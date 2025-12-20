/**
 * Model configuration service
 * Defines available models, their costs, and provides utilities for cost estimation
 *
 * NOTE: These are DEFAULT models. If models are stored in the database,
 * those take precedence. Use getModelsFromDB() for the authoritative list.
 */

export type ModelProvider = "anthropic" | "openai" | "google";

export interface ModelConfig {
  id: string;
  provider: ModelProvider;
  name: string;
  description: string;
  inputCostPerMillion: number;  // Cost per 1M input tokens
  outputCostPerMillion: number; // Cost per 1M output tokens
  contextWindow: number;        // Max context window size
  recommended?: boolean;        // Flag for recommended models
  isActive?: boolean;           // Whether model is enabled
}

// Current pricing as of December 2024
// These serve as defaults - database models take precedence
export const AVAILABLE_MODELS: ModelConfig[] = [
  // Anthropic Claude Models
  {
    id: "claude-3-opus-20240229",
    provider: "anthropic",
    name: "Claude 3 Opus",
    description: "Most capable Claude model. Best for complex extractions requiring deep reasoning.",
    inputCostPerMillion: 15.00,
    outputCostPerMillion: 75.00,
    contextWindow: 200000,
  },
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    name: "Claude Sonnet 4",
    description: "Latest Claude Sonnet. Excellent balance of capability and cost.",
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
    contextWindow: 200000,
    recommended: true,
  },
  {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    name: "Claude 3.5 Sonnet",
    description: "Excellent balance of capability and cost. Recommended for most extractions.",
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
    contextWindow: 200000,
  },
  {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    name: "Claude 3.5 Haiku",
    description: "Fast and affordable. Good for simple, high-volume extractions.",
    inputCostPerMillion: 1.00,
    outputCostPerMillion: 5.00,
    contextWindow: 200000,
  },
  // OpenAI Models (GPT-5 series and o1 reasoning)
  {
    id: "gpt-5",
    provider: "openai",
    name: "GPT-5",
    description: "OpenAI's latest flagship model. Exceptional reasoning and extraction.",
    inputCostPerMillion: 5.00,
    outputCostPerMillion: 15.00,
    contextWindow: 128000,
  },
  {
    id: "gpt-5.2",
    provider: "openai",
    name: "GPT-5.2",
    description: "Enhanced GPT-5 with improved structured output. Great for data extraction.",
    inputCostPerMillion: 5.00,
    outputCostPerMillion: 15.00,
    contextWindow: 128000,
  },
  {
    id: "o1",
    provider: "openai",
    name: "o1",
    description: "Advanced reasoning model. Best for complex financial analysis.",
    inputCostPerMillion: 15.00,
    outputCostPerMillion: 60.00,
    contextWindow: 200000,
  },
  {
    id: "o1-mini",
    provider: "openai",
    name: "o1-mini",
    description: "Compact reasoning model. Good balance of reasoning and cost.",
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 12.00,
    contextWindow: 128000,
  },
  // Google Gemini Models
  {
    id: "gemini-2.0-flash",
    provider: "google",
    name: "Gemini 2.0 Flash",
    description: "Google's fastest model. Excellent for high-volume processing.",
    inputCostPerMillion: 0.10,
    outputCostPerMillion: 0.40,
    contextWindow: 1000000,
  },
  {
    id: "gemini-2.0-pro",
    provider: "google",
    name: "Gemini 2.0 Pro",
    description: "Google's most capable model. Strong multimodal understanding.",
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 5.00,
    contextWindow: 2000000,
  },
  {
    id: "gemini-1.5-pro",
    provider: "google",
    name: "Gemini 1.5 Pro",
    description: "Reliable workhorse with massive context window.",
    inputCostPerMillion: 1.25,
    outputCostPerMillion: 5.00,
    contextWindow: 2000000,
  },
];

// Default model for new extractions
export const DEFAULT_MODEL_ID = "claude-sonnet-4-20250514";

/**
 * Get a model configuration by ID
 */
export function getModelConfig(modelId: string): ModelConfig | undefined {
  return AVAILABLE_MODELS.find(m => m.id === modelId);
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: ModelProvider): ModelConfig[] {
  return AVAILABLE_MODELS.filter(m => m.provider === provider);
}

/**
 * Estimate tokens from text content
 * This is a rough estimate - actual tokenization varies by model
 * Uses a conservative estimate of 4 characters per token
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Estimate the cost of processing a single email
 */
