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

      console.log(`Type: ${extraction.transactionType || "N/A"}`);
      console.log(`Is Transaction: ${extraction.isTransaction}`);
      console.log(`Date: ${extraction.transactionDate || "N/A"}`);
      console.log(`Amount: ${extraction.amount ? `$${extraction.amount.toLocaleString()}` : "N/A"}`);
      console.log(`Account: ${extraction.accountNumber || extraction.accountName || "N/A"}`);

      if (extraction.symbol) console.log(`Symbol: ${extraction.symbol}`);
      if (extraction.quantity) console.log(`Quantity: ${extraction.quantity}`);
      if (extraction.price) console.log(`Price: $${extraction.price}`);
      if (extraction.toAccountNumber) console.log(`To Account: ${extraction.toAccountNumber}`);
      if (extraction.fees) console.log(`Fees: $${extraction.fees}`);
      if (extraction.referenceNumber) console.log(`Reference: ${extraction.referenceNumber}`);
      if (extraction.grantNumber) console.log(`Grant #: ${extraction.grantNumber}`);

      console.log(`Confidence: ${(extraction.confidence * 100).toFixed(0)}%`);
    } catch (error: any) {
      console.log(`✗ Error: ${error.message}`);
    }
  }

  console.log("\n━━━ Test Complete ━━━\n");
}

main().catch(console.error);
