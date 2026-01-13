import { inngest } from "./client";
import { db } from "@/db";
import {
  emails,
  transactions,
  extractionRuns,
  emailExtractions,
  extractionLogs,
  prompts,
  discussionSummaries,
  jobs,
  qaRuns,
  qaResults,
} from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { extractTransaction, DEFAULT_MODEL_ID } from "@/services/ai-extractor";
import { normalizeTransaction, detectOrCreateAccount } from "@/services/transaction-normalizer";
import { SOFTWARE_VERSION } from "@/config/version";

/**
 * Orchestrator function - creates the run and fans out to individual email processors
 * This function returns quickly after dispatching all email events
 */
export const extractionOrchestrator = inngest.createFunction(
  {
    id: "extraction-orchestrator",
    retries: 3,
    // Cancel if a new orchestrator starts for the same run
    cancelOn: [
      {
        event: "extraction/cancel",
        match: "data.runId",
      },
    ],
  },
  { event: "extraction/started" },
  async ({ event, step }) => {
    const { setId, modelId: inputModelId, promptId, sampleSize, resumeRunId } = event.data;
    const modelId = inputModelId || DEFAULT_MODEL_ID;

    // Step 1: Initialize or resume the extraction run
    const runInfo = await step.run("initialize-run", async () => {
      let extractionRunId: string;
      let alreadyProcessedEmailIds: string[] = [];
      let isResume = false;
      let effectiveSetId = setId;
      let effectivePromptId = promptId;
      let effectiveModelId = modelId;

      if (resumeRunId) {
        // Resuming an existing run
        const [existingRun] = await db
          .select()
          .from(extractionRuns)
          .where(eq(extractionRuns.id, resumeRunId))
          .limit(1);

        if (!existingRun) {
          throw new Error(`Run not found: ${resumeRunId}`);
        }

        if (existingRun.status === "completed") {
          throw new Error("Cannot resume a completed run");
        }

        if (existingRun.status === "running") {
          throw new Error("Run is already in progress");
        }

        extractionRunId = existingRun.id;
        effectiveSetId = existingRun.setId;
        effectivePromptId = existingRun.promptId;
        effectiveModelId = existingRun.modelId;
        isResume = true;

        // Get already processed emails
        const processedExtractions = await db
          .select({ emailId: emailExtractions.emailId })
          .from(emailExtractions)
          .where(eq(emailExtractions.runId, existingRun.id));

        alreadyProcessedEmailIds = processedExtractions.map((e) => e.emailId);

        // Update run status back to running
        await db
          .update(extractionRuns)
          .set({ status: "running" })
          .where(eq(extractionRuns.id, extractionRunId));

        console.log(
          `[Inngest] Resuming run ${extractionRunId}: ${alreadyProcessedEmailIds.length} already processed`
        );
      } else {
        // Create new run
        extractionRunId = uuid();
        const [latestRun] = await db
          .select({ version: extractionRuns.version })
          .from(extractionRuns)
          .orderBy(desc(extractionRuns.version))
          .limit(1);
        const nextVersion = (latestRun?.version || 0) + 1;

        // Create job record
        const jobId = uuid();
        await db.insert(jobs).values({
          id: jobId,
          type: "extraction",
          status: "running",
          startedAt: new Date(),
          metadata: {
            setId: effectiveSetId,
            modelId: effectiveModelId,
            promptId: effectivePromptId,
            softwareVersion: SOFTWARE_VERSION,
            inngest: true,
          },
        });

        await db.insert(extractionRuns).values({
          id: extractionRunId,
          jobId,
          setId: effectiveSetId,
          version: nextVersion,
          modelId: effectiveModelId,
          promptId: effectivePromptId,
          softwareVersion: SOFTWARE_VERSION,
          config: { sampleSize },
          status: "running",
          startedAt: new Date(),
          emailsProcessed: 0,
          transactionsCreated: 0,
          informationalCount: 0,
          errorCount: 0,
        });

        console.log(`[Inngest] Created new run v${nextVersion}: ${extractionRunId}`);
      }

      return {
        extractionRunId,
        setId: effectiveSetId,
        promptId: effectivePromptId,
        modelId: effectiveModelId,
        alreadyProcessedEmailIds,
        isResume,
      };
    });

    // Step 2: Fetch prompt and email IDs to process
    const workload = await step.run("fetch-workload", async () => {
      // Fetch prompt
      const [prompt] = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, runInfo.promptId))
        .limit(1);

      if (!prompt) {
        throw new Error(`Prompt not found: ${runInfo.promptId}`);
      }

      // Fetch email IDs from set
      let emailIds = await db
        .select({ id: emails.id })
        .from(emails)
        .where(eq(emails.setId, runInfo.setId));

      // Filter out already processed emails if resuming
      if (runInfo.alreadyProcessedEmailIds.length > 0) {
        const processedSet = new Set(runInfo.alreadyProcessedEmailIds);
        emailIds = emailIds.filter((e) => !processedSet.has(e.id));
      }

      // Apply sampling if specified (only for new runs)
      if (!runInfo.isResume && sampleSize && sampleSize > 0 && sampleSize < emailIds.length) {
        const shuffled = [...emailIds];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        emailIds = shuffled.slice(0, sampleSize);
      }

      // Update job total
      const [runForJob] = await db
        .select({ jobId: extractionRuns.jobId })
        .from(extractionRuns)
        .where(eq(extractionRuns.id, runInfo.extractionRunId))
        .limit(1);

      if (runForJob?.jobId) {
        await db
          .update(jobs)
          .set({ totalItems: emailIds.length + runInfo.alreadyProcessedEmailIds.length })
          .where(eq(jobs.id, runForJob.jobId));
      }

      return {
        promptContent: prompt.content,
        jsonSchema: prompt.jsonSchema as Record<string, unknown> | null,
        emailIds: emailIds.map((e) => e.id),
        totalEmails: emailIds.length + runInfo.alreadyProcessedEmailIds.length,
      };
    });

    // Step 3: Fan out - send an event for each email to be processed
    await step.run("dispatch-email-events", async () => {
      const events = workload.emailIds.map((emailId) => ({
        name: "extraction/process-email" as const,
        data: {
          runId: runInfo.extractionRunId,
          emailId,
          modelId: runInfo.modelId,
          promptContent: workload.promptContent,
          jsonSchema: workload.jsonSchema,
          totalEmails: workload.totalEmails,
        },
      }));

      // Send all events in batches (Inngest has a limit per request)
      const BATCH_SIZE = 100;
      for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);
        await inngest.send(batch);
      }

      console.log(`[Inngest] Dispatched ${events.length} email processing events for run ${runInfo.extractionRunId}`);
    });

    return {
      runId: runInfo.extractionRunId,
      emailsDispatched: workload.emailIds.length,
      totalEmails: workload.totalEmails,
    };
  }
);

