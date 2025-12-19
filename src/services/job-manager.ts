import { v4 as uuid } from "uuid";
import { db } from "@/db";
import { jobs, emails, transactions, accounts, extractionLogs, extractionRuns } from "@/db/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { scanEmailDirectory, parseEmlFile, toDbEmail, classifyEmail } from "./email-parser";
import { extractTransaction, type TransactionExtraction, DEFAULT_MODEL_ID } from "./ai-extractor";
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
 * Check if an extraction already exists for this set+model+version combination
 */
export async function checkExistingExtraction(
  setId: string,
  modelId: string
): Promise<{ exists: boolean; run?: typeof extractionRuns.$inferSelect }> {
  const existing = await db
    .select()
    .from(extractionRuns)
    .where(
      and(
        eq(extractionRuns.setId, setId),
        eq(extractionRuns.modelId, modelId),
        eq(extractionRuns.softwareVersion, SOFTWARE_VERSION),
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
    concurrency?: number;
  }
): Promise<string> {
  if (!options.setId) {
    throw new Error("setId is required for extraction");
  }

  const modelId = options.modelId || DEFAULT_MODEL_ID;

  // Check if this combination already exists
  const { exists, run } = await checkExistingExtraction(options.setId, modelId);
  if (exists) {
    throw new Error(
      `Extraction already exists for this set with ${modelId} and software v${SOFTWARE_VERSION}. ` +
      `Run ID: ${run?.id}`
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

  runExtractionJob(jobId, options, abortController.signal);

  return jobId;
}

// Type for pending transaction data collected during extraction
interface PendingTransaction {
  emailId: string;
  extraction: TransactionExtraction;
}

async function runExtractionJob(
  jobId: string,
  options: {
    setId: string;
    modelId?: string;
    concurrency?: number;
  },
  signal: AbortSignal
): Promise<void> {
  const job = activeJobs.get(jobId)!;
  job.progress.status = "running";
  job.progress.startedAt = new Date();
  const startTime = Date.now();

  const modelId = options.modelId || DEFAULT_MODEL_ID;
  const setId = options.setId;

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
    modelId,
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
          // Extract transaction
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

          const extraction = await extractTransaction(parsedEmail, modelId);

          return { email, extraction };
        })
      );

      // Collect results (don't commit to DB yet)
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const email = batch[j];

        if (result.status === "fulfilled") {
          const { extraction } = result.value;

          if (extraction.isTransaction && extraction.transactionType) {
            // This is a valid financial transaction - collect for later
            pendingTransactions.push({ emailId: email.id, extraction });
            emailUpdates.push({
              id: email.id,
              status: "completed",
              extraction: extraction as Record<string, unknown>,
            });

            // Track stats
            runStats.transactionCount++;
            runStats.byType[extraction.transactionType] = (runStats.byType[extraction.transactionType] || 0) + 1;
            runStats.totalConfidence += extraction.confidence || 0;
          } else {
            // Not a transaction - mark as informational
            emailUpdates.push({
              id: email.id,
              status: "informational",
              extraction: extraction as Record<string, unknown>,
              notes: extraction.extractionNotes || "Non-transactional email",
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
      // Create all transactions
      for (const pending of pendingTransactions) {
        const fromAccount = await detectOrCreateAccount({
          accountNumber: pending.extraction.accountNumber,
          accountName: pending.extraction.accountName,
          institution: pending.extraction.institution,
        });

        let toAccount = null;
        if (pending.extraction.toAccountNumber || pending.extraction.toAccountName) {
          toAccount = await detectOrCreateAccount({
            accountNumber: pending.extraction.toAccountNumber,
            accountName: pending.extraction.toAccountName,
            institution: pending.extraction.toInstitution,
            isExternal:
              pending.extraction.transactionType === "wire_transfer_out" ||
              pending.extraction.transactionType === "wire_transfer_in",
          });
        }

        const normalizedTx = normalizeTransaction(pending.extraction, fromAccount?.id, toAccount?.id);

        await tx.insert(transactions).values({
          ...normalizedTx,
          sourceEmailId: pending.emailId,
          extractionRunId,
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

/**
 * Create a transaction record from an extraction result
 */
async function createTransactionFromExtraction(
  emailId: string,
  extraction: TransactionExtraction,
  extractionRunId: string
): Promise<void> {
  // Detect or create accounts
  const fromAccount = await detectOrCreateAccount({
    accountNumber: extraction.accountNumber,
    accountName: extraction.accountName,
    institution: extraction.institution,
  });

  let toAccount = null;
  if (extraction.toAccountNumber || extraction.toAccountName) {
    toAccount = await detectOrCreateAccount({
      accountNumber: extraction.toAccountNumber,
      accountName: extraction.toAccountName,
      institution: extraction.toInstitution,
      isExternal:
        extraction.transactionType === "wire_transfer_out" ||
        extraction.transactionType === "wire_transfer_in",
    });
  }

  // Normalize and create transaction
  const normalizedTx = normalizeTransaction(extraction, fromAccount?.id, toAccount?.id);

  await db.insert(transactions).values({
    ...normalizedTx,
    sourceEmailId: emailId,
    extractionRunId,
  });
}
