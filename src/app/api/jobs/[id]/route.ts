import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs, extractionLogs, transactions, accounts, extractionRuns } from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import { getJobProgress, cancelJob } from "@/services/job-manager";

// GET /api/jobs/[id] - Get job details with logs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  const includeLogs = searchParams.get("logs") !== "false";
  const logLimit = parseInt(searchParams.get("logLimit") || "100");

  // First check in-memory for real-time progress
  const liveProgress = getJobProgress(id);

  // Get job from database (for full details like metadata)
  const jobResult = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);

  if (!liveProgress && jobResult.length === 0) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  const job = jobResult[0] || null;

  // Get extraction logs for this job
  let logs: typeof extractionLogs.$inferSelect[] = [];
  if (includeLogs) {
    logs = await db
      .select()
      .from(extractionLogs)
      .where(eq(extractionLogs.jobId, id))
      .orderBy(desc(extractionLogs.createdAt))
      .limit(logLimit);
  }

  // Get extraction run if exists
  const runResult = await db
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.jobId, id))
    .limit(1);
  const extractionRun = runResult[0] || null;

  // Get summary stats for completed jobs
  let summary = null;
  if (extractionRun) {
    // Get recent transactions from this run
    const recentTransactions = await db
      .select({
        id: transactions.id,
        type: transactions.type,
        symbol: transactions.symbol,
        amount: transactions.amount,
        date: transactions.date,
        accountId: transactions.accountId,
      })
      .from(transactions)
      .where(eq(transactions.extractionRunId, extractionRun.id))
      .orderBy(desc(transactions.date))
      .limit(20);

    // Get accounts created/used
    const accountIds = [...new Set(recentTransactions.map(t => t.accountId).filter(Boolean))];
    const accountsUsed = accountIds.length > 0
      ? await db
          .select()
          .from(accounts)
          .where(eq(accounts.id, accountIds[0]!)) // Simplified - get first account
      : [];

    summary = {
      transactionsCreated: extractionRun.transactionsCreated,
      informationalCount: extractionRun.informationalCount,
      errorCount: extractionRun.errorCount,
      recentTransactions,
      accountsUsed: accountsUsed.length,
    };
  }

  // Combine live progress with DB data
  const response = {
    job: liveProgress || job,
    live: !!liveProgress,
    dbJob: job, // Full DB record with metadata
    logs,
    extractionRun,
    summary,
  };

  return NextResponse.json(response);
}

// DELETE /api/jobs/[id] - Cancel a job with optional notes
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Try to get notes from request body
  let notes: string | null = null;
  try {
    const body = await request.json();
    notes = body.notes || null;
  } catch {
    // No body or invalid JSON - that's fine
  }

  const cancelled = cancelJob(id);

  if (cancelled) {
    // Update database with cancel notes
    await db
      .update(jobs)
      .set({
        cancelNotes: notes,
        cancelledAt: new Date(),
      })
      .where(eq(jobs.id, id));

    return NextResponse.json({ message: "Job cancelled", notes });
  }

  return NextResponse.json(
    { error: "Job not found or not running" },
    { status: 400 }
  );
}

// PATCH /api/jobs/[id] - Update job (e.g., add notes to cancelled job)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const updates: Partial<typeof jobs.$inferInsert> = {};

  if (body.cancelNotes !== undefined) {
    updates.cancelNotes = body.cancelNotes;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 });
  }

  await db.update(jobs).set(updates).where(eq(jobs.id, id));

  return NextResponse.json({ message: "Job updated" });
}
