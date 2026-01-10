import { generateText, Output, jsonSchema } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";
import { z } from "zod";
import type { JSONSchema7 } from "json-schema";
import type { ParsedEmail } from "./email-parser";
import { getModelConfig, DEFAULT_MODEL_ID, type ModelConfig, type ModelProvider } from "./model-config";

// Schema for a single transaction
// Using .nullish() instead of .nullable() to allow fields to be omitted (OpenAI) or set to null (Claude)
const SingleTransactionSchema = z.object({
  transactionType: z
    .enum([
      "dividend",
      "interest",
      "stock_trade",
      "option_trade",
      "wire_transfer_in",
      "wire_transfer_out",
      "funds_transfer",
      "deposit",
      "withdrawal",
      "rsu_vest",
      "rsu_release",
      "account_transfer",
      "fee",
      "other",
    ])
    .describe("The type of financial transaction"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score from 0 to 1"),

  // Date and amount
  transactionDate: z
    .string()
    .nullish()
    .describe("Transaction date in ISO format (YYYY-MM-DD)"),
  amount: z.number().nullish().describe("Transaction amount in dollars"),
  currency: z.string().default("USD").describe("Currency code"),

  // Account information
  accountNumber: z
    .string()
    .nullish()
    .describe("Account number or masked account number (e.g., XXXX-1802)"),
  accountName: z
    .string()
    .nullish()
    .describe("Account name if mentioned (e.g., 'MAS Irrevocable Trust')"),
  institution: z
    .string()
    .nullish()
    .describe("Financial institution name"),

  // For transfers - destination account
  toAccountNumber: z
    .string()
    .nullish()
    .describe("Destination account number for transfers"),
  toAccountName: z
    .string()
    .nullish()
    .describe("Destination account name for transfers"),
  toInstitution: z
    .string()
    .nullish()
    .describe("Destination institution for transfers"),

  // Security/stock information
  symbol: z.string().nullish().describe("Stock or option symbol (e.g., AAPL, INTC)"),
  securityName: z
    .string()
    .nullish()
    .describe("Full security name (e.g., 'INTEL CORP')"),
  quantity: z.number().nullish().describe("Number of shares or contracts"),
  price: z.number().nullish().describe("Price per share or contract"),

  // Option-specific fields
  optionType: z
    .enum(["call", "put"])
    .nullish()
    .describe("Option type if applicable"),
  strikePrice: z.number().nullish().describe("Option strike price"),
  expirationDate: z
    .string()
    .nullish()
    .describe("Option expiration date in ISO format"),
  optionAction: z
    .enum(["buy_to_open", "buy_to_close", "sell_to_open", "sell_to_close", "assigned", "expired", "exercised"])
    .nullish()
    .describe("Option action type"),

  // Trade-specific
  orderType: z
    .enum(["buy", "sell", "buy_to_cover", "sell_short"])
    .nullish()
    .describe("Order type for stock trades"),
  orderStatus: z
    .enum(["executed", "cancelled", "partial", "pending"])
    .nullish()
    .describe("Order execution status"),

  // Wire/transfer specific
  fees: z.number().nullish().describe("Transaction fees"),
  referenceNumber: z
    .string()
    .nullish()
    .describe("Transaction reference or case number"),

  // RSU specific
  grantNumber: z.string().nullish().describe("RSU grant number"),
  vestDate: z
    .string()
    .nullish()
    .describe("RSU vesting date in ISO format"),

  // Additional extracted fields as key-value pairs (array format for Gemini compatibility)
  additionalFields: z
    .array(z.object({
      key: z.string().describe("Field name"),
      value: z.string().describe("Field value as string"),
    }))
    .optional()
    .default([])
    .describe("Any other relevant fields extracted from the email as key-value pairs"),
});

// Schema for the full email extraction result
export const TransactionExtractionSchema = z.object({
  isTransactional: z.boolean().describe("Whether this email contains any financial transactions"),
  emailType: z
    .enum(["transactional", "informational", "marketing", "alert", "statement", "other"])
    .describe("The type of email"),
  transactions: z
    .array(SingleTransactionSchema)
    .describe("Array of transactions found in this email (can be empty if non-transactional)"),
  extractionNotes: z
    .string()
    .nullable()
    .describe("Any notes about the extraction, ambiguities, or why this email is non-transactional"),
});

export type SingleTransaction = z.infer<typeof SingleTransactionSchema>;
export type TransactionExtraction = z.infer<typeof TransactionExtractionSchema>;

/**
 * Result of getModelInstance - includes both the model and provider info for caching decisions
 */
interface ModelInstanceResult {
  model: ReturnType<typeof anthropic> | ReturnType<typeof openai> | ReturnType<typeof google>;
  provider: ModelProvider;
}

/**
 * Get the AI model instance based on model ID
 * ALWAYS queries database first (source of truth), falls back to hardcoded models only as last resort
 * Returns both the model instance and provider for cache control decisions
 */
async function getModelInstance(modelId: string): Promise<ModelInstanceResult> {
  let config: ModelConfig | undefined;

  // Database is the source of truth - try it first
  try {
    const { db } = await import("@/db");
    const { aiModels } = await import("@/db/schema");
    const { eq } = await import("drizzle-orm");

    const dbModels = await db.select().from(aiModels).where(eq(aiModels.id, modelId)).limit(1);

    if (dbModels.length > 0) {
      const dbModel = dbModels[0];
      config = {
        id: dbModel.id,
        provider: dbModel.provider as ModelProvider,
        name: dbModel.name,
        description: dbModel.description || "",
        inputCostPerMillion: parseFloat(dbModel.inputCostPerMillion),
        outputCostPerMillion: parseFloat(dbModel.outputCostPerMillion),
        contextWindow: dbModel.contextWindow,
      };
      console.log(`[AI Extractor] ✓ Using model from database: ${modelId} (${config.provider})`);
    }
  } catch (dbError) {
    console.error(`[AI Extractor] ⚠ Failed to query database for model ${modelId}, falling back to hardcoded:`, dbError);
    // Fall back to hardcoded models
    config = getModelConfig(modelId);
  }

  // If still not found in database, try hardcoded as fallback
  if (!config) {
    config = getModelConfig(modelId);
    if (config) {
      console.log(`[AI Extractor] ⚠ Using hardcoded model (not in database): ${modelId} (${config.provider})`);
    }
  }

  if (!config) {
    const error = new Error(`Unknown model: ${modelId}. Model not found in database or hardcoded models.`);
    console.error(`[AI Extractor] ✗ ${error.message}`);
    throw error;
  }

  if (config.provider === "anthropic") {
    return { model: anthropic(modelId), provider: "anthropic" };
  }
  if (config.provider === "openai") {
    return { model: openai(modelId), provider: "openai" };
  }
  if (config.provider === "google") {
    return { model: google(modelId), provider: "google" };
  }

  const error = new Error(`Unsupported provider: ${config.provider} for model ${modelId}`);
  console.error(`[AI Extractor] ✗ ${error.message}`);
  throw error;
}

/**
 * Extract transaction data from a parsed email using the specified model
 * Note: customInstructions must be provided from the prompts database
 * @param customJsonSchema - Optional custom JSON schema to use instead of TransactionExtractionSchema
 *
 * Performance: Uses prompt caching for Anthropic models - the system prompt and instructions
 * are cached across requests, reducing latency by up to 80% for subsequent extractions.
 */
export async function extractTransaction(
  email: ParsedEmail,
  modelId: string = DEFAULT_MODEL_ID,
  customInstructions?: string,
  customJsonSchema?: Record<string, unknown> | null
): Promise<TransactionExtraction> {
  try {
    // Prepare the email content for the AI
    const emailContent = prepareEmailContent(email);

    console.log(`[AI Extractor] Starting extraction for email ${email.id} (${email.subject}) using model ${modelId}`);

    const { model, provider } = await getModelInstance(modelId);

    if (!customInstructions) {
      throw new Error("customInstructions is required. Extraction prompts must be fetched from the database.");
    }

    // Separate system prompt (cacheable) from user content (unique per email)
    // This enables Anthropic's prompt caching - the system prompt is cached and reused
    const systemPrompt = customJsonSchema
      ? `You are a data extraction expert. Analyze emails and extract all relevant information according to the provided schema.\n\n${customInstructions}`
      : `You are a financial data extraction expert. Analyze emails and extract all financial transaction information according to the provided schema.\n\n${customInstructions}`;

    // User message contains only the email-specific content
    const userMessage = `Analyze this email and extract the data:

EMAIL SUBJECT: ${email.subject || "(no subject)"}

EMAIL DATE: ${email.date?.toISOString() || "(unknown)"}

EMAIL SENDER: ${email.sender || "(unknown)"}

EMAIL CONTENT:
${emailContent}`;

    // Provider options for prompt caching (Anthropic-specific)
    // The cache control marks the system prompt as cacheable for 5 minutes
    const providerOptions = provider === "anthropic" ? {
      anthropic: {
        cacheControl: { type: "ephemeral" as const },
      },
    } : undefined;

    // Use custom JSON schema if provided, otherwise use default Zod schema
    if (customJsonSchema) {
      // Custom schema path - output type is unknown, cast to TransactionExtraction
      // Callers using custom schemas should handle the different output structure
      const { output } = await generateText({
        model,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
        output: Output.object({
          schema: jsonSchema(customJsonSchema as JSONSchema7),
          name: "transaction_extraction",
          description: "Extract data from email content",
        }),
        providerOptions,
      });

      if (!output) {
        throw new Error("Failed to extract structured data from email");
      }

      console.log(`[AI Extractor] ✓ Extraction successful for email ${email.id} with custom schema`);
      return output as unknown as TransactionExtraction;
    }

    // Default schema path - output is properly typed as TransactionExtraction
    const { output } = await generateText({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
      output: Output.object({
        schema: TransactionExtractionSchema,
        name: "transaction_extraction",
        description: "Extract financial transactions from email content",
      }),
      providerOptions,
    });

    // output can be undefined if extraction fails, handle gracefully
    if (!output) {
      throw new Error("Failed to extract structured data from email");
    }

    console.log(`[AI Extractor] ✓ Extraction successful for email ${email.id}: ${output.isTransactional ? output.transactions.length + " transaction(s)" : "non-transactional"}`);

    return output;
  } catch (error) {
    console.error(`[AI Extractor] ✗ Extraction failed for email ${email.id} (${email.subject}) with model ${modelId}:`, error);

    // Re-throw with more context
    if (error instanceof Error) {
      error.message = `[Model: ${modelId}] ${error.message}`;
    }
    throw error;
  }
}

/**
 * Prepare email content for extraction - prefer text, fall back to HTML stripped
 */
export function prepareEmailContent(email: ParsedEmail): string {
  if (email.bodyText && email.bodyText.trim().length > 100) {
    return email.bodyText;
  }

  if (email.bodyHtml) {
    // Simple HTML stripping - remove tags and decode entities
    return stripHtml(email.bodyHtml);
  }

  return "(no content)";
}

/**
 * Strip HTML tags and decode common entities
 */
export function stripHtml(html: string): string {
  return html
    // Remove script and style elements
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    // Remove HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode common entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Clean up whitespace
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Batch extract transactions from multiple emails
 * Returns results as they complete for streaming
 */
export async function* extractTransactionsBatch(
  emails: ParsedEmail[],
  options: {
    modelId?: string;
    concurrency?: number;
    customInstructions?: string;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): AsyncGenerator<{
  email: ParsedEmail;
  extraction: TransactionExtraction | null;
  error: Error | null;
}> {
  const { modelId = DEFAULT_MODEL_ID, concurrency = 3, customInstructions, onProgress } = options;

  let completed = 0;
  const total = emails.length;

  // Process in batches with concurrency limit
  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (email) => {
        const extraction = await extractTransaction(email, modelId, customInstructions);
        return { email, extraction };
      })
    );

    for (const result of results) {
      completed++;
      onProgress?.(completed, total);

      if (result.status === "fulfilled") {
        yield {
          email: result.value.email,
          extraction: result.value.extraction,
          error: null,
        };
      } else {
        // Find the corresponding email for this failed result
        const index = results.indexOf(result);
        yield {
          email: batch[index],
          extraction: null,
          error: result.reason as Error,
        };
      }
    }
  }
}

// Re-export for convenience
export { DEFAULT_MODEL_ID, getModelConfig, AVAILABLE_MODELS } from "./model-config";
export { SingleTransactionSchema };
