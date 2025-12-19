import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, transactions } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

// POST /api/accounts/merge - Merge multiple accounts into one
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { targetAccountId, sourceAccountIds } = body;

    if (!targetAccountId) {
      return NextResponse.json(
        { error: "Target account ID is required" },
        { status: 400 }
      );
    }

    if (!sourceAccountIds || !Array.isArray(sourceAccountIds) || sourceAccountIds.length === 0) {
      return NextResponse.json(
        { error: "At least one source account ID is required" },
        { status: 400 }
      );
    }

    // Ensure target is not in source list
    const filteredSourceIds = sourceAccountIds.filter((id: string) => id !== targetAccountId);
    if (filteredSourceIds.length === 0) {
      return NextResponse.json(
        { error: "Source accounts must be different from target account" },
        { status: 400 }
      );
    }

    // Verify target account exists
    const targetAccount = await db
      .select()
      .from(accounts)
      .where(eq(accounts.id, targetAccountId))
      .limit(1);

    if (targetAccount.length === 0) {
      return NextResponse.json(
        { error: "Target account not found" },
        { status: 404 }
      );
    }

    // Verify all source accounts exist
    const sourceAccounts = await db
      .select()
      .from(accounts)
      .where(inArray(accounts.id, filteredSourceIds));

    if (sourceAccounts.length !== filteredSourceIds.length) {
      return NextResponse.json(
        { error: "One or more source accounts not found" },
        { status: 404 }
      );
    }

    // Update all transactions referencing source accounts
    // Update accountId
    await db
      .update(transactions)
      .set({ accountId: targetAccountId })
      .where(inArray(transactions.accountId, filteredSourceIds));

    // Update toAccountId
    await db
      .update(transactions)
      .set({ toAccountId: targetAccountId })
      .where(inArray(transactions.toAccountId, filteredSourceIds));

    // Delete source accounts
    await db
      .delete(accounts)
      .where(inArray(accounts.id, filteredSourceIds));

    return NextResponse.json({
      message: `Merged ${filteredSourceIds.length} account(s) into target account`,
      targetAccountId,
      mergedAccountIds: filteredSourceIds,
      mergedCount: filteredSourceIds.length,
    });
  } catch (error) {
    console.error("Account merge error:", error);
    return NextResponse.json(
      { error: "Failed to merge accounts" },
      { status: 500 }
    );
  }
}
