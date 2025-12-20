/**
 * Test .txt file extraction
 * Run with: npx tsx scripts/test-txt-extraction.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { parseTxtContent } from "../src/services/email-parser";
import { extractTransaction } from "../src/services/ai-extractor";
import { readFileSync } from "fs";

const testContent = `INTEL CORPORATION - DIVIDEND PAYMENT

Account: XXXX-5678
Date: December 15, 2024

Dividend Payment Details:
- Stock: INTC (Intel Corporation)
- Shares: 500
- Dividend per share: $0.125
- Total amount: $62.50
- Payment type: Cash dividend

This is a quarterly dividend payment for your Intel holdings.`;

async function main() {
  console.log("=== Testing .txt file extraction ===\n");

  console.log("Document content:");
  console.log(testContent);
  console.log("\n--- Parsing ---\n");

  // Parse as text
  const parsed = parseTxtContent(testContent, "test-document.txt");
  console.log("Parsed result:");
  console.log("  Subject: " + parsed.subject);
  console.log("  Body length: " + (parsed.bodyText?.length || 0) + " chars");
  console.log("  File type: " + (parsed.headers as Record<string, string>)._fileType);

  console.log("\n--- AI Extraction (Claude 3.5 Haiku) ---\n");

  // Run extraction
  const result = await extractTransaction(parsed, "claude-3-5-haiku-20241022");
  console.log("Email Type: " + result.emailType);
  console.log("Is Transactional: " + result.isTransactional);
  console.log("Transactions: " + result.transactions.length);

  if (result.transactions.length > 0) {
    for (let i = 0; i < result.transactions.length; i++) {
      const tx = result.transactions[i];
      console.log("\n  Transaction " + (i + 1) + ":");
      console.log("    Type: " + tx.transactionType);
      console.log("    Symbol: " + (tx.symbol || "N/A"));
      console.log("    Amount: " + (tx.amount ? "$" + tx.amount : "N/A"));
      console.log("    Confidence: " + (tx.confidence * 100).toFixed(0) + "%");
    }
  }

  if (result.extractionNotes) {
    console.log("\nNotes: " + result.extractionNotes);
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