/**
 * Email processor function - processes a single email
 * Inngest manages concurrency via the concurrency option
 */
export const extractionProcessEmail = inngest.createFunction(
  {
    id: "extraction-process-email",
    retries: 3,
    // Concurrency limit - Inngest will queue excess invocations
    concurrency: {
      limit: 75, // Anthropic paid tier allows ~100 concurrent requests
      key: "event.data.runId", // Partition by run so different runs don't block each other
    },
    // Cancel queued jobs when run is cancelled
    cancelOn: [
      {
        event: "extraction/cancel",
        match: "data.runId",
      },
    ],
  },
  { event: "extraction/process-email" },
  async ({ event, step }) => {
    const { runId, emailId, modelId, promptContent, jsonSchema, totalEmails } = event.data;

    // Define extraction result type
    type ExtractionResultSuccess = {
      success: true;
      extraction: {
        isTransactional: boolean;
        emailType: string;
        transactions: Array<Record<string, unknown>>;
        extractionNotes?: string;
        discussionSummary: string | null;
        relatedReferenceNumbers: string[];
      };
      processingTimeMs: number;
    };
    type ExtractionResultFailure = {
      success: false;
      processingTimeMs: number;
      error: string;
      errorStack?: string;
      errorName: string;
    };
    type ExtractionResult = ExtractionResultSuccess | ExtractionResultFailure;

    // Step 1: Fetch the email and process it
    const extractionResult: ExtractionResult = await step.run("extract", async () => {
      const [email] = await db
        .select()
        .from(emails)
        .where(eq(emails.id, emailId))
        .limit(1);

      if (!email) {
        return {
          success: false as const,
          error: "Email not found",
          errorName: "NotFoundError",
          processingTimeMs: 0,
        };
      }

      const parsedEmail = {
        id: email.id,
        filename: email.filename,
        subject: email.subject,
        sender: email.sender,
        senderName: email.senderName,
        recipient: email.recipient,
        recipientName: email.recipientName,
        cc: email.cc,
        replyTo: email.replyTo,
        messageId: email.messageId,
        inReplyTo: email.inReplyTo,
        date: email.date,
        receivedAt: email.receivedAt,
        bodyText: email.bodyText,
        bodyHtml: email.bodyHtml,
        rawContent: email.rawContent,
        headers: (email.headers as Record<string, string>) || {},
      };

      const startTime = Date.now();
      try {
        const extraction = await extractTransaction(
          parsedEmail,
          modelId,
          promptContent,
          jsonSchema
        );
        const endTime = Date.now();

        return {
          success: true as const,
          extraction: {
            isTransactional: extraction.isTransactional,
            emailType: extraction.emailType,
            transactions: extraction.transactions as Array<Record<string, unknown>>,
            extractionNotes: extraction.extractionNotes || undefined,
            discussionSummary: extraction.discussionSummary ?? null,
            relatedReferenceNumbers: extraction.relatedReferenceNumbers ?? [],
          },
          processingTimeMs: endTime - startTime,
        };
      } catch (error) {
        const endTime = Date.now();
        return {
          success: false as const,
          processingTimeMs: endTime - startTime,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
          errorName: error instanceof Error ? error.name : "UnknownError",
        };
      }
    });

    // Step 2: Write results to DB and update counters
    const writeResult = await step.run("write-results", async () => {
      // Get job ID for error logging
      const [runForJob] = await db
        .select({ jobId: extractionRuns.jobId })
        .from(extractionRuns)
        .where(eq(extractionRuns.id, runId))
        .limit(1);
      const jobId = runForJob?.jobId || null;

      let transactionsCreated = 0;
      let isInformational = false;
      let isFailed = false;

      if (extractionResult.success && extractionResult.extraction) {
        const extraction = extractionResult.extraction;
        const txIds: string[] = [];
        const discussionSummary = extraction.discussionSummary?.trim();
        const isEvidence = extraction.emailType === "evidence";

        // Insert discussion summary if present
        if (discussionSummary) {
          await db.insert(discussionSummaries).values({
            id: uuid(),
            emailId,
            runId,
            summary: discussionSummary,
            relatedReferenceNumbers: Array.isArray(extraction.relatedReferenceNumbers)
              ? extraction.relatedReferenceNumbers
              : [],
          });
        }

        if (!isEvidence && extraction.isTransactional && extraction.transactions.length > 0) {
          // Process transactions
          for (const txData of extraction.transactions) {
            const typedTxData = txData as Record<string, unknown>;

            // Resolve accounts
            const fromAccount = await detectOrCreateAccount({
              accountNumber: typedTxData.accountNumber as string | null,
              accountName: typedTxData.accountName as string | null,
              institution: typedTxData.institution as string | null,
            });

            let toAccount = null;
            if (typedTxData.toAccountNumber || typedTxData.toAccountName) {
              toAccount = await detectOrCreateAccount({
                accountNumber: typedTxData.toAccountNumber as string | null,
                accountName: typedTxData.toAccountName as string | null,
                institution: typedTxData.toInstitution as string | null,
                isExternal:
                  typedTxData.transactionType === "wire_transfer_out" ||
                  typedTxData.transactionType === "wire_transfer_in",
              });
            }

            const normalizedTx = normalizeTransaction(
              { ...typedTxData, isTransaction: true, extractionNotes: null } as Parameters<typeof normalizeTransaction>[0],
              fromAccount?.id || null,
              toAccount?.id || null
            );
            const txId = uuid();
            txIds.push(txId);

            await db.insert(transactions).values({
              ...normalizedTx,
              id: txId,
              sourceEmailId: emailId,
              extractionRunId: runId,
              runCompleted: false,
            });
            transactionsCreated++;
          }

          // Calculate average confidence
          const confidences = extraction.transactions
            .map((t) => (t as Record<string, unknown>).confidence as number | null | undefined)
            .filter((c): c is number => c !== null && c !== undefined);
          const avgConfidence =
            confidences.length > 0
              ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
              : null;

          // Insert extraction record
          await db.insert(emailExtractions).values({
            id: uuid(),
            emailId,
            runId,
            status: "completed",
            rawExtraction: {
              isTransactional: extraction.isTransactional,
              emailType: extraction.emailType,
              transactions: extraction.transactions,
              extractionNotes: extraction.extractionNotes,
              discussionSummary: extraction.discussionSummary ?? null,
              relatedReferenceNumbers: extraction.relatedReferenceNumbers ?? [],
            },
            confidence: avgConfidence ? avgConfidence.toFixed(2) : null,
            processingTimeMs: extractionResult.processingTimeMs,
            transactionIds: txIds,
          });
        } else {
          // Non-transactional email
          isInformational = true;
          await db.insert(emailExtractions).values({
            id: uuid(),
            emailId,
            runId,
            status: "informational",
            rawExtraction: {
              isTransactional: extraction.isTransactional,
              emailType: extraction.emailType,
              transactions: extraction.transactions,
              extractionNotes: extraction.extractionNotes,
              discussionSummary: extraction.discussionSummary ?? null,
              relatedReferenceNumbers: extraction.relatedReferenceNumbers ?? [],
            },
            confidence: null,
            processingTimeMs: extractionResult.processingTimeMs,
            transactionIds: [],
          });
        }
      } else {
        // Failed extraction - cast to failure type since we're in the else branch
        const failedResult = extractionResult as ExtractionResultFailure;
        isFailed = true;

        await db.insert(extractionLogs).values({
          id: uuid(),
          emailId,
          jobId,
          level: "error",
          message: `[Model: ${modelId}] ${failedResult.error || "Unknown error"}`,
          errorType: failedResult.errorName?.includes("API")
            ? "api_error"
            : failedResult.errorName?.includes("Schema")
            ? "schema_validation"
            : "unknown",
          stackTrace: failedResult.errorStack || null,
          metadata: {
            name: failedResult.errorName || "UnknownError",
            timestamp: new Date().toISOString(),
            runId,
          },
        });

        await db.insert(emailExtractions).values({
          id: uuid(),
          emailId,
          runId,
          status: "failed",
          rawExtraction: {
            isTransactional: false,
            emailType: "error",
            transactions: [],
            extractionNotes: failedResult.error,
          },
          confidence: null,
          processingTimeMs: failedResult.processingTimeMs,
          transactionIds: [],
        });

        console.error(`[Inngest] Error processing email ${emailId}: ${failedResult.error}`);
      }

      // Atomically update run counters and check if we're done
      const updateResult = await db
        .update(extractionRuns)
        .set({
          emailsProcessed: sql`${extractionRuns.emailsProcessed} + 1`,
          transactionsCreated: sql`${extractionRuns.transactionsCreated} + ${transactionsCreated}`,
          informationalCount: isInformational
            ? sql`${extractionRuns.informationalCount} + 1`
            : extractionRuns.informationalCount,
          errorCount: isFailed
            ? sql`${extractionRuns.errorCount} + 1`
            : extractionRuns.errorCount,
        })
        .where(eq(extractionRuns.id, runId))
        .returning({
          emailsProcessed: extractionRuns.emailsProcessed,
          transactionsCreated: extractionRuns.transactionsCreated,
          jobId: extractionRuns.jobId,
        });

      const updatedRun = updateResult[0];

      // Update job progress
      if (updatedRun?.jobId) {
        await db
          .update(jobs)
          .set({
            processedItems: updatedRun.emailsProcessed,
          })
          .where(eq(jobs.id, updatedRun.jobId));
      }

      return {
        transactionsCreated,
        isInformational,
        isFailed,
        totalProcessed: updatedRun?.emailsProcessed || 0,
        isComplete: updatedRun?.emailsProcessed === totalEmails,
        jobId: updatedRun?.jobId,
      };
    });

    // Step 3: If this was the last email, finalize the run
    if (writeResult.isComplete) {
      await step.run("finalize-run", async () => {
        // Mark all transactions as completed
        await db
          .update(transactions)
          .set({ runCompleted: true })
          .where(eq(transactions.extractionRunId, runId));

        // Update run status to completed
        await db
          .update(extractionRuns)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(extractionRuns.id, runId));

        // Update job status
        if (writeResult.jobId) {
          await db
            .update(jobs)
            .set({
              status: "completed",
              completedAt: new Date(),
            })
            .where(eq(jobs.id, writeResult.jobId));
        }

        console.log(`[Inngest] Run ${runId} complete: ${totalEmails} emails processed`);
      });
    }

    return {
      emailId,
      success: extractionResult.success,
      transactionsCreated: writeResult.transactionsCreated,
      isComplete: writeResult.isComplete,
    };
  }
);

