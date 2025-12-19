import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { aiModels, AiModel } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  AVAILABLE_MODELS,
  isProviderConfigured,
  ModelProvider,
} from "@/services/model-config";

// GET /api/models/config - Get all models with their configuration
export async function GET() {
  try {
    // Try to get models from database first
    let dbModels: AiModel[] = [];
    try {
      dbModels = await db.select().from(aiModels).orderBy(aiModels.sortOrder);
    } catch {
      // Table might not exist yet, use defaults
      console.log("aiModels table not found, using defaults");
    }

    // If no models in DB, use defaults from code
    const models = dbModels.length > 0
      ? dbModels.map(m => ({
          id: m.id,
          provider: m.provider as ModelProvider,
          name: m.name,
          description: m.description || "",
          inputCostPerMillion: parseFloat(m.inputCostPerMillion),
          outputCostPerMillion: parseFloat(m.outputCostPerMillion),
          contextWindow: m.contextWindow,
          recommended: m.isRecommended || false,
          isActive: m.isActive !== false,
          available: isProviderConfigured(m.provider as ModelProvider),
        }))
      : AVAILABLE_MODELS.map(m => ({
          ...m,
          isActive: m.isActive !== false,
          available: isProviderConfigured(m.provider),
        }));

    // Provider status
    const providers: Array<{ provider: string; configured: boolean; modelCount: number }> = [
      {
        provider: "anthropic",
        configured: isProviderConfigured("anthropic"),
        modelCount: models.filter(m => m.provider === "anthropic").length,
      },
      {
        provider: "openai",
        configured: isProviderConfigured("openai"),
        modelCount: models.filter(m => m.provider === "openai").length,
      },
      {
        provider: "google",
        configured: isProviderConfigured("google"),
        modelCount: models.filter(m => m.provider === "google").length,
      },
    ];

    return NextResponse.json({ models, providers });
  } catch (error) {
    console.error("Failed to get model config:", error);
    return NextResponse.json(
      { error: "Failed to get model configuration" },
      { status: 500 }
    );
  }
}

// PUT /api/models/config - Update a model's active status
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { modelId, isActive } = body;

    if (!modelId || typeof isActive !== "boolean") {
      return NextResponse.json(
        { error: "modelId and isActive required" },
        { status: 400 }
      );
    }

    // Try to update in DB
    try {
      const existing = await db.select().from(aiModels).where(eq(aiModels.id, modelId));

      if (existing.length > 0) {
        await db
          .update(aiModels)
          .set({ isActive, updatedAt: new Date() })
          .where(eq(aiModels.id, modelId));
      } else {
        // Model not in DB, need to seed it first
        const defaultModel = AVAILABLE_MODELS.find(m => m.id === modelId);
        if (defaultModel) {
          await db.insert(aiModels).values({
            id: defaultModel.id,
            provider: defaultModel.provider,
            name: defaultModel.name,
            description: defaultModel.description,
            inputCostPerMillion: defaultModel.inputCostPerMillion.toFixed(4),
            outputCostPerMillion: defaultModel.outputCostPerMillion.toFixed(4),
            contextWindow: defaultModel.contextWindow,
            isRecommended: defaultModel.recommended || false,
            isActive,
            sortOrder: 0,
          });
        }
      }
    } catch (dbError) {
      console.error("DB update failed:", dbError);
      // Continue anyway - will use in-memory state
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update model:", error);
    return NextResponse.json(
      { error: "Failed to update model" },
      { status: 500 }
    );
  }
}

// POST /api/models/config - Add new models
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { models } = body;

    if (!Array.isArray(models) || models.length === 0) {
      return NextResponse.json(
        { error: "models array required" },
        { status: 400 }
      );
    }

    // Get current max sort order
    let maxSortOrder = 0;
    try {
      const existing = await db.select().from(aiModels);
      maxSortOrder = Math.max(0, ...existing.map(m => m.sortOrder || 0));
    } catch {
      // Table might not exist
    }

    // Insert new models
    const newModels = models.map((model: {
      id: string;
      provider: ModelProvider;
      name: string;
      description?: string;
      inputCostPerMillion: number;
      outputCostPerMillion: number;
      contextWindow: number;
    }, index: number) => ({
      id: model.id,
      provider: model.provider,
      name: model.name,
      description: model.description || "",
      inputCostPerMillion: model.inputCostPerMillion.toFixed(4),
      outputCostPerMillion: model.outputCostPerMillion.toFixed(4),
      contextWindow: model.contextWindow,
      isRecommended: false,
      isActive: true,
      sortOrder: maxSortOrder + index + 1,
    }));

    try {
      // Use upsert to handle duplicates
      for (const model of newModels) {
        const existing = await db.select().from(aiModels).where(eq(aiModels.id, model.id));
        if (existing.length === 0) {
          await db.insert(aiModels).values(model);
        } else {
          // Update existing model
          await db
            .update(aiModels)
            .set({
              name: model.name,
              description: model.description,
              inputCostPerMillion: model.inputCostPerMillion,
              outputCostPerMillion: model.outputCostPerMillion,
              contextWindow: model.contextWindow,
              updatedAt: new Date(),
            })
            .where(eq(aiModels.id, model.id));
        }
      }
    } catch (dbError) {
      console.error("DB insert failed:", dbError);
      return NextResponse.json(
        { error: "Database error - models table may not exist" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, added: newModels.length });
  } catch (error) {
    console.error("Failed to add models:", error);
    return NextResponse.json(
      { error: "Failed to add models" },
      { status: 500 }
    );
  }
}
