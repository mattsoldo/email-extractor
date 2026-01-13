import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, emails } from "@/db/schema";
import { inArray, eq } from "drizzle-orm";
import { inngest } from "@/inngest/client";
import { v4 as uuid } from "uuid";

// POST /api/transactions/review - Submit transactions for re-review to fill missing fields
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { transactionIds } = body;

    if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length === 0) {
      return NextResponse.json(
        { error: "transactionIds array is required" },
        { status: 400 }
      );
    }

    // Get the transactions with their source emails
    const txsWithEmails = await db
      .select({
        transaction: transactions,
        email: emails,
      })
      .from(transactions)
      .leftJoin(emails, eq(transactions.sourceEmailId, emails.id))
      .where(inArray(transactions.id, transactionIds));

    if (txsWithEmails.length === 0) {
      return NextResponse.json(
        { error: "No transactions found" },
        { status: 404 }
      );
    }

    // Filter out transactions without source emails
    const validTxs = txsWithEmails.filter((t) => t.email !== null);
    if (validTxs.length === 0) {
      return NextResponse.json(
        { error: "None of the selected transactions have source emails" },
        { status: 400 }
      );
    }

    // Create a review batch ID
    const reviewBatchId = uuid();

    // Send event to Inngest to process the review
    await inngest.send({
      name: "transaction/review-batch",
      data: {
        reviewBatchId,
        transactionIds: validTxs.map((t) => t.transaction.id),
        emailIds: validTxs.map((t) => t.email!.id),
      },
    });

    return NextResponse.json({
      success: true,
      reviewBatchId,
      count: validTxs.length,
      skipped: txsWithEmails.length - validTxs.length,
      message: `Submitted ${validTxs.length} transactions for review`,
    });
  } catch (error) {
    console.error("Failed to submit transactions for review:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to submit for review" },
      { status: 500 }
    );
  }
}
