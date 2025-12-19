import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { db } from "@/db";
import { transactions, emails, accounts } from "@/db/schema";
import { sql, eq, ilike, and, or, gte, lte, desc } from "drizzle-orm";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface SearchResult {
  type: "transaction" | "email" | "account" | "summary";
  data: Record<string, unknown>;
}

/**
 * Search transactions based on natural language query
 */
async function searchTransactions(params: {
  symbol?: string;
  type?: string;
  minAmount?: number;
  maxAmount?: number;
  startDate?: string;
  endDate?: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const conditions = [];

  if (params.symbol) {
    conditions.push(ilike(transactions.symbol, `%${params.symbol}%`));
  }
  if (params.type) {
    conditions.push(eq(transactions.type, params.type as any));
  }
  if (params.minAmount) {
    conditions.push(gte(transactions.amount, String(params.minAmount)));
  }
  if (params.maxAmount) {
    conditions.push(lte(transactions.amount, String(params.maxAmount)));
  }
  if (params.startDate) {
    conditions.push(gte(transactions.date, new Date(params.startDate)));
  }
  if (params.endDate) {
    conditions.push(lte(transactions.date, new Date(params.endDate)));
  }

  let query = db
    .select({
      transaction: transactions,
      account: accounts,
    })
    .from(transactions)
    .leftJoin(accounts, eq(transactions.accountId, accounts.id));

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const results = await query
    .orderBy(desc(transactions.date))
    .limit(params.limit || 20);

  return results.map((r) => ({
    type: "transaction" as const,
    data: {
      ...r.transaction,
      account: r.account,
    },
  }));
}

/**
 * Search emails based on natural language query
 */
async function searchEmails(params: {
  subject?: string;
  sender?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
  limit?: number;
}): Promise<SearchResult[]> {
  const conditions = [];

  if (params.subject) {
    conditions.push(ilike(emails.subject, `%${params.subject}%`));
  }
  if (params.sender) {
    conditions.push(ilike(emails.sender, `%${params.sender}%`));
  }
  if (params.status) {
    conditions.push(eq(emails.extractionStatus, params.status as any));
  }
  if (params.startDate) {
    conditions.push(gte(emails.date, new Date(params.startDate)));
  }
  if (params.endDate) {
    conditions.push(lte(emails.date, new Date(params.endDate)));
  }

  let query = db.select().from(emails);

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  const results = await query
    .orderBy(desc(emails.date))
    .limit(params.limit || 20);

  return results.map((r) => ({
    type: "email" as const,
    data: r,
  }));
}

/**
 * Get transaction statistics
 */
async function getTransactionStats(params: {
  startDate?: string;
  endDate?: string;
  groupBy?: "type" | "month" | "symbol";
}): Promise<SearchResult> {
  const conditions = [];

  if (params.startDate) {
    conditions.push(gte(transactions.date, new Date(params.startDate)));
  }
  if (params.endDate) {
    conditions.push(lte(transactions.date, new Date(params.endDate)));
  }

  // Get totals by type
  const byType = await db
    .select({
      type: transactions.type,
      count: sql<number>`count(*)`,
      totalAmount: sql<number>`sum(cast(${transactions.amount} as decimal))`,
    })
    .from(transactions)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(transactions.type);

  // Get overall stats
  const overall = await db
    .select({
      totalTransactions: sql<number>`count(*)`,
      totalAmount: sql<number>`sum(cast(${transactions.amount} as decimal))`,
      avgAmount: sql<number>`avg(cast(${transactions.amount} as decimal))`,
    })
    .from(transactions)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  return {
    type: "summary",
    data: {
      byType: byType.reduce(
        (acc, row) => ({
          ...acc,
          [row.type]: { count: row.count, totalAmount: row.totalAmount },
        }),
        {}
      ),
      overall: overall[0],
    },
  };
}

/**
 * Process a chat message and generate a response
 */
export async function processChat(
  message: string,
  history: ChatMessage[] = []
): Promise<{ response: string; results: SearchResult[] }> {
  // Build context from conversation history
  const conversationContext = history
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n");

  // First, use AI to understand the query and decide what to search
  const { text: analysisText } = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: `You are an assistant that helps users query their financial transaction data.
When users ask questions, analyze what they want and respond with a JSON object containing search parameters.

Available search types:
1. "transactions" - Search transactions with params: symbol, type (dividend, interest, stock_trade, option_trade, wire_transfer_in, wire_transfer_out, funds_transfer, deposit, withdrawal, rsu_vest, rsu_release, account_transfer, fee, other), minAmount, maxAmount, startDate (YYYY-MM-DD), endDate (YYYY-MM-DD), limit
2. "emails" - Search emails with params: subject, sender, startDate, endDate, status (pending, completed, failed, skipped, informational), limit
3. "stats" - Get statistics with params: startDate, endDate, groupBy (type, month, symbol)
4. "none" - Just respond conversationally (for greetings, clarifications, etc.)

Respond ONLY with a JSON object in this format:
{
  "searchType": "transactions" | "emails" | "stats" | "none",
  "params": { ... },
  "followUpQuestion": "optional question if you need clarification"
}

Examples:
- "Show me my AAPL trades" -> {"searchType": "transactions", "params": {"symbol": "AAPL", "type": "stock_trade"}}
- "How many dividends did I receive last year?" -> {"searchType": "stats", "params": {"startDate": "2024-01-01", "endDate": "2024-12-31"}}
- "Hello" -> {"searchType": "none", "params": {}}`,
    prompt: `${conversationContext ? `Previous conversation:\n${conversationContext}\n\n` : ""}User: ${message}`,
  });

  // Parse the analysis
  let analysis: {
    searchType: "transactions" | "emails" | "stats" | "none";
    params: Record<string, unknown>;
    followUpQuestion?: string;
  };

  try {
    // Extract JSON from response (handle potential markdown code blocks)
    const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
    analysis = JSON.parse(jsonMatch?.[0] || analysisText);
  } catch {
    analysis = { searchType: "none", params: {} };
  }

  // Execute the appropriate search
  let results: SearchResult[] = [];
  let contextData = "";

  switch (analysis.searchType) {
    case "transactions":
      results = await searchTransactions(analysis.params as any);
      contextData = `Found ${results.length} transactions:\n${JSON.stringify(
        results.slice(0, 10).map((r) => ({
          date: (r.data as any).date,
          type: (r.data as any).type,
          symbol: (r.data as any).symbol,
          amount: (r.data as any).amount,
          quantity: (r.data as any).quantity,
          price: (r.data as any).price,
        })),
        null,
        2
      )}`;
      break;

    case "emails":
      results = await searchEmails(analysis.params as any);
      contextData = `Found ${results.length} emails:\n${JSON.stringify(
        results.slice(0, 10).map((r) => ({
          date: (r.data as any).date,
          subject: (r.data as any).subject,
          sender: (r.data as any).sender,
          status: (r.data as any).extractionStatus,
        })),
        null,
        2
      )}`;
      break;

    case "stats":
      const statsResult = await getTransactionStats(analysis.params as any);
      results = [statsResult];
      contextData = `Statistics:\n${JSON.stringify(statsResult.data, null, 2)}`;
      break;

    case "none":
      if (analysis.followUpQuestion) {
        return { response: analysis.followUpQuestion, results: [] };
      }
      break;
  }

  // Generate a natural language response based on the results
  const { text: response } = await generateText({
    model: anthropic("claude-sonnet-4-20250514"),
    system: `You are a helpful assistant that summarizes financial transaction data for users.
Be concise and helpful. Format numbers as currency when appropriate.
If results are empty, say so helpfully and suggest alternatives.`,
    prompt: `User asked: "${message}"

${contextData || "No specific data to report."}

Provide a helpful, concise response summarizing this information for the user.`,
  });

  return { response, results };
}
