/**
 * Seed default prompts into the database
 * Run with: npx tsx scripts/seed-prompts.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db, sql } from "../src/db";
import { prompts } from "../src/db/schema";
import { v4 as uuid } from "uuid";

const DEFAULT_PROMPT_CONTENT = `INSTRUCTIONS:
1. Determine if this email contains any financial transactions
2. If this is a discussion about transactions (threads, approvals, disputes, forwarded transaction notifications), classify as "evidence" and set isTransactional to false
3. For evidence emails, leave transactions empty and write a concise discussionSummary (participants, decisions, amounts/dates, and any transaction references)
4. For evidence emails, populate relatedReferenceNumbers with any explicit confirmation numbers, case IDs, or reference numbers mentioned; otherwise use an empty array
5. For non-evidence emails, set discussionSummary to null and relatedReferenceNumbers to an empty array
5. Extract ALL transactions found - an email may contain multiple transactions
6. For each transaction, extract all relevant financial data with high precision
7. For account numbers, preserve the exact format shown (including masked portions like XXXX-1802)
8. For dates, convert to ISO format (YYYY-MM-DD)
9. For amounts, extract the numeric value in dollars
10. Pay attention to both the "from" and "to" accounts for transfers
11. For options, extract the full contract details including strike, expiration, and action type
12. Note any fields you found that don't fit the standard schema in additionalFields
13. Set confidence based on how clear and complete the information is
14. Do not include information that you infer or compute. for example if there was a stock sale of 100 shares at $20, but the total transaction amount is not included, do not include an computer amount of $2,000.
15. Include transactions that are cancelled, expired or otherwise didn't happen. But categorize them as "Unexecuted".
16. If the email appears to be a discussion about a transaction between people rather than an automatic system notification, mark them as "evidence". 
17. For limit stock order executions, record the order number if available, and the original order quantity, and the limit price.


COMMON PATTERNS TO RECOGNIZE:
- "Dividend or Interest Paid" emails contain dividend/interest payments
- "Executed @ $X.XX" indicates trade execution with price
- "Wire Transfer Complete" contains wire details with fees
- "Funds Transfer Confirmation" contains internal transfer details
- "Restricted Stock released/vesting" contains RSU information
- Account formats: "XXXX-1234", "Account: XXXX1234", "AccountName-1234", "AccountName"

EMAIL TYPES:
- "transactional": Contains one or more financial transactions
- "informational": Account alerts, balance notifications, security alerts (no actual transaction)
- "marketing": Promotional content, newsletters
- "alert": Price alerts, news alerts, notifications
- "statement": Account statements, tax documents
- "evidence": discussions between humans about transactions that can be used to provide information about them, for example validating that they occurred, the intent behind them, or other circumstances.
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
    await sql.end();
    process.exit(1);
  }
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("Seed script error:", error);
    await sql.end();
    process.exit(1);
  });
