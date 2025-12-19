/**
 * Reset database data - deletes all emails, transactions, and email sets
 * Run with: npx tsx scripts/reset-data.ts
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { emails, transactions, emailSets, extractionRuns, jobs } from "../src/db/schema";

async function resetData() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error("❌ DATABASE_URL environment variable is not set");
    console.log("\nRun with:");
    console.log("  DATABASE_URL=postgresql://postgres:postgres@localhost:5433/email_extractor npx tsx scripts/reset-data.ts");
    process.exit(1);
  }

  console.log("🗑️  Resetting database data...\n");

  const client = postgres(databaseUrl);
  const db = drizzle(client);

  try {
    // Delete in order to respect foreign key constraints
    console.log("  Deleting transactions...");
    const txResult = await db.delete(transactions);
    console.log("  ✓ Transactions deleted");

    console.log("  Deleting extraction runs...");
    await db.delete(extractionRuns);
    console.log("  ✓ Extraction runs deleted");

    console.log("  Deleting jobs...");
    await db.delete(jobs);
    console.log("  ✓ Jobs deleted");

    console.log("  Deleting emails...");
    await db.delete(emails);
    console.log("  ✓ Emails deleted");

    console.log("  Deleting email sets...");
    await db.delete(emailSets);
    console.log("  ✓ Email sets deleted");

    console.log("\n✅ All data has been reset!");
    console.log("   You can now upload a fresh dataset.");

  } catch (error) {
    console.error("\n❌ Error resetting data:", error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

resetData();
