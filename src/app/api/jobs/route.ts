import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, extractionRuns, aiModels, emailSets } from "@/db/schema";
import { desc, eq, or, inArray } from "drizzle-orm";
import {
  startExtractionJob,
  getJobProgress,
  getActiveJobs,
  cancelJob,
} from "@/services/job-manager";

// GET /api/jobs - List all jobs
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const activeOnly = searchParams.get("active") === "true";

  if (activeOnly) {
    // Get in-memory active jobs
    const inMemoryJobs = getActiveJobs();

    // Also get running extraction runs from database (in case of server restart)
    const runningRuns = await db
      .select({
        id: extractionRuns.id,
        jobId: extractionRuns.jobId,
        setId: extractionRuns.setId,
        modelId: extractionRuns.modelId,
        modelName: aiModels.name,
        emailsProcessed: extractionRuns.emailsProcessed,
        errorCount: extractionRuns.errorCount,
        informationalCount: extractionRuns.informationalCount,
        startedAt: extractionRuns.startedAt,
        emailCount: emailSets.emailCount,
      })
      .from(extractionRuns)
      .leftJoin(aiModels, eq(extractionRuns.modelId, aiModels.id))
      .leftJoin(emailSets, eq(extractionRuns.setId, emailSets.id))
      .where(eq(extractionRuns.status, "running"))
      .orderBy(desc(extractionRuns.startedAt));

    // Convert running runs to job progress format
    const runningJobsFromDB = runningRuns.map(run => ({
      id: run.jobId || run.id,
      type: "extraction" as const,
      status: "running" as const,
      totalItems: run.emailCount || run.emailsProcessed,
      processedItems: run.emailsProcessed,
      failedItems: run.errorCount,
      skippedItems: 0,
      informationalItems: run.informationalCount,
      errorMessage: null,
      modelId: run.modelId,
      modelName: run.modelName,
      startedAt: run.startedAt,
      completedAt: null,
    }));

    // Merge in-memory jobs with DB jobs, preferring in-memory for duplicates
    const inMemoryJobIds = new Set(inMemoryJobs.map(j => j.id));
    const allActiveJobs = [
      ...inMemoryJobs,
      ...runningJobsFromDB.filter(j => !inMemoryJobIds.has(j.id))
    ];

    return NextResponse.json({ jobs: allActiveJobs });
  }

  const allJobs = await db
    .select()
    .from(jobs)
    .orderBy(desc(jobs.createdAt))
    .limit(50);

  return NextResponse.json({ jobs: allJobs });
}

// POST /api/jobs - Start a new job
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { type, options } = body;

  let jobId: string;

  switch (type) {
    case "extraction":
      if (!options?.setId) {
        return NextResponse.json(
          { error: "setId is required for extraction" },
          { status: 400 }
        );
      }
      if (!options?.promptId) {
        return NextResponse.json(
          { error: "promptId is required for extraction" },
          { status: 400 }
        );
      }
      jobId = await startExtractionJob({
        setId: options.setId,
        modelId: options?.modelId,
        promptId: options.promptId,
        customPromptContent: options?.customPromptContent, // Optional: overrides prompt content if provided
        concurrency: options?.concurrency || 3,
        sampleSize: options?.sampleSize, // Optional: randomly select this many emails
      });
      break;

    default:
      return NextResponse.json(
        { error: `Unknown job type: ${type}` },
        { status: 400 }
      );
  }

  return NextResponse.json({ jobId, message: `Started ${type} job` });
}
