import { NextResponse } from "next/server";
import { AVAILABLE_MODELS, ModelProvider } from "@/services/model-config";
import { db } from "@/db";
import { aiModels } from "@/db/schema";

interface DiscoveredModel {
  id: string;
  provider: ModelProvider;
  name: string;
  description: string;
  inputCostPerMillion: number;
  outputCostPerMillion: number;
  contextWindow: number;
  source: string;
}

// Known pricing for models (fallback when API doesn't provide it)
const KNOWN_PRICING: Record<string, { input: number; output: number; context: number }> = {
  // Anthropic Claude 4.5 series
  "claude-haiku-4-5-20251001": { input: 1.00, output: 5.00, context: 200000 },
  // Anthropic Claude 4 series
  "claude-opus-4-20250514": { input: 15.00, output: 75.00, context: 200000 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00, context: 200000 },
  // Anthropic Claude 3.5 series
  "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00, context: 200000 },
  "claude-3-5-sonnet-20240620": { input: 3.00, output: 15.00, context: 200000 },
  "claude-3-5-haiku-20241022": { input: 1.00, output: 5.00, context: 200000 },
  // Anthropic Claude 3 series
  "claude-3-opus-20240229": { input: 15.00, output: 75.00, context: 200000 },
  "claude-3-sonnet-20240229": { input: 3.00, output: 15.00, context: 200000 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25, context: 200000 },
  // OpenAI GPT-4o series
  "gpt-4o": { input: 2.50, output: 10.00, context: 128000 },
  "gpt-4o-mini": { input: 0.15, output: 0.60, context: 128000 },
  "gpt-4o-2024-11-20": { input: 2.50, output: 10.00, context: 128000 },
  "gpt-4o-2024-08-06": { input: 2.50, output: 10.00, context: 128000 },
  "gpt-4o-2024-05-13": { input: 5.00, output: 15.00, context: 128000 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.60, context: 128000 },
  // OpenAI GPT-4 Turbo
  "gpt-4-turbo": { input: 10.00, output: 30.00, context: 128000 },
  "gpt-4-turbo-2024-04-09": { input: 10.00, output: 30.00, context: 128000 },
  "gpt-4-turbo-preview": { input: 10.00, output: 30.00, context: 128000 },
  "gpt-4-0125-preview": { input: 10.00, output: 30.00, context: 128000 },
  "gpt-4-1106-preview": { input: 10.00, output: 30.00, context: 128000 },
  // OpenAI GPT-4 (original)
  "gpt-4": { input: 30.00, output: 60.00, context: 8192 },
  "gpt-4-0613": { input: 30.00, output: 60.00, context: 8192 },
  "gpt-4-32k": { input: 60.00, output: 120.00, context: 32768 },
  // OpenAI o1/o3 reasoning
  "o1": { input: 15.00, output: 60.00, context: 200000 },
  "o1-mini": { input: 3.00, output: 12.00, context: 128000 },
  "o1-preview": { input: 15.00, output: 60.00, context: 128000 },
  "o1-preview-2024-09-12": { input: 15.00, output: 60.00, context: 128000 },
  "o1-mini-2024-09-12": { input: 3.00, output: 12.00, context: 128000 },
  "o3": { input: 10.00, output: 40.00, context: 200000 },
  "o3-mini": { input: 1.10, output: 4.40, context: 200000 },
  "o3-mini-2025-01-31": { input: 1.10, output: 4.40, context: 200000 },
  // OpenAI o4 reasoning (estimated)
  "o4-mini": { input: 1.10, output: 4.40, context: 200000 },
  // OpenAI GPT-4.5
  "gpt-4.5-preview": { input: 75.00, output: 150.00, context: 128000 },
  "gpt-4.5-preview-2025-02-27": { input: 75.00, output: 150.00, context: 128000 },
  // OpenAI ChatGPT
  "chatgpt-4o-latest": { input: 5.00, output: 15.00, context: 128000 },
  // Google Gemini 2.x
  "gemini-2.0-flash": { input: 0.10, output: 0.40, context: 1000000 },
  "gemini-2.0-flash-exp": { input: 0.10, output: 0.40, context: 1000000 },
  "gemini-2.0-flash-lite": { input: 0.02, output: 0.10, context: 1000000 },
  "gemini-2.0-pro": { input: 1.25, output: 5.00, context: 2000000 },
  "gemini-2.0-pro-exp": { input: 1.25, output: 5.00, context: 2000000 },
  // Google Gemini 2.5
  "gemini-2.5-pro": { input: 1.25, output: 10.00, context: 1000000 },
  "gemini-2.5-pro-preview-06-05": { input: 1.25, output: 10.00, context: 1000000 },
  "gemini-2.5-pro-exp-03-25": { input: 1.25, output: 10.00, context: 1000000 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60, context: 1000000 },
  "gemini-2.5-flash-preview-05-20": { input: 0.15, output: 0.60, context: 1000000 },
  "gemini-2.5-flash-lite": { input: 0.02, output: 0.10, context: 1000000 },
  // Google Gemini 1.5
  "gemini-1.5-pro": { input: 1.25, output: 5.00, context: 2000000 },
  "gemini-1.5-pro-latest": { input: 1.25, output: 5.00, context: 2000000 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30, context: 1000000 },
  "gemini-1.5-flash-latest": { input: 0.075, output: 0.30, context: 1000000 },
  "gemini-1.5-flash-8b": { input: 0.0375, output: 0.15, context: 1000000 },
  // Google Gemini 1.0
  "gemini-1.0-pro": { input: 0.50, output: 1.50, context: 32000 },
  "gemini-pro": { input: 0.50, output: 1.50, context: 32000 },
};

