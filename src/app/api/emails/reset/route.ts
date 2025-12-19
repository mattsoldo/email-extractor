import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails, transactions } from "@/db/schema";
import { eq, and, inArray, or } from "drizzle-orm";

// POST /api/emails/reset - Reset emails for re-processing
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailIds, setId, runId, deleteExisting } = body;

    if (!emailIds && !setId && !runId) {
      return NextResponse.json(
        { error: "Must provide emailIds, setId, or runId" },
        { status: 400 }
      );
    }

    let targetEmailIds: string[] = [];

    if (emailIds && emailIds.length > 0) {
      targetEmailIds = emailIds;
    } else if (setId) {
      // Get all processed emails from set
      const setEmails = await db
        .select({ id: emails.id })
        .from(emails)
        .where(
          and(
            eq(emails.setId, setId),
            or(
              eq(emails.extractionStatus, "completed"),
              eq(emails.extractionStatus, "failed"),
              eq(emails.extractionStatus, "informational")
            )
          )
        );
      targetEmailIds = setEmails.map((e) => e.id);
    } else if (runId) {
      // Get emails from a specific run via their transactions
      const runTransactions = await db
        .select({ sourceEmailId: transactions.sourceEmailId })
        .from(transactions)
        .where(eq(transactions.extractionRunId, runId));
      targetEmailIds = runTransactions
        .map((t) => t.sourceEmailId)
        .filter((id): id is string => id !== null);
    }

    if (targetEmailIds.length === 0) {
      return NextResponse.json({
        message: "No emails found to reset",
        resetCount: 0,
      });
    }

    // Optionally delete existing transactions from these emails
    if (deleteExisting) {
      await db
        .delete(transactions)
        .where(inArray(transactions.sourceEmailId, targetEmailIds));
    }

    // Reset emails to pending
    await db
      .update(emails)
      .set({
        extractionStatus: "pending",
        extractionError: null,
        rawExtraction: null,
        informationalNotes: null,
        processedAt: null,
      })
      .where(inArray(emails.id, targetEmailIds));

    return NextResponse.json({
      message: `Reset ${targetEmailIds.length} email(s) for re-processing`,
      resetCount: targetEmailIds.length,
      deletedTransactions: deleteExisting,
    });
  } catch (error) {
    console.error("Email reset error:", error);
    return NextResponse.json(
      { error: "Failed to reset emails" },
      { status: 500 }
    );
  }
}
