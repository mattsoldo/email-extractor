/**
 * Test AI extraction with different models
 * Run with: npx tsx scripts/test-ai-extraction.ts
 */

import { config } from "dotenv";
import { join } from "path";
import { readdirSync } from "fs";

// Load environment variables
config({ path: ".env.local" });

import { parseEmlFile } from "../src/services/email-parser";
import { extractTransaction, DEFAULT_EXTRACTION_INSTRUCTIONS } from "../src/services/ai-extractor";
import { AVAILABLE_MODELS, isProviderConfigured } from "../src/services/model-config";

async function main() {
  console.log("\n=== AI Extraction Test ===\n");

  // Check which providers are configured
  console.log("Provider Status:");
  console.log(`  Anthropic: ${isProviderConfigured("anthropic") ? "✓ Configured" : "✗ Not configured"}`);
  console.log(`  OpenAI: ${isProviderConfigured("openai") ? "✓ Configured" : "✗ Not configured"}`);
  console.log(`  Google: ${isProviderConfigured("google") ? "✓ Configured" : "✗ Not configured"}`);

  // List available models
  console.log("\nAvailable Models:");
  for (const model of AVAILABLE_MODELS) {
    const configured = isProviderConfigured(model.provider);
    console.log(`  ${configured ? "✓" : "✗"} ${model.id} (${model.provider})`);
  }

  // Find a test email
  const emailFolder = join(process.cwd(), "emails");
  let testEmailPath: string | null = null;

  try {
    const files = readdirSync(emailFolder).filter(f => f.endsWith(".eml"));
    // Pick a dividend or trade email for testing
    const testFile = files.find(f =>
      f.toLowerCase().includes("dividend") ||
      f.toLowerCase().includes("executed") ||
      f.toLowerCase().includes("trade")
    ) || files[0];

    if (testFile) {
      testEmailPath = join(emailFolder, testFile);
      console.log(`\nTest Email: ${testFile}`);
    }
  } catch (e) {
    console.log("\nNo emails folder found, using inline test data");
  }

  if (!testEmailPath) {
    console.log("\nNo test email found. Please ensure there are .eml files in the emails/ folder.");
    return;
  }

  // Parse the email
  console.log("\nParsing email...");
  const parsed = await parseEmlFile(testEmailPath);
  console.log(`  Subject: ${parsed.subject}`);
  console.log(`  From: ${parsed.sender}`);
  console.log(`  Date: ${parsed.date}`);
  console.log(`  Body length: ${(parsed.bodyText || parsed.bodyHtml || "").length} chars`);

  // Test extraction with each configured provider
  const modelsToTest = AVAILABLE_MODELS.filter(m => isProviderConfigured(m.provider));

  if (modelsToTest.length === 0) {
    console.log("\n⚠ No models have API keys configured!");
    console.log("Set ANTHROPIC_API_KEY, OPENAI_API_KEY, or GOOGLE_API_KEY in .env.local");
    return;
  }

  // Test one model from each provider
  const testedProviders = new Set<string>();

  for (const model of modelsToTest) {
    if (testedProviders.has(model.provider)) continue;
    testedProviders.add(model.provider);

    console.log(`\n━━━ Testing ${model.name} (${model.id}) ━━━`);

    try {
      const startTime = Date.now();
      const result = await extractTransaction(parsed, model.id);
      const elapsed = Date.now() - startTime;

      console.log(`  ✓ Success in ${elapsed}ms`);
      console.log(`  Email Type: ${result.emailType}`);
      console.log(`  Is Transactional: ${result.isTransactional}`);
      console.log(`  Transactions: ${result.transactions.length}`);

      if (result.transactions.length > 0) {
        for (let i = 0; i < result.transactions.length; i++) {
          const tx = result.transactions[i];
          console.log(`\n  Transaction ${i + 1}:`);
          console.log(`    Type: ${tx.transactionType}`);
          console.log(`    Amount: ${tx.amount ? `$${tx.amount}` : "N/A"}`);
          console.log(`    Symbol: ${tx.symbol || "N/A"}`);
          console.log(`    Confidence: ${(tx.confidence * 100).toFixed(0)}%`);
        }
      }

      if (result.extractionNotes) {
        console.log(`\n  Notes: ${result.extractionNotes}`);
      }
    } catch (error: any) {
      console.log(`  ✗ FAILED: ${error.message}`);

      // Show more details for debugging
      if (error.cause) {
        console.log(`  Cause: ${error.cause.message || error.cause}`);
      }
      if (error.response) {
        console.log(`  Response: ${JSON.stringify(error.response, null, 2)}`);
      }

      // Check for common issues
      if (error.message.includes("API key")) {
        console.log(`  → Check that ${model.provider.toUpperCase()}_API_KEY is set correctly`);
      }
      if (error.message.includes("model")) {
        console.log(`  → Model ID "${model.id}" may be invalid for ${model.provider}`);
      }
      if (error.message.includes("rate limit")) {
        console.log(`  → Rate limited, try again later`);
      }
    }
  }

  console.log("\n=== Test Complete ===\n");
}

main().catch(err => {
  console.error("Test failed:", err);
  process.exit(1);
});
