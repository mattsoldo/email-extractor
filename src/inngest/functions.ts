import { inngest } from "./client";
import { db } from "@/db";
import {
  emails,
  transactions,
  accounts,
  extractionRuns,
  emailExtractions,
  extractionLogs,
  prompts,
  discussionSummaries,
  jobs,
} from "@/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { extractTransaction, DEFAULT_MODEL_ID } from "@/services/ai-extractor";
import { normalizeTransaction } from "@/services/transaction-normalizer";
import { SOFTWARE_VERSION } from "@/config/version";
import { getModelConcurrencyLimit } from "@/services/model-config";

// DB batch size for final writes
const DB_BATCH_SIZE = 100;

/**
 * Process a single email extraction
 * Returns the extraction result without writing to DB
 */
async function processEmail(
  email: typeof emails.$inferSelect,
  modelId: string,
  promptContent: string,
  jsonSchema: Record<string, unknown> | null
): Promise<{
  emailId: string;
  success: boolean;
  extraction?: {
    isTransactional: boolean;
    emailType: string;
    transactions: Array<Record<string, unknown>>;
    extractionNotes?: string;
    discussionSummary?: string | null;
    relatedReferenceNumbers?: string[];
  };
  processingTimeMs: number;
  error?: string;
  errorStack?: string;
  errorName?: string;
}> {
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
      emailId: email.id,
      success: true,
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
      emailId: email.id,
      success: false,
      processingTimeMs: endTime - startTime,
      error: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorName: error instanceof Error ? error.name : "UnknownError",
    };
  }
}

/**
 * Main extraction function using Inngest steps
 * Each email is processed as an individual step for maximum parallelism
 */