// Infer pricing based on model name patterns when exact match isn't found
function inferAnthropicPricing(modelId: string): { input: number; output: number; context: number } {
  // Check for exact match first
  if (KNOWN_PRICING[modelId]) {
    return KNOWN_PRICING[modelId];
  }

  // Pattern-based inference for Anthropic models
  const lowerModel = modelId.toLowerCase();

  if (lowerModel.includes("opus")) {
    // Opus models are the most capable and expensive
    return { input: 15.00, output: 75.00, context: 200000 };
  }

  if (lowerModel.includes("sonnet")) {
    // Sonnet models are mid-tier
    return { input: 3.00, output: 15.00, context: 200000 };
  }

  if (lowerModel.includes("haiku")) {
    // Haiku models are the cheapest/fastest
    // Claude 4.5 Haiku
    if (lowerModel.includes("4-5") || lowerModel.includes("4.5")) {
      return { input: 0.80, output: 4.00, context: 200000 };
    }
    // Claude 3.5 Haiku
    if (lowerModel.includes("3-5") || lowerModel.includes("3.5")) {
      return { input: 1.00, output: 5.00, context: 200000 };
    }
    // Claude 3 Haiku is even cheaper
    return { input: 0.25, output: 1.25, context: 200000 };
  }

  // Default fallback for unknown Anthropic models - assume mid-tier
  return { input: 3.00, output: 15.00, context: 200000 };
}

function inferOpenAIPricing(modelId: string): { input: number; output: number; context: number } {
  // Check for exact match first
  if (KNOWN_PRICING[modelId]) {
    return KNOWN_PRICING[modelId];
  }

  const lowerModel = modelId.toLowerCase();

  // GPT-4.5 (most expensive)
  if (lowerModel.includes("gpt-4.5")) {
    return { input: 75.00, output: 150.00, context: 128000 };
  }

  // o4 reasoning models (future)
  if (lowerModel.startsWith("o4")) {
    if (lowerModel.includes("mini")) {
      return { input: 1.10, output: 4.40, context: 200000 };
    }
    return { input: 10.00, output: 40.00, context: 200000 };
  }

  // o3 reasoning models
  if (lowerModel.startsWith("o3")) {
    if (lowerModel.includes("mini")) {
      return { input: 1.10, output: 4.40, context: 200000 };
    }
    return { input: 10.00, output: 40.00, context: 200000 };
  }

  // o1 reasoning models
  if (lowerModel.startsWith("o1")) {
    if (lowerModel.includes("mini")) {
      return { input: 3.00, output: 12.00, context: 128000 };
    }
    return { input: 15.00, output: 60.00, context: 200000 };
  }

  // GPT-4o models
  if (lowerModel.includes("gpt-4o")) {
    if (lowerModel.includes("mini")) {
      return { input: 0.15, output: 0.60, context: 128000 };
    }
    return { input: 2.50, output: 10.00, context: 128000 };
  }

  // GPT-4 turbo
  if (lowerModel.includes("gpt-4-turbo") || lowerModel.includes("gpt-4-0125") || lowerModel.includes("gpt-4-1106")) {
    return { input: 10.00, output: 30.00, context: 128000 };
  }

  // GPT-4 32k
  if (lowerModel.includes("gpt-4-32k")) {
    return { input: 60.00, output: 120.00, context: 32768 };
  }

  // GPT-4 base
  if (lowerModel.startsWith("gpt-4")) {
    return { input: 30.00, output: 60.00, context: 8192 };
  }

  // ChatGPT models
  if (lowerModel.includes("chatgpt")) {
    return { input: 5.00, output: 15.00, context: 128000 };
  }

  // GPT-5 (future) - estimate based on expected pricing tier
  if (lowerModel.includes("gpt-5")) {
    if (lowerModel.includes("mini")) {
      return { input: 1.00, output: 4.00, context: 128000 };
    }
    return { input: 20.00, output: 80.00, context: 200000 };
  }

  // Default fallback for unknown OpenAI models
  return { input: 5.00, output: 15.00, context: 128000 };
}

