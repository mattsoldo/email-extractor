/**
 * Seed default prompts into the database
 * Run with: npx tsx scripts/seed-prompts.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db";
import { prompts } from "../src/db/schema";
import { v4 as uuid } from "uuid";

const DEFAULT_PROMPT_CONTENT = `INSTRUCTIONS:
1. Determine if this email contains any financial transactions
2. Extract ALL transactions found - an email may contain multiple transactions
3. For each transaction, extract all relevant financial data with high precision
4. For account numbers, preserve the exact format shown (including masked portions like XXXX-1802)
5. For dates, convert to ISO format (YYYY-MM-DD)
6. For amounts, extract the numeric value in dollars
7. Pay attention to both the "from" and "to" accounts for transfers
8. For options, extract the full contract details including strike, expiration, and action type
9. Note any fields you found that don't fit the standard schema in additionalFields
10. Set confidence based on how clear and complete the information is

COMMON PATTERNS TO RECOGNIZE:
- "Dividend or Interest Paid" emails contain dividend/interest payments
- "Executed @ $X.XX" indicates trade execution with price
- "Wire Transfer Complete" contains wire details with fees
- "Funds Transfer Confirmation" contains internal transfer details
- "Restricted Stock released/vesting" contains RSU information
- Account formats: "XXXX-1234", "Account: XXXX1234", "AccountName-1234"

EMAIL TYPES:
- "transactional": Contains one or more financial transactions
- "informational": Account alerts, balance notifications, security alerts (no actual transaction)
- "marketing": Promotional content, newsletters
- "alert": Price alerts, news alerts, notifications
- "statement": Account statements, tax documents
- "other": Other email types`;

async function main() {
  console.log("=== Seeding Prompts ===\n");

  try {
    // Check if default prompt already exists
    const existing = await db.select().from(prompts).limit(1);

    if (existing.length > 0) {
      console.log("Prompts table already has data. Skipping seed.");
      console.log(`Found ${existing.length} existing prompt(s).`);
      return;
    }

    // Insert default prompt
    const defaultPromptId = uuid();
    await db.insert(prompts).values({
      id: defaultPromptId,
      name: "Default Financial Extraction",
      description: "Standard prompt for extracting financial transactions from emails. Covers dividends, trades, transfers, options, and RSUs.",
      content: DEFAULT_PROMPT_CONTENT,
      isDefault: true,
      isActive: true,
    });

    console.log("✓ Created default prompt");
    console.log(`  ID: ${defaultPromptId}`);
    console.log(`  Name: Default Financial Extraction`);
    console.log(`  Content length: ${DEFAULT_PROMPT_CONTENT.length} chars`);

    console.log("\n=== Seed Complete ===");
  } catch (error) {
    console.error("Failed to seed prompts:", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Seed script error:", error);
  process.exit(1);
});
