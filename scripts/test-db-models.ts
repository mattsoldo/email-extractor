/**
 * Test that extraction works with database model IDs
 * Run with: npx tsx scripts/test-db-models.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { parseTxtContent } from "../src/services/email-parser";
import { extractTransaction } from "../src/services/ai-extractor";
import { db } from "../src/db";
import { aiModels } from "../src/db/schema";
import { eq } from "drizzle-orm";

const testContent = `INTEL CORPORATION - DIVIDEND PAYMENT

Account: XXXX-5678
Date: December 15, 2024

Dividend Payment Details:
- Stock: INTC (Intel Corporation)
- Shares: 500
- Dividend per share: $0.125
- Total amount: $62.50
- Payment type: Cash dividend`;

async function main() {
  console.log("=== Testing Database Model IDs ===\n");

  // Get active models from database
  const dbModels = await db
    .select()
    .from(aiModels)
    .where(eq(aiModels.isActive, true))
    .orderBy(aiModels.sortOrder);

  console.log(`Found ${dbModels.length} active models in database:\n`);

  for (const model of dbModels) {
    console.log(`  - ${model.id} (${model.provider})`);
  }

  // Test with first Anthropic and first Google model
  const anthropicModel = dbModels.find(m => m.provider === "anthropic");
  const googleModel = dbModels.find(m => m.provider === "google");

  const parsed = parseTxtContent(testContent, "test-dividend.txt");

  if (anthropicModel) {
    console.log(`\n━━━ Testing Anthropic: ${anthropicModel.id} ━━━`);
    try {
      const startTime = Date.now();
      const result = await extractTransaction(parsed, anthropicModel.id);
      const elapsed = Date.now() - startTime;

      console.log(`✓ Success in ${elapsed}ms`);
      console.log(`  Transactional: ${result.isTransactional}`);
      console.log(`  Transactions: ${result.transactions.length}`);
      if (result.transactions.length > 0) {
        const tx = result.transactions[0];
        console.log(`  Type: ${tx.transactionType}, Symbol: ${tx.symbol}, Amount: $${tx.amount}`);
      }
    } catch (error: any) {
      console.log(`✗ FAILED: ${error.message}`);
    }
  }

  if (googleModel) {
    console.log(`\n━━━ Testing Google: ${googleModel.id} ━━━`);
    try {
      const startTime = Date.now();
      const result = await extractTransaction(parsed, googleModel.id);
      const elapsed = Date.now() - startTime;

      console.log(`✓ Success in ${elapsed}ms`);
      console.log(`  Transactional: ${result.isTransactional}`);
      console.log(`  Transactions: ${result.transactions.length}`);
      if (result.transactions.length > 0) {
        const tx = result.transactions[0];
        console.log(`  Type: ${tx.transactionType}, Symbol: ${tx.symbol}, Amount: $${tx.amount}`);
      }
    } catch (error: any) {
      console.log(`✗ FAILED: ${error.message}`);
    }
  }

  console.log("\n=== Test Complete ===");
}

main().catch(console.error);
