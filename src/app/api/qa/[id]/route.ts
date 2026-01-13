import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import {
  qaRuns,
  qaResults,
  extractionRuns,
  transactions,
  emails,
  emailSets,
} from "@/db/schema";
import { eq, and, sql, max, inArray } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { v4 as uuid } from "uuid";

// GET /api/qa/[id] - Get QA run details with results
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const searchParams = request.nextUrl.searchParams;
  const onlyIssues = searchParams.get("onlyIssues") === "true";
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  // Get QA run
  const [qaRun] = await db
    .select()
    .from(qaRuns)
    .where(eq(qaRuns.id, id))
    .limit(1);

  if (!qaRun) {
    return NextResponse.json({ error: "QA run not found" }, { status: 404 });
  }

  // Get source run info
  const [sourceRun] = await db
    .select()
    .from(extractionRuns)
    .where(eq(extractionRuns.id, qaRun.sourceRunId))
    .limit(1);

  // Get set info
  const [set] = await db
    .select()
    .from(emailSets)
    .where(eq(emailSets.id, qaRun.setId))
    .limit(1);

  // Get results with optional filtering
  let resultsQuery = db
    .select({
      result: qaResults,
      transaction: transactions,
      email: {
        id: emails.id,
        subject: emails.subject,
        sender: emails.sender,
        date: emails.date,
      },
    })
    .from(qaResults)
    .leftJoin(transactions, eq(qaResults.transactionId, transactions.id))
    .leftJoin(emails, eq(qaResults.sourceEmailId, emails.id))
    .where(
      onlyIssues
        ? and(eq(qaResults.qaRunId, id), eq(qaResults.hasIssues, true))
        : eq(qaResults.qaRunId, id)
    )
    .limit(limit)
    .offset(offset);

  const results = await resultsQuery;

  // Get total count based on filter
  const [{ count: totalResults }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(qaResults)
    .where(
      onlyIssues
        ? and(eq(qaResults.qaRunId, id), eq(qaResults.hasIssues, true))
        : eq(qaResults.qaRunId, id)
    );

  // Get summary stats
  const [stats] = await db
    .select({
      total: sql<number>`count(*)`,
      withIssues: sql<number>`count(*) filter (where ${qaResults.hasIssues} = true)`,
      accepted: sql<number>`count(*) filter (where ${qaResults.status} = 'accepted')`,
      rejected: sql<number>`count(*) filter (where ${qaResults.status} = 'rejected')`,
      partial: sql<number>`count(*) filter (where ${qaResults.status} = 'partial')`,
      pending: sql<number>`count(*) filter (where ${qaResults.status} = 'pending_review')`,
    })
    .from(qaResults)
    .where(eq(qaResults.qaRunId, id));

  return NextResponse.json({
    qaRun,
    sourceRun,
    set,
    results: results.map((r) => ({
      ...r.result,
      transaction: r.transaction,
      email: r.email,
    })),
    pagination: {
      page,
      limit,
      total: totalResults,
      totalPages: Math.ceil(totalResults / limit),
    },
    stats,
  });
}

// PATCH /api/qa/[id] - Update a QA result's review status
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { resultId, status, acceptedFields, acceptedMerges } = body;

    if (!resultId) {
      return NextResponse.json(
        { error: "resultId is required" },
        { status: 400 }
      );
    }

    // Verify the result belongs to this QA run
    const [result] = await db
      .select()
      .from(qaResults)
      .where(and(eq(qaResults.id, resultId), eq(qaResults.qaRunId, id)))
      .limit(1);

    if (!result) {
      return NextResponse.json(
        { error: "QA result not found" },
        { status: 404 }
      );
    }

    // Update the result
    const updateData: Partial<typeof qaResults.$inferInsert> = {
      reviewedAt: new Date(),
    };

    if (status) {
      updateData.status = status;
    }
    if (acceptedFields !== undefined) {
      updateData.acceptedFields = acceptedFields;
    }
    if (acceptedMerges !== undefined) {
      updateData.acceptedMerges = acceptedMerges;
    }

    await db
      .update(qaResults)
      .set(updateData)
      .where(eq(qaResults.id, resultId));

    return NextResponse.json({
      success: true,
      message: "QA result updated",
    });
  } catch (error) {
    console.error("Failed to update QA result:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update" },
      { status: 500 }
    );
  }
}

// DELETE /api/qa/[id] - Cancel a running QA run
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Get the QA run
    const [qaRun] = await db
      .select()
      .from(qaRuns)
      .where(eq(qaRuns.id, id))
      .limit(1);

    if (!qaRun) {
      return NextResponse.json({ error: "QA run not found" }, { status: 404 });
    }

    if (qaRun.status !== "running" && qaRun.status !== "pending") {
      return NextResponse.json(
        { error: "Can only cancel running or pending QA runs" },
        { status: 400 }
      );
    }

    // Send cancel event to Inngest
    await inngest.send({
      name: "qa/cancel",
      data: { qaRunId: id },
    });

    // Update status
    await db
      .update(qaRuns)
      .set({ status: "failed", completedAt: new Date() })
      .where(eq(qaRuns.id, id));

    return NextResponse.json({
      success: true,
      message: "QA run cancelled",
    });
  } catch (error) {
    console.error("Failed to cancel QA run:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to cancel" },
      { status: 500 }
    );
  }
}
