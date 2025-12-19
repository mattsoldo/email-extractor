import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts, emails } from "@/db/schema";
import { desc, eq, and, gte, lte, sql, count, inArray } from "drizzle-orm";

// GET /api/transactions - List transactions with filtering
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const type = searchParams.get("type");
  const accountId = searchParams.get("accountId");
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const setId = searchParams.get("setId"); // Filter by email set
  const runId = searchParams.get("runId"); // Filter by extraction run
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  // Build conditions
  const conditions = [];
  if (type) {
    conditions.push(eq(transactions.type, type as any));
  }
  if (accountId) {
    conditions.push(eq(transactions.accountId, accountId));
  }
  if (startDate) {
    conditions.push(gte(transactions.date, new Date(startDate)));
  }
  if (endDate) {
    conditions.push(lte(transactions.date, new Date(endDate)));
  }
  if (runId) {
    conditions.push(eq(transactions.extractionRunId, runId));
  }

  // If filtering by setId, we need to get email IDs from that set first
  let emailIdsInSet: string[] | null = null;
  if (setId) {
    const setEmails = await db
      .select({ id: emails.id })
      .from(emails)
      .where(eq(emails.setId, setId));
    emailIdsInSet = setEmails.map((e) => e.id);

    if (emailIdsInSet.length > 0) {
      conditions.push(inArray(transactions.sourceEmailId, emailIdsInSet));
    } else {
      // No emails in set, return empty results
      return NextResponse.json({
        transactions: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
        typeCounts: {},
        totals: {},
      });
    }
  }

  // Query with joins
  const results = await db
    .select({
      transaction: transactions,
      account: accounts,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(transactions.date))
    .limit(limit)
    .offset(offset);

  // Get total count
  let countQuery = db.select({ count: count() }).from(transactions);
  if (conditions.length > 0) {
    countQuery = countQuery.where(and(...conditions)) as any;
  }
  const [{ count: total }] = await countQuery;

  // Get type counts
  const typeCounts = await db
    .select({
      type: transactions.type,
      count: count(),
    })
    .from(transactions)
    .groupBy(transactions.type);

  // Calculate totals by type
  const totals = await db
    .select({
      type: transactions.type,
      total: sql<string>`COALESCE(SUM(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .groupBy(transactions.type);

  return NextResponse.json({
    transactions: results.map((r) => ({
      ...r.transaction,
      account: r.account,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    typeCounts: Object.fromEntries(typeCounts.map((t) => [t.type, t.count])),
    totals: Object.fromEntries(totals.map((t) => [t.type, parseFloat(t.total)])),
  });
}
