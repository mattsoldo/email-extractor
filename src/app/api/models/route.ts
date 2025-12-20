import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails, aiModels, AiModel } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  AVAILABLE_MODELS,
  isProviderConfigured,
  estimateBatchCost,
  formatCost,
  DEFAULT_MODEL_ID,
  ModelProvider,
} from "@/services/model-config";

// GET /api/models - List available models and estimate costs
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const setId = searchParams.get("setId");
  const emailIds = searchParams.get("emailIds"); // Comma-separated

  // Get models from database first, fall back to defaults
  let dbModels: AiModel[] = [];
  try {
    dbModels = await db.select().from(aiModels).orderBy(aiModels.sortOrder);
  } catch {
    // Table might not exist yet
  }

  // Create a map of database models by ID
  const dbModelMap = new Map(dbModels.map(m => [m.id, m]));

  // Build the models list, respecting database settings
  const allModels = AVAILABLE_MODELS.map(model => {
    const dbModel = dbModelMap.get(model.id);
    const provider = (dbModel?.provider || model.provider) as ModelProvider;
    const isActive = dbModel ? dbModel.isActive !== false : true; // Default to active if not in DB
    const available = isProviderConfigured(provider);

    return {
      id: dbModel?.id || model.id,
      provider,
      name: dbModel?.name || model.name,
      description: dbModel?.description || model.description,
      inputCostPerMillion: dbModel ? parseFloat(dbModel.inputCostPerMillion) : model.inputCostPerMillion,
      outputCostPerMillion: dbModel ? parseFloat(dbModel.outputCostPerMillion) : model.outputCostPerMillion,
      contextWindow: dbModel?.contextWindow || model.contextWindow,
      recommended: dbModel?.isRecommended || model.recommended || false,
      isActive,
      available,
    };
  });

  // Add any discovered models from DB that aren't in defaults
  for (const dbModel of dbModels) {
    if (!AVAILABLE_MODELS.some(m => m.id === dbModel.id)) {
      const provider = dbModel.provider as ModelProvider;
      allModels.push({
        id: dbModel.id,
        provider,
        name: dbModel.name,
        description: dbModel.description || "",
        inputCostPerMillion: parseFloat(dbModel.inputCostPerMillion),
        outputCostPerMillion: parseFloat(dbModel.outputCostPerMillion),
        contextWindow: dbModel.contextWindow,
        recommended: dbModel.isRecommended || false,
        isActive: dbModel.isActive !== false,
        available: isProviderConfigured(provider),
      });
    }
  }

  // Filter to only active and available models for the dropdown
  const availableModels = allModels.filter(m => m.isActive && m.available);

  // If emailIds or setId provided, estimate costs for pending emails
  let costEstimates: Record<string, {
    totalEmails: number;
    estimatedCost: number;
    costPerEmail: number;
    formattedCost: string;
  }> | null = null;

  if (setId || emailIds) {
    try {
      let targetEmails: Array<{ bodyText: string | null; bodyHtml: string | null }>;

      if (emailIds) {
        // Get specific emails
        const ids = emailIds.split(",").filter(Boolean);
        targetEmails = await db
          .select({ bodyText: emails.bodyText, bodyHtml: emails.bodyHtml })
          .from(emails)
          .where(inArray(emails.id, ids));
      } else if (setId) {
        // Get pending emails in set
        targetEmails = await db
          .select({ bodyText: emails.bodyText, bodyHtml: emails.bodyHtml })
          .from(emails)
          .where(
            and(
              eq(emails.setId, setId),
              eq(emails.extractionStatus, "pending")
            )
          );
      } else {
        targetEmails = [];
      }

      // Estimate costs for each model
      costEstimates = {};
      for (const model of availableModels) {
        const estimate = estimateBatchCost(targetEmails, model.id);
        costEstimates[model.id] = {
          totalEmails: estimate.totalEmails,
          estimatedCost: estimate.estimatedCost,
          costPerEmail: estimate.costPerEmail,
          formattedCost: formatCost(estimate.estimatedCost),
        };
      }
    } catch (error) {
      console.error("Cost estimation error:", error);
    }
  }

  // Find a valid default - preferably the configured default if it's active, otherwise first available
  let effectiveDefaultModelId = DEFAULT_MODEL_ID;
  if (!availableModels.some(m => m.id === DEFAULT_MODEL_ID)) {
    effectiveDefaultModelId = availableModels[0]?.id || DEFAULT_MODEL_ID;
  }

  return NextResponse.json({
    models: availableModels, // Only active + available models for dropdown
    allModels, // All models including inactive ones (for reference)
    defaultModelId: effectiveDefaultModelId,
    costEstimates,
  });
}
