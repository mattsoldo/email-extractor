#!/usr/bin/env tsx
/**
 * Count total tokens in all email bodies
 *
 * This script queries all emails from the database and counts
 * the total number of tokens across all email body_text fields
 * using the Anthropic tokenizer.
 */

// IMPORTANT: Load environment variables FIRST, before any imports that use them
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(process.cwd(), ".env.local") });

// Now import database modules after env is loaded
import { db, sql, emails } from "@/db";
import { count } from "drizzle-orm";

// Simple token counter (approximation using GPT-style tokenization)
// For accurate Anthropic token counts, we'd need @anthropic-ai/tokenizer
// This uses ~4 chars per token as a rough estimate
function estimateTokens(text: string | null): number {
  if (!text) return 0;

  // Rough estimation: ~4 characters per token
  // This is a common approximation for English text
  // Actual token counts may vary by ~20-30%
  return Math.ceil(text.length / 4);
}

async function main() {
  try {
    console.log("🔍 Querying all emails from database...");
    console.log(`📍 DATABASE_URL: ${process.env.DATABASE_URL?.substring(0, 50)}...`);
    console.log();

    // Get total count of emails
    const [{ value: totalEmails }] = await db
      .select({ value: count() })
      .from(emails);

    console.log(`📧 Found ${totalEmails} emails in database`);

    // Fetch all email bodies (in batches to avoid memory issues)
    const batchSize = 1000;
    let totalTokens = 0;
    let totalEmptyBodies = 0;
    let totalChars = 0;
    let processedCount = 0;

    // Query all emails, but only select the bodyText field
    const allEmails = await db
      .select({
        id: emails.id,
        bodyText: emails.bodyText,
      })
      .from(emails);

    console.log(`\n📊 Processing ${allEmails.length} email bodies...\n`);

    for (const email of allEmails) {
      const tokens = estimateTokens(email.bodyText);
      totalTokens += tokens;

      if (email.bodyText) {
        totalChars += email.bodyText.length;
      } else {
        totalEmptyBodies++;
      }

      processedCount++;

      // Show progress every 100 emails
      if (processedCount % 100 === 0) {
        console.log(`  Processed ${processedCount}/${allEmails.length} emails...`);
      }
    }

    // Final results
    console.log("\n" + "=".repeat(60));
    console.log("📈 RESULTS");
    console.log("=".repeat(60));
    console.log(`Total emails:           ${totalEmails.toLocaleString()}`);
    console.log(`Empty body texts:       ${totalEmptyBodies.toLocaleString()}`);
    console.log(`Emails with content:    ${(totalEmails - totalEmptyBodies).toLocaleString()}`);
    console.log(`Total characters:       ${totalChars.toLocaleString()}`);
    console.log(`\n🎯 ESTIMATED TOKENS:     ${totalTokens.toLocaleString()}`);
    console.log(`\nAverage chars/email:    ${totalEmails > 0 ? Math.round(totalChars / totalEmails).toLocaleString() : 0}`);
    console.log(`Average tokens/email:   ${totalEmails > 0 ? Math.round(totalTokens / totalEmails).toLocaleString() : 0}`);
    console.log("=".repeat(60));
    console.log("\n⚠️  Note: Token counts are estimated using ~4 chars/token");
    console.log("   Actual Anthropic token counts may vary by ±20-30%");
    console.log("   For exact counts, install @anthropic-ai/tokenizer\n");

  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    // Close database connection
    await sql.end();
  }
}

main();
