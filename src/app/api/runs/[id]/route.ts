import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { extractionRuns, transactions, jobs, accounts, emails } from "@/db/schema";
import { eq, desc, count } from "drizzle-orm";

// GET /api/runs/[id] - Get a specific extraction run with transactions
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  // Get the extraction run
  const [run] = await db
    .select({
      run: extractionRuns,
      job: {
        id: jobs.id,
        type: jobs.type,
        status: jobs.status,
        totalItems: jobs.totalItems,
      },
    })
    .from(extractionRuns)
    .leftJoin(jobs, eq(extractionRuns.jobId, jobs.id))
    .where(eq(extractionRuns.id, id));

  if (!run) {
    return NextResponse.json({ error: "Extraction run not found" }, { status: 404 });
  }

  // Get transactions from this run
  const searchParams = request.nextUrl.searchParams;
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "50");
  const offset = (page - 1) * limit;

  const txResults = await db
    .select({
      transaction: transactions,
      account: accounts,
      email: {
        id: emails.id,
        filename: emails.filename,
        subject: emails.subject,
      },
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id))
    .leftJoin(emails, eq(transactions.sourceEmailId, emails.id))
    .where(eq(transactions.extractionRunId, id))
    .orderBy(desc(transactions.date))
    .limit(limit)
    .offset(offset);

  // Get total transaction count for this run
  const [{ count: txTotal }] = await db
    .select({ count: count() })
    .from(transactions)
    .where(eq(transactions.extractionRunId, id));

  return NextResponse.json({
    run: {
      ...run.run,
      job: run.job,
    },
    transactions: txResults.map((r) => ({
      ...r.transaction,
      account: r.account,
      email: r.email,
    })),
    pagination: {
      page,
      limit,
      total: txTotal,
      totalPages: Math.ceil(txTotal / limit),
    },
  });
}

// PATCH /api/runs/[id] - Update extraction run name/description
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const body = await request.json();
  const { name, description } = body;

  const [updated] = await db
    .update(extractionRuns)
    .set({
      name: name !== undefined ? name : undefined,
      description: description !== undefined ? description : undefined,
    })
    .where(eq(extractionRuns.id, id))
    .returning();

  if (!updated) {
    return NextResponse.json({ error: "Extraction run not found" }, { status: 404 });
  }

  return NextResponse.json({ run: updated });
}
