import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getJobProgress, cancelJob } from "@/services/job-manager";

// GET /api/jobs/[id] - Get job details
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // First check in-memory for real-time progress
  const liveProgress = getJobProgress(id);
  if (liveProgress) {
    return NextResponse.json({ job: liveProgress, live: true });
  }

  // Fall back to database
  const job = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);

  if (job.length === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job: job[0], live: false });
}

// DELETE /api/jobs/[id] - Cancel a job
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const cancelled = cancelJob(id);

  if (cancelled) {
    return NextResponse.json({ message: "Job cancelled" });
  }

  return NextResponse.json(
    { error: "Job not found or not running" },
    { status: 400 }
  );
}
