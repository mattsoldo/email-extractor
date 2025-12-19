/**
 * Test broader set of emails to identify error patterns
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { parseEmlFile, classifyEmail } from "../src/services/email-parser";
import { extractTransaction } from "../src/services/ai-extractor";
import { readdirSync } from "fs";
import { join } from "path";

async function main() {
  const emailFolder = "./emails";
  const files = readdirSync(emailFolder).filter(f => f.endsWith(".eml"));

  // Sample 30 random emails
  const shuffled = files.sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, 30);

  const results = {
    success: [] as string[],
    errors: [] as { file: string; error: string; subject?: string }[],
    nonTransactional: [] as { file: string; subject?: string; notes?: string }[],
  };

  console.log(`Testing ${sample.length} random emails...\n`);

  for (let i = 0; i < sample.length; i++) {
    const file = sample[i];
    const shortName = file.substring(0, 60);
    process.stdout.write(`[${i + 1}/${sample.length}] ${shortName}... `);

    try {
      const parsed = await parseEmlFile(join(emailFolder, file));
      const extraction = await extractTransaction(parsed);

      if (extraction.isTransaction) {
        console.log(`✓ ${extraction.transactionType}`);
        results.success.push(file);
      } else {
        console.log(`○ Not a transaction`);
        results.nonTransactional.push({
          file,
          subject: parsed.subject || undefined,
          notes: extraction.extractionNotes || undefined,
        });
      }
    } catch (error: any) {
      console.log(`✗ ERROR`);
      results.errors.push({
        file,
        error: error.message,
      });
    }

    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  console.log(`✓ Transactions extracted: ${results.success.length}`);
  console.log(`○ Non-transactional: ${results.nonTransactional.length}`);
  console.log(`✗ Errors: ${results.errors.length}`);

  if (results.errors.length > 0) {
    console.log("\n" + "-".repeat(60));
    console.log("ERRORS:");
    console.log("-".repeat(60));
    for (const err of results.errors) {
      console.log(`\nFile: ${err.file}`);
      console.log(`Error: ${err.error}`);
    }
  }

  if (results.nonTransactional.length > 0) {
    console.log("\n" + "-".repeat(60));
    console.log("NON-TRANSACTIONAL EMAILS:");
    console.log("-".repeat(60));
    for (const nt of results.nonTransactional) {
      console.log(`\n• ${nt.subject || nt.file}`);
      if (nt.notes) console.log(`  Notes: ${nt.notes}`);
    }
  }
}

main().catch(console.error);
