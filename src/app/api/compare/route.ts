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
  dataKeyDifferences: string[]; // Keys from the data field that differ
  winnerTransactionId: string | null; // The email's current winner
  fieldOverrides: Record<string, unknown> | null; // User-edited field values for synthesis
}

// Fields to compare between transactions (excluding confidence per user request)
const COMPARE_FIELDS = [
  // Core fields
  "type",
  "amount",
  "currency",
  "description",
  "symbol",
  "category",
  "date",
  // Account fields
  "accountId",
  "toAccountId",
  // Quantity fields
  "quantity",
  "quantityExecuted",
  "quantityRemaining",
  // Price fields
  "price",
  "executionPrice",
  "priceType",
  "limitPrice",
  // Fees
  "fees",
  // Options
  "contractSize",
  // Order tracking
  "orderId",
  "orderType",
  "orderQuantity",
  "orderPrice",
  "orderStatus",
  "timeInForce",
  "referenceNumber",
  "partiallyExecuted",
  "executionTime",
] as const;

// Numeric fields for proper comparison
const NUMERIC_FIELDS = [
  "amount",
  "quantity",
  "quantityExecuted",
  "quantityRemaining",
  "price",
  "executionPrice",
  "limitPrice",
  "fees",
  "contractSize",
  "orderQuantity",
  "orderPrice",
];

