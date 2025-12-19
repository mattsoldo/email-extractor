import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails, transactions } from "@/db/schema";
import { eq } from "drizzle-orm";

// GET /api/emails/[id] - Get single email with transactions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const email = await db.select().from(emails).where(eq(emails.id, id)).limit(1);

  if (email.length === 0) {
    return NextResponse.json({ error: "Email not found" }, { status: 404 });
  }

  // Get associated transactions
  const emailTransactions = await db
    .select()
    .from(transactions)
    .where(eq(transactions.sourceEmailId, id));

  return NextResponse.json({
    email: email[0],
    transactions: emailTransactions,
  });
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
