import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import type { ParsedEmail } from "./email-parser";

// Export model ID for tracking in extraction runs
export const MODEL_ID = "claude-sonnet-4-20250514";

// Schema for extracted transaction data
const TransactionExtractionSchema = z.object({
  isTransaction: z.boolean().describe("Whether this email contains a financial transaction"),
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
    .nullable()
    .describe("The type of financial transaction"),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Confidence score from 0 to 1"),

  // Date and amount
  transactionDate: z
    .string()
    .nullable()
    .describe("Transaction date in ISO format (YYYY-MM-DD)"),
  amount: z.number().nullable().describe("Transaction amount in dollars"),
  currency: z.string().default("USD").describe("Currency code"),

  // Account information
  accountNumber: z
    .string()
    .nullable()
    .describe("Account number or masked account number (e.g., XXXX-1802)"),
  accountName: z
    .string()
    .nullable()
    .describe("Account name if mentioned (e.g., 'MAS Irrevocable Trust')"),
  institution: z
    .string()
    .nullable()
    .describe("Financial institution name"),

  // For transfers - destination account
  toAccountNumber: z
    .string()
    .nullable()
    .describe("Destination account number for transfers"),
  toAccountName: z
    .string()
    .nullable()
    .describe("Destination account name for transfers"),
  toInstitution: z
    .string()
    .nullable()
    .describe("Destination institution for transfers"),

  // Security/stock information
  symbol: z.string().nullable().describe("Stock or option symbol (e.g., AAPL, INTC)"),
  securityName: z
    .string()
    .nullable()
    .describe("Full security name (e.g., 'INTEL CORP')"),
  quantity: z.number().nullable().describe("Number of shares or contracts"),
  price: z.number().nullable().describe("Price per share or contract"),

  // Option-specific fields
  optionType: z
    .enum(["call", "put"])
    .nullable()
    .describe("Option type if applicable"),
  strikePrice: z.number().nullable().describe("Option strike price"),
  expirationDate: z
    .string()
    .nullable()
    .describe("Option expiration date in ISO format"),
  optionAction: z
    .enum(["buy_to_open", "buy_to_close", "sell_to_open", "sell_to_close", "assigned", "expired", "exercised"])
    .nullable()
    .describe("Option action type"),

  // Trade-specific
  orderType: z
    .enum(["buy", "sell", "buy_to_cover", "sell_short"])
    .nullable()
    .describe("Order type for stock trades"),
  orderStatus: z
    .enum(["executed", "cancelled", "partial", "pending"])
    .nullable()
    .describe("Order execution status"),

  // Wire/transfer specific
  fees: z.number().nullable().describe("Transaction fees"),
  referenceNumber: z
    .string()
    .nullable()
    .describe("Transaction reference or case number"),

  // RSU specific
  grantNumber: z.string().nullable().describe("RSU grant number"),
  vestDate: z
    .string()
    .nullable()
    .describe("RSU vesting date in ISO format"),

  // Additional extracted fields as key-value pairs
  additionalFields: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]).nullable())
    .default({})
    .describe("Any other relevant fields extracted from the email"),

  // Extraction notes
  extractionNotes: z
    .string()
    .nullable()
    .describe("Any notes about the extraction or ambiguities"),
});

export type TransactionExtraction = z.infer<typeof TransactionExtractionSchema>;

/**
 * Extract transaction data from a parsed email using Claude
 */
export async function extractTransaction(
  email: ParsedEmail
): Promise<TransactionExtraction> {
  // Prepare the email content for the AI
  const emailContent = prepareEmailContent(email);

  const { object } = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: TransactionExtractionSchema,
    prompt: `You are a financial data extraction expert. Analyze this email and extract all financial transaction information.

EMAIL SUBJECT: ${email.subject || "(no subject)"}

EMAIL DATE: ${email.date?.toISOString() || "(unknown)"}

EMAIL SENDER: ${email.sender || "(unknown)"}

EMAIL CONTENT:
${emailContent}

INSTRUCTIONS:
1. Determine if this email contains a financial transaction notification
2. Extract all relevant financial data with high precision
3. For account numbers, preserve the exact format shown (including masked portions like XXXX-1802)
4. For dates, convert to ISO format (YYYY-MM-DD)
5. For amounts, extract the numeric value in dollars
6. If multiple transactions are mentioned, extract the PRIMARY transaction
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
- Account formats: "XXXX-1234", "Account: XXXX1234", "AccountName-1234"`,
  });

  return object;
}

/**
 * Prepare email content for extraction - prefer text, fall back to HTML stripped
 */
function prepareEmailContent(email: ParsedEmail): string {
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
function stripHtml(html: string): string {
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
    concurrency?: number;
    onProgress?: (completed: number, total: number) => void;
  } = {}
): AsyncGenerator<{
  email: ParsedEmail;
  extraction: TransactionExtraction | null;
  error: Error | null;
}> {
  const { concurrency = 3, onProgress } = options;

  let completed = 0;
  const total = emails.length;

  // Process in batches with concurrency limit
  for (let i = 0; i < emails.length; i += concurrency) {
    const batch = emails.slice(i, i + concurrency);

    const results = await Promise.allSettled(
      batch.map(async (email) => {
        const extraction = await extractTransaction(email);
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
