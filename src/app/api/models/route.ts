import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { emails } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import {
  AVAILABLE_MODELS,
  getAvailableModels,
  estimateBatchCost,
  formatCost,
  DEFAULT_MODEL_ID,
} from "@/services/model-config";

// GET /api/models - List available models and estimate costs
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const setId = searchParams.get("setId");
  const emailIds = searchParams.get("emailIds"); // Comma-separated

  // Get available models (those with API keys)
  const availableModels = getAvailableModels();
  const allModels = AVAILABLE_MODELS.map(model => ({
    ...model,
    available: availableModels.some(m => m.id === model.id),
  }));

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

  return NextResponse.json({
    models: allModels,
    defaultModelId: DEFAULT_MODEL_ID,
    costEstimates,
  });
}
