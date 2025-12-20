/**
 * Test script for email extraction
 * Run with: npx tsx scripts/test-extraction.ts
 */

import { scanEmailDirectory, parseEmlFile, classifyEmail } from "../src/services/email-parser";
import { extractTransaction } from "../src/services/ai-extractor";
import { db } from "../src/db";
import { emails } from "../src/db/schema";
import { count } from "drizzle-orm";

async function main() {
  console.log("=== Email Extractor Test ===\n");

  // 1. Test database connection
  console.log("1. Testing database connection...");
  try {
    const result = await db.select({ count: count() }).from(emails);
    console.log(`   ✓ Database connected. ${result[0].count} emails in database.\n`);
  } catch (error) {
    console.error("   ✗ Database connection failed:", error);
    process.exit(1);
  }

  // 2. Scan email directory
  console.log("2. Scanning email directory...");
  const emailFolder = process.env.EMAIL_FOLDER_PATH || "./emails";
  const emailFiles = await scanEmailDirectory(emailFolder);
  console.log(`   ✓ Found ${emailFiles.length} .eml files\n`);

  // 3. Parse a few sample emails
  console.log("3. Parsing sample emails...");
  const samplesToTest = emailFiles.slice(0, 5);

  for (const filePath of samplesToTest) {
    const filename = filePath.split("/").pop();
    try {
      const parsed = await parseEmlFile(filePath);
      const classification = classifyEmail(parsed);
      console.log(`   • ${filename?.substring(0, 60)}...`);
      console.log(`     Subject: ${parsed.subject?.substring(0, 50) || "(none)"}`);
      console.log(`     Process: ${classification.shouldProcess ? "Yes" : `No (${classification.skipReason})`}`);
    } catch (error) {
      console.log(`   ✗ Failed to parse: ${filename}`);
    }
  }
  console.log();

  // 4. Test AI extraction on a transactional email
  console.log("4. Testing AI extraction...");

  // Find a dividend email to test
  const dividendEmail = emailFiles.find(f => f.toLowerCase().includes("dividend"));

  if (!dividendEmail) {
    console.log("   ⚠ No dividend email found for testing");
  } else {
    console.log(`   Testing with: ${dividendEmail.split("/").pop()}`);

    try {
      const parsed = await parseEmlFile(dividendEmail);
      console.log("   Calling Claude API for extraction...");

      const extraction = await extractTransaction(parsed);

      console.log("\n   ✓ Extraction result:");
      console.log(`     Email Type: ${extraction.emailType}`);
      console.log(`     Is Transactional: ${extraction.isTransactional}`);
      console.log(`     Transactions Found: ${extraction.transactions.length}`);

      for (let i = 0; i < extraction.transactions.length; i++) {
        const tx = extraction.transactions[i];
        console.log(`\n     Transaction ${i + 1}:`);
        console.log(`       Type: ${tx.transactionType}`);
        console.log(`       Amount: ${tx.amount ? `$${tx.amount}` : "N/A"}`);
        console.log(`       Symbol: ${tx.symbol || "N/A"}`);
        console.log(`       Account: ${tx.accountNumber || "N/A"}`);
        console.log(`       Date: ${tx.transactionDate || "N/A"}`);
        console.log(`       Confidence: ${tx.confidence}`);
      }

      if (extraction.extractionNotes) {
        console.log(`\n     Notes: ${extraction.extractionNotes}`);
      }
    } catch (error: any) {
      console.error("   ✗ AI extraction failed:", error.message);
      if (error.message.includes("API key")) {
        console.log("\n   ⚠ Make sure ANTHROPIC_API_KEY is set in .env.local");
      }
    }
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
