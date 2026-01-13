import {
  pgTable,
  text,
  timestamp,
  decimal,
  jsonb,
  boolean,
  integer,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// Enums
export const transactionTypeEnum = pgEnum("transaction_type", [
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
]);

export const extractionStatusEnum = pgEnum("extraction_status", [
  "pending",
  "processing",
  "completed",
  "failed",
  "skipped",
  "informational", // Non-transactional emails (alerts, marketing, etc.)
  "non_financial", // Marketing/promotional emails detected at upload
]);

export const jobStatusEnum = pgEnum("job_status", [
  "pending",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);

export const modelProviderEnum = pgEnum("model_provider", [
  "anthropic",
  "openai",
  "google",
]);

// AI Models - stores model configurations (takes precedence over code defaults)
export const aiModels = pgTable("ai_models", {
  id: text("id").primaryKey(), // The API model ID (e.g., "claude-sonnet-4-5-20241022")
  provider: modelProviderEnum("provider").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  inputCostPerMillion: decimal("input_cost_per_million", { precision: 10, scale: 4 }).notNull(),
  outputCostPerMillion: decimal("output_cost_per_million", { precision: 10, scale: 4 }).notNull(),
  contextWindow: integer("context_window").notNull(),
  isRecommended: boolean("is_recommended").default(false),
  isActive: boolean("is_active").default(true),
  sortOrder: integer("sort_order").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Account corpus - groups of accounts representing the same money/entity
export const accountCorpus = pgTable("account_corpus", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Accounts table with consolidation support
export const accounts = pgTable("accounts", {
  id: text("id").primaryKey(),
  displayName: text("display_name"),
  institution: text("institution"),
  accountNumber: text("account_number"), // Full account number if known
  maskedNumber: text("masked_number"), // e.g., XXXX-1802
  accountType: text("account_type"), // brokerage, bank, ira, trust, etc.
  corpusId: text("corpus_id").references(() => accountCorpus.id),
  isExternal: boolean("is_external").default(false), // External accounts (wire destinations)
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Corpus suggestions - AI-suggested groupings awaiting confirmation
export const corpusSuggestions = pgTable("corpus_suggestions", {
  id: text("id").primaryKey(),
  accountId1: text("account_id_1")
    .references(() => accounts.id)
    .notNull(),
  accountId2: text("account_id_2")
    .references(() => accounts.id)
    .notNull(),
  reason: text("reason").notNull(), // Why AI thinks these are related
  confidence: decimal("confidence", { precision: 3, scale: 2 }), // 0.00 - 1.00
  status: text("status").default("pending"), // pending, accepted, rejected
  createdAt: timestamp("created_at").defaultNow().notNull(),
  reviewedAt: timestamp("reviewed_at"),
});

// Email sets - groups of emails uploaded together or manually organized
export const emailSets = pgTable("email_sets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  emailCount: integer("email_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Raw emails storage
export const emails = pgTable("emails", {
  id: text("id").primaryKey(),
  contentHash: text("content_hash").unique(), // SHA-256 hash of raw content for deduplication
  setId: text("set_id").references(() => emailSets.id), // Optional set membership
  filename: text("filename").notNull(),

  // Structured header fields (extracted via mailparser, not AI)
  subject: text("subject"),
  sender: text("sender"), // Email address from From header
  senderName: text("sender_name"), // Display name from From header
  recipient: text("recipient"), // Email address from To header
  recipientName: text("recipient_name"), // Display name from To header
  cc: text("cc"), // CC recipients (comma-separated addresses)
  replyTo: text("reply_to"), // Reply-To address
  messageId: text("message_id"), // Unique Message-ID header
  inReplyTo: text("in_reply_to"), // In-Reply-To header for threading

  // Date/time fields
  date: timestamp("date"), // Date header (when email was composed)
  receivedAt: timestamp("received_at"), // First Received header (when server received it)

  // Body content
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  rawContent: text("raw_content"), // Original .eml file content

  // Legacy headers JSON (for any additional headers not in structured columns)
  headers: jsonb("headers").$type<Record<string, string>>(),

  // Extraction status and results
  extractionStatus: extractionStatusEnum("extraction_status")
    .default("pending")
    .notNull(),
  extractionError: text("extraction_error"),
  rawExtraction: jsonb("raw_extraction").$type<Record<string, unknown>>(),
  skipReason: text("skip_reason"), // Why email was skipped (e.g., "marketing")
  informationalNotes: text("informational_notes"), // AI explanation for non-transactional emails
  winnerTransactionId: text("winner_transaction_id"), // User-selected canonical transaction
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
});

// Unified transactions table
export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  type: transactionTypeEnum("type").notNull(),
  accountId: text("account_id").references(() => accounts.id),
  toAccountId: text("to_account_id").references(() => accounts.id), // For transfers
  date: timestamp("date").notNull(),
  amount: decimal("amount", { precision: 18, scale: 4 }),
  currency: text("currency").default("USD"),
  description: text("description"), // Transaction description

  // Security/symbol fields
  symbol: text("symbol"), // Stock/option symbol (called "security" in some systems)
  category: text("category"), // Transaction category

  // Quantity fields
  quantity: decimal("quantity", { precision: 18, scale: 6 }),
  quantityExecuted: decimal("quantity_executed", { precision: 18, scale: 6 }),
  quantityRemaining: decimal("quantity_remaining", { precision: 18, scale: 6 }),

  // Price fields
  price: decimal("price", { precision: 18, scale: 4 }),
  executionPrice: decimal("execution_price", { precision: 18, scale: 4 }),
  priceType: text("price_type"), // market, limit, stop, etc.
  limitPrice: decimal("limit_price", { precision: 18, scale: 4 }),

  // Fees
  fees: decimal("fees", { precision: 18, scale: 4 }),

  // Options-specific
  contractSize: integer("contract_size"),
  optionType: text("option_type"), // 'call' or 'put'
  strikePrice: decimal("strike_price", { precision: 18, scale: 4 }),
  expirationDate: text("expiration_date"), // ISO date string (YYYY-MM-DD)
  optionAction: text("option_action"), // buy_to_open, sell_to_close, assigned, etc.
  securityName: text("security_name"), // Full security name (e.g., INTEL CORP)

  // RSU/Stock grant fields
  grantNumber: text("grant_number"),
  vestDate: text("vest_date"), // ISO date string (YYYY-MM-DD)

  // Order tracking
  orderId: text("order_id"), // External order reference
  orderType: text("order_type"), // buy, sell, short, cover, etc.
  orderQuantity: decimal("order_quantity", { precision: 18, scale: 6 }),
  orderPrice: decimal("order_price", { precision: 18, scale: 4 }),
  orderStatus: text("order_status"), // pending, filled, partial, cancelled, etc.
  timeInForce: text("time_in_force"), // day, gtc, ioc, fok, etc.
  referenceNumber: text("reference_number"), // Transaction/order reference number
  partiallyExecuted: boolean("partially_executed").default(false),
  executionTime: text("execution_time"), // Time of execution

  // Type-specific data stored as JSON
  data: jsonb("data").$type<Record<string, unknown>>(),
  unclassifiedData: jsonb("unclassified_data").$type<Record<string, unknown>>(), // Fields LLM couldn't map

  // Provenance
  sourceEmailId: text("source_email_id").references(() => emails.id),
  extractionRunId: text("extraction_run_id"), // Links to the extraction run that created this
  runCompleted: boolean("run_completed").default(false), // True when the extraction run fully completed
  confidence: decimal("confidence", { precision: 3, scale: 2 }), // AI confidence
  llmModel: text("llm_model"), // Which LLM model extracted this
  sourceTransactionId: text("source_transaction_id"), // For synthesized runs, the original transaction this was copied from

  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Field mapping configuration - canonical names and their aliases
export const fieldMappings = pgTable("field_mappings", {
  id: text("id").primaryKey(),
  canonicalName: text("canonical_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  aliases: jsonb("aliases").$type<string[]>().default([]),
  transactionTypes: jsonb("transaction_types").$type<string[]>(), // Which types this applies to
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Discovered fields - raw fields found during extraction, pending mapping
export const discoveredFields = pgTable("discovered_fields", {
  id: text("id").primaryKey(),
  fieldName: text("field_name").notNull(),
  sampleValues: jsonb("sample_values").$type<string[]>().default([]),
  occurrenceCount: integer("occurrence_count").default(0),
  transactionTypes: jsonb("transaction_types").$type<string[]>().default([]),
  mappedTo: text("mapped_to").references(() => fieldMappings.id),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Extraction error logs for debugging
export const extractionLogs = pgTable("extraction_logs", {
  id: text("id").primaryKey(),
  emailId: text("email_id").references(() => emails.id),
  jobId: text("job_id").references(() => jobs.id),
  level: text("level").notNull(), // "error", "warning", "info"
  message: text("message").notNull(),
  errorType: text("error_type"), // "schema_validation", "api_error", "parse_error", etc.
  stackTrace: text("stack_trace"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Background jobs for batch processing
export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  type: text("type").notNull(), // "email_scan", "extraction", "reprocess"
  status: jobStatusEnum("status").default("pending").notNull(),
  totalItems: integer("total_items").default(0),
  processedItems: integer("processed_items").default(0),
  failedItems: integer("failed_items").default(0),
  skippedItems: integer("skipped_items").default(0),
  informationalItems: integer("informational_items").default(0),
  errorMessage: text("error_message"),
  cancelNotes: text("cancel_notes"), // User notes when job was cancelled
  metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  cancelledAt: timestamp("cancelled_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Prompts - reusable extraction prompts with optional custom JSON schema
export const prompts = pgTable("prompts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(), // User-friendly name (e.g., "Default Financial Extraction")
  description: text("description"), // What this prompt is for
  content: text("content").notNull(), // The actual prompt text
  jsonSchema: jsonb("json_schema").$type<Record<string, unknown>>(), // Custom JSON Schema for extraction output (null uses default)
  isDefault: boolean("is_default").default(false), // Is this the default prompt?
  isActive: boolean("is_active").default(true), // Can this prompt be used?
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Extraction runs - immutable snapshots of extraction results
export const extractionRuns = pgTable("extraction_runs", {
  id: text("id").primaryKey(),
  jobId: text("job_id").references(() => jobs.id),
  setId: text("set_id").references(() => emailSets.id).notNull(), // Which set was extracted
  version: integer("version").notNull(), // Auto-incrementing version number
  name: text("name"), // Optional user-friendly name
  description: text("description"), // Notes about this run
  modelId: text("model_id").notNull(), // Which AI model was used
  promptId: text("prompt_id").references(() => prompts.id).notNull(), // Which prompt was used
  softwareVersion: text("software_version").notNull(), // Which version of our software was used
  emailsProcessed: integer("emails_processed").default(0),
  transactionsCreated: integer("transactions_created").default(0),
  informationalCount: integer("informational_count").default(0),
  errorCount: integer("error_count").default(0),
  config: jsonb("config").$type<Record<string, unknown>>(), // Extraction config used
  stats: jsonb("stats").$type<{
    byType: Record<string, number>;
    avgConfidence: number;
    processingTimeMs: number;
    isResume?: boolean; // Whether this run was resumed from a failed state
    resumedAt?: number; // Timestamp when resume was initiated
    canResume?: boolean; // Whether this run can be resumed (has remaining emails)
  }>(),
  status: text("status").default("running"), // running, completed, failed
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),

  // Synthesized run fields
  isSynthesized: boolean("is_synthesized").default(false),
  synthesisType: text("synthesis_type"), // 'comparison_winners', 'data_flatten'
  sourceRunIds: jsonb("source_run_ids").$type<string[]>().default([]), // Array of run IDs this was synthesized from
  // Note: primaryRunId is stored in config JSON, not as a column (it's always in sourceRunIds)
});

// Email Extractions - tracks each extraction attempt for each email
// This allows us to track multiple extraction runs on the same email and compare results
export const emailExtractions = pgTable("email_extractions", {
  id: text("id").primaryKey(),
  emailId: text("email_id").references(() => emails.id).notNull(),
  runId: text("run_id").references(() => extractionRuns.id).notNull(),

  // Extraction result
  status: extractionStatusEnum("status").notNull(), // completed, failed, skipped, informational

  // Raw AI response (full extraction data including all transactions)
  rawExtraction: jsonb("raw_extraction").$type<{
    isTransactional: boolean;
    emailType: string;
    transactions: Array<Record<string, unknown>>;
    extractionNotes?: string;
    skipReason?: string;
    informationalNotes?: string;
    discussionSummary?: string | null;
    relatedReferenceNumbers?: string[];
  }>(),

  // Metrics
  confidence: decimal("confidence", { precision: 3, scale: 2 }), // Overall confidence
  processingTimeMs: integer("processing_time_ms"), // Processing duration

  // Transaction IDs created from this extraction (for easy lookup)
  transactionIds: jsonb("transaction_ids").$type<string[]>().default([]),

  // Error details if failed
  error: text("error"),

  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Discussion summaries - extracted summaries for evidence/discussion emails
export const discussionSummaries = pgTable("discussion_summaries", {
  id: text("id").primaryKey(),
  emailId: text("email_id").references(() => emails.id).notNull(),
  runId: text("run_id").references(() => extractionRuns.id).notNull(),
  summary: text("summary").notNull(),
  // External reference/confirmation numbers from the email (not database transaction IDs)
  relatedReferenceNumbers: jsonb("related_reference_numbers").$type<string[]>().default([]),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Relations
export const accountCorpusRelations = relations(accountCorpus, ({ many }) => ({
  accounts: many(accounts),
}));

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  corpus: one(accountCorpus, {
    fields: [accounts.corpusId],
    references: [accountCorpus.id],
  }),
  transactionsFrom: many(transactions, { relationName: "fromAccount" }),
  transactionsTo: many(transactions, { relationName: "toAccount" }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  account: one(accounts, {
    fields: [transactions.accountId],
    references: [accounts.id],
    relationName: "fromAccount",
  }),
  toAccount: one(accounts, {
    fields: [transactions.toAccountId],
    references: [accounts.id],
    relationName: "toAccount",
  }),
  sourceEmail: one(emails, {
    fields: [transactions.sourceEmailId],
    references: [emails.id],
  }),
  extractionRun: one(extractionRuns, {
    fields: [transactions.extractionRunId],
    references: [extractionRuns.id],
  }),
}));

export const extractionRunsRelations = relations(extractionRuns, ({ one, many }) => ({
  job: one(jobs, {
    fields: [extractionRuns.jobId],
    references: [jobs.id],
  }),
  set: one(emailSets, {
    fields: [extractionRuns.setId],
    references: [emailSets.id],
  }),
  transactions: many(transactions),
  discussionSummaries: many(discussionSummaries),
}));

export const emailSetsRelations = relations(emailSets, ({ many }) => ({
  emails: many(emails),
  extractionRuns: many(extractionRuns),
}));

export const emailsRelations = relations(emails, ({ one, many }) => ({
  set: one(emailSets, {
    fields: [emails.setId],
    references: [emailSets.id],
  }),
  transactions: many(transactions),
  extractions: many(emailExtractions),
  discussionSummaries: many(discussionSummaries),
  winnerTransaction: one(transactions, {
    fields: [emails.winnerTransactionId],
    references: [transactions.id],
  }),
}));

export const emailExtractionsRelations = relations(emailExtractions, ({ one }) => ({
  email: one(emails, {
    fields: [emailExtractions.emailId],
    references: [emails.id],
  }),
  run: one(extractionRuns, {
    fields: [emailExtractions.runId],
    references: [extractionRuns.id],
  }),
}));

export const discussionSummariesRelations = relations(discussionSummaries, ({ one }) => ({
  email: one(emails, {
    fields: [discussionSummaries.emailId],
    references: [emails.id],
  }),
  run: one(extractionRuns, {
    fields: [discussionSummaries.runId],
    references: [extractionRuns.id],
  }),
}));

// Type exports for use in application code
export type AccountCorpus = typeof accountCorpus.$inferSelect;
export type NewAccountCorpus = typeof accountCorpus.$inferInsert;
export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type Email = typeof emails.$inferSelect;
export type NewEmail = typeof emails.$inferInsert;
export type Transaction = typeof transactions.$inferSelect;
export type NewTransaction = typeof transactions.$inferInsert;
export type FieldMapping = typeof fieldMappings.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type CorpusSuggestion = typeof corpusSuggestions.$inferSelect;
export type ExtractionLog = typeof extractionLogs.$inferSelect;
export type NewExtractionLog = typeof extractionLogs.$inferInsert;
export type ExtractionRun = typeof extractionRuns.$inferSelect;
export type NewExtractionRun = typeof extractionRuns.$inferInsert;
export type EmailExtraction = typeof emailExtractions.$inferSelect;
export type NewEmailExtraction = typeof emailExtractions.$inferInsert;
export type DiscussionSummary = typeof discussionSummaries.$inferSelect;
export type NewDiscussionSummary = typeof discussionSummaries.$inferInsert;
export type EmailSet = typeof emailSets.$inferSelect;
export type NewEmailSet = typeof emailSets.$inferInsert;
export type AiModel = typeof aiModels.$inferSelect;
export type NewAiModel = typeof aiModels.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
