import { NextResponse } from "next/server";
import { generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
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

// POST /api/models/discover - Discover new models via AI + web search
export async function POST() {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!anthropicKey) {
    return NextResponse.json(
      { error: "Anthropic API key not configured for model discovery" },
      { status: 400 }
    );
  }

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

    // Use Claude to search for and identify new models
    const { text } = await generateText({
      model: anthropic("claude-sonnet-4-20250514"),
      prompt: `You are an AI model expert. I need you to identify the latest AI models from Anthropic, OpenAI, and Google that would be useful for text extraction tasks.

Current models I already have configured:
${Array.from(existingIds).join(", ")}

Please identify any NEW models from these providers that are NOT in my list above. Focus on:
1. Production-ready models (not preview/experimental)
2. Models good for text understanding and extraction
3. Include latest versions and any recent releases

For each new model found, provide:
- id: The exact API model ID (e.g., "claude-3-5-sonnet-20241022", "gpt-4-turbo-2024-04-09", "gemini-1.5-flash")
- provider: "anthropic", "openai", or "google"
- name: Human-readable name
- description: Brief description of capabilities
- inputCostPerMillion: Cost per 1M input tokens in USD
- outputCostPerMillion: Cost per 1M output tokens in USD
- contextWindow: Maximum context window size in tokens
- source: Where you found this information

Return your response as a JSON array. If no new models are found, return an empty array.
Example format:
[
  {
    "id": "model-id",
    "provider": "anthropic",
    "name": "Model Name",
    "description": "Description here",
    "inputCostPerMillion": 3.00,
    "outputCostPerMillion": 15.00,
    "contextWindow": 200000,
    "source": "Anthropic pricing page"
  }
]

Only return the JSON array, no other text.`,
    });

    // Parse the response
    let discoveredModels: DiscoveredModel[] = [];

    try {
      // Extract JSON from response
      const jsonMatch = text.trim().match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        discoveredModels = JSON.parse(jsonMatch[0]);
      }
    } catch (parseError) {
      console.error("Failed to parse discovery response:", parseError);
      return NextResponse.json({ models: [] });
    }

    // Filter out any models that already exist
    const newModels = discoveredModels.filter(m => !existingIds.has(m.id));

    // Validate each model
    const validModels = newModels.filter(m =>
      m.id &&
      m.provider &&
      m.name &&
      ["anthropic", "openai", "google"].includes(m.provider) &&
      typeof m.inputCostPerMillion === "number" &&
      typeof m.outputCostPerMillion === "number" &&
      typeof m.contextWindow === "number"
    );

    return NextResponse.json({ models: validModels });
  } catch (error) {
    console.error("Model discovery failed:", error);
    return NextResponse.json(
      { error: "Failed to discover models. Please try again." },
      { status: 500 }
    );
  }
}
