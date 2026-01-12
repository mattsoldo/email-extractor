import { v4 as uuid } from "uuid";
import { db } from "@/db";
import { jobs, emails, transactions, accounts, extractionLogs, extractionRuns, prompts, emailExtractions, aiModels } from "@/db/schema";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { scanEmailDirectory, parseEmlFile, toDbEmail, classifyEmail } from "./email-parser";
import { extractTransaction, type TransactionExtraction, type SingleTransaction, DEFAULT_MODEL_ID } from "./ai-extractor";
import { normalizeTransaction, detectOrCreateAccount } from "./transaction-normalizer";
import { estimateBatchCost, formatCost, getModelConfig } from "./model-config";
import { SOFTWARE_VERSION } from "@/config/version";

/**
 * Clean up stale "running" extraction runs left from server restarts
 * Marks them as "failed" so they don't block the UI
 */
export async function cleanupStaleRuns(): Promise<number> {
  try {
    // First count how many stale runs exist
    const staleRuns = await db
      .select({ id: extractionRuns.id })
      .from(extractionRuns)
      .where(eq(extractionRuns.status, "running"));

    if (staleRuns.length === 0) {
      return 0;
    }

    // Update stale extraction runs to failed
    await db
      .update(extractionRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
      })
      .where(eq(extractionRuns.status, "running"));

    // Also clean up stale jobs
    await db
      .update(jobs)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: "Job interrupted by server restart",
      })
      .where(eq(jobs.status, "running"));

    return staleRuns.length;
  } catch (error) {
    console.error("[Job Manager] Failed to cleanup stale runs:", error);
    return 0;
  }
}

// NOTE: cleanupStaleRuns() should NOT be called on module load in serverless environments.
// On Vercel, multiple function instances run concurrently. If one instance imports this module
// while another is running an extraction, it would incorrectly mark the running job as failed.
// Instead, stale jobs are cleaned up:
// 1. When a new extraction is started (checks for jobs running > 10 minutes without progress)
// 2. Manually via admin action if needed

export type JobType = "email_scan" | "extraction" | "reprocess";
export type JobStatus = "pending" | "running" | "paused" | "completed" | "failed" | "cancelled";

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
 * Start AI extraction job
 * Processes emails from a specific set through the AI extractor
 * Results are atomic - transactions are only created if the entire run succeeds
 */
