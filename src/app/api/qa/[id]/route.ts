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
  const onlyMultiTransaction = searchParams.get("onlyMultiTransaction") === "true";
  const excludeMultiTransaction = searchParams.get("excludeMultiTransaction") === "true";
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

  // Build filter conditions
  const buildWhereCondition = () => {
    const conditions = [eq(qaResults.qaRunId, id)];
    if (onlyIssues) {
      conditions.push(eq(qaResults.hasIssues, true));
    }
    if (onlyMultiTransaction) {
      conditions.push(eq(qaResults.isMultiTransaction, true));
    } else if (excludeMultiTransaction) {
      conditions.push(eq(qaResults.isMultiTransaction, false));
    }
    return conditions.length === 1 ? conditions[0] : and(...conditions);
  };

  const whereCondition = buildWhereCondition();

  // Get results with optional filtering
  const results = await db
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
    .where(whereCondition)
    .limit(limit)
    .offset(offset);

  // Get total count based on filter
  const [{ count: totalResults }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(qaResults)
    .where(whereCondition);

  // Get summary stats
  const [stats] = await db
    .select({
      total: sql<number>`count(*)`,
      withIssues: sql<number>`count(*) filter (where ${qaResults.hasIssues} = true)`,
      multiTransaction: sql<number>`count(*) filter (where ${qaResults.isMultiTransaction} = true)`,
      accepted: sql<number>`count(*) filter (where ${qaResults.status} = 'accepted')`,
      rejected: sql<number>`count(*) filter (where ${qaResults.status} = 'rejected')`,
      partial: sql<number>`count(*) filter (where ${qaResults.status} = 'partial')`,
      pending: sql<number>`count(*) filter (where ${qaResults.status} = 'pending_review')`,
    })
    .from(qaResults)
    .where(eq(qaResults.qaRunId, id));

  // Get pending results to compute grouped field stats
  const pendingResults = await db
    .select({
      id: qaResults.id,
      fieldIssues: qaResults.fieldIssues,
      status: qaResults.status,
      acceptedFields: qaResults.acceptedFields,
    })
    .from(qaResults)
    .where(
      and(
        eq(qaResults.qaRunId, id),
        eq(qaResults.hasIssues, true),
        eq(qaResults.status, "pending_review")
      )
    );

  // Group pending issues by field name
  const fieldGroups: Record<string, { count: number; resultIds: string[] }> = {};
  for (const result of pendingResults) {
    const issues = result.fieldIssues as Array<{ field: string }> || [];
    for (const issue of issues) {
      if (!fieldGroups[issue.field]) {
        fieldGroups[issue.field] = { count: 0, resultIds: [] };
      }
      fieldGroups[issue.field].count++;
      if (!fieldGroups[issue.field].resultIds.includes(result.id)) {
        fieldGroups[issue.field].resultIds.push(result.id);
      }
    }
  }

  // Convert to sorted array
  const groupedFields = Object.entries(fieldGroups)
    .map(([field, data]) => ({
      field,
      count: data.count,
      resultCount: data.resultIds.length,
    }))
    .sort((a, b) => b.count - a.count);

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
    groupedFields,
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

// PUT /api/qa/[id] - Bulk operations (accept all issues for a field)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const body = await request.json();
    const { action, field } = body;

    if (action === "acceptFieldGroup" && field) {
      // Get all pending results that have issues with this field
      const pendingResults = await db
        .select()
        .from(qaResults)
        .where(
          and(
            eq(qaResults.qaRunId, id),
            eq(qaResults.hasIssues, true),
            eq(qaResults.status, "pending_review")
          )
        );

      let updatedCount = 0;

      for (const result of pendingResults) {
        const issues = result.fieldIssues as Array<{ field: string }> || [];
        const hasFieldIssue = issues.some((issue) => issue.field === field);

        if (hasFieldIssue) {
          // Update acceptedFields to include this field
          const currentAccepted = (result.acceptedFields as Record<string, boolean>) || {};
          const newAccepted: Record<string, boolean> = { ...currentAccepted, [field]: true };

          // Check if all fields are now accepted
          const allAccepted = issues.every((issue) => newAccepted[issue.field]);
          const anyAccepted = issues.some((issue) => newAccepted[issue.field]);

          let newStatus: "accepted" | "partial" | "pending_review" = "pending_review";
          if (allAccepted) {
            newStatus = "accepted";
          } else if (anyAccepted) {
            newStatus = "partial";
          }

          await db
            .update(qaResults)
            .set({
              acceptedFields: newAccepted,
              status: newStatus,
              reviewedAt: new Date(),
            })
            .where(eq(qaResults.id, result.id));

          updatedCount++;
        }
      }

      return NextResponse.json({
        success: true,
        message: `Accepted "${field}" changes in ${updatedCount} results`,
        updatedCount,
      });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Failed to perform bulk operation:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to perform operation" },
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
      .set({ status: "cancelled", completedAt: new Date() })
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
