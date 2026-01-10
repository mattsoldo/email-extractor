import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, emails, accounts, extractionRuns, aiModels, prompts } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * GET /api/transactions/[id] - Get a single transaction with its source email and metadata
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // Fetch transaction with related data
    const result = await db
      .select({
        transaction: transactions,
        email: emails,
        account: accounts,
        toAccount: accounts,
        extractionRun: extractionRuns,
        model: aiModels,
        prompt: prompts,
      })
      .from(transactions)
      .leftJoin(emails, eq(transactions.sourceEmailId, emails.id))
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(extractionRuns, eq(transactions.extractionRunId, extractionRuns.id))
      .leftJoin(aiModels, eq(extractionRuns.modelId, aiModels.id))
      .leftJoin(prompts, eq(extractionRuns.promptId, prompts.id))
      .where(eq(transactions.id, id))
      .limit(1);

    if (result.length === 0) {
      return NextResponse.json(
        { error: "Transaction not found" },
        { status: 404 }
      );
    }

    const { transaction, email, account, extractionRun, model, prompt } = result[0];

    // If there's a toAccountId, fetch that account separately
    let toAccount = null;
    if (transaction.toAccountId) {
      const toAccountResult = await db
        .select()
        .from(accounts)
        .where(eq(accounts.id, transaction.toAccountId))
        .limit(1);
      if (toAccountResult.length > 0) {
        toAccount = toAccountResult[0];
      }
    }

    return NextResponse.json({
      transaction,
      email,
      account,
      toAccount,
      extractionRun: extractionRun ? {
        ...extractionRun,
        modelName: model?.name || null,
        promptName: prompt?.name || null,
      } : null,
    });
  } catch (error) {
    console.error("Error fetching transaction:", error);
    return NextResponse.json(
      { error: "Failed to fetch transaction" },
      { status: 500 }
    );
  }
}