export async function startExtractionJob(
  options: {
    setId: string; // Required - which set to extract
    modelId?: string; // AI model to use (defaults to DEFAULT_MODEL_ID)
    promptId: string; // Required - which prompt to use
    customPromptContent?: string; // Optional - overrides the prompt content from database
    concurrency?: number;
    runName?: string; // Optional name for this run
    runDescription?: string; // Optional description for this run
    sampleSize?: number; // Optional - randomly select this many emails from the set
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

  // Use custom prompt content if provided, otherwise use the database prompt content
  const promptContentToUse = options.customPromptContent || prompt.content;
  const isCustomPrompt = !!options.customPromptContent && options.customPromptContent !== prompt.content;

  // Only use custom JSON schema if explicitly defined in the prompt
  // Otherwise, let extractTransaction use the default Zod schema (which is properly typed)
  const hasCustomSchema = !!prompt.jsonSchema;

  console.log(`[Job Manager] Using prompt: ${prompt.name} (${prompt.id})${isCustomPrompt ? " [CUSTOM CONTENT]" : ""}${hasCustomSchema ? " [CUSTOM SCHEMA]" : " [DEFAULT SCHEMA]"}`);

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
    metadata: {
      ...options,
      softwareVersion: SOFTWARE_VERSION,
      isCustomPrompt, // Track if custom prompt was used
    },
  });

  // Only pass custom schema if defined, otherwise use default Zod schema in extractTransaction
  runExtractionJob(jobId, { ...options, promptContent: promptContentToUse, jsonSchema: hasCustomSchema ? prompt.jsonSchema : null, sampleSize: options.sampleSize }, abortController.signal);

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
    jsonSchema?: Record<string, unknown> | null; // Custom JSON schema for extraction output
    concurrency?: number;
    runName?: string;
    runDescription?: string;
    sampleSize?: number; // Optional - randomly select this many emails from the set
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
  const jsonSchema = options.jsonSchema;

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
    // Get emails from the set - optionally sample randomly
    let emailsToProcess = await db
      .select()
      .from(emails)
      .where(eq(emails.setId, setId));

    // Apply random sampling if sampleSize is specified
    const totalInSet = emailsToProcess.length;
    if (options.sampleSize && options.sampleSize > 0 && options.sampleSize < totalInSet) {
      // Fisher-Yates shuffle and take first N
      const shuffled = [...emailsToProcess];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      emailsToProcess = shuffled.slice(0, options.sampleSize);
      console.log(`[Job Manager] Randomly sampled ${emailsToProcess.length} emails from ${totalInSet} total in set`);
    }

    job.progress.totalItems = emailsToProcess.length;

    await db
      .update(jobs)
      .set({ totalItems: emailsToProcess.length })
      .where(eq(jobs.id, jobId));

    const concurrency = options.concurrency || 8;

    // Process in batches - collect results but don't commit yet
    for (let i = 0; i < emailsToProcess.length; i += concurrency) {
      // Check if job is cancelled
      if (signal.aborted) {
        throw new Error("Job cancelled");
      }

      // Check if job is paused and wait until resumed
      while (true) {
        const [currentJob] = await db
          .select({ status: jobs.status })
          .from(jobs)
          .where(eq(jobs.id, jobId))
          .limit(1);

        if (!currentJob) {
          throw new Error("Job not found");
        }

        if (currentJob.status === "cancelled") {
          throw new Error("Job cancelled");
        }

        if (currentJob.status === "paused") {
          // Job is paused, update progress and wait
          job.progress.status = "paused";
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
          continue; // Check again
        }

        // Job is running, break out of wait loop
        job.progress.status = "running";
        break;
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
          const extraction = await extractTransaction(parsedEmail, modelId, promptContent, jsonSchema);
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

    // PHASE 1: Pre-fetch all accounts and build lookup map (outside transaction for speed)
    console.log(`[Job Manager] Phase 1: Pre-fetching accounts...`);
    const existingAccounts = await db.select().from(accounts);
    const accountsByMaskedNumber = new Map<string, typeof existingAccounts[0]>();
    const accountsByName = new Map<string, typeof existingAccounts[0]>();

    for (const account of existingAccounts) {
      if (account.maskedNumber) {
        accountsByMaskedNumber.set(account.maskedNumber.replace(/[\s-]/g, "").toUpperCase(), account);
      }
      if (account.displayName) {
        accountsByName.set(account.displayName.toLowerCase(), account);
      }
    }

    // PHASE 2: Resolve all account references and collect new accounts to create
    console.log(`[Job Manager] Phase 2: Resolving account references...`);
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
    const accountCache = new Map<string, string | null>(); // key -> accountId

    function getAccountCacheKey(input: { accountNumber?: string | null; accountName?: string | null; institution?: string | null }): string {
      return `${input.accountNumber || ''}_${input.accountName || ''}_${input.institution || ''}`;
    }

    function findOrCreateAccountSync(input: { accountNumber?: string | null; accountName?: string | null; institution?: string | null; isExternal?: boolean }): string | null {
      if (!input.accountNumber && !input.accountName) {
        return null;
      }

      const cacheKey = getAccountCacheKey(input);
      if (accountCache.has(cacheKey)) {
        return accountCache.get(cacheKey)!;
      }

      // Try to find by masked number
      if (input.accountNumber) {
        const normalizedNumber = input.accountNumber.replace(/[\s-]/g, "").toUpperCase();
        const existing = accountsByMaskedNumber.get(normalizedNumber);
        if (existing) {
          accountCache.set(cacheKey, existing.id);
          return existing.id;
        }
        // Also try last 4 digits match
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

      // Try to find by name
      if (input.accountName) {
        const existing = accountsByName.get(input.accountName.toLowerCase());
        if (existing) {
          accountCache.set(cacheKey, existing.id);
          return existing.id;
        }
      }

      // Create new account
      const newId = uuid();
      const newAccount = {
        id: newId,
        displayName: input.accountName || input.accountNumber || "Unknown Account",
        institution: input.institution || null,
        accountNumber: input.accountNumber?.includes("X") ? null : input.accountNumber || null,
        maskedNumber: input.accountNumber || null,
        accountType: null,
        corpusId: null,
        isExternal: input.isExternal || false,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      newAccountsToCreate.push(newAccount);

      // Add to lookup maps for future references
      if (newAccount.maskedNumber) {
        accountsByMaskedNumber.set(newAccount.maskedNumber.replace(/[\s-]/g, "").toUpperCase(), newAccount as any);
      }
      if (newAccount.displayName) {
        accountsByName.set(newAccount.displayName.toLowerCase(), newAccount as any);
      }

      accountCache.set(cacheKey, newId);
      return newId;
    }

    // PHASE 3: Prepare all transaction data with resolved account IDs
    console.log(`[Job Manager] Phase 3: Preparing ${pendingTransactions.length} transactions...`);
    const transactionsToInsert: Array<{
      id: string;
      emailId: string;
      data: ReturnType<typeof normalizeTransaction>;
    }> = [];
    const transactionIdsByEmail = new Map<string, string[]>();

    for (const pending of pendingTransactions) {
      const txData = pending.transaction;

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
          isExternal: txData.transactionType === "wire_transfer_out" || txData.transactionType === "wire_transfer_in",
        });
      }

      const extractionForNormalize = {
        ...txData,
        isTransaction: true,
        extractionNotes: null,
      };

      const normalizedTx = normalizeTransaction(extractionForNormalize, fromAccountId, toAccountId);
      const txId = uuid();

      transactionsToInsert.push({
        id: txId,
        emailId: pending.emailId,
        data: normalizedTx,
      });

      if (!transactionIdsByEmail.has(pending.emailId)) {
        transactionIdsByEmail.set(pending.emailId, []);
      }
      transactionIdsByEmail.get(pending.emailId)!.push(txId);
    }

    // PHASE 4: Prepare email extractions data
    console.log(`[Job Manager] Phase 4: Preparing ${pendingExtractions.length} email extraction records...`);
    const extractionsToInsert = pendingExtractions.map(pending => {
      const extraction = pending.extraction;
      const procTimeMs = pending.endTime - pending.startTime;
      const txIds = transactionIdsByEmail.get(pending.emailId) || [];

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

      return {
        id: uuid(),
        emailId: pending.emailId,
        runId: extractionRunId,
        status,
        rawExtraction: extraction as any,
        confidence: avgConfidence ? avgConfidence.toFixed(2) : null,
        processingTimeMs: procTimeMs,
        transactionIds: txIds,
      };
    });

    // PHASE 5: Batch insert everything in a single transaction
    console.log(`[Job Manager] Phase 5: Batch inserting ${newAccountsToCreate.length} accounts, ${transactionsToInsert.length} transactions, ${extractionsToInsert.length} extractions...`);

    const BATCH_SIZE = 100;

    await db.transaction(async (tx) => {
      // Insert new accounts in batches
      if (newAccountsToCreate.length > 0) {
        for (let i = 0; i < newAccountsToCreate.length; i += BATCH_SIZE) {
          const batch = newAccountsToCreate.slice(i, i + BATCH_SIZE);
          await tx.insert(accounts).values(batch);
        }
        console.log(`[Job Manager] Inserted ${newAccountsToCreate.length} new accounts`);
      }

      // Insert transactions in batches
      if (transactionsToInsert.length > 0) {
        for (let i = 0; i < transactionsToInsert.length; i += BATCH_SIZE) {
          const batch = transactionsToInsert.slice(i, i + BATCH_SIZE).map(t => ({
            ...t.data,
            id: t.id, // Override the id from normalizeTransaction with our pre-generated one
            sourceEmailId: t.emailId,
            extractionRunId,
          }));
          await tx.insert(transactions).values(batch);
        }
        console.log(`[Job Manager] Inserted ${transactionsToInsert.length} transactions`);
      }

      // Insert email extractions in batches
      if (extractionsToInsert.length > 0) {
        for (let i = 0; i < extractionsToInsert.length; i += BATCH_SIZE) {
          const batch = extractionsToInsert.slice(i, i + BATCH_SIZE);
          await tx.insert(emailExtractions).values(batch);
        }
        console.log(`[Job Manager] Inserted ${extractionsToInsert.length} email extractions`);
      }

      // Update email statuses in batches
      const completedEmails = emailUpdates.filter(u => u.status === "completed");
      const informationalEmails = emailUpdates.filter(u => u.status === "informational");
      const failedEmails = emailUpdates.filter(u => u.status === "failed");

      // Batch update completed emails
      if (completedEmails.length > 0) {
        for (let i = 0; i < completedEmails.length; i += BATCH_SIZE) {
          const batch = completedEmails.slice(i, i + BATCH_SIZE);
          const ids = batch.map(e => e.id);
          await tx
            .update(emails)
            .set({
              extractionStatus: "completed",
              processedAt: new Date(),
            })
            .where(inArray(emails.id, ids));
        }
      }

      // Batch update informational emails
      if (informationalEmails.length > 0) {
        for (let i = 0; i < informationalEmails.length; i += BATCH_SIZE) {
          const batch = informationalEmails.slice(i, i + BATCH_SIZE);
          const ids = batch.map(e => e.id);
          await tx
            .update(emails)
            .set({
              extractionStatus: "informational",
              processedAt: new Date(),
            })
            .where(inArray(emails.id, ids));
        }
      }

      // Batch update failed emails
      if (failedEmails.length > 0) {
        for (let i = 0; i < failedEmails.length; i += BATCH_SIZE) {
          const batch = failedEmails.slice(i, i + BATCH_SIZE);
          const ids = batch.map(e => e.id);
          await tx
            .update(emails)
            .set({
              extractionStatus: "failed",
              processedAt: new Date(),
            })
            .where(inArray(emails.id, ids));
        }
      }

      console.log(`[Job Manager] Updated ${emailUpdates.length} email statuses`);

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

/**
 * Progress event types for streaming extraction
 */
export type ExtractionProgressEvent =
  | { type: "started"; jobId: string; runId: string; totalItems: number; modelId: string; modelName: string; isResume?: boolean; alreadyProcessed?: number }
  | { type: "progress"; processedItems: number; totalItems: number; failedItems: number; informationalItems: number; transactionsFound: number }
  | { type: "batch_complete"; batchSize: number; processedItems: number; totalItems: number }
  | { type: "batch_committed"; transactionsCommitted: number; totalTransactionsCommitted: number; processedItems: number; totalItems: number }
  | { type: "committing"; transactionCount: number; extractionCount: number }
  | { type: "completed"; runId: string; transactionsCreated: number; emailsProcessed: number; processingTimeMs: number }
  | { type: "error"; error: string }
  | { type: "done" };

/**
 * Streaming version of extraction job that yields progress events.
 * This runs synchronously (not fire-and-forget) and yields events as it progresses.
 * Designed for use with Server-Sent Events to keep the connection alive on Vercel.
 *
 * Supports resuming failed/stalled runs via the resumeRunId option.
 * When resuming, emails that already have extractions for that run are skipped.
 */
export async function* runExtractionJobStreaming(
  options: {
    setId: string;
    modelId?: string;
    promptId: string;
    customPromptContent?: string;
    concurrency?: number;
    runName?: string;
    runDescription?: string;
    sampleSize?: number;
    resumeRunId?: string; // Resume a failed/stalled run instead of creating new one
  }
): AsyncGenerator<ExtractionProgressEvent> {
  // When resuming, we don't need setId or promptId - we get them from the existing run
  if (!options.resumeRunId && !options.setId) {
    yield { type: "error", error: "setId is required for extraction (unless resuming)" };
    return;
  }
  if (!options.resumeRunId && !options.promptId) {
    yield { type: "error", error: "promptId is required for extraction (unless resuming)" };
    return;
  }

  const startTime = Date.now();
  let modelId = options.modelId || DEFAULT_MODEL_ID;
  let setId = options.setId;
  let promptId = options.promptId;
  let extractionRunId!: string; // Definite assignment - guaranteed to be set in resume or new run block
  let isResume = false;
  let alreadyProcessedEmailIds: Set<string> = new Set();
  let existingTransactionsCount = 0;

  // If resuming, fetch existing run and determine what's already been processed
  if (options.resumeRunId) {
    const [existingRun] = await db
      .select()
      .from(extractionRuns)
      .where(eq(extractionRuns.id, options.resumeRunId))
      .limit(1);

    if (!existingRun) {
      yield { type: "error", error: `Run not found: ${options.resumeRunId}` };
      return;
    }

    if (existingRun.status === "completed") {
      yield { type: "error", error: "Cannot resume a completed run" };
      return;
    }

    if (existingRun.status === "running") {
      yield { type: "error", error: "Run is already in progress" };
      return;
    }

    // Use values from the existing run
    extractionRunId = existingRun.id;
    setId = existingRun.setId;
    promptId = existingRun.promptId;
    modelId = existingRun.modelId;
    isResume = true;

    // Get emails already processed in this run
    const processedExtractions = await db
      .select({ emailId: emailExtractions.emailId })
      .from(emailExtractions)
      .where(eq(emailExtractions.runId, existingRun.id));

    alreadyProcessedEmailIds = new Set(processedExtractions.map(e => e.emailId));
    existingTransactionsCount = existingRun.transactionsCreated || 0;

    console.log(`[Job Manager] Resuming run ${existingRun.id} (v${existingRun.version}): ${alreadyProcessedEmailIds.size} emails already processed, ${existingTransactionsCount} transactions already committed`);

    // Update run status back to running
    await db
      .update(extractionRuns)
      .set({ status: "running" })
      .where(eq(extractionRuns.id, extractionRunId));
  }

  // Fetch the prompt from database
  const promptResult = await db
    .select()
    .from(prompts)
    .where(eq(prompts.id, promptId))
    .limit(1);

  if (promptResult.length === 0) {
    yield { type: "error", error: `Prompt not found: ${promptId}` };
    return;
  }

  const prompt = promptResult[0];
  const promptContent = options.customPromptContent || prompt.content;
  const hasCustomSchema = !!prompt.jsonSchema;
  const jsonSchema = hasCustomSchema ? prompt.jsonSchema : null;

  // Get model name
  const [modelResult] = await db
    .select({ name: aiModels.name })
    .from(aiModels)
    .where(eq(aiModels.id, modelId))
    .limit(1);
  const modelName = modelResult?.name || modelId;

  // Create job record (always create a new job, even when resuming)
  const jobId = uuid();
  await db.insert(jobs).values({
    id: jobId,
    type: "extraction",
    status: "running",
    startedAt: new Date(),
    metadata: {
      ...options,
      softwareVersion: SOFTWARE_VERSION,
      streaming: true,
      isResume,
      resumedFromRunId: options.resumeRunId || null,
    },
  });

  // Create extraction run only if not resuming
  if (!isResume) {
    extractionRunId = uuid();
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
      promptId,
      softwareVersion: SOFTWARE_VERSION,
      config: options,
      status: "running",
      startedAt: new Date(),
    });
  } else {
    // Update the existing run's jobId to link to the new resume job
    await db
      .update(extractionRuns)
      .set({ jobId })
      .where(eq(extractionRuns.id, extractionRunId));
  }

  // Get emails to process
  let emailsToProcess = await db
    .select()
    .from(emails)
    .where(eq(emails.setId, setId));

  const totalInSet = emailsToProcess.length;

  // When resuming, filter out already processed emails
  if (isResume && alreadyProcessedEmailIds.size > 0) {
    const beforeFilter = emailsToProcess.length;
    emailsToProcess = emailsToProcess.filter(e => !alreadyProcessedEmailIds.has(e.id));
    console.log(`[Job Manager] Filtered out ${beforeFilter - emailsToProcess.length} already-processed emails, ${emailsToProcess.length} remaining`);
  }

  // Apply sampling if specified (only for new runs, not resumes)
  if (!isResume && options.sampleSize && options.sampleSize > 0 && options.sampleSize < totalInSet) {
    const shuffled = [...emailsToProcess];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    emailsToProcess = shuffled.slice(0, options.sampleSize);
  }

  await db
    .update(jobs)
    .set({ totalItems: emailsToProcess.length })
    .where(eq(jobs.id, jobId));

  // Yield started event
  yield {
    type: "started",
    jobId,
    runId: extractionRunId,
    totalItems: emailsToProcess.length,
    modelId,
    modelName,
    isResume,
    alreadyProcessed: alreadyProcessedEmailIds.size,
  };

  // Track progress - when resuming, start with existing counts
  let processedItems = 0; // Only track new items processed in this session
  let failedItems = 0;
  let informationalItems = 0;
  let totalTransactionsCommitted = isResume ? existingTransactionsCount : 0;
  const runStats = {
    byType: {} as Record<string, number>,
    totalConfidence: 0,
    transactionCount: 0,
  };

  // Pending items to commit (cleared after each DB commit batch)
  let pendingTransactions: PendingTransaction[] = [];
  let pendingExtractions: PendingEmailExtraction[] = [];
  let emailUpdates: Array<{
    id: string;
    status: "completed" | "informational" | "failed";
    extraction?: Record<string, unknown>;
    notes?: string;
    error?: string;
  }> = [];

  // Pre-fetch accounts for efficient resolution
  const existingAccounts = await db.select().from(accounts);
  const accountsByMaskedNumber = new Map<string, typeof existingAccounts[0]>();
  const accountsByName = new Map<string, typeof existingAccounts[0]>();

  for (const account of existingAccounts) {
    if (account.maskedNumber) {
      accountsByMaskedNumber.set(account.maskedNumber.replace(/[\s-]/g, "").toUpperCase(), account);
    }
    if (account.displayName) {
      accountsByName.set(account.displayName.toLowerCase(), account);
    }
  }

  // Account resolution cache
  const accountCache = new Map<string, string | null>();

  function getAccountCacheKey(input: { accountNumber?: string | null; accountName?: string | null; institution?: string | null }): string {
    return `${input.accountNumber || ''}_${input.accountName || ''}_${input.institution || ''}`;
  }

  // Helper to commit a batch of pending items to the database
  async function commitBatch(): Promise<number> {
    if (pendingTransactions.length === 0 && pendingExtractions.length === 0) {
      return 0;
    }

    // Track new accounts to create in this batch
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

    function findOrCreateAccountSync(input: { accountNumber?: string | null; accountName?: string | null; institution?: string | null; isExternal?: boolean }): string | null {
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
        accountNumber: input.accountNumber?.includes("X") ? null : input.accountNumber || null,
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
        accountsByMaskedNumber.set(newAccount.maskedNumber.replace(/[\s-]/g, "").toUpperCase(), newAccount as typeof existingAccounts[0]);
      }
      if (newAccount.displayName) {
        accountsByName.set(newAccount.displayName.toLowerCase(), newAccount as typeof existingAccounts[0]);
      }

      accountCache.set(cacheKey, newId);
      return newId;
    }

    // Prepare transactions with account resolution
    const transactionsToInsert: Array<{
      id: string;
      emailId: string;
      data: ReturnType<typeof normalizeTransaction>;
    }> = [];
    const transactionIdsByEmail = new Map<string, string[]>();

    for (const pending of pendingTransactions) {
      const txData = pending.transaction;

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
          isExternal: txData.transactionType === "wire_transfer_out" || txData.transactionType === "wire_transfer_in",
        });
      }

      const extractionForNormalize = {
        ...txData,
        isTransaction: true,
        extractionNotes: null,
      };

      const normalizedTx = normalizeTransaction(extractionForNormalize, fromAccountId, toAccountId);
      const txId = uuid();

      transactionsToInsert.push({
        id: txId,
        emailId: pending.emailId,
        data: normalizedTx,
      });

      if (!transactionIdsByEmail.has(pending.emailId)) {
        transactionIdsByEmail.set(pending.emailId, []);
      }
      transactionIdsByEmail.get(pending.emailId)!.push(txId);
    }

    // Prepare email extractions
    const extractionsToInsert = pendingExtractions.map(pending => {
      const extraction = pending.extraction;
      const procTimeMs = pending.endTime - pending.startTime;
      const txIds = transactionIdsByEmail.get(pending.emailId) || [];

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

      return {
        id: uuid(),
        emailId: pending.emailId,
        runId: extractionRunId,
        status,
        rawExtraction: extraction as any,
        confidence: avgConfidence ? avgConfidence.toFixed(2) : null,
        processingTimeMs: procTimeMs,
        transactionIds: txIds,
      };
    });

    const BATCH_SIZE = 100;
    const transactionsCommitted = transactionsToInsert.length;

    // Insert accounts, transactions, extractions, and update emails
    if (newAccountsToCreate.length > 0) {
      for (let i = 0; i < newAccountsToCreate.length; i += BATCH_SIZE) {
        const batch = newAccountsToCreate.slice(i, i + BATCH_SIZE);
        await db.insert(accounts).values(batch);
      }
    }

    if (transactionsToInsert.length > 0) {
      for (let i = 0; i < transactionsToInsert.length; i += BATCH_SIZE) {
        const batch = transactionsToInsert.slice(i, i + BATCH_SIZE).map(t => ({
          ...t.data,
          id: t.id,
          sourceEmailId: t.emailId,
          extractionRunId,
          runCompleted: false, // Will be set to true when run completes
        }));
        await db.insert(transactions).values(batch);
      }
    }

    if (extractionsToInsert.length > 0) {
      for (let i = 0; i < extractionsToInsert.length; i += BATCH_SIZE) {
        const batch = extractionsToInsert.slice(i, i + BATCH_SIZE);
        await db.insert(emailExtractions).values(batch);
      }
    }

    // Update email statuses
    const completedEmails = emailUpdates.filter(u => u.status === "completed");
    const informationalEmails = emailUpdates.filter(u => u.status === "informational");
    const failedEmails = emailUpdates.filter(u => u.status === "failed");

    if (completedEmails.length > 0) {
      for (let i = 0; i < completedEmails.length; i += BATCH_SIZE) {
        const batch = completedEmails.slice(i, i + BATCH_SIZE);
        const ids = batch.map(e => e.id);
        await db.update(emails).set({ extractionStatus: "completed", processedAt: new Date() }).where(inArray(emails.id, ids));
      }
    }

    if (informationalEmails.length > 0) {
      for (let i = 0; i < informationalEmails.length; i += BATCH_SIZE) {
        const batch = informationalEmails.slice(i, i + BATCH_SIZE);
        const ids = batch.map(e => e.id);
        await db.update(emails).set({ extractionStatus: "informational", processedAt: new Date() }).where(inArray(emails.id, ids));
      }
    }

    if (failedEmails.length > 0) {
      for (let i = 0; i < failedEmails.length; i += BATCH_SIZE) {
        const batch = failedEmails.slice(i, i + BATCH_SIZE);
        const ids = batch.map(e => e.id);
        await db.update(emails).set({ extractionStatus: "failed", processedAt: new Date() }).where(inArray(emails.id, ids));
      }
    }

    // Clear pending items
    pendingTransactions = [];
    pendingExtractions = [];
    emailUpdates = [];

    return transactionsCommitted;
  }

  // Commit batch size (number of emails to process before committing to DB)
  const COMMIT_BATCH_SIZE = 25;

  try {
    const concurrency = options.concurrency || 8;

    // Process in batches
    for (let i = 0; i < emailsToProcess.length; i += concurrency) {
      const batch = emailsToProcess.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        batch.map(async (email) => {
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

          const extractionStartTime = Date.now();
          const extraction = await extractTransaction(parsedEmail, modelId, promptContent, jsonSchema);
          const extractionEndTime = Date.now();

          return { email, extraction, startTime: extractionStartTime, endTime: extractionEndTime };
        })
      );

      // Process results
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const email = batch[j];

        if (result.status === "fulfilled") {
          const { extraction, startTime: extStart, endTime: extEnd } = result.value;

          pendingExtractions.push({
            emailId: email.id,
            extraction,
            startTime: extStart,
            endTime: extEnd,
          });

          if (extraction.isTransactional && extraction.transactions.length > 0) {
            for (let txIndex = 0; txIndex < extraction.transactions.length; txIndex++) {
              const transaction = extraction.transactions[txIndex];
              pendingTransactions.push({
                emailId: email.id,
                transaction,
                transactionIndex: txIndex,
              });

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
            const notes = extraction.extractionNotes ||
              `Non-transactional email (type: ${extraction.emailType})`;
            emailUpdates.push({
              id: email.id,
              status: "informational",
              extraction: extraction as unknown as Record<string, unknown>,
              notes,
            });
            informationalItems++;
          }

          processedItems++;
        } else {
          const error = result.reason as Error;
          await logExtractionError(email.id, jobId, error, "error");
          emailUpdates.push({
            id: email.id,
            status: "failed",
            error: error.message,
          });
          failedItems++;
          processedItems++;
        }
      }

      // Update job progress in DB
      await db
        .update(jobs)
        .set({
          processedItems,
          failedItems,
          informationalItems,
        })
        .where(eq(jobs.id, jobId));

      // Yield progress event
      yield {
        type: "progress",
        processedItems,
        totalItems: emailsToProcess.length,
        failedItems,
        informationalItems,
        transactionsFound: runStats.transactionCount,
      };

      // Yield batch complete event
      yield {
        type: "batch_complete",
        batchSize: batch.length,
        processedItems,
        totalItems: emailsToProcess.length,
      };

      // Commit to DB every COMMIT_BATCH_SIZE emails
      if (pendingExtractions.length >= COMMIT_BATCH_SIZE) {
        const transactionsCommitted = await commitBatch();
        totalTransactionsCommitted += transactionsCommitted;

        // Update extraction run with current progress (including already processed from resume)
        await db
          .update(extractionRuns)
          .set({
            emailsProcessed: processedItems + alreadyProcessedEmailIds.size,
            transactionsCreated: totalTransactionsCommitted,
            informationalCount: informationalItems,
            errorCount: failedItems,
            stats: {
              byType: runStats.byType,
              avgConfidence: runStats.transactionCount > 0 ? runStats.totalConfidence / runStats.transactionCount : 0,
              processingTimeMs: Date.now() - startTime,
              isResume,
            },
          })
          .where(eq(extractionRuns.id, extractionRunId));

        // Yield batch committed event
        yield {
          type: "batch_committed",
          transactionsCommitted,
          totalTransactionsCommitted,
          processedItems,
          totalItems: emailsToProcess.length,
        };
      }
    }

    // Commit any remaining pending items
    if (pendingExtractions.length > 0) {
      yield {
        type: "committing",
        transactionCount: pendingTransactions.length,
        extractionCount: pendingExtractions.length,
      };

      const transactionsCommitted = await commitBatch();
      totalTransactionsCommitted += transactionsCommitted;
    }

    const processingTimeMs = Date.now() - startTime;

    // Mark all transactions from this run as runCompleted = true
    await db
      .update(transactions)
      .set({ runCompleted: true })
      .where(eq(transactions.extractionRunId, extractionRunId));

    // Calculate total emails processed (including those from resume)
    const totalEmailsProcessed = processedItems + alreadyProcessedEmailIds.size;

    // Update extraction run as completed
    await db
      .update(extractionRuns)
      .set({
        status: "completed",
        completedAt: new Date(),
        emailsProcessed: totalEmailsProcessed,
        transactionsCreated: totalTransactionsCommitted,
        informationalCount: informationalItems,
        errorCount: failedItems,
        stats: {
          byType: runStats.byType,
          avgConfidence: runStats.transactionCount > 0 ? runStats.totalConfidence / runStats.transactionCount : 0,
          processingTimeMs,
          isResume,
          resumedAt: isResume ? startTime : undefined,
        },
      })
      .where(eq(extractionRuns.id, extractionRunId));

    // Update job as completed
    await db
      .update(jobs)
      .set({ status: "completed", completedAt: new Date() })
      .where(eq(jobs.id, jobId));

    // Yield completed event
    yield {
      type: "completed",
      runId: extractionRunId,
      transactionsCreated: totalTransactionsCommitted,
      emailsProcessed: totalEmailsProcessed,
      processingTimeMs,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    const processingTimeMs = Date.now() - startTime;
    const totalEmailsProcessed = processedItems + alreadyProcessedEmailIds.size;

    // Update run as failed (but keep track of transactions that were committed before failure)
    // Note: transactions committed before failure have runCompleted = false
    // The run can be resumed later to continue processing
    await db
      .update(extractionRuns)
      .set({
        status: "failed",
        completedAt: new Date(),
        emailsProcessed: totalEmailsProcessed,
        transactionsCreated: totalTransactionsCommitted,
        informationalCount: informationalItems,
        errorCount: failedItems,
        stats: {
          byType: runStats.byType,
          avgConfidence: runStats.transactionCount > 0 ? runStats.totalConfidence / runStats.transactionCount : 0,
          processingTimeMs,
          isResume,
          canResume: true, // Mark that this run can be resumed
        },
      })
      .where(eq(extractionRuns.id, extractionRunId));

    await db
      .update(jobs)
      .set({
        status: "failed",
        errorMessage,
        completedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));

    yield { type: "error", error: errorMessage };
  }
}