function compareTransactions(
  a: typeof transactions.$inferSelect | null,
  b: typeof transactions.$inferSelect | null
): { status: TransactionComparison["status"]; differences: string[]; dataKeyDifferences: string[] } {
  if (!a && !b) return { status: "match", differences: [], dataKeyDifferences: [] };
  if (!a) return { status: "only_b", differences: ["Transaction only in Run B"], dataKeyDifferences: [] };
  if (!b) return { status: "only_a", differences: ["Transaction only in Run A"], dataKeyDifferences: [] };

  const differences: string[] = [];

  for (const field of COMPARE_FIELDS) {
    const valA = a[field];
    const valB = b[field];

    // Handle date comparison - only compare date portion, ignore time
    if (field === "date" || field === "executionTime") {
      const dateA = valA ? new Date(valA as string | Date).toISOString().split("T")[0] : null;
      const dateB = valB ? new Date(valB as string | Date).toISOString().split("T")[0] : null;
      if (dateA !== dateB) {
        differences.push(field);
      }
      continue;
    }

    // Handle numeric comparison
    if (NUMERIC_FIELDS.includes(field)) {
      const numA = valA ? parseFloat(String(valA)) : null;
      const numB = valB ? parseFloat(String(valB)) : null;
      if (numA !== numB) {
        differences.push(field);
      }
      continue;
    }

    // Handle boolean comparison
    if (field === "partiallyExecuted") {
      if (Boolean(valA) !== Boolean(valB)) {
        differences.push(field);
      }
      continue;
    }

    // String comparison
    if (String(valA || "") !== String(valB || "")) {
      differences.push(field);
    }
  }

  // Compare data field (additional key-value pairs)
  const dataKeyDifferences: string[] = [];
  const dataA = (a.data || {}) as Record<string, unknown>;
  const dataB = (b.data || {}) as Record<string, unknown>;

  // Helper to flatten data - handles numeric keys with {key, value} objects
  const flattenData = (data: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(data)) {
      // Skip numeric keys that contain {key, value} objects - flatten them instead
      if (/^\d+$/.test(k) && v && typeof v === "object" && "key" in v && "value" in v) {
        const obj = v as { key: string; value: unknown };
        result[obj.key] = obj.value;
      } else if (/^\d+$/.test(k) && v && typeof v === "object") {
        // Skip other numeric indexed objects (arrays serialized as objects)
        continue;
      } else {
        result[k] = v;
      }
    }
    return result;
  };

  const flatA = flattenData(dataA);
  const flatB = flattenData(dataB);
  const allDataKeys = new Set([...Object.keys(flatA), ...Object.keys(flatB)]);

  for (const key of allDataKeys) {
    const valA = flatA[key];
    const valB = flatB[key];

    // Compare values (handle numbers, strings, null/undefined)
    const strA = valA === null || valA === undefined ? "" : String(valA);
    const strB = valB === null || valB === undefined ? "" : String(valB);

    if (strA !== strB) {
      dataKeyDifferences.push(key);
      // Add to main differences to flag as "different" status
      differences.push(`data.${key}`);
    }
  }

  return {
    status: differences.length === 0 ? "match" : "different",
    differences,
    dataKeyDifferences,
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

    // Fetch email info including winnerTransactionId and fieldOverrides
    const emailList = await db
      .select({
        id: emails.id,
        subject: emails.subject,
        winnerTransactionId: emails.winnerTransactionId,
        fieldOverrides: emails.fieldOverrides,
      })
      .from(emails)
      .where(inArray(emails.id, Array.from(allEmailIds)));

    const emailMap = new Map(emailList.map((e) => [e.id, e]));

    // Compare transactions
    const comparisons: TransactionComparison[] = [];

    for (const emailId of allEmailIds) {
      const tA = byEmailA.get(emailId) || null;
      const tB = byEmailB.get(emailId) || null;
      const { status, differences, dataKeyDifferences } = compareTransactions(tA, tB);
      const emailInfo = emailMap.get(emailId);

      comparisons.push({
        emailId,
        emailSubject: emailInfo?.subject || null,
        runATransaction: tA,
        runBTransaction: tB,
        status,
        differences,
        dataKeyDifferences,
        winnerTransactionId: emailInfo?.winnerTransactionId || null,
        fieldOverrides: (emailInfo?.fieldOverrides as Record<string, unknown>) || null,
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

    // Validate transaction if provided (skip validation for special "tie" value)
    if (winnerTransactionId && winnerTransactionId !== "tie") {
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

    const message = !winnerTransactionId
      ? "Winner cleared"
      : winnerTransactionId === "tie"
        ? "Marked as tie"
        : "Winner set";

    return NextResponse.json({
      message,
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

// PUT /api/compare - Bulk set winners for multiple emails
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { updates } = body as {
      updates: Array<{ emailId: string; winnerTransactionId: string | null }>;
    };

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json(
        { error: "updates array is required" },
        { status: 400 }
      );
    }

    // Validate all emails exist
    const emailIds = updates.map((u) => u.emailId);
    const existingEmails = await db
      .select({ id: emails.id })
      .from(emails)
      .where(inArray(emails.id, emailIds));

    if (existingEmails.length !== emailIds.length) {
      return NextResponse.json(
        { error: "Some emails not found" },
        { status: 404 }
      );
    }

    // Perform bulk update
    let successCount = 0;
    for (const update of updates) {
      await db
        .update(emails)
        .set({ winnerTransactionId: update.winnerTransactionId || null })
        .where(eq(emails.id, update.emailId));
      successCount++;
    }

    return NextResponse.json({
      message: `Updated ${successCount} emails`,
      count: successCount,
    });
  } catch (error) {
    console.error("Bulk set winner error:", error);
    return NextResponse.json(
      { error: "Failed to bulk set winners" },
      { status: 500 }
    );
  }
}

// PATCH /api/compare - Update field overrides for an email
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { emailId, fieldOverrides } = body as {
      emailId: string;
      fieldOverrides: Record<string, unknown>;
    };

    if (!emailId) {
      return NextResponse.json(
        { error: "emailId is required" },
        { status: 400 }
      );
    }

    // Validate email exists
    const email = await db
      .select({ id: emails.id, fieldOverrides: emails.fieldOverrides })
      .from(emails)
      .where(eq(emails.id, emailId))
      .limit(1);

    if (email.length === 0) {
      return NextResponse.json(
        { error: "Email not found" },
        { status: 404 }
      );
    }

    // Merge with existing overrides (so we can update individual fields)
    const existingOverrides = (email[0].fieldOverrides || {}) as Record<string, unknown>;
    const mergedOverrides = { ...existingOverrides, ...fieldOverrides };

    // Remove null/undefined values (to allow clearing overrides)
    for (const key of Object.keys(mergedOverrides)) {
      if (mergedOverrides[key] === null || mergedOverrides[key] === undefined) {
        delete mergedOverrides[key];
      }
    }

    // Update the email's field overrides
    await db
      .update(emails)
      .set({ fieldOverrides: Object.keys(mergedOverrides).length > 0 ? mergedOverrides : null })
      .where(eq(emails.id, emailId));

    return NextResponse.json({
      message: "Field overrides updated",
      emailId,
      fieldOverrides: mergedOverrides,
    });
  } catch (error) {
    console.error("Update field overrides error:", error);
    return NextResponse.json(
      { error: "Failed to update field overrides" },
      { status: 500 }
    );
  }
}
