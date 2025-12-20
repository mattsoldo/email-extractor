/**
 * Cleanup script: Delete all extraction runs, transactions, and accounts
 *
 * This script is used to start fresh with the new email_extractions system.
 * It will delete:
 * - All extraction_runs
 * - All transactions
 * - All accounts and account_corpus
 * - All extraction_logs
 * - Reset email extraction status to 'pending'
 *
 * Run with: npx tsx scripts/cleanup-extractions.ts
 */

// IMPORTANT: Load env vars BEFORE importing db
import { config } from "dotenv";
import { resolve } from "path";

// Load .env.local from project root
config({ path: resolve(process.cwd(), ".env.local") });

// Verify DATABASE_URL is loaded
if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL not found in .env.local");
  process.exit(1);
}

console.log(`Using database: ${process.env.DATABASE_URL.replace(/:[^:]*@/, ':***@')}`);

// Import drizzle and create connection inline
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/db/schema";
import {
  extractionRuns,
  transactions,
  accounts,
  accountCorpus,
  extractionLogs,
  emails,
  corpusSuggestions,
  jobs,
} from "../src/db/schema";
import { sql } from "drizzle-orm";

// Create db connection with env var
const queryClient = postgres(process.env.DATABASE_URL);
const db = drizzle(queryClient, { schema });

async function main() {
  console.log("\n=== Cleanup: Delete All Extraction Data ===\n");

  console.log("⚠️  WARNING: This will permanently delete:");
  console.log("   - All extraction runs");
  console.log("   - All transactions");
  console.log("   - All accounts");
  console.log("   - All extraction logs");
  console.log("   - Reset all emails to 'pending' status\n");

  // Wait 3 seconds to allow user to cancel
  console.log("Starting cleanup in 3 seconds... (Press Ctrl+C to cancel)");
  await new Promise((resolve) => setTimeout(resolve, 3000));

  try {
    console.log("\n1. Deleting corpus suggestions...");
    const deletedSuggestions = await db.delete(corpusSuggestions);
    console.log(`   ✓ Deleted corpus suggestions`);

    console.log("\n2. Deleting transactions...");
    const deletedTransactions = await db.delete(transactions);
    console.log(`   ✓ Deleted transactions`);

    console.log("\n3. Deleting accounts...");
    const deletedAccounts = await db.delete(accounts);
    console.log(`   ✓ Deleted accounts`);

    console.log("\n4. Deleting account corpus...");
    const deletedCorpus = await db.delete(accountCorpus);
    console.log(`   ✓ Deleted account corpus`);

    console.log("\n5. Deleting extraction logs...");
    const deletedLogs = await db.delete(extractionLogs);
    console.log(`   ✓ Deleted extraction logs`);

    console.log("\n6. Deleting extraction runs...");
    const deletedRuns = await db.delete(extractionRuns);
    console.log(`   ✓ Deleted extraction runs`);

    console.log("\n7. Deleting jobs...");
    const deletedJobs = await db.delete(jobs);
    console.log(`   ✓ Deleted jobs`);

    console.log("\n8. Resetting email extraction status to 'pending'...");
    await db
      .update(emails)
      .set({
        extractionStatus: "pending",
        extractionError: null,
        rawExtraction: null,
        skipReason: null,
        informationalNotes: null,
        processedAt: null,
      });
    console.log(`   ✓ Reset all emails to pending`);

    console.log("\n9. Resetting email set counts...");
    // Update email counts for all sets
    await db.execute(sql`
      UPDATE email_sets
      SET email_count = (
        SELECT COUNT(*)
        FROM emails
        WHERE emails.set_id = email_sets.id
      )
    `);
    console.log(`   ✓ Reset email set counts`);

    console.log("\n=== Cleanup Complete ===");
    console.log("\nAll extraction data has been deleted.");
    console.log("Emails have been reset to 'pending' status.");
    console.log("You can now start fresh extractions with the new system.\n");

    process.exit(0);
  } catch (error) {
    console.error("\n✗ Cleanup failed:", error);
    process.exit(1);
  }
}

main();
