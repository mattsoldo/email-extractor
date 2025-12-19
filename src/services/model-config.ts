/**
 * Model configuration service
 * Defines available models, their costs, and provides utilities for cost estimation
 */

export interface ModelConfig {
  id: string;
  provider: "anthropic" | "openai";
  name: string;
  description: string;
  inputCostPerMillion: number;  // Cost per 1M input tokens
  outputCostPerMillion: number; // Cost per 1M output tokens
  contextWindow: number;        // Max context window size
  recommended?: boolean;        // Flag for recommended models
}

// Current pricing as of December 2024
export const AVAILABLE_MODELS: ModelConfig[] = [
  // Anthropic Claude Models (actual API model IDs)
  {
    id: "claude-sonnet-4-20250514",
    provider: "anthropic",
    name: "Claude Sonnet 4",
    description: "Best balance of speed, accuracy, and cost. Recommended for most extractions.",
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
    contextWindow: 200000,
    recommended: true,
  },
  {
    id: "claude-3-5-sonnet-20241022",
    provider: "anthropic",
    name: "Claude 3.5 Sonnet",
    description: "Previous generation Sonnet. Very capable and cost-effective.",
    inputCostPerMillion: 3.00,
    outputCostPerMillion: 15.00,
    contextWindow: 200000,
  },
  {
    id: "claude-3-5-haiku-20241022",
    provider: "anthropic",
    name: "Claude 3.5 Haiku",
    description: "Fastest and cheapest Claude model. Good for simple emails.",
    inputCostPerMillion: 0.80,
    outputCostPerMillion: 4.00,
    contextWindow: 200000,
  },
  // OpenAI Models (actual API model IDs)
  {
    id: "gpt-4o",
    provider: "openai",
    name: "GPT-4o",
    description: "OpenAI's flagship model. Strong at structured data extraction.",
    inputCostPerMillion: 2.50,
    outputCostPerMillion: 10.00,
    contextWindow: 128000,
  },
  {
    id: "gpt-4o-mini",
    provider: "openai",
    name: "GPT-4o Mini",
    description: "Cost-effective GPT-4 variant. Good balance of performance and price.",
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.60,
    contextWindow: 128000,
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
export function getModelsByProvider(provider: "anthropic" | "openai"): ModelConfig[] {
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
 * Check if a model is available (has required API keys)
 */
export function isModelAvailable(modelId: string): boolean {
  const model = getModelConfig(modelId);
  if (!model) return false;

  if (model.provider === "anthropic") {
    return !!process.env.ANTHROPIC_API_KEY;
  }
  if (model.provider === "openai") {
    return !!process.env.OPENAI_API_KEY;
  }
  return false;
}

/**
 * Get list of available models (with API keys configured)
 */
export function getAvailableModels(): ModelConfig[] {
  return AVAILABLE_MODELS.filter(model => {
    if (model.provider === "anthropic") {
      return !!process.env.ANTHROPIC_API_KEY;
    }
    if (model.provider === "openai") {
      return !!process.env.OPENAI_API_KEY;
    }
    return false;
  });
}
