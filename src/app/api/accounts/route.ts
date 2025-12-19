import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, accountCorpus, transactions } from "@/db/schema";
import { eq, sql, count, desc } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// GET /api/accounts - List all accounts
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const includeStats = searchParams.get("stats") === "true";

  if (includeStats) {
    // Get accounts with transaction counts
    const results = await db
      .select({
        account: accounts,
        transactionCount: count(transactions.id),
        totalAmount: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(accounts)
      .leftJoin(transactions, eq(accounts.id, transactions.accountId))
      .groupBy(accounts.id)
      .orderBy(desc(sql`count(${transactions.id})`));

    return NextResponse.json({
      accounts: results.map((r) => ({
        ...r.account,
        stats: {
          transactionCount: r.transactionCount,
          totalAmount: parseFloat(r.totalAmount),
        },
      })),
    });
  }

  const allAccounts = await db.select().from(accounts);
  return NextResponse.json({ accounts: allAccounts });
}

// POST /api/accounts - Create a new account manually
export async function POST(request: NextRequest) {
  const body = await request.json();
  const { displayName, institution, accountNumber, maskedNumber, accountType, corpusId } = body;

  const newAccount = {
    id: uuid(),
    displayName: displayName || accountNumber || "New Account",
    institution: institution || null,
    accountNumber: accountNumber || null,
    maskedNumber: maskedNumber || null,
    accountType: accountType || null,
    corpusId: corpusId || null,
    isExternal: false,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await db.insert(accounts).values(newAccount);

  return NextResponse.json({ account: newAccount });
}
