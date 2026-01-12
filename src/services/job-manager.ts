import { v4 as uuid } from "uuid";
import { db } from "@/db";
import { jobs, emails, extractionRuns, prompts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { scanEmailDirectory, parseEmlFile, toDbEmail, classifyEmail } from "./email-parser";
import { DEFAULT_MODEL_ID } from "./ai-extractor";
import { inngest } from "@/inngest/client";

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

  // Send event to Inngest to start the extraction
  // The orchestrator function will create the job and extraction run records
  await inngest.send({
    name: "extraction/started",
    data: {
      runId: uuid(), // Will be used by orchestrator if not resuming
      setId: options.setId,
      modelId,
      promptId: options.promptId,
      sampleSize: options.sampleSize,
    },
  });

  console.log(`[Job Manager] Triggered Inngest extraction for set ${options.setId}`);

  // Return a placeholder - the actual job ID is created by the Inngest orchestrator
  // The UI will pick up the running job from the extraction_runs table
  return "inngest-triggered";
}
