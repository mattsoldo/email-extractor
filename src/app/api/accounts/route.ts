import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, accountCorpus, transactions, emails } from "@/db/schema";
import { eq, sql, count, desc, inArray, and } from "drizzle-orm";
import { v4 as uuid } from "uuid";

// GET /api/accounts - List all accounts
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const includeStats = searchParams.get("stats") === "true";
  const setId = searchParams.get("setId"); // Filter by email set
  const runId = searchParams.get("runId"); // Filter by extraction run

  // If filtering by set or run, get the relevant account IDs first
  let accountIdFilter: string[] | null = null;

  if (setId || runId) {
    const conditions = [];

    if (setId) {
      // Get emails in the set
      const setEmails = await db
        .select({ id: emails.id })
        .from(emails)
        .where(eq(emails.setId, setId));
      const emailIds = setEmails.map(e => e.id);

      if (emailIds.length > 0) {
        conditions.push(inArray(transactions.sourceEmailId, emailIds));
      } else {
        // No emails in set, return empty
        return NextResponse.json({ accounts: [] });
      }
    }

    if (runId) {
      conditions.push(eq(transactions.extractionRunId, runId));
    }

    // Get unique account IDs from filtered transactions
    const filteredTx = await db
      .select({ accountId: transactions.accountId })
      .from(transactions)
      .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

    accountIdFilter = [...new Set(filteredTx.map(t => t.accountId).filter((id): id is string => id !== null))];

    if (accountIdFilter.length === 0) {
      return NextResponse.json({ accounts: [] });
    }
  }

  if (includeStats) {
    // Get accounts with transaction counts
    let query = db
      .select({
        account: accounts,
        transactionCount: count(transactions.id),
        totalAmount: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
      })
      .from(accounts)
      .leftJoin(transactions, eq(accounts.id, transactions.accountId));

    if (accountIdFilter) {
      query = query.where(inArray(accounts.id, accountIdFilter)) as typeof query;
    }

    const results = await query
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

  let allAccounts;
  if (accountIdFilter) {
    allAccounts = await db.select().from(accounts).where(inArray(accounts.id, accountIdFilter));
  } else {
    allAccounts = await db.select().from(accounts);
  }
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