function inferGeminiPricing(modelId: string): { input: number; output: number; context: number } {
  // Check for exact match first
  if (KNOWN_PRICING[modelId]) {
    return KNOWN_PRICING[modelId];
  }

  const lowerModel = modelId.toLowerCase();

  // Flash-lite models (cheapest)
  if (lowerModel.includes("flash-lite") || lowerModel.includes("flash-8b")) {
    return { input: 0.02, output: 0.10, context: 1000000 };
  }

  // Flash models (cheap and fast)
  if (lowerModel.includes("flash")) {
    // Gemini 2.5 flash is slightly more expensive
    if (lowerModel.includes("2.5")) {
      return { input: 0.15, output: 0.60, context: 1000000 };
    }
    // Gemini 2.0 flash
    if (lowerModel.includes("2.0")) {
      return { input: 0.10, output: 0.40, context: 1000000 };
    }
    // Gemini 1.5 flash
    return { input: 0.075, output: 0.30, context: 1000000 };
  }

  // Pro models (more capable)
  if (lowerModel.includes("pro")) {
    // Gemini 2.5 pro has higher output cost
    if (lowerModel.includes("2.5")) {
      return { input: 1.25, output: 10.00, context: 1000000 };
    }
    // Gemini 2.0 and 1.5 pro
    if (lowerModel.includes("2.0") || lowerModel.includes("1.5")) {
      return { input: 1.25, output: 5.00, context: 2000000 };
    }
    // Gemini 1.0 pro
    return { input: 0.50, output: 1.50, context: 32000 };
  }

  // Ultra models (most capable)
  if (lowerModel.includes("ultra")) {
    return { input: 5.00, output: 15.00, context: 1000000 };
  }

  // Default fallback - assume flash-tier pricing
  return { input: 0.10, output: 0.40, context: 1000000 };
}

// Known models that should always be available for discovery
// These are models we know exist but might not appear in API listings
const KNOWN_ANTHROPIC_MODELS = [
  "claude-opus-4-20250514",
  "claude-sonnet-4-20250514",
  "claude-haiku-4-5-20251001",
  "claude-3-5-sonnet-20241022",
  "claude-3-5-haiku-20241022",
  "claude-3-opus-20240229",
  "claude-3-sonnet-20240229",
  "claude-3-haiku-20240307",
];

const KNOWN_OPENAI_MODELS = [
  "gpt-4o",
  "gpt-4o-mini",
  "gpt-4o-2024-11-20",
  "gpt-4-turbo",
  "gpt-4.5-preview",
  "o1",
  "o1-mini",
  "o1-preview",
  "o3",
  "o3-mini",
  "o4-mini",
];

const KNOWN_GEMINI_MODELS = [
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
  "gemini-2.0-pro",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
];

