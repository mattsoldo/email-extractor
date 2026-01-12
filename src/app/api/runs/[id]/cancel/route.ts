import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { extractionRuns, jobs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";

// POST /api/runs/[id]/cancel - Cancel a running extraction
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // Get the run
  const [run] = await db
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.id, id));

  if (!run) {
    return NextResponse.json({ error: "Extraction run not found" }, { status: 404 });
  }

  if (run.status !== "running") {
    return NextResponse.json(
      { error: `Cannot cancel run with status: ${run.status}` },
      { status: 400 }
    );
  }

  // Send cancel event to Inngest - this will cancel all queued email processors
  await inngest.send({
    name: "extraction/cancel",
    data: {
      runId: id,
    },
  });

  // Update run status to cancelled
  await db
    .update(extractionRuns)
    .set({
      status: "cancelled",
      completedAt: new Date(),
    })
    .where(eq(extractionRuns.id, id));

  // Update job status if exists
  if (run.jobId) {
    await db
      .update(jobs)
      .set({
        status: "cancelled",
        completedAt: new Date(),
      })
      .where(eq(jobs.id, run.jobId));
  }

  console.log(`[API] Cancelled extraction run ${id}`);

  return NextResponse.json({
    success: true,
    runId: id,
    message: "Extraction run cancelled. Queued jobs will be stopped.",
  });
}
