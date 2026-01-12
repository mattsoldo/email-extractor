import { NextRequest, NextResponse } from "next/server";
import { inngest } from "@/inngest/client";
import { db } from "@/db";
import { extractionRuns, emailSets, prompts, aiModels } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import { SOFTWARE_VERSION } from "@/config/version";
import { DEFAULT_MODEL_ID } from "@/services/ai-extractor";

/**
 * POST /api/jobs/inngest - Start an extraction job via Inngest
 *
 * This endpoint queues the job with Inngest for background processing.
 * Unlike the streaming endpoint, it returns immediately after queuing.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { setId, modelId, promptId, concurrency, sampleSize, resumeRunId } = body;

    // Validate inputs (unless resuming)
    if (!resumeRunId) {
      if (!setId) {
        return NextResponse.json(
          { error: "setId is required" },
          { status: 400 }
        );
      }
      if (!promptId) {
        return NextResponse.json(
          { error: "promptId is required" },
          { status: 400 }
        );
      }

      // Validate set exists
      const [set] = await db
        .select({ id: emailSets.id, emailCount: emailSets.emailCount })
        .from(emailSets)
        .where(eq(emailSets.id, setId))
        .limit(1);

      if (!set) {
        return NextResponse.json(
          { error: "Email set not found" },
          { status: 404 }
        );
      }

      // Validate prompt exists
      const [prompt] = await db
        .select({ id: prompts.id })
        .from(prompts)
        .where(eq(prompts.id, promptId))
        .limit(1);

      if (!prompt) {
        return NextResponse.json(
          { error: "Prompt not found" },
          { status: 404 }
        );
      }
    }

    // If resuming, validate the run
    if (resumeRunId) {
      const [existingRun] = await db
        .select()
        .from(extractionRuns)
        .where(eq(extractionRuns.id, resumeRunId))
        .limit(1);

      if (!existingRun) {
        return NextResponse.json(
          { error: "Run not found" },
          { status: 404 }
        );
      }

      if (existingRun.status === "completed") {
        return NextResponse.json(
          { error: "Cannot resume a completed run" },
          { status: 400 }
        );
      }

      if (existingRun.status === "running") {
        return NextResponse.json(
          { error: "Run is already in progress" },
          { status: 400 }
        );
      }
    }

    // Get the next version number for display
    const [latestRun] = await db
      .select({ version: extractionRuns.version })
      .from(extractionRuns)
      .orderBy(desc(extractionRuns.version))
      .limit(1);
    const nextVersion = resumeRunId ? null : (latestRun?.version || 0) + 1;

    // Send event to Inngest
    const eventId = await inngest.send({
      name: "extraction/started",
      data: {
        runId: uuid(), // This will be overridden in the function for new runs
        setId: setId || "",
        modelId: modelId || DEFAULT_MODEL_ID,
        promptId: promptId || "",
        concurrency: concurrency || 3,
        sampleSize,
        resumeRunId,
      },
    });

    return NextResponse.json({
      success: true,
      message: resumeRunId
        ? "Resume job queued successfully"
        : `Extraction job v${nextVersion} queued successfully`,
      eventId,
      isResume: !!resumeRunId,
    });
  } catch (error) {
    console.error("Failed to queue extraction job:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to queue job" },
      { status: 500 }
    );
  }
}