// Fetch models from OpenAI API
async function fetchOpenAIModels(apiKey: string): Promise<DiscoveredModel[]> {
  const models: DiscoveredModel[] = [];
  const seenIds = new Set<string>();

  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (response.ok) {
      const data = await response.json();

      // Expanded prefixes to catch more models including future ones
      const relevantPrefixes = ["gpt-4", "gpt-5", "gpt-6", "o1", "o2", "o3", "o4", "o5", "chatgpt"];
      // Also match by pattern for reasoning models
      const relevantPatterns = [/^o\d+/, /^gpt-\d/];

      for (const model of data.data || []) {
        const id = model.id;

        // Skip fine-tuned, audio, and utility models
        if (id.includes(":ft-") || id.includes("-audio") || id.includes("realtime") ||
            id.includes("tts") || id.includes("whisper") || id.includes("dall-e") ||
            id.includes("embedding") || id.includes("babbage") || id.includes("davinci") ||
            id.includes("curie") || id.includes("ada") || id.includes("moderation")) {
          continue;
        }

        // Check if it's a relevant model by prefix or pattern
        const isRelevant = relevantPrefixes.some(prefix => id.startsWith(prefix)) ||
                          relevantPatterns.some(pattern => pattern.test(id));
        if (!isRelevant) continue;

        seenIds.add(id);
        const pricing = inferOpenAIPricing(id);

        models.push({
          id,
          provider: "openai",
          name: formatModelName(id, "openai"),
          description: `OpenAI ${formatModelName(id, "openai")} model`,
          inputCostPerMillion: pricing.input,
          outputCostPerMillion: pricing.output,
          contextWindow: pricing.context,
          source: "OpenAI API",
        });
      }
    } else {
      console.error("OpenAI API error:", response.status);
    }
  } catch (error) {
    console.error("Failed to fetch OpenAI models:", error);
  }

  // Add known models that weren't returned by the API
  for (const id of KNOWN_OPENAI_MODELS) {
    if (!seenIds.has(id)) {
      const pricing = inferOpenAIPricing(id);
      models.push({
        id,
        provider: "openai",
        name: formatModelName(id, "openai"),
        description: `OpenAI ${formatModelName(id, "openai")} model`,
        inputCostPerMillion: pricing.input,
        outputCostPerMillion: pricing.output,
        contextWindow: pricing.context,
        source: "Known Model",
      });
    }
  }

  return models;
}

// Fetch models from Anthropic API with pagination support
async function fetchAnthropicModels(apiKey: string): Promise<DiscoveredModel[]> {
  const models: DiscoveredModel[] = [];
  const seenIds = new Set<string>();

  try {
    let hasMore = true;
    let afterId: string | undefined;

    while (hasMore) {
      const url = new URL("https://api.anthropic.com/v1/models");
      url.searchParams.set("limit", "100");
      if (afterId) {
        url.searchParams.set("after_id", afterId);
      }

      const response = await fetch(url.toString(), {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2024-10-22",
        },
      });

      if (!response.ok) {
        console.error("Anthropic API error:", response.status);
        break;
      }

      const data = await response.json();
      const modelList = data.data || [];

      for (const model of modelList) {
        const id = model.id;

        // Skip if not a claude model
        if (!id.startsWith("claude")) continue;

        seenIds.add(id);
        const pricing = inferAnthropicPricing(id);

        models.push({
          id,
          provider: "anthropic",
          name: formatModelName(id, "anthropic"),
          description: model.display_name || `Anthropic ${formatModelName(id, "anthropic")} model`,
          inputCostPerMillion: pricing.input,
          outputCostPerMillion: pricing.output,
          contextWindow: pricing.context,
          source: "Anthropic API",
        });
      }

      // Check for more pages
      hasMore = data.has_more === true;
      if (hasMore && modelList.length > 0) {
        afterId = modelList[modelList.length - 1].id;
      } else {
        hasMore = false;
      }
    }
  } catch (error) {
    console.error("Failed to fetch Anthropic models:", error);
  }

  // Add known models that weren't returned by the API
  for (const id of KNOWN_ANTHROPIC_MODELS) {
    if (!seenIds.has(id)) {
      const pricing = inferAnthropicPricing(id);
      models.push({
        id,
        provider: "anthropic",
        name: formatModelName(id, "anthropic"),
        description: `Anthropic ${formatModelName(id, "anthropic")} model`,
        inputCostPerMillion: pricing.input,
        outputCostPerMillion: pricing.output,
        contextWindow: pricing.context,
        source: "Known Model",
      });
    }
  }

  return models;
}

