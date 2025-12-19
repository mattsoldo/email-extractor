import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
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
    const active = getActiveJobs();
    return NextResponse.json({ jobs: active });
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
      jobId = await startExtractionJob({
        setId: options.setId,
        modelId: options?.modelId,
        concurrency: options?.concurrency || 3,
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
