import { v4 as uuid } from "uuid";
import { db } from "@/db";
import { jobs, emails, transactions, accounts, extractionLogs, extractionRuns, prompts, emailExtractions, aiModels } from "@/db/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { scanEmailDirectory, parseEmlFile, toDbEmail, classifyEmail } from "./email-parser";
import { extractTransaction, type TransactionExtraction, type SingleTransaction, DEFAULT_MODEL_ID } from "./ai-extractor";
import { normalizeTransaction, detectOrCreateAccount } from "./transaction-normalizer";
import { estimateBatchCost, formatCost, getModelConfig } from "./model-config";
import { SOFTWARE_VERSION } from "@/config/version";

export type JobType = "email_scan" | "extraction" | "reprocess";
export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export interface JobProgress {
  id: string;
  type: JobType;
  status: JobStatus;
  totalItems: number;
  processedItems: number;
  failedItems: number;
  skippedItems: number;
  informationalItems: number;
  errorMessage: string | null;
  modelId?: string | null;
  modelName?: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * Classify error type for logging
 */
function classifyError(error: Error): string {
  const message = error.message.toLowerCase();
  if (message.includes("schema") || message.includes("no object generated")) {
    return "schema_validation";
  }
  if (message.includes("api") || message.includes("rate limit") || message.includes("429")) {
    return "api_error";
  }
  if (message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("parse") || message.includes("json")) {
    return "parse_error";
  }
  return "unknown";
}

/**
 * Log an extraction error
 */
async function logExtractionError(
  emailId: string,
  jobId: string,
  error: Error,
  level: "error" | "warning" | "info" = "error"
): Promise<void> {
  try {
    await db.insert(extractionLogs).values({
      id: uuid(),
      emailId,
      jobId,
      level,
      message: error.message,
      errorType: classifyError(error),
      stackTrace: error.stack || null,
      metadata: {
        name: error.name,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (logError) {
    console.error("Failed to log extraction error:", logError);
  }
}

// In-memory job state for real-time updates
const activeJobs = new Map<string, {
  abortController: AbortController;
  progress: JobProgress;
}>();

/**
 * Get current progress for a job
 */
export function getJobProgress(jobId: string): JobProgress | null {
  const job = activeJobs.get(jobId);
  return job?.progress || null;
}

/**
 * Get all active jobs
 */
export function getActiveJobs(): JobProgress[] {
  return Array.from(activeJobs.values()).map((j) => j.progress);
}

/**
 * Cancel a running job
 */
export function cancelJob(jobId: string): boolean {
  const job = activeJobs.get(jobId);
  if (job && job.progress.status === "running") {
    job.abortController.abort();
    job.progress.status = "cancelled";
    return true;
  }
  return false;
}

/**
 * Start email scanning job
 * Scans the email directory and imports emails to the database
 */
export async function startEmailScanJob(
  emailFolderPath: string
): Promise<string> {
  const jobId = uuid();
  const abortController = new AbortController();

  const progress: JobProgress = {
    id: jobId,
    type: "email_scan",
    status: "pending",
    totalItems: 0,
    processedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    informationalItems: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
  };

  activeJobs.set(jobId, { abortController, progress });

  // Create job record in database
  await db.insert(jobs).values({
    id: jobId,
    type: "email_scan",
    status: "pending",
    metadata: { emailFolderPath },
  });

  // Run job in background
  runEmailScanJob(jobId, emailFolderPath, abortController.signal);

  return jobId;
}

async function runEmailScanJob(
  jobId: string,
  emailFolderPath: string,
  signal: AbortSignal
): Promise<void> {
  const job = activeJobs.get(jobId)!;
  job.progress.status = "running";
  job.progress.startedAt = new Date();

  await db
    .update(jobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(jobs.id, jobId));

  try {
    // Scan directory for emails
    const emailFiles = await scanEmailDirectory(emailFolderPath);
    job.progress.totalItems = emailFiles.length;

    await db
      .update(jobs)
      .set({ totalItems: emailFiles.length })
      .where(eq(jobs.id, jobId));

    // Get existing emails to avoid duplicates
    const existingEmails = await db
      .select({ filename: emails.filename })
      .from(emails);
    const existingFilenames = new Set(existingEmails.map((e) => e.filename));

    // Process emails in batches
    const batchSize = 50;
    for (let i = 0; i < emailFiles.length; i += batchSize) {
      if (signal.aborted) {
        throw new Error("Job cancelled");
      }

      const batch = emailFiles.slice(i, i + batchSize);
      const emailsToInsert: Array<ReturnType<typeof toDbEmail>> = [];

      for (const filePath of batch) {
        const filename = filePath.split("/").pop() || filePath;

        // Skip if already exists
        if (existingFilenames.has(filename)) {
          job.progress.skippedItems++;
          job.progress.processedItems++;
          continue;
        }

        try {
          const parsed = await parseEmlFile(filePath);
          const classification = classifyEmail(parsed);

          const dbEmail = toDbEmail(parsed);

          if (!classification.shouldProcess) {
            dbEmail.extractionStatus = "skipped";
            dbEmail.skipReason = classification.skipReason;
            job.progress.skippedItems++;
          }

          emailsToInsert.push(dbEmail);
          job.progress.processedItems++;
        } catch (error) {
          console.error(`Failed to parse ${filePath}:`, error);
          job.progress.failedItems++;
          job.progress.processedItems++;
        }
      }

      // Batch insert emails
      if (emailsToInsert.length > 0) {
        await db.insert(emails).values(emailsToInsert);
      }

      // Update job progress in database
      await db
        .update(jobs)
        .set({
          processedItems: job.progress.processedItems,
          failedItems: job.progress.failedItems,
          skippedItems: job.progress.skippedItems,
        })
        .where(eq(jobs.id, jobId));
    }

    job.progress.status = "completed";
    job.progress.completedAt = new Date();

    await db
      .update(jobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(jobs.id, jobId));
  } catch (error) {
    job.progress.status = "failed";
    job.progress.errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    job.progress.completedAt = new Date();

    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage: job.progress.errorMessage,
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }
}

/**
 * Check if an extraction already exists for this set+model+version+prompt combination
 */
export async function checkExistingExtraction(
  setId: string,
  modelId: string,
  promptId: string
): Promise<{ exists: boolean; run?: typeof extractionRuns.$inferSelect }> {
  const existing = await db
    .select()
    .from(extractionRuns)
    .where(
      and(
        eq(extractionRuns.setId, setId),
        eq(extractionRuns.modelId, modelId),
        eq(extractionRuns.softwareVersion, SOFTWARE_VERSION),
        eq(extractionRuns.promptId, promptId),
        eq(extractionRuns.status, "completed")
      )
    )
    .limit(1);

  return {
    exists: existing.length > 0,
    run: existing[0],
  };
}

/**
 * Start AI extraction job
 * Processes emails from a specific set through the AI extractor
 * Results are atomic - transactions are only created if the entire run succeeds
 */
export async function startExtractionJob(
  options: {
    setId: string; // Required - which set to extract
    modelId?: string; // AI model to use (defaults to DEFAULT_MODEL_ID)
    promptId: string; // Required - which prompt to use
    concurrency?: number;
    runName?: string; // Optional name for this run
    runDescription?: string; // Optional description for this run
  }
): Promise<string> {
  if (!options.setId) {
    throw new Error("setId is required for extraction");
  }
  if (!options.promptId) {
    throw new Error("promptId is required for extraction");
  }

  const modelId = options.modelId || DEFAULT_MODEL_ID;

  // Fetch the prompt from database
  const promptResult = await db
    .select()
    .from(prompts)
    .where(eq(prompts.id, options.promptId))
    .limit(1);

  if (promptResult.length === 0) {
    throw new Error(`Prompt not found: ${options.promptId}`);
  }

  const prompt = promptResult[0];
  console.log(`[Job Manager] Using prompt: ${prompt.name} (${prompt.id})`);

  // Check if this combination already exists (same set, model, version, AND prompt)
  const { exists, run } = await checkExistingExtraction(options.setId, modelId, options.promptId);
  if (exists) {
    throw new Error(
      `Extraction already exists for this set with ${modelId}, software v${SOFTWARE_VERSION}, and prompt "${prompt.name}". ` +
      `Run ID: ${run?.id}. Use a different prompt or model to create a new run.`
    );
  }

  const jobId = uuid();
  const abortController = new AbortController();

  const progress: JobProgress = {
    id: jobId,
    type: "extraction",
    status: "pending",
    totalItems: 0,
    processedItems: 0,
    failedItems: 0,
    skippedItems: 0,
    informationalItems: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
  };

  activeJobs.set(jobId, { abortController, progress });

  await db.insert(jobs).values({
    id: jobId,
    type: "extraction",
    status: "pending",
    metadata: { ...options, softwareVersion: SOFTWARE_VERSION },
  });

  runExtractionJob(jobId, { ...options, promptContent: prompt.content }, abortController.signal);

  return jobId;
}

// Type for pending transaction data collected during extraction
interface PendingTransaction {
  emailId: string;
  transaction: SingleTransaction;
  transactionIndex: number; // Index within the email (for emails with multiple transactions)
}

// Type for email extraction records to create
interface PendingEmailExtraction {
  emailId: string;
  extraction: TransactionExtraction;
  startTime: number;
  endTime: number;
}

async function runExtractionJob(
  jobId: string,
  options: {
    setId: string;
    modelId?: string;
    promptId: string;
    promptContent: string; // The actual prompt text
    concurrency?: number;
    runName?: string;
    runDescription?: string;
  },
  signal: AbortSignal
): Promise<void> {
  const job = activeJobs.get(jobId)!;
  job.progress.status = "running";
  job.progress.startedAt = new Date();
  const startTime = Date.now();

  const modelId = options.modelId || DEFAULT_MODEL_ID;
  const setId = options.setId;
  const promptContent = options.promptContent;

  // Get model name for progress display
  const [modelResult] = await db
    .select({ name: aiModels.name })
    .from(aiModels)
    .where(eq(aiModels.id, modelId))
    .limit(1);
  const modelName = modelResult?.name || modelId;

  // Update progress with model info
  job.progress.modelId = modelId;
  job.progress.modelName = modelName;

  await db
    .update(jobs)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(jobs.id, jobId));

  // Create extraction run
  const extractionRunId = uuid();

  // Get next version number
  const [latestRun] = await db
    .select({ version: extractionRuns.version })
    .from(extractionRuns)
    .orderBy(desc(extractionRuns.version))
    .limit(1);
  const nextVersion = (latestRun?.version || 0) + 1;

  await db.insert(extractionRuns).values({
    id: extractionRunId,
    jobId,
    setId,
    version: nextVersion,
    name: options.runName || null,
    description: options.runDescription || null,
    modelId,
    promptId: options.promptId,
    softwareVersion: SOFTWARE_VERSION,
    config: options,
    status: "running",
    startedAt: new Date(),
  });

  // Track stats for this run
  const runStats = {
    byType: {} as Record<string, number>,
    totalConfidence: 0,
    transactionCount: 0,
  };

  // Collect all pending transactions for atomic insert at the end
  const pendingTransactions: PendingTransaction[] = [];
  // Collect all email extractions to create records
  const pendingExtractions: PendingEmailExtraction[] = [];
  // Track email updates to apply atomically
  const emailUpdates: Array<{
    id: string;
    status: "completed" | "informational" | "failed";
    extraction?: Record<string, unknown>;
    notes?: string;
    error?: string;
  }> = [];

  try {
    // Get ALL emails from the set (not just pending)
    const emailsToProcess = await db
      .select()
      .from(emails)
      .where(eq(emails.setId, setId));

    job.progress.totalItems = emailsToProcess.length;

    await db
      .update(jobs)
      .set({ totalItems: emailsToProcess.length })
      .where(eq(jobs.id, jobId));

    const concurrency = options.concurrency || 3;

    // Process in batches - collect results but don't commit yet
    for (let i = 0; i < emailsToProcess.length; i += concurrency) {
      if (signal.aborted) {
        throw new Error("Job cancelled");
      }

      const batch = emailsToProcess.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        batch.map(async (email) => {
          // Extract transaction(s)
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
          const extraction = await extractTransaction(parsedEmail, modelId, promptContent);
          const endTime = Date.now();

          return { email, extraction, startTime, endTime };
        })
      );

      // Collect results (don't commit to DB yet)
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const email = batch[j];

        if (result.status === "fulfilled") {
          const { extraction, startTime, endTime } = result.value;

          // Always add to pending extractions (for email_extractions table)
          pendingExtractions.push({
            emailId: email.id,
            extraction,
            startTime,
            endTime,
          });

          if (extraction.isTransactional && extraction.transactions.length > 0) {
            // This email contains one or more financial transactions
            for (let txIndex = 0; txIndex < extraction.transactions.length; txIndex++) {
              const transaction = extraction.transactions[txIndex];
              pendingTransactions.push({
                emailId: email.id,
                transaction,
                transactionIndex: txIndex,
              });

              // Track stats per transaction
              runStats.transactionCount++;
              runStats.byType[transaction.transactionType] = (runStats.byType[transaction.transactionType] || 0) + 1;
              runStats.totalConfidence += transaction.confidence || 0;
            }

            emailUpdates.push({
              id: email.id,
              status: "completed",
              extraction: extraction as unknown as Record<string, unknown>,
            });
          } else {
            // Not a transaction - mark as informational with email type info
            const notes = extraction.extractionNotes ||
              `Non-transactional email (type: ${extraction.emailType})`;
            emailUpdates.push({
              id: email.id,
              status: "informational",
              extraction: extraction as unknown as Record<string, unknown>,
              notes,
            });
            job.progress.informationalItems++;
          }

          job.progress.processedItems++;
        } else {
          // Handle API/extraction failure
          const error = result.reason as Error;

          // Log the error
          await logExtractionError(email.id, jobId, error, "error");

          emailUpdates.push({
            id: email.id,
            status: "failed",
            error: error.message,
          });

          job.progress.failedItems++;
          job.progress.processedItems++;
        }
      }

      // Update job progress (but not email statuses yet)
      await db
        .update(jobs)
        .set({
          processedItems: job.progress.processedItems,
          failedItems: job.progress.failedItems,
          informationalItems: job.progress.informationalItems,
        })
        .where(eq(jobs.id, jobId));
    }

    // All extractions complete - now commit atomically using a database transaction
    console.log(`Extraction complete. Committing ${pendingTransactions.length} transactions atomically...`);

    const processingTimeMs = Date.now() - startTime;

    // Use database transaction for true atomicity
    await db.transaction(async (tx) => {
      // Track transaction IDs by email for email_extractions
      const transactionIdsByEmail = new Map<string, string[]>();

      // Create all transactions and capture IDs
      for (const pending of pendingTransactions) {
        const txData = pending.transaction;

        const fromAccount = await detectOrCreateAccount({
          accountNumber: txData.accountNumber,
          accountName: txData.accountName,
          institution: txData.institution,
        });

        let toAccount = null;
        if (txData.toAccountNumber || txData.toAccountName) {
          toAccount = await detectOrCreateAccount({
            accountNumber: txData.toAccountNumber,
            accountName: txData.toAccountName,
            institution: txData.toInstitution,
            isExternal:
              txData.transactionType === "wire_transfer_out" ||
              txData.transactionType === "wire_transfer_in",
          });
        }

        // Convert SingleTransaction to the format expected by normalizeTransaction
        const extractionForNormalize = {
          ...txData,
          isTransaction: true,
          extractionNotes: null,
        };

        const normalizedTx = normalizeTransaction(extractionForNormalize, fromAccount?.id, toAccount?.id);

        // Insert and capture the transaction ID
        const [created] = await tx.insert(transactions).values({
          ...normalizedTx,
          sourceEmailId: pending.emailId,
          extractionRunId,
        }).returning({ id: transactions.id });

        // Track transaction ID by email
        if (!transactionIdsByEmail.has(pending.emailId)) {
          transactionIdsByEmail.set(pending.emailId, []);
        }
        transactionIdsByEmail.get(pending.emailId)!.push(created.id);
      }

      // Create email_extractions records
      for (const pending of pendingExtractions) {
        const extraction = pending.extraction;
        const processingTimeMs = pending.endTime - pending.startTime;

        // Get transaction IDs for this email
        const txIds = transactionIdsByEmail.get(pending.emailId) || [];

        // Determine status and confidence
        let status: "completed" | "informational" | "skipped" = "completed";
        let avgConfidence: number | null = null;

        if (extraction.isTransactional && extraction.transactions.length > 0) {
          status = "completed";
          const confidences = extraction.transactions
            .map(t => t.confidence)
            .filter((c): c is number => c !== null && c !== undefined);
          if (confidences.length > 0) {
            avgConfidence = confidences.reduce((sum, c) => sum + c, 0) / confidences.length;
          }
        } else {
          status = "informational";
        }

        await tx.insert(emailExtractions).values({
          id: uuid(),
          emailId: pending.emailId,
          runId: extractionRunId,
          status,
          rawExtraction: extraction as any,
          confidence: avgConfidence ? avgConfidence.toFixed(2) : null,
          processingTimeMs,
          transactionIds: txIds,
        });
      }

      // Update all email statuses within the same transaction
      for (const update of emailUpdates) {
        if (update.status === "completed") {
          await tx
            .update(emails)
            .set({
              extractionStatus: "completed",
              rawExtraction: update.extraction,
              processedAt: new Date(),
            })
            .where(eq(emails.id, update.id));
        } else if (update.status === "informational") {
          await tx
            .update(emails)
            .set({
              extractionStatus: "informational",
              rawExtraction: update.extraction,
              informationalNotes: update.notes,
              processedAt: new Date(),
            })
            .where(eq(emails.id, update.id));
        } else if (update.status === "failed") {
          await tx
            .update(emails)
            .set({
              extractionStatus: "failed",
              extractionError: update.error,
              processedAt: new Date(),
            })
            .where(eq(emails.id, update.id));
        }
      }

      // Update extraction run with final stats
      await tx
        .update(extractionRuns)
        .set({
          status: "completed",
          completedAt: new Date(),
          emailsProcessed: job.progress.processedItems,
          transactionsCreated: runStats.transactionCount,
          informationalCount: job.progress.informationalItems,
          errorCount: job.progress.failedItems,
          stats: {
            byType: runStats.byType,
            avgConfidence: runStats.transactionCount > 0
              ? runStats.totalConfidence / runStats.transactionCount
              : 0,
            processingTimeMs,
          },
        })
        .where(eq(extractionRuns.id, extractionRunId));

      // Update job status
      await tx
        .update(jobs)
        .set({ status: "completed", completedAt: new Date() })
        .where(eq(jobs.id, jobId));
    });

    job.progress.status = "completed";
    job.progress.completedAt = new Date();

    console.log(`Extraction run ${extractionRunId} completed with ${runStats.transactionCount} transactions`);
  } catch (error) {
    // Run failed - don't commit any transactions (they weren't inserted yet)
    console.error(`Extraction run failed:`, error);

    job.progress.status = "failed";
    job.progress.errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    job.progress.completedAt = new Date();

    // Update extraction run as failed (no transactions were created)
    const processingTimeMs = Date.now() - startTime;
    await db
      .update(extractionRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        emailsProcessed: job.progress.processedItems,
        transactionsCreated: 0, // No transactions created on failure
        informationalCount: job.progress.informationalItems,
        errorCount: job.progress.failedItems,
        stats: {
          byType: runStats.byType,
          avgConfidence: 0,
          processingTimeMs,
        },
      })
      .where(eq(extractionRuns.id, extractionRunId));

    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage: job.progress.errorMessage,
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }
}

// NOTE: createTransactionFromExtraction function was removed -
// transaction creation is now handled inline in runExtractionJob with support for multiple transactions per email
