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
  aiModels,
  jobs,
} from "@/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { extractTransaction, DEFAULT_MODEL_ID } from "@/services/ai-extractor";
import { normalizeTransaction } from "@/services/transaction-normalizer";
import { SOFTWARE_VERSION } from "@/config/version";

// Batch size for processing emails
const BATCH_SIZE = 25;

/**
 * Main extraction function using Inngest steps
 * Each step is executed independently and can be retried
 */
export const extractionJob = inngest.createFunction(
  {
    id: "extraction-job",
    // Retry configuration
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
    const { setId, modelId: inputModelId, promptId, concurrency = 3, sampleSize, resumeRunId } = event.data;
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
          config: { concurrency, sampleSize },
          status: "running",
          startedAt: new Date(),
        });
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

    // Step 2: Fetch prompt and emails to process
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

      // Fetch emails from set
      let emailsToProcess = await db
        .select({
          id: emails.id,
          filename: emails.filename,
          subject: emails.subject,
          sender: emails.sender,
          senderName: emails.senderName,
          recipient: emails.recipient,
          recipientName: emails.recipientName,
          cc: emails.cc,
          replyTo: emails.replyTo,
          messageId: emails.messageId,
          inReplyTo: emails.inReplyTo,
          date: emails.date,
          receivedAt: emails.receivedAt,
          bodyText: emails.bodyText,
          bodyHtml: emails.bodyHtml,
          rawContent: emails.rawContent,
          headers: emails.headers,
        })
        .from(emails)
        .where(eq(emails.setId, runInfo.setId));

      // Filter out already processed emails if resuming
      if (runInfo.alreadyProcessedEmailIds.length > 0) {
        const processedSet = new Set(runInfo.alreadyProcessedEmailIds);
        emailsToProcess = emailsToProcess.filter((e) => !processedSet.has(e.id));
      }

      // Apply sampling if specified (only for new runs)
      if (!runInfo.isResume && sampleSize && sampleSize > 0 && sampleSize < emailsToProcess.length) {
        const shuffled = [...emailsToProcess];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        emailsToProcess = shuffled.slice(0, sampleSize);
      }

      // Update job total
      await db
        .update(jobs)
        .set({ totalItems: emailsToProcess.length })
        .where(
          eq(
            jobs.id,
            (
              await db
                .select({ jobId: extractionRuns.jobId })
                .from(extractionRuns)
                .where(eq(extractionRuns.id, runInfo.extractionRunId))
                .limit(1)
            )[0]?.jobId || ""
          )
        );

      // Create batches
      const batches: string[][] = [];
      for (let i = 0; i < emailsToProcess.length; i += BATCH_SIZE) {
        batches.push(emailsToProcess.slice(i, i + BATCH_SIZE).map((e) => e.id));
      }

      return {
        promptContent: prompt.content,
        jsonSchema: prompt.jsonSchema,
        totalEmails: emailsToProcess.length,
        batches,
      };
    });

    console.log(
      `[Inngest] Processing ${workload.totalEmails} emails in ${workload.batches.length} batches`
    );

    // Step 3: Process each batch as a separate step
    let totalTransactions = runInfo.existingTransactionsCount;
    let processedCount = runInfo.alreadyProcessedEmailIds.length;
    let failedCount = 0;
    let informationalCount = 0;

    for (let batchIndex = 0; batchIndex < workload.batches.length; batchIndex++) {
      const batchResult = await step.run(`process-batch-${batchIndex}`, async () => {
        const batchEmailIds = workload.batches[batchIndex];

        // Fetch full email data for this batch
        const batchEmails = await db
          .select()
          .from(emails)
          .where(inArray(emails.id, batchEmailIds));

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

        // Process emails with AI extraction
        const results = await Promise.allSettled(
          batchEmails.map(async (email) => {
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
            const extraction = await extractTransaction(
              parsedEmail,
              runInfo.modelId,
              workload.promptContent,
              workload.jsonSchema
            );
            const endTime = Date.now();

            return { email, extraction, startTime, endTime };
          })
        );

        // Collect results
        const transactionsToInsert: Array<{
          id: string;
          emailId: string;
          data: ReturnType<typeof normalizeTransaction>;
        }> = [];
        const extractionsToInsert: Array<{
          id: string;
          emailId: string;
          runId: string;
          status: "completed" | "informational" | "skipped";
          rawExtraction: {
            isTransactional: boolean;
            emailType: string;
            transactions: Array<Record<string, unknown>>;
            extractionNotes?: string;
            skipReason?: string;
            informationalNotes?: string;
          };
          confidence: string | null;
          processingTimeMs: number;
          transactionIds: string[];
        }> = [];
        const transactionIdsByEmail = new Map<string, string[]>();

        let batchTransactions = 0;
        let batchFailed = 0;
        let batchInformational = 0;

        // Track error logs to insert
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

        // Get job ID for error logging
        const [runForJob] = await db
          .select({ jobId: extractionRuns.jobId })
          .from(extractionRuns)
          .where(eq(extractionRuns.id, runInfo.extractionRunId))
          .limit(1);
        const jobId = runForJob?.jobId || null;

        // Process results - use index to map back to original email
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const originalEmail = batchEmails[i];

          if (result.status === "fulfilled") {
            const { email, extraction, startTime, endTime } = result.value;

            if (extraction.isTransactional && extraction.transactions.length > 0) {
              for (const txData of extraction.transactions) {
                const fromAccountId = findOrCreateAccountSync({
                  accountNumber: txData.accountNumber,
                  accountName: txData.accountName,
                  institution: txData.institution,
                });

                let toAccountId: string | null = null;
                if (txData.toAccountNumber || txData.toAccountName) {
                  toAccountId = findOrCreateAccountSync({
                    accountNumber: txData.toAccountNumber,
                    accountName: txData.toAccountName,
                    institution: txData.toInstitution,
                    isExternal:
                      txData.transactionType === "wire_transfer_out" ||
                      txData.transactionType === "wire_transfer_in",
                  });
                }

                const normalizedTx = normalizeTransaction(
                  { ...txData, isTransaction: true, extractionNotes: null },
                  fromAccountId,
                  toAccountId
                );
                const txId = uuid();

                transactionsToInsert.push({
                  id: txId,
                  emailId: email.id,
                  data: normalizedTx,
                });

                if (!transactionIdsByEmail.has(email.id)) {
                  transactionIdsByEmail.set(email.id, []);
                }
                transactionIdsByEmail.get(email.id)!.push(txId);
                batchTransactions++;
              }

              const confidences = extraction.transactions
                .map((t) => t.confidence)
                .filter((c): c is number => c !== null && c !== undefined);
              const avgConfidence =
                confidences.length > 0
                  ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
                  : null;

              extractionsToInsert.push({
                id: uuid(),
                emailId: email.id,
                runId: runInfo.extractionRunId,
                status: "completed",
                rawExtraction: {
                  isTransactional: extraction.isTransactional,
                  emailType: extraction.emailType,
                  transactions: extraction.transactions as Array<Record<string, unknown>>,
                  extractionNotes: extraction.extractionNotes || undefined,
                },
                confidence: avgConfidence ? avgConfidence.toFixed(2) : null,
                processingTimeMs: endTime - startTime,
                transactionIds: transactionIdsByEmail.get(email.id) || [],
              });
            } else {
              extractionsToInsert.push({
                id: uuid(),
                emailId: email.id,
                runId: runInfo.extractionRunId,
                status: "informational",
                rawExtraction: {
                  isTransactional: extraction.isTransactional,
                  emailType: extraction.emailType,
                  transactions: extraction.transactions as Array<Record<string, unknown>>,
                  extractionNotes: extraction.extractionNotes || undefined,
                  informationalNotes: extraction.extractionNotes || undefined,
                },
                confidence: null,
                processingTimeMs: endTime - startTime,
                transactionIds: [],
              });
              batchInformational++;
            }
          } else {
            // Promise was rejected - log the error
            batchFailed++;
            const error = result.reason;
            const errorMessage = error instanceof Error ? error.message : String(error);
            const errorStack = error instanceof Error ? error.stack || null : null;
            const errorName = error instanceof Error ? error.name : "UnknownError";

            // Log to extraction_logs table
            errorLogsToInsert.push({
              id: uuid(),
              emailId: originalEmail.id,
              jobId,
              level: "error",
              message: `[Model: ${runInfo.modelId}] ${errorMessage}`,
              errorType: errorName.includes("API") ? "api_error" :
                        errorName.includes("Schema") ? "schema_validation" : "unknown",
              stackTrace: errorStack,
              metadata: {
                name: errorName,
                timestamp: new Date().toISOString(),
                runId: runInfo.extractionRunId,
              },
            });

            // Also create a failed extraction record
            extractionsToInsert.push({
              id: uuid(),
              emailId: originalEmail.id,
              runId: runInfo.extractionRunId,
              status: "failed" as "completed" | "informational" | "skipped",
              rawExtraction: {
                isTransactional: false,
                emailType: "error",
                transactions: [],
                extractionNotes: errorMessage,
              },
              confidence: null,
              processingTimeMs: 0,
              transactionIds: [],
            });

            console.error(`[Inngest] Error processing email ${originalEmail.id}: ${errorMessage}`);
          }
        }

        // Insert accounts, transactions, and extractions
        const DB_BATCH_SIZE = 100;

        if (newAccountsToCreate.length > 0) {
          for (let i = 0; i < newAccountsToCreate.length; i += DB_BATCH_SIZE) {
            await db.insert(accounts).values(newAccountsToCreate.slice(i, i + DB_BATCH_SIZE));
          }
        }

        if (transactionsToInsert.length > 0) {
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

        if (extractionsToInsert.length > 0) {
          for (let i = 0; i < extractionsToInsert.length; i += DB_BATCH_SIZE) {
            await db.insert(emailExtractions).values(extractionsToInsert.slice(i, i + DB_BATCH_SIZE));
          }
        }

        // Insert error logs
        if (errorLogsToInsert.length > 0) {
          for (let i = 0; i < errorLogsToInsert.length; i += DB_BATCH_SIZE) {
            await db.insert(extractionLogs).values(errorLogsToInsert.slice(i, i + DB_BATCH_SIZE));
          }
        }

        // Update run progress
        await db
          .update(extractionRuns)
          .set({
            emailsProcessed:
              processedCount + runInfo.alreadyProcessedEmailIds.length + batchEmails.length,
            transactionsCreated: totalTransactions + batchTransactions,
          })
          .where(eq(extractionRuns.id, runInfo.extractionRunId));

        return {
          processed: batchEmails.length,
          transactions: batchTransactions,
          failed: batchFailed,
          informational: batchInformational,
        };
      });

      // Update cumulative counts
      processedCount += batchResult.processed;
      totalTransactions += batchResult.transactions;
      failedCount += batchResult.failed;
      informationalCount += batchResult.informational;

      console.log(
        `[Inngest] Batch ${batchIndex + 1}/${workload.batches.length}: ${batchResult.processed} processed, ${batchResult.transactions} transactions`
      );
    }

    // Step 4: Finalize the run
    await step.run("finalize-run", async () => {
      // Mark all transactions as completed
      await db
        .update(transactions)
        .set({ runCompleted: true })
        .where(eq(transactions.extractionRunId, runInfo.extractionRunId));

      // Update run status
      await db
        .update(extractionRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          emailsProcessed: processedCount + runInfo.alreadyProcessedEmailIds.length,
          transactionsCreated: totalTransactions,
          informationalCount,
          errorCount: failedCount,
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
            processedItems: processedCount + runInfo.alreadyProcessedEmailIds.length,
          })
          .where(eq(jobs.id, run.jobId));
      }
    });

    return {
      runId: runInfo.extractionRunId,
      emailsProcessed: processedCount + runInfo.alreadyProcessedEmailIds.length,
      transactionsCreated: totalTransactions,
      informationalCount,
      failedCount,
    };
  }
);

// Export all functions
export const functions = [extractionJob];
