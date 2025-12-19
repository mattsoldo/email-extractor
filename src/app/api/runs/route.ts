import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { extractionRuns, transactions, jobs } from "@/db/schema";
import { desc, eq, count, sql } from "drizzle-orm";

// GET /api/runs - List extraction runs
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "20");
  const offset = (page - 1) * limit;

  // Get extraction runs with job info (including progress for running jobs)
  const runs = await db
    .select({
      run: extractionRuns,
      job: {
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        totalItems: jobs.totalItems,
        processedItems: jobs.processedItems,
        failedItems: jobs.failedItems,
        skippedItems: jobs.skippedItems,
        informationalItems: jobs.informationalItems,
      },
    })
    .from(extractionRuns)
    .leftJoin(jobs, eq(extractionRuns.jobId, jobs.id))
    .orderBy(desc(extractionRuns.version))
    .limit(limit)
    .offset(offset);

  // Get total count
  const [{ count: total }] = await db
    .select({ count: count() })
    .from(extractionRuns);

  // Get summary stats
  const [summaryStats] = await db
    .select({
      totalRuns: count(),
      totalTransactions: sql<number>`sum(${extractionRuns.transactionsCreated})`,
      totalEmails: sql<number>`sum(${extractionRuns.emailsProcessed})`,
    })
    .from(extractionRuns)
    .where(eq(extractionRuns.status, "completed"));

  return NextResponse.json({
    runs: runs.map((r) => ({
      ...r.run,
      job: r.job,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    summary: {
      totalRuns: summaryStats.totalRuns || 0,
      totalTransactions: summaryStats.totalTransactions || 0,
      totalEmails: summaryStats.totalEmails || 0,
    },
  });
}