/**
 * QA Orchestrator - creates the QA run and fans out to individual transaction processors
 */
export const qaOrchestrator = inngest.createFunction(
  {
    id: "qa-orchestrator",
    retries: 3,
    cancelOn: [
      {
        event: "qa/cancel",
        match: "data.qaRunId",
      },
    ],
  },
  { event: "qa/started" },
  async ({ event, step }) => {
    const { qaRunId, sourceRunId, modelId, promptId, filters } = event.data;

    // Step 1: Initialize the QA run
    const runInfo = await step.run("initialize-qa-run", async () => {
      // Get source run info
      const [sourceRun] = await db
        .select()
        .from(extractionRuns)
        .where(eq(extractionRuns.id, sourceRunId))
        .limit(1);

      if (!sourceRun) {
        throw new Error(`Source run not found: ${sourceRunId}`);
      }

      // Get transactions to QA with optional filtering
      let transactionsQuery = db
        .select({
          id: transactions.id,
          sourceEmailId: transactions.sourceEmailId,
          type: transactions.type,
          confidence: transactions.confidence,
        })
        .from(transactions)
        .where(eq(transactions.extractionRunId, sourceRunId));

      const txList = await transactionsQuery;

      // Apply filters
      let filteredTx = txList;
      if (filters?.transactionTypes?.length) {
        filteredTx = filteredTx.filter((t) =>
          filters.transactionTypes!.includes(t.type)
        );
      }
      if (filters?.minConfidence !== undefined) {
        filteredTx = filteredTx.filter(
          (t) => t.confidence && parseFloat(t.confidence) >= filters.minConfidence!
        );
      }
      if (filters?.maxConfidence !== undefined) {
        filteredTx = filteredTx.filter(
          (t) => t.confidence && parseFloat(t.confidence) <= filters.maxConfidence!
        );
      }

      // Update QA run with total count
      await db
        .update(qaRuns)
        .set({
          status: "running",
          startedAt: new Date(),
          transactionsTotal: filteredTx.length,
        })
        .where(eq(qaRuns.id, qaRunId));

      console.log(
        `[Inngest QA] Starting QA run ${qaRunId}: ${filteredTx.length} transactions to check`
      );

      return {
        qaRunId,
        setId: sourceRun.setId,
        transactionIds: filteredTx.map((t) => ({
          id: t.id,
          emailId: t.sourceEmailId,
        })),
        totalTransactions: filteredTx.length,
      };
    });

    // Step 2: Fetch prompt
    const promptContent = await step.run("fetch-prompt", async () => {
      const [prompt] = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, promptId))
        .limit(1);

      if (!prompt) {
        throw new Error(`Prompt not found: ${promptId}`);
      }

      return prompt.content;
    });

    // Step 3: Fan out - send an event for each transaction to be QA'd
    await step.run("dispatch-qa-events", async () => {
      const events = runInfo.transactionIds.map((tx) => ({
        name: "qa/process-transaction" as const,
        data: {
          qaRunId: runInfo.qaRunId,
          transactionId: tx.id,
          emailId: tx.emailId,
          modelId,
          promptContent,
          totalTransactions: runInfo.totalTransactions,
        },
      }));

      // Send all events in batches
      const BATCH_SIZE = 100;
      for (let i = 0; i < events.length; i += BATCH_SIZE) {
        const batch = events.slice(i, i + BATCH_SIZE);
        await inngest.send(batch);
      }

      console.log(
        `[Inngest QA] Dispatched ${events.length} QA events for run ${runInfo.qaRunId}`
      );
    });

    return {
      qaRunId: runInfo.qaRunId,
      transactionsDispatched: runInfo.transactionIds.length,
      totalTransactions: runInfo.totalTransactions,
    };
  }
);

