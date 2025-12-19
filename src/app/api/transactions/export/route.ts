import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts, emails } from "@/db/schema";
import { desc, eq, and, inArray } from "drizzle-orm";
import { format } from "date-fns";

// GET /api/transactions/export - Export all transactions as CSV
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const setId = searchParams.get("setId");
  const runId = searchParams.get("runId");
  const fileFormat = searchParams.get("format") || "csv"; // csv or excel

  try {
    // Build conditions
    const conditions = [];

    if (runId) {
      conditions.push(eq(transactions.extractionRunId, runId));
    }

    // If filtering by setId, get email IDs from that set first
    if (setId) {
      const setEmails = await db
        .select({ id: emails.id })
        .from(emails)
        .where(eq(emails.setId, setId));
      const emailIds = setEmails.map((e) => e.id);

      if (emailIds.length > 0) {
        conditions.push(inArray(transactions.sourceEmailId, emailIds));
      } else {
        // No emails in set, return empty CSV
        return createCsvResponse([], fileFormat);
      }
    }

    // Fetch all transactions with account info
    const results = await db
      .select({
        transaction: transactions,
        account: accounts,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transactions.date));

    // Transform to flat rows for CSV
    const rows = results.map((r) => ({
      date: r.transaction.date
        ? format(new Date(r.transaction.date), "yyyy-MM-dd")
        : "",
      type: r.transaction.type,
      account: r.account?.displayName || "",
      institution: r.account?.institution || "",
      accountNumber: r.account?.accountNumber || r.account?.maskedNumber || "",
      symbol: r.transaction.symbol || "",
      quantity: r.transaction.quantity || "",
      price: r.transaction.price || "",
      amount: r.transaction.amount || "",
      fees: r.transaction.fees || "",
      currency: r.transaction.currency || "USD",
      confidence: r.transaction.confidence || "",
      // Flatten common data fields
      ...(r.transaction.data as Record<string, unknown> || {}),
    }));

    return createCsvResponse(rows, fileFormat);
  } catch (error) {
    console.error("Export error:", error);
    return NextResponse.json(
      { error: "Failed to export transactions" },
      { status: 500 }
    );
  }
}

function createCsvResponse(
  rows: Record<string, unknown>[],
  fileFormat: string
): NextResponse {
  if (rows.length === 0) {
    const emptyContent = "No transactions to export";
    return new NextResponse(emptyContent, {
      headers: {
        "Content-Type": "text/plain",
        "Content-Disposition": `attachment; filename="transactions-empty.txt"`,
      },
    });
  }

  // Get all unique headers from all rows
  const headerSet = new Set<string>();
  const priorityHeaders = [
    "date",
    "type",
    "account",
    "institution",
    "accountNumber",
    "symbol",
    "quantity",
    "price",
    "amount",
    "fees",
    "currency",
    "confidence",
  ];

  // Add priority headers first, then any additional ones
  priorityHeaders.forEach((h) => headerSet.add(h));
  rows.forEach((row) => {
    Object.keys(row).forEach((key) => headerSet.add(key));
  });

  const headers = Array.from(headerSet);

  // Build CSV content
  const csvRows: string[] = [];

  // Header row
  csvRows.push(headers.map(escapeCSV).join(","));

  // Data rows
  for (const row of rows) {
    const values = headers.map((header) => {
      const value = row[header];
      if (value === null || value === undefined) return "";
      if (typeof value === "object") return escapeCSV(JSON.stringify(value));
      return escapeCSV(String(value));
    });
    csvRows.push(values.join(","));
  }

  const csvContent = csvRows.join("\n");
  const timestamp = format(new Date(), "yyyy-MM-dd-HHmmss");

  // For Excel format, add BOM for proper UTF-8 encoding
  const content =
    fileFormat === "excel" ? "\uFEFF" + csvContent : csvContent;

  const extension = fileFormat === "excel" ? "csv" : "csv";
  const mimeType =
    fileFormat === "excel"
      ? "application/vnd.ms-excel"
      : "text/csv";

  return new NextResponse(content, {
    headers: {
      "Content-Type": `${mimeType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="transactions-${timestamp}.${extension}"`,
    },
  });
}

function escapeCSV(value: string): string {
  // If value contains comma, newline, or quote, wrap in quotes and escape internal quotes
  if (value.includes(",") || value.includes("\n") || value.includes('"')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
