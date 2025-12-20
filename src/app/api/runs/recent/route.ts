import { NextResponse } from "next/server";
import { db } from "@/db";
import { extractionRuns, aiModels, emailSets, prompts } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

/**
 * GET /api/runs/recent - Get recent completed extraction runs
 */
export async function GET() {
  try {
    const recentRuns = await db
      .select({
        id: extractionRuns.id,
        setId: extractionRuns.setId,
        setName: emailSets.name,
        modelId: extractionRuns.modelId,
        modelName: aiModels.name,
        promptId: extractionRuns.promptId,
        promptName: prompts.name,
        version: extractionRuns.version,
        name: extractionRuns.name,
        status: extractionRuns.status,
        emailsProcessed: extractionRuns.emailsProcessed,
        transactionsCreated: extractionRuns.transactionsCreated,
        informationalCount: extractionRuns.informationalCount,
        errorCount: extractionRuns.errorCount,
        startedAt: extractionRuns.startedAt,
        completedAt: extractionRuns.completedAt,
      })
      .from(extractionRuns)
      .leftJoin(emailSets, eq(extractionRuns.setId, emailSets.id))
      .leftJoin(aiModels, eq(extractionRuns.modelId, aiModels.id))
      .leftJoin(prompts, eq(extractionRuns.promptId, prompts.id))
      .where(eq(extractionRuns.status, "completed"))
      .orderBy(desc(extractionRuns.completedAt))
      .limit(3);

    return NextResponse.json({ runs: recentRuns });
  } catch (error) {
    console.error("Failed to fetch recent runs:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent runs" },
      { status: 500 }
    );
  }
}
