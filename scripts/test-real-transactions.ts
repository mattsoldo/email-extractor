/**
 * Test real transactional emails
 */

import { parseEmlFile } from "../src/services/email-parser";
import { extractTransaction } from "../src/services/ai-extractor";
import { readdirSync } from "fs";
import { join } from "path";

async function main() {
  const emailFolder = "./emails";
  const files = readdirSync(emailFolder);

  // Find specific transaction types to test
  const testCases = [
    { pattern: /Dividend or Interest Paid/i, name: "Dividend" },
    { pattern: /Wire Transfer Complete/i, name: "Wire Transfer" },
    { pattern: /Funds Transfer Confirmation/i, name: "Funds Transfer" },
    { pattern: /Executed.*\$\d/i, name: "Trade Execution" },
    { pattern: /Restricted Stock released/i, name: "RSU Release" },
  ];

  for (const testCase of testCases) {
    const file = files.find(f => testCase.pattern.test(f));
    if (!file) {
      console.log(`\n⚠ No ${testCase.name} email found`);
      continue;
    }

    console.log(`\n━━━ ${testCase.name} ━━━`);
    console.log(`File: ${file.substring(0, 70)}...`);

    try {
      const parsed = await parseEmlFile(join(emailFolder, file));
      const extraction = await extractTransaction(parsed);

      console.log(`Email Type: ${extraction.emailType}`);
      console.log(`Is Transactional: ${extraction.isTransactional}`);
      console.log(`Transactions Found: ${extraction.transactions.length}`);

      for (let i = 0; i < extraction.transactions.length; i++) {
        const tx = extraction.transactions[i];
        console.log(`\n  Transaction ${i + 1}:`);
        console.log(`    Type: ${tx.transactionType}`);
        console.log(`    Date: ${tx.transactionDate || "N/A"}`);
        console.log(`    Amount: ${tx.amount ? `$${tx.amount.toLocaleString()}` : "N/A"}`);
        console.log(`    Account: ${tx.accountNumber || tx.accountName || "N/A"}`);

        if (tx.symbol) console.log(`    Symbol: ${tx.symbol}`);
        if (tx.quantity) console.log(`    Quantity: ${tx.quantity}`);
        if (tx.price) console.log(`    Price: $${tx.price}`);
        if (tx.toAccountNumber) console.log(`    To Account: ${tx.toAccountNumber}`);
        if (tx.fees) console.log(`    Fees: $${tx.fees}`);
        if (tx.referenceNumber) console.log(`    Reference: ${tx.referenceNumber}`);
        if (tx.grantNumber) console.log(`    Grant #: ${tx.grantNumber}`);

        console.log(`    Confidence: ${(tx.confidence * 100).toFixed(0)}%`);
      }

      if (extraction.extractionNotes) {
        console.log(`\nNotes: ${extraction.extractionNotes}`);
      }
    } catch (error: any) {
      console.log(`✗ Error: ${error.message}`);
    }
  }

  console.log("\n━━━ Test Complete ━━━\n");
}

main().catch(console.error);
