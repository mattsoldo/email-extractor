import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, or, desc, count, sql } from "drizzle-orm";

// GET /api/accounts/[id] - Get account details with transactions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const account = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);

  if (account.length === 0) {
    return NextResponse.json({ error: "Account not found" }, { status: 404 });
  }

  // Get transactions for this account (both as source and destination)
  const accountTransactions = await db
    .select()
    .from(transactions)
    .where(
      or(eq(transactions.accountId, id), eq(transactions.toAccountId, id))
    )
    .orderBy(desc(transactions.date))
    .limit(100);

  // Get transaction type summary
  const typeSummary = await db
    .select({
      type: transactions.type,
      count: count(),
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(eq(transactions.accountId, id))
    .groupBy(transactions.type);

  return NextResponse.json({
    account: account[0],
    transactions: accountTransactions,
    summary: typeSummary.map((s) => ({
      type: s.type,
      count: s.count,
      total: parseFloat(s.total),
    })),
  });
}

// PATCH /api/accounts/[id] - Update account
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json();

  const { displayName, institution, accountType, corpusId } = body;

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (displayName !== undefined) updates.displayName = displayName;
  if (institution !== undefined) updates.institution = institution;
  if (accountType !== undefined) updates.accountType = accountType;
  if (corpusId !== undefined) updates.corpusId = corpusId;

  await db.update(accounts).set(updates).where(eq(accounts.id, id));

  const updated = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1);

  return NextResponse.json({ account: updated[0] });
}

// DELETE /api/accounts/[id] - Delete account (only if no transactions)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Check for transactions
  const txCount = await db
    .select({ count: count() })
    .from(transactions)
    .where(
      or(eq(transactions.accountId, id), eq(transactions.toAccountId, id))
    );

  if (txCount[0].count > 0) {
    return NextResponse.json(
      { error: "Cannot delete account with transactions" },
      { status: 400 }
    );
  }

  await db.delete(accounts).where(eq(accounts.id, id));

  return NextResponse.json({ message: "Account deleted" });
}