export const extractionJob = inngest.createFunction(
  {
    id: "extraction-job",
    // Retry configuration for individual steps
    retries: 3,
    // Cancel running job if a new one starts for same run
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
      let existingTransactionsCount = 0;
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
        existingTransactionsCount = existingRun.transactionsCreated || 0;

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
        });

        console.log(`[Inngest] Created new run v${nextVersion}: ${extractionRunId}`);
      }

      return {
        extractionRunId,
        setId: effectiveSetId,
        promptId: effectivePromptId,
        modelId: effectiveModelId,
        alreadyProcessedEmailIds,
        existingTransactionsCount,
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
          .set({ totalItems: emailIds.length })
          .where(eq(jobs.id, runForJob.jobId));
      }

      return {
        promptContent: prompt.content,
        jsonSchema: prompt.jsonSchema,
        emailIds: emailIds.map((e) => e.id),
        totalEmails: emailIds.length,
      };
    });

    // Get concurrency limit based on the model's provider
    const concurrencyLimit = getModelConcurrencyLimit(runInfo.modelId);
    console.log(`[Inngest] Processing ${workload.totalEmails} emails with concurrency limit ${concurrencyLimit} (model: ${runInfo.modelId})`);

    // Step 3: Process email extractions in waves to respect provider rate limits
    // Instead of kicking off all steps at once, process in batches
    const extractionResults: Awaited<ReturnType<typeof processEmail>>[] = [];

    for (let waveStart = 0; waveStart < workload.emailIds.length; waveStart += concurrencyLimit) {
      const waveEmailIds = workload.emailIds.slice(waveStart, waveStart + concurrencyLimit);
      const waveNumber = Math.floor(waveStart / concurrencyLimit) + 1;
      const totalWaves = Math.ceil(workload.emailIds.length / concurrencyLimit);

      console.log(`[Inngest] Processing wave ${waveNumber}/${totalWaves} (${waveEmailIds.length} emails)`);

      // Kick off this wave's extractions in parallel
      const wavePromises = waveEmailIds.map((emailId) =>
        step.run(`extract-${emailId}`, async () => {
          // Fetch the email
          const [email] = await db
            .select()
            .from(emails)
            .where(eq(emails.id, emailId))
            .limit(1);

          if (!email) {
            return {
              emailId,
              success: false,
              processingTimeMs: 0,
              error: "Email not found",
              errorName: "NotFoundError",
            };
          }

          // Process the email
          return processEmail(
            email,
            runInfo.modelId,
            workload.promptContent,
            workload.jsonSchema
          );
        })
      );

      // Wait for this wave to complete before starting the next
      const waveResults = await Promise.all(wavePromises);
      extractionResults.push(...waveResults);
    }

    console.log(`[Inngest] All ${extractionResults.length} extractions complete, writing to DB`);

    // Step 4: Write all results to DB in batches
    const writeResult = await step.run("write-results", async () => {
      // Pre-fetch accounts for efficient resolution
      const existingAccounts = await db.select().from(accounts);
      const accountsByMaskedNumber = new Map<string, (typeof existingAccounts)[0]>();
      const accountsByName = new Map<string, (typeof existingAccounts)[0]>();

      for (const account of existingAccounts) {
        if (account.maskedNumber) {
          accountsByMaskedNumber.set(
            account.maskedNumber.replace(/[\s-]/g, "").toUpperCase(),
            account
          );
        }
        if (account.displayName) {
          accountsByName.set(account.displayName.toLowerCase(), account);
        }
      }

      const accountCache = new Map<string, string | null>();
      const newAccountsToCreate: Array<{
        id: string;
        displayName: string;
        institution: string | null;
        accountNumber: string | null;
        maskedNumber: string | null;
        accountType: string | null;
        corpusId: string | null;
        isExternal: boolean;
        metadata: Record<string, unknown>;
        createdAt: Date;
        updatedAt: Date;
      }> = [];

      function getAccountCacheKey(input: {
        accountNumber?: string | null;
        accountName?: string | null;
        institution?: string | null;
      }): string {
        return `${input.accountNumber || ""}_${input.accountName || ""}_${input.institution || ""}`;
      }

      function findOrCreateAccountSync(input: {
        accountNumber?: string | null;
        accountName?: string | null;
        institution?: string | null;
        isExternal?: boolean;
      }): string | null {
        if (!input.accountNumber && !input.accountName) {
          return null;
        }

        const cacheKey = getAccountCacheKey(input);
        if (accountCache.has(cacheKey)) {
          return accountCache.get(cacheKey)!;
        }

        if (input.accountNumber) {
          const normalizedNumber = input.accountNumber.replace(/[\s-]/g, "").toUpperCase();
          const existing = accountsByMaskedNumber.get(normalizedNumber);
          if (existing) {
            accountCache.set(cacheKey, existing.id);
            return existing.id;
          }
          const last4 = normalizedNumber.match(/(\d{4})$/)?.[1];
          if (last4) {
            for (const [key, account] of accountsByMaskedNumber) {
              if (key.endsWith(last4)) {
                accountCache.set(cacheKey, account.id);
                return account.id;
              }
            }
          }
        }

        if (input.accountName) {
          const existing = accountsByName.get(input.accountName.toLowerCase());
          if (existing) {
            accountCache.set(cacheKey, existing.id);
            return existing.id;
          }
        }

        const newId = uuid();
        const newAccount = {
          id: newId,
          displayName: input.accountName || input.accountNumber || "Unknown Account",
          institution: input.institution || null,
          accountNumber: input.accountNumber?.includes("X")
            ? null
            : input.accountNumber || null,
          maskedNumber: input.accountNumber || null,
          accountType: null,
          corpusId: null,
          isExternal: input.isExternal || false,
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        newAccountsToCreate.push(newAccount);

        if (newAccount.maskedNumber) {
          accountsByMaskedNumber.set(
            newAccount.maskedNumber.replace(/[\s-]/g, "").toUpperCase(),
            newAccount as (typeof existingAccounts)[0]
          );
        }
        if (newAccount.displayName) {
          accountsByName.set(
            newAccount.displayName.toLowerCase(),
            newAccount as (typeof existingAccounts)[0]
          );
        }

        accountCache.set(cacheKey, newId);
        return newId;
      }

      // Get job ID for error logging
      const [runForJob] = await db
        .select({ jobId: extractionRuns.jobId })
        .from(extractionRuns)
        .where(eq(extractionRuns.id, runInfo.extractionRunId))
        .limit(1);
      const jobId = runForJob?.jobId || null;

      // Process all extraction results
      const transactionsToInsert: Array<{
        id: string;
        emailId: string;
        data: ReturnType<typeof normalizeTransaction>;
      }> = [];
      const extractionsToInsert: Array<{
        id: string;
        emailId: string;
        runId: string;
        status: "completed" | "informational" | "skipped" | "failed";
        rawExtraction: {
          isTransactional: boolean;
          emailType: string;
          transactions: Array<Record<string, unknown>>;
          extractionNotes?: string;
          skipReason?: string;
          informationalNotes?: string;
          discussionSummary?: string | null;
          relatedReferenceNumbers?: string[];
        };
        confidence: string | null;
        processingTimeMs: number;
        transactionIds: string[];
      }> = [];
      const discussionSummariesToInsert: Array<{
        id: string;
        emailId: string;
        runId: string;
        summary: string;
        relatedReferenceNumbers: string[];
      }> = [];
      const errorLogsToInsert: Array<{
        id: string;
        emailId: string;
        jobId: string | null;
        level: "error";
        message: string;
        errorType: string;
        stackTrace: string | null;
        metadata: Record<string, unknown>;
      }> = [];

      let totalTransactions = 0;
      let failedCount = 0;
      let informationalCount = 0;

      for (const result of extractionResults) {
        if (result.success && result.extraction) {
          const extraction = result.extraction;
          const txIds: string[] = [];
          const discussionSummary = extraction.discussionSummary?.trim();
          const isEvidence = extraction.emailType === "evidence";
          if (discussionSummary) {
            discussionSummariesToInsert.push({
              id: uuid(),
              emailId: result.emailId,
              runId: runInfo.extractionRunId,
              summary: discussionSummary,
              relatedReferenceNumbers: Array.isArray(extraction.relatedReferenceNumbers)
                ? extraction.relatedReferenceNumbers
                : [],
            });
          }

          if (!isEvidence && extraction.isTransactional && extraction.transactions.length > 0) {
            for (const txData of extraction.transactions) {
              const typedTxData = txData as Record<string, unknown>;

              const fromAccountId = findOrCreateAccountSync({
                accountNumber: typedTxData.accountNumber as string | null,
                accountName: typedTxData.accountName as string | null,
                institution: typedTxData.institution as string | null,
              });

              let toAccountId: string | null = null;
              if (typedTxData.toAccountNumber || typedTxData.toAccountName) {
                toAccountId = findOrCreateAccountSync({
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
                fromAccountId,
                toAccountId
              );
              const txId = uuid();
              txIds.push(txId);

              transactionsToInsert.push({
                id: txId,
                emailId: result.emailId,
                data: normalizedTx,
              });
              totalTransactions++;
            }

            const confidences = extraction.transactions
              .map((t) => (t as Record<string, unknown>).confidence as number | null | undefined)
              .filter((c): c is number => c !== null && c !== undefined);
            const avgConfidence =
              confidences.length > 0
                ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
                : null;

            extractionsToInsert.push({
              id: uuid(),
              emailId: result.emailId,
              runId: runInfo.extractionRunId,
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
              processingTimeMs: result.processingTimeMs,
              transactionIds: txIds,
            });
          } else {
            // Non-transactional email
            extractionsToInsert.push({
              id: uuid(),
              emailId: result.emailId,
              runId: runInfo.extractionRunId,
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
              processingTimeMs: result.processingTimeMs,
              transactionIds: [],
            });
            informationalCount++;
          }
        } else {
          // Failed extraction
          failedCount++;

          errorLogsToInsert.push({
            id: uuid(),
            emailId: result.emailId,
            jobId,
            level: "error",
            message: `[Model: ${runInfo.modelId}] ${result.error || "Unknown error"}`,
            errorType: result.errorName?.includes("API")
              ? "api_error"
              : result.errorName?.includes("Schema")
              ? "schema_validation"
              : "unknown",
            stackTrace: result.errorStack || null,
            metadata: {
              name: result.errorName || "UnknownError",
              timestamp: new Date().toISOString(),
              runId: runInfo.extractionRunId,
            },
          });

          extractionsToInsert.push({
            id: uuid(),
            emailId: result.emailId,
            runId: runInfo.extractionRunId,
            status: "failed",
            rawExtraction: {
              isTransactional: false,
              emailType: "error",
              transactions: [],
              extractionNotes: result.error,
            },
            confidence: null,
            processingTimeMs: result.processingTimeMs,
            transactionIds: [],
          });

          console.error(`[Inngest] Error processing email ${result.emailId}: ${result.error}`);
        }
      }

      // Insert accounts in batches
      if (newAccountsToCreate.length > 0) {
        console.log(`[Inngest] Creating ${newAccountsToCreate.length} new accounts`);
        for (let i = 0; i < newAccountsToCreate.length; i += DB_BATCH_SIZE) {
          await db.insert(accounts).values(newAccountsToCreate.slice(i, i + DB_BATCH_SIZE));
        }
      }

      // Insert transactions in batches
      if (transactionsToInsert.length > 0) {
        console.log(`[Inngest] Inserting ${transactionsToInsert.length} transactions`);
        for (let i = 0; i < transactionsToInsert.length; i += DB_BATCH_SIZE) {
          const batch = transactionsToInsert.slice(i, i + DB_BATCH_SIZE).map((t) => ({
            ...t.data,
            id: t.id,
            sourceEmailId: t.emailId,
            extractionRunId: runInfo.extractionRunId,
            runCompleted: false,
          }));
          await db.insert(transactions).values(batch);
        }
      }

      // Insert extractions in batches
      if (extractionsToInsert.length > 0) {
        console.log(`[Inngest] Inserting ${extractionsToInsert.length} extractions`);
        for (let i = 0; i < extractionsToInsert.length; i += DB_BATCH_SIZE) {
          await db.insert(emailExtractions).values(extractionsToInsert.slice(i, i + DB_BATCH_SIZE));
        }
      }

      if (discussionSummariesToInsert.length > 0) {
        console.log(`[Inngest] Inserting ${discussionSummariesToInsert.length} discussion summaries`);
        for (let i = 0; i < discussionSummariesToInsert.length; i += DB_BATCH_SIZE) {
          await db.insert(discussionSummaries).values(discussionSummariesToInsert.slice(i, i + DB_BATCH_SIZE));
        }
      }

      // Insert error logs in batches
      if (errorLogsToInsert.length > 0) {
        console.log(`[Inngest] Inserting ${errorLogsToInsert.length} error logs`);
        for (let i = 0; i < errorLogsToInsert.length; i += DB_BATCH_SIZE) {
          await db.insert(extractionLogs).values(errorLogsToInsert.slice(i, i + DB_BATCH_SIZE));
        }
      }

      return {
        totalTransactions,
        failedCount,
        informationalCount,
        accountsCreated: newAccountsToCreate.length,
      };
    });

    // Step 5: Finalize the run
    await step.run("finalize-run", async () => {
      // Mark all transactions as completed
      await db
        .update(transactions)
        .set({ runCompleted: true })
        .where(eq(transactions.extractionRunId, runInfo.extractionRunId));

      const totalProcessed = workload.totalEmails + runInfo.alreadyProcessedEmailIds.length;
      const totalTransactions = writeResult.totalTransactions + runInfo.existingTransactionsCount;

      // Update run status
      await db
        .update(extractionRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          emailsProcessed: totalProcessed,
          transactionsCreated: totalTransactions,
          informationalCount: writeResult.informationalCount,
          errorCount: writeResult.failedCount,
        })
        .where(eq(extractionRuns.id, runInfo.extractionRunId));

      // Update job status
      const [run] = await db
        .select({ jobId: extractionRuns.jobId })
        .from(extractionRuns)
        .where(eq(extractionRuns.id, runInfo.extractionRunId))
        .limit(1);

      if (run?.jobId) {
        await db
          .update(jobs)
          .set({
            status: "completed",
            completedAt: new Date(),
            processedItems: totalProcessed,
          })
          .where(eq(jobs.id, run.jobId));
      }

      console.log(
        `[Inngest] Run complete: ${totalProcessed} emails, ${totalTransactions} transactions, ${writeResult.failedCount} errors`
      );
    });

    return {
      runId: runInfo.extractionRunId,
      emailsProcessed: workload.totalEmails + runInfo.alreadyProcessedEmailIds.length,
      transactionsCreated: writeResult.totalTransactions + runInfo.existingTransactionsCount,
      informationalCount: writeResult.informationalCount,
      failedCount: writeResult.failedCount,
    };
  }
);

// Export all functions
export const functions = [extractionJob];
