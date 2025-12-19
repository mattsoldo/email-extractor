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
  // Anthropic Claude 4 series
  "claude-opus-4-20250514": { input: 15.00, output: 75.00, context: 200000 },
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00, context: 200000 },
  // Anthropic Claude 3.5 series
  "claude-3-5-sonnet-20241022": { input: 3.00, output: 15.00, context: 200000 },
  "claude-3-5-haiku-20241022": { input: 1.00, output: 5.00, context: 200000 },
  // OpenAI GPT-4o series
  "gpt-4o": { input: 2.50, output: 10.00, context: 128000 },
  "gpt-4o-mini": { input: 0.15, output: 0.60, context: 128000 },
  "gpt-4o-2024-11-20": { input: 2.50, output: 10.00, context: 128000 },
  // OpenAI o1/o3 reasoning
  "o1": { input: 15.00, output: 60.00, context: 200000 },
  "o1-mini": { input: 3.00, output: 12.00, context: 128000 },
  "o1-preview": { input: 15.00, output: 60.00, context: 128000 },
  "o3-mini": { input: 1.10, output: 4.40, context: 200000 },
  // Google Gemini 2.x
  "gemini-2.0-flash": { input: 0.10, output: 0.40, context: 1000000 },
  "gemini-2.0-flash-exp": { input: 0.10, output: 0.40, context: 1000000 },
  "gemini-2.0-pro-exp": { input: 1.25, output: 5.00, context: 2000000 },
  "gemini-2.5-pro-preview-06-05": { input: 1.25, output: 10.00, context: 1000000 },
  "gemini-2.5-flash-preview-05-20": { input: 0.15, output: 0.60, context: 1000000 },
  // Google Gemini 1.5
  "gemini-1.5-pro": { input: 1.25, output: 5.00, context: 2000000 },
  "gemini-1.5-flash": { input: 0.075, output: 0.30, context: 1000000 },
  // Gemini 3 (anticipated)
  "gemini-3.0-pro": { input: 2.00, output: 8.00, context: 2000000 },
  "gemini-3.0-flash": { input: 0.20, output: 0.80, context: 1000000 },
};

// Fetch models from OpenAI API
async function fetchOpenAIModels(apiKey: string): Promise<DiscoveredModel[]> {
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      console.error("OpenAI API error:", response.status);
      return [];
    }

    const data = await response.json();
    const models: DiscoveredModel[] = [];

    // Filter for relevant models (GPT-4, o1, o3, etc.)
    const relevantPrefixes = ["gpt-4", "gpt-5", "o1", "o3", "chatgpt"];

    for (const model of data.data || []) {
      const id = model.id;

      // Skip fine-tuned, snapshot, and audio models
      if (id.includes(":ft-") || id.includes("-audio") || id.includes("realtime") || id.includes("tts") || id.includes("whisper") || id.includes("dall-e") || id.includes("embedding")) {
        continue;
      }

      // Check if it's a relevant model
      const isRelevant = relevantPrefixes.some(prefix => id.startsWith(prefix));
      if (!isRelevant) continue;

      const pricing = KNOWN_PRICING[id] || { input: 5.00, output: 15.00, context: 128000 };

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

    return models;
  } catch (error) {
    console.error("Failed to fetch OpenAI models:", error);
    return [];
  }
}

// Fetch models from Anthropic API
async function fetchAnthropicModels(apiKey: string): Promise<DiscoveredModel[]> {
  try {
    const response = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
    });

    if (!response.ok) {
      console.error("Anthropic API error:", response.status);
      return [];
    }

    const data = await response.json();
    const models: DiscoveredModel[] = [];

    for (const model of data.data || []) {
      const id = model.id;

      // Skip if not a claude model
      if (!id.startsWith("claude")) continue;

      const pricing = KNOWN_PRICING[id] || { input: 3.00, output: 15.00, context: 200000 };

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

    return models;
  } catch (error) {
    console.error("Failed to fetch Anthropic models:", error);
    return [];
  }
}

// Fetch models from Google Gemini API
async function fetchGeminiModels(apiKey: string): Promise<DiscoveredModel[]> {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    if (!response.ok) {
      console.error("Gemini API error:", response.status);
      return [];
    }

    const data = await response.json();
    const models: DiscoveredModel[] = [];

    for (const model of data.models || []) {
      // Model name is like "models/gemini-1.5-pro"
      const fullName = model.name || "";
      const id = fullName.replace("models/", "");

      // Skip non-gemini models or embedding models
      if (!id.startsWith("gemini") || id.includes("embedding") || id.includes("aqa")) {
        continue;
      }

      const pricing = KNOWN_PRICING[id] || { input: 0.50, output: 1.50, context: 1000000 };

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

    return models;
  } catch (error) {
    console.error("Failed to fetch Gemini models:", error);
    return [];
  }
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