export function estimateEmailCost(
  emailContent: string,
  modelId: string
): { inputTokens: number; outputTokens: number; estimatedCost: number } {
  const model = getModelConfig(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  // Estimate input tokens (email content + prompt overhead ~500 tokens)
  const inputTokens = estimateTokens(emailContent) + 500;

  // Estimate output tokens (extraction response is typically 200-500 tokens)
  const outputTokens = 400;

  const estimatedCost =
    (inputTokens / 1_000_000) * model.inputCostPerMillion +
    (outputTokens / 1_000_000) * model.outputCostPerMillion;

  return {
    inputTokens,
    outputTokens,
    estimatedCost,
  };
}

/**
 * Estimate the total cost of processing multiple emails
 */
export function estimateBatchCost(
  emails: Array<{ bodyText?: string | null; bodyHtml?: string | null }>,
  modelId: string
): {
  totalEmails: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedCost: number;
  costPerEmail: number;
} {
  const model = getModelConfig(modelId);
  if (!model) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for (const email of emails) {
    const content = email.bodyText || email.bodyHtml || "";
    const estimate = estimateEmailCost(content, modelId);
    totalInputTokens += estimate.inputTokens;
    totalOutputTokens += estimate.outputTokens;
  }

  const estimatedCost =
    (totalInputTokens / 1_000_000) * model.inputCostPerMillion +
    (totalOutputTokens / 1_000_000) * model.outputCostPerMillion;

  return {
    totalEmails: emails.length,
    totalInputTokens,
    totalOutputTokens,
    estimatedCost,
    costPerEmail: emails.length > 0 ? estimatedCost / emails.length : 0,
  };
}

/**
 * Format cost for display
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Check if a provider has the required API key configured
 */
export function isProviderConfigured(provider: ModelProvider): boolean {
  switch (provider) {
    case "anthropic":
      return !!process.env.ANTHROPIC_API_KEY;
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "google":
      // Google AI SDK uses GOOGLE_GENERATIVE_AI_API_KEY
      return !!(process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
    default:
      return false;
  }
}

/**
 * Check if a model is available (has required API keys)
 */
export function isModelAvailable(modelId: string): boolean {
  const model = getModelConfig(modelId);
  if (!model) return false;
  return isProviderConfigured(model.provider);
}

/**
 * Get list of available models (with API keys configured)
 */
export function getAvailableModels(): ModelConfig[] {
  return AVAILABLE_MODELS.filter(model => isProviderConfigured(model.provider));
}

/**
 * Get all configured providers (those with API keys)
 */
export function getConfiguredProviders(): ModelProvider[] {
  const providers: ModelProvider[] = ["anthropic", "openai", "google"];
  return providers.filter(isProviderConfigured);
}

/**
 * Convert database model to ModelConfig format
 */
export function dbModelToConfig(dbModel: {
  id: string;
  provider: string;
  name: string;
  description: string | null;
  inputCostPerMillion: string;
  outputCostPerMillion: string;
  contextWindow: number;
  isRecommended: boolean | null;
  isActive: boolean | null;
}): ModelConfig {
  return {
    id: dbModel.id,
    provider: dbModel.provider as ModelProvider,
    name: dbModel.name,
    description: dbModel.description || "",
    inputCostPerMillion: parseFloat(dbModel.inputCostPerMillion),
    outputCostPerMillion: parseFloat(dbModel.outputCostPerMillion),
    contextWindow: dbModel.contextWindow,
    recommended: dbModel.isRecommended || false,
    isActive: dbModel.isActive !== false,
  };
}

/**
 * Seed models to database (call this to initialize or update DB models)
 */
export function getDefaultModelsForSeeding(): Array<{
  id: string;
  provider: ModelProvider;
  name: string;
  description: string;
  inputCostPerMillion: string;
  outputCostPerMillion: string;
  contextWindow: number;
  isRecommended: boolean;
  isActive: boolean;
  sortOrder: number;
}> {
  return AVAILABLE_MODELS.map((model, index) => ({
    id: model.id,
    provider: model.provider,
    name: model.name,
    description: model.description,
    inputCostPerMillion: model.inputCostPerMillion.toFixed(4),
    outputCostPerMillion: model.outputCostPerMillion.toFixed(4),
    contextWindow: model.contextWindow,
    isRecommended: model.recommended || false,
    isActive: true,
    sortOrder: index,
  }));
}
