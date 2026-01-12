import { NextResponse } from "next/server";
import { db } from "@/db";
import { extractionRuns, aiModels, emailSets, prompts, emailExtractions } from "@/db/schema";
import { desc, eq, inArray, sql } from "drizzle-orm";

/**
 * GET /api/runs/recent - Get recent extraction runs (completed and failed)
 * Failed runs can be resumed to continue processing remaining emails
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
      .where(inArray(extractionRuns.status, ["completed", "failed"]))
      .orderBy(desc(extractionRuns.completedAt))
      .limit(10);

    // For failed runs, calculate how many emails remain to process
    const runsWithRemaining = await Promise.all(
      recentRuns.map(async (run) => {
        if (run.status === "failed") {
          // Count total emails in the set
          const [setInfo] = await db
            .select({ emailCount: emailSets.emailCount })
            .from(emailSets)
            .where(eq(emailSets.id, run.setId))
            .limit(1);

          // Count already processed emails in this run
          const [processedCount] = await db
            .select({ count: sql<number>`count(*)` })
            .from(emailExtractions)
            .where(eq(emailExtractions.runId, run.id));

          const totalEmails = setInfo?.emailCount || 0;
          const processed = Number(processedCount?.count) || 0;
          const remaining = totalEmails - processed;

          return {
            ...run,
            canResume: remaining > 0,
            emailsRemaining: remaining,
            totalEmailsInSet: totalEmails,
          };
        }
        return {
          ...run,
          canResume: false,
          emailsRemaining: 0,
          totalEmailsInSet: 0,
        };
      })
    );

    return NextResponse.json({ runs: runsWithRemaining });
  } catch (error) {
    console.error("Failed to fetch recent runs:", error);
    return NextResponse.json(
      { error: "Failed to fetch recent runs" },
      { status: 500 }
    );
  }
}
