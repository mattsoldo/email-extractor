import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, extractionRuns, emails } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

interface TransactionComparison {
  emailId: string;
  emailSubject: string | null;
  runATransaction: typeof transactions.$inferSelect | null;
  runBTransaction: typeof transactions.$inferSelect | null;
  status: "match" | "different" | "only_a" | "only_b";
  differences: string[];
  winnerTransactionId: string | null; // The email's current winner
}

// Fields to compare between transactions
const COMPARE_FIELDS = [
  "type",
  "amount",
  "currency",
  "symbol",
  "quantity",
  "price",
  "fees",
  "date",
  "accountId",
  "toAccountId",
] as const;

function compareTransactions(
  a: typeof transactions.$inferSelect | null,
  b: typeof transactions.$inferSelect | null
): { status: TransactionComparison["status"]; differences: string[] } {
  if (!a && !b) return { status: "match", differences: [] };
  if (!a) return { status: "only_b", differences: ["Transaction only in Run B"] };
  if (!b) return { status: "only_a", differences: ["Transaction only in Run A"] };

  const differences: string[] = [];

  for (const field of COMPARE_FIELDS) {
    const valA = a[field];
    const valB = b[field];

    // Handle date comparison
    if (field === "date") {
      const dateA = valA ? new Date(valA as string | Date).toISOString() : null;
      const dateB = valB ? new Date(valB as string | Date).toISOString() : null;
      if (dateA !== dateB) {
        differences.push(field);
      }
      continue;
    }

    // Handle numeric comparison (amounts, quantities)
    if (["amount", "quantity", "price", "fees"].includes(field)) {
      const numA = valA ? parseFloat(String(valA)) : null;
      const numB = valB ? parseFloat(String(valB)) : null;
      if (numA !== numB) {
        differences.push(field);
      }
      continue;
    }

    // String comparison
    if (String(valA || "") !== String(valB || "")) {
      differences.push(field);
    }
  }

  return {
    status: differences.length === 0 ? "match" : "different",
    differences,
  };
}

// GET /api/compare - Compare two extraction runs
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const runAId = searchParams.get("runA");
  const runBId = searchParams.get("runB");

  if (!runAId || !runBId) {
    return NextResponse.json(
      { error: "Both runA and runB parameters are required" },
      { status: 400 }
    );
  }

  try {
    // Fetch both runs
    const [runA, runB] = await Promise.all([
      db.select().from(extractionRuns).where(eq(extractionRuns.id, runAId)).limit(1),
      db.select().from(extractionRuns).where(eq(extractionRuns.id, runBId)).limit(1),
    ]);

    if (!runA[0] || !runB[0]) {
      return NextResponse.json(
        { error: "One or both runs not found" },
        { status: 404 }
      );
    }

    // Get all transactions from both runs
    const [transactionsA, transactionsB] = await Promise.all([
      db.select().from(transactions).where(eq(transactions.extractionRunId, runAId)),
      db.select().from(transactions).where(eq(transactions.extractionRunId, runBId)),
    ]);

    // Group transactions by source email
    const byEmailA = new Map<string, typeof transactions.$inferSelect>();
    const byEmailB = new Map<string, typeof transactions.$inferSelect>();

    for (const t of transactionsA) {
      if (t.sourceEmailId) {
        byEmailA.set(t.sourceEmailId, t);
      }
    }
    for (const t of transactionsB) {
      if (t.sourceEmailId) {
        byEmailB.set(t.sourceEmailId, t);
      }
    }

    // Get all unique email IDs
    const allEmailIds = new Set([...byEmailA.keys(), ...byEmailB.keys()]);

    // Fetch email info including winnerTransactionId
    const emailList = await db
      .select({
        id: emails.id,
        subject: emails.subject,
        winnerTransactionId: emails.winnerTransactionId,
      })
      .from(emails)
      .where(inArray(emails.id, Array.from(allEmailIds)));

    const emailMap = new Map(emailList.map((e) => [e.id, e]));

    // Compare transactions
    const comparisons: TransactionComparison[] = [];

    for (const emailId of allEmailIds) {
      const tA = byEmailA.get(emailId) || null;
      const tB = byEmailB.get(emailId) || null;
      const { status, differences } = compareTransactions(tA, tB);
      const emailInfo = emailMap.get(emailId);

      comparisons.push({
        emailId,
        emailSubject: emailInfo?.subject || null,
        runATransaction: tA,
        runBTransaction: tB,
        status,
        differences,
        winnerTransactionId: emailInfo?.winnerTransactionId || null,
      });
    }

    // Sort by status (differences first, then matches)
    const statusOrder = { different: 0, only_a: 1, only_b: 2, match: 3 };
    comparisons.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    // Calculate summary stats
    const disputedCount = comparisons.filter((c) => c.status !== "match").length;
    const winnersCount = comparisons.filter((c) => c.winnerTransactionId !== null).length;

    const summary = {
      total: comparisons.length,
      matches: comparisons.filter((c) => c.status === "match").length,
      different: comparisons.filter((c) => c.status === "different").length,
      onlyA: comparisons.filter((c) => c.status === "only_a").length,
      onlyB: comparisons.filter((c) => c.status === "only_b").length,
      winnersDesignated: winnersCount,
      agreementRate: 0,
    };
    summary.agreementRate =
      summary.total > 0
        ? Math.round((summary.matches / summary.total) * 100)
        : 0;

    return NextResponse.json({
      runA: runA[0],
      runB: runB[0],
      summary,
      comparisons,
    });
  } catch (error) {
    console.error("Comparison error:", error);
    return NextResponse.json(
      { error: "Failed to compare runs" },
      { status: 500 }
    );
  }
}

// POST /api/compare - Set winner transaction for an email
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailId, winnerTransactionId } = body;

    if (!emailId) {
      return NextResponse.json(
        { error: "emailId is required" },
        { status: 400 }
      );
    }

    // Validate email exists
    const email = await db
      .select()
      .from(emails)
      .where(eq(emails.id, emailId))
      .limit(1);

    if (email.length === 0) {
      return NextResponse.json(
        { error: "Email not found" },
        { status: 404 }
      );
    }

    // Validate transaction if provided
    if (winnerTransactionId) {
      const txn = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, winnerTransactionId))
        .limit(1);

      if (txn.length === 0) {
        return NextResponse.json(
          { error: "Transaction not found" },
          { status: 400 }
        );
      }

      if (txn[0].sourceEmailId !== emailId) {
        return NextResponse.json(
          { error: "Transaction does not belong to this email" },
          { status: 400 }
        );
      }
    }

    // Update the email's winner
    await db
      .update(emails)
      .set({ winnerTransactionId: winnerTransactionId || null })
      .where(eq(emails.id, emailId));

    return NextResponse.json({
      message: winnerTransactionId ? "Winner set" : "Winner cleared",
      emailId,
      winnerTransactionId,
    });
  } catch (error) {
    console.error("Set winner error:", error);
    return NextResponse.json(
      { error: "Failed to set winner" },
      { status: 500 }
    );
  }
}
