import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { transactions, accounts, emails } from "@/db/schema";
import { desc, eq, and, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { format } from "date-fns";

// GET /api/transactions/export - Export all transactions as CSV
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const setId = searchParams.get("setId");
  const runId = searchParams.get("runId");
  const fileFormat = searchParams.get("format") || "csv"; // csv or excel

  // Get base URL for links
  const host = request.headers.get("host") || "localhost:3000";
  const protocol = host.includes("localhost") ? "http" : "https";
  const baseUrl = `${protocol}://${host}`;

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

    // Create alias for toAccount join
    const toAccounts = alias(accounts, "to_accounts");

    // Fetch all transactions with both account and toAccount info
    const results = await db
      .select({
        transaction: transactions,
        account: accounts,
        toAccount: toAccounts,
      })
      .from(transactions)
      .leftJoin(accounts, eq(transactions.accountId, accounts.id))
      .leftJoin(toAccounts, eq(transactions.toAccountId, toAccounts.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(transactions.date));

    // Transform to flat rows for CSV
    const rows = results.map((r) => ({
      date: r.transaction.date
        ? format(new Date(r.transaction.date), "yyyy-MM-dd")
        : "",
      type: r.transaction.type,
      // Account fields (source/from account)
      "Account Name": r.account?.displayName || "",
      "Account Institution": r.account?.institution || "",
      "Account Number": r.account?.accountNumber || r.account?.maskedNumber || "",
      // To Account fields (destination account for transfers)
      "To Account Name": r.toAccount?.displayName || "",
      "To Account Institution": r.toAccount?.institution || "",
      "To Account Number": r.toAccount?.accountNumber || r.toAccount?.maskedNumber || "",
      // Transaction details
      symbol: r.transaction.symbol || "",
      quantity: r.transaction.quantity || "",
      price: r.transaction.price || "",
      amount: r.transaction.amount || "",
      fees: r.transaction.fees || "",
      currency: r.transaction.currency || "USD",
      description: r.transaction.description || "",
      referenceNumber: r.transaction.referenceNumber || "",
      confidence: r.transaction.confidence || "",
      // Links
      "Transaction Link": `${baseUrl}/transactions/${r.transaction.id}`,
      "Email Link": r.transaction.sourceEmailId
        ? `${baseUrl}/emails/${r.transaction.sourceEmailId}`
        : "",
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
    "Account Name",
    "Account Institution",
    "Account Number",
    "To Account Name",
    "To Account Institution",
    "To Account Number",
    "symbol",
    "quantity",
    "price",
    "amount",
    "fees",
    "currency",
    "description",
    "referenceNumber",
    "confidence",
    "Transaction Link",
    "Email Link",
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