// Fetch models from Google Gemini API with pagination support
async function fetchGeminiModels(apiKey: string): Promise<DiscoveredModel[]> {
  const models: DiscoveredModel[] = [];
  const seenIds = new Set<string>();

  try {
    let pageToken: string | undefined;

    do {
      const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("pageSize", "100");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }

      const response = await fetch(url.toString());

      if (!response.ok) {
        console.error("Gemini API error:", response.status);
        break;
      }

      const data = await response.json();

      for (const model of data.models || []) {
        // Model name is like "models/gemini-1.5-pro"
        const fullName = model.name || "";
        const id = fullName.replace("models/", "");

        // Skip non-gemini models or embedding models
        if (!id.startsWith("gemini") || id.includes("embedding") || id.includes("aqa")) {
          continue;
        }

        seenIds.add(id);
        const pricing = inferGeminiPricing(id);

        // Get context window from API if available
        const contextWindow = model.inputTokenLimit || pricing.context;

        models.push({
          id,
          provider: "google",
          name: model.displayName || formatModelName(id, "google"),
          description: model.description || `Google ${formatModelName(id, "google")} model`,
          inputCostPerMillion: pricing.input,
          outputCostPerMillion: pricing.output,
          contextWindow,
          source: "Google AI API",
        });
      }

      pageToken = data.nextPageToken;
    } while (pageToken);
  } catch (error) {
    console.error("Failed to fetch Gemini models:", error);
  }

  // Add known models that weren't returned by the API
  for (const id of KNOWN_GEMINI_MODELS) {
    if (!seenIds.has(id)) {
      const pricing = inferGeminiPricing(id);
      models.push({
        id,
        provider: "google",
        name: formatModelName(id, "google"),
        description: `Google ${formatModelName(id, "google")} model`,
        inputCostPerMillion: pricing.input,
        outputCostPerMillion: pricing.output,
        contextWindow: pricing.context,
        source: "Known Model",
      });
    }
  }

  return models;
}

// Format model ID into a readable name
function formatModelName(id: string, provider: ModelProvider): string {
  if (provider === "anthropic") {
    // claude-3-5-sonnet-20241022 -> Claude 3.5 Sonnet
    return id
      .replace("claude-", "Claude ")
      .replace(/-(\d{8})$/, "")
      .replace(/-/g, " ")
      .replace(/(\d) (\d)/g, "$1.$2")
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  if (provider === "openai") {
    // gpt-4o-mini -> GPT-4o Mini
    return id
      .replace("gpt-", "GPT-")
      .replace(/-(\d{4}-\d{2}-\d{2})$/, "")
      .split("-")
      .map((word, i) => i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  if (provider === "google") {
    // gemini-1.5-pro -> Gemini 1.5 Pro
    return id
      .replace("gemini-", "Gemini ")
      .replace(/-/g, " ")
      .split(" ")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  return id;
}

// POST /api/models/discover - Discover new models from provider APIs
export async function POST() {
  try {
    // Get existing model IDs
    const existingIds = new Set(AVAILABLE_MODELS.map(m => m.id));

    // Also check database
    try {
      const dbModels = await db.select().from(aiModels);
      dbModels.forEach(m => existingIds.add(m.id));
    } catch {
      // Table might not exist
    }

    const allDiscovered: DiscoveredModel[] = [];

    // Fetch from each provider that has an API key
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    const fetchPromises: Promise<DiscoveredModel[]>[] = [];

    if (anthropicKey) {
      fetchPromises.push(fetchAnthropicModels(anthropicKey));
    }
    if (openaiKey) {
      fetchPromises.push(fetchOpenAIModels(openaiKey));
    }
    if (geminiKey) {
      fetchPromises.push(fetchGeminiModels(geminiKey));
    }

    if (fetchPromises.length === 0) {
      return NextResponse.json({
        error: "No API keys configured. Add at least one provider API key to discover models.",
        models: [],
      });
    }

    const results = await Promise.all(fetchPromises);
    results.forEach(models => allDiscovered.push(...models));

    // Filter out models that already exist
    const newModels = allDiscovered.filter(m => !existingIds.has(m.id));

    // Sort by provider then name
    newModels.sort((a, b) => {
      if (a.provider !== b.provider) {
        return a.provider.localeCompare(b.provider);
      }
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({ models: newModels });
  } catch (error) {
    console.error("Model discovery failed:", error);
    return NextResponse.json(
      { error: "Failed to discover models. Please try again." },
      { status: 500 }
    );
  }
}
