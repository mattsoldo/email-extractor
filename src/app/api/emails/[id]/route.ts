import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails, transactions, extractionRuns, emailExtractions, aiModels, prompts, discussionSummaries } from "@/db/schema";
import { eq, inArray, desc } from "drizzle-orm";

// GET /api/emails/[id] - Get single email with all transactions from different runs
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const email = await db.select().from(emails).where(eq(emails.id, id)).limit(1);

  if (email.length === 0) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  // Get all transactions from this email (may have multiple from different runs)
  const emailTransactions = await db
    .select()
    .from(transactions)
    .where(eq(transactions.sourceEmailId, id));

  // Get run info for each unique extractionRunId
  const runIds = [...new Set(emailTransactions.map((t) => t.extractionRunId).filter(Boolean))];
  let runs: Array<{ id: string; modelId: string | null; version: number; startedAt: Date }> = [];
  if (runIds.length > 0) {
    runs = await db
      .select({
        id: extractionRuns.id,
        modelId: extractionRuns.modelId,
        version: extractionRuns.version,
        startedAt: extractionRuns.startedAt,
      })
      .from(extractionRuns)
      .where(inArray(extractionRuns.id, runIds as string[]));
  }

  // Group transactions by run
  const transactionsByRun = new Map<string, typeof emailTransactions>();
  for (const t of emailTransactions) {
    const runId = t.extractionRunId || "unknown";
    if (!transactionsByRun.has(runId)) {
      transactionsByRun.set(runId, []);
    }
    transactionsByRun.get(runId)!.push(t);
  }

  // Get all extractions for this email (with run, model, and prompt info)
  const extractions = await db
    .select({
      id: emailExtractions.id,
      emailId: emailExtractions.emailId,
      runId: emailExtractions.runId,
      status: emailExtractions.status,
      rawExtraction: emailExtractions.rawExtraction,
      confidence: emailExtractions.confidence,
      processingTimeMs: emailExtractions.processingTimeMs,
      transactionIds: emailExtractions.transactionIds,
      createdAt: emailExtractions.createdAt,
      error: emailExtractions.error,
      // Run info
      runVersion: extractionRuns.version,
      runStartedAt: extractionRuns.startedAt,
      runCompletedAt: extractionRuns.completedAt,
      // Model info
      modelId: aiModels.id,
      modelName: aiModels.name,
      // Prompt info
      promptId: prompts.id,
      promptName: prompts.name,
    })
    .from(emailExtractions)
    .leftJoin(extractionRuns, eq(emailExtractions.runId, extractionRuns.id))
    .leftJoin(aiModels, eq(extractionRuns.modelId, aiModels.id))
    .leftJoin(prompts, eq(extractionRuns.promptId, prompts.id))
    .where(eq(emailExtractions.emailId, id))
    .orderBy(desc(emailExtractions.createdAt));

  // Get discussion summaries for this email (evidence/discussion context)
  const summaries = await db
    .select({
      id: discussionSummaries.id,
      emailId: discussionSummaries.emailId,
      runId: discussionSummaries.runId,
      summary: discussionSummaries.summary,
      relatedReferenceNumbers: discussionSummaries.relatedReferenceNumbers,
      createdAt: discussionSummaries.createdAt,
      // Run info for context
      runVersion: extractionRuns.version,
    })
    .from(discussionSummaries)
    .leftJoin(extractionRuns, eq(discussionSummaries.runId, extractionRuns.id))
    .where(eq(discussionSummaries.emailId, id))
    .orderBy(desc(discussionSummaries.createdAt));

  return NextResponse.json({
    email: email[0],
    transactions: emailTransactions,
    runs,
    transactionsByRun: Object.fromEntries(transactionsByRun),
    extractions,
    discussionSummaries: summaries,
    winnerTransactionId: email[0].winnerTransactionId,
  });
}

// PATCH /api/emails/[id] - Update email (e.g., set winner transaction)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const email = await db.select().from(emails).where(eq(emails.id, id)).limit(1);

  if (email.length === 0) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  const updates: Partial<typeof emails.$inferInsert> = {};

  // Set winner transaction
  if ("winnerTransactionId" in body) {
    // Validate that the transaction exists and belongs to this email
    if (body.winnerTransactionId) {
      const txn = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, body.winnerTransactionId))
        .limit(1);

      if (txn.length === 0) {
        return NextResponse.json({ error: "Transaction not found" }, { status: 400 });
      }
      if (txn[0].sourceEmailId !== id) {
        return NextResponse.json({ error: "Transaction does not belong to this email" }, { status: 400 });
      }
    }
    updates.winnerTransactionId = body.winnerTransactionId || null;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No valid updates provided" }, { status: 400 });
  }

  await db.update(emails).set(updates).where(eq(emails.id, id));

  return NextResponse.json({ message: "Email updated", updates });
}

// POST /api/emails/[id]/reprocess - Reprocess a single email
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Reset email status to pending
  await db
    .update(emails)
    .set({
      extractionStatus: "pending",
      extractionError: null,
      rawExtraction: null,
      processedAt: null,
    })
    .where(eq(emails.id, id));

  // Delete existing transactions for this email
  await db.delete(transactions).where(eq(transactions.sourceEmailId, id));

  return NextResponse.json({ message: "Email queued for reprocessing" });
}