/**
 * QA Transaction Processor - QAs a single transaction against its source email
 */
export const qaProcessTransaction = inngest.createFunction(
  {
    id: "qa-process-transaction",
    retries: 3,
    concurrency: {
      limit: 50,
      key: "event.data.qaRunId",
    },
    cancelOn: [
      {
        event: "qa/cancel",
        match: "data.qaRunId",
      },
    ],
  },
  { event: "qa/process-transaction" },
  async ({ event, step }) => {
    const { qaRunId, transactionId, emailId, modelId, promptContent, totalTransactions } =
      event.data;

    // Step 1: Fetch transaction and email data
    const qaData = await step.run("fetch-data", async () => {
      const [tx] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, transactionId))
        .limit(1);

      if (!tx) {
        throw new Error(`Transaction not found: ${transactionId}`);
      }

      const [email] = await db
        .select()
        .from(emails)
        .where(eq(emails.id, emailId!))
        .limit(1);

      if (!email) {
        throw new Error(`Email not found: ${emailId}`);
      }

      // Build transaction JSON (exclude internal fields)
      const txJson = {
        type: tx.type,
        amount: tx.amount,
        currency: tx.currency,
        date: tx.date,
        symbol: tx.symbol,
        description: tx.description,
        category: tx.category,
        quantity: tx.quantity,
        quantityExecuted: tx.quantityExecuted,
        quantityRemaining: tx.quantityRemaining,
        price: tx.price,
        executionPrice: tx.executionPrice,
        priceType: tx.priceType,
        limitPrice: tx.limitPrice,
        fees: tx.fees,
        contractSize: tx.contractSize,
        optionType: tx.optionType,
        strikePrice: tx.strikePrice,
        expirationDate: tx.expirationDate,
        optionAction: tx.optionAction,
        securityName: tx.securityName,
        grantNumber: tx.grantNumber,
        vestDate: tx.vestDate,
        orderId: tx.orderId,
        orderType: tx.orderType,
        orderQuantity: tx.orderQuantity,
        orderPrice: tx.orderPrice,
        orderStatus: tx.orderStatus,
        timeInForce: tx.timeInForce,
        referenceNumber: tx.referenceNumber,
        partiallyExecuted: tx.partiallyExecuted,
        executionTime: tx.executionTime,
        data: tx.data,
        confidence: tx.confidence,
      };

      // Remove null/undefined fields for cleaner JSON
      const cleanTxJson = Object.fromEntries(
        Object.entries(txJson).filter(([, v]) => v !== null && v !== undefined)
      );

      return {
        transactionJson: JSON.stringify(cleanTxJson, null, 2),
        emailSubject: email.subject,
        emailBody: email.bodyText || email.bodyHtml || "",
        emailSender: email.sender,
        emailDate: email.date,
      };
    });

    // Step 2: Call the AI model for QA
    type QAModelResult = {
      success: true;
      hasIssues: boolean;
      fieldIssues: Array<{
        field: string;
        currentValue: unknown;
        suggestedValue: unknown;
        confidence: "high" | "medium" | "low";
        reason: string;
      }>;
      duplicateFields: Array<{
        fields: string[];
        suggestedCanonical: string;
        reason: string;
      }>;
      overallAssessment?: string;
    } | {
      success: false;
      error: string;
    };

    const qaResult: QAModelResult = await step.run("qa-with-model", async () => {
      try {
        const { generateText } = await import("ai");
        const { anthropic } = await import("@ai-sdk/anthropic");
        const { openai } = await import("@ai-sdk/openai");
        const { google } = await import("@ai-sdk/google");

        // Determine provider from model ID
        let model;
        if (modelId.includes("claude")) {
          model = anthropic(modelId);
        } else if (modelId.includes("gpt") || modelId.includes("o1") || modelId.includes("o3")) {
          model = openai(modelId);
        } else if (modelId.includes("gemini")) {
          model = google(modelId);
        } else {
          // Default to anthropic
          model = anthropic(modelId);
        }

        const systemPrompt = promptContent;
        const userMessage = `## Email Information
Subject: ${qaData.emailSubject}
From: ${qaData.emailSender}
Date: ${qaData.emailDate}

## Email Body
${qaData.emailBody}

## Extracted Transaction Data
\`\`\`json
${qaData.transactionJson}
\`\`\`

Please verify this transaction data against the email content and return your findings as JSON.`;

        const response = await generateText({
          model,
          system: systemPrompt,
          prompt: userMessage,
        });

        const text = response.text;

        // Try to extract JSON from the response
        let jsonMatch = text.match(/```json\n?([\s\S]*?)\n?```/);
        let parsed: Record<string, unknown>;

        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[1]);
        } else {
          // Try parsing the entire response as JSON
          parsed = JSON.parse(text);
        }

        return {
          success: true as const,
          hasIssues: parsed.hasIssues as boolean ?? false,
          fieldIssues: (parsed.fieldIssues as Array<{
            field: string;
            currentValue: unknown;
            suggestedValue: unknown;
            confidence: "high" | "medium" | "low";
            reason: string;
          }>) || [],
          duplicateFields: (parsed.duplicateFields as Array<{
            fields: string[];
            suggestedCanonical: string;
            reason: string;
          }>) || [],
          overallAssessment: parsed.overallAssessment as string | undefined,
        };
      } catch (error) {
        console.error(`[Inngest QA] Error processing transaction ${transactionId}:`, error);
        return {
          success: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    });

    // Step 3: Write results and update counters
    const writeResult = await step.run("write-results", async () => {
      if (qaResult.success) {
        // Insert QA result
        await db.insert(qaResults).values({
          id: uuid(),
          qaRunId,
          transactionId,
          sourceEmailId: emailId!,
          hasIssues: qaResult.hasIssues,
          fieldIssues: qaResult.fieldIssues,
          duplicateFields: qaResult.duplicateFields,
          overallAssessment: qaResult.overallAssessment || null,
          status: "pending_review",
        });
      } else {
        // Insert failed result
        await db.insert(qaResults).values({
          id: uuid(),
          qaRunId,
          transactionId,
          sourceEmailId: emailId!,
          hasIssues: false,
          fieldIssues: [],
          duplicateFields: [],
          overallAssessment: `Error: ${qaResult.error}`,
          status: "pending_review",
        });
      }

      // Update QA run counters
      const hasIssues = qaResult.success && qaResult.hasIssues;
      const updateResult = await db
        .update(qaRuns)
        .set({
          transactionsChecked: sql`${qaRuns.transactionsChecked} + 1`,
          issuesFound: hasIssues
            ? sql`${qaRuns.issuesFound} + 1`
            : qaRuns.issuesFound,
        })
        .where(eq(qaRuns.id, qaRunId))
        .returning({
          transactionsChecked: qaRuns.transactionsChecked,
          transactionsTotal: qaRuns.transactionsTotal,
        });

      const updated = updateResult[0];
      const isComplete = updated?.transactionsChecked === totalTransactions;

      return { isComplete, hasIssues };
    });

    // Step 4: If this was the last transaction, finalize the run
    if (writeResult.isComplete) {
      await step.run("finalize-qa-run", async () => {
        await db
          .update(qaRuns)
          .set({
            status: "completed",
            completedAt: new Date(),
          })
          .where(eq(qaRuns.id, qaRunId));

        console.log(`[Inngest QA] QA run ${qaRunId} complete`);
      });
    }

    return {
      transactionId,
      success: qaResult.success,
      hasIssues: writeResult.hasIssues,
      isComplete: writeResult.isComplete,
    };
  }
);

// Export all functions
export const functions = [
  extractionOrchestrator,
  extractionProcessEmail,
  qaOrchestrator,
  qaProcessTransaction,
];
