import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AVAILABLE_MODELS,
  DEFAULT_MODEL_ID,
  getModelConfig,
  getModelsByProvider,
  estimateTokens,
  estimateEmailCost,
  estimateBatchCost,
  formatCost,
  isModelAvailable,
  getAvailableModels,
} from "./model-config";

describe("model-config", () => {
  describe("AVAILABLE_MODELS", () => {
    it("should have at least one model", () => {
      expect(AVAILABLE_MODELS.length).toBeGreaterThan(0);
    });

    it("should have models from both providers", () => {
      const providers = new Set(AVAILABLE_MODELS.map((m) => m.provider));
      expect(providers.has("anthropic")).toBe(true);
      expect(providers.has("openai")).toBe(true);
    });

    it("should have exactly one recommended model", () => {
      const recommended = AVAILABLE_MODELS.filter((m) => m.recommended);
      expect(recommended.length).toBe(1);
    });

    it("should have valid pricing for all models", () => {
      for (const model of AVAILABLE_MODELS) {
        expect(model.inputCostPerMillion).toBeGreaterThan(0);
        expect(model.outputCostPerMillion).toBeGreaterThan(0);
        expect(model.contextWindow).toBeGreaterThan(0);
      }
    });
  });

  describe("DEFAULT_MODEL_ID", () => {
    it("should be a valid model ID", () => {
      const model = getModelConfig(DEFAULT_MODEL_ID);
      expect(model).toBeDefined();
    });

    it("should be the recommended model", () => {
      const model = getModelConfig(DEFAULT_MODEL_ID);
      expect(model?.recommended).toBe(true);
    });
  });

  describe("getModelConfig", () => {
    it("should return model config for valid ID", () => {
      const model = getModelConfig("claude-sonnet-4-5-20251101");
      expect(model).toBeDefined();
      expect(model?.name).toBe("Claude 4.5 Sonnet");
    });

    it("should return undefined for invalid ID", () => {
      const model = getModelConfig("non-existent-model");
      expect(model).toBeUndefined();
    });
  });

  describe("getModelsByProvider", () => {
    it("should return only Anthropic models", () => {
      const models = getModelsByProvider("anthropic");
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === "anthropic")).toBe(true);
    });

    it("should return only OpenAI models", () => {
      const models = getModelsByProvider("openai");
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === "openai")).toBe(true);
    });
  });

  describe("estimateTokens", () => {
    it("should estimate tokens at ~4 chars per token", () => {
      const text = "a".repeat(100);
      expect(estimateTokens(text)).toBe(25);
    });

    it("should round up", () => {
      const text = "a".repeat(101);
      expect(estimateTokens(text)).toBe(26);
    });

    it("should handle empty string", () => {
      expect(estimateTokens("")).toBe(0);
    });

    it("should handle typical email content", () => {
      const email = `
        Subject: Your dividend payment
        Dear Customer,
        Your quarterly dividend of $125.50 has been credited to your account.
        Thank you for your continued investment.
      `;
      const tokens = estimateTokens(email);
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(1000); // Reasonable for a short email
    });
  });

  describe("estimateEmailCost", () => {
    it("should calculate cost for valid model", () => {
      const emailContent = "This is a test email with some content about dividends.";
      const result = estimateEmailCost(emailContent, "claude-sonnet-4-5-20251101");

      expect(result.inputTokens).toBeGreaterThan(500); // Content + 500 overhead
      expect(result.outputTokens).toBe(400); // Fixed estimate
      expect(result.estimatedCost).toBeGreaterThan(0);
    });

    it("should throw for invalid model", () => {
      expect(() => estimateEmailCost("test", "invalid-model")).toThrow("Unknown model");
    });

    it("should include prompt overhead in tokens", () => {
      const result1 = estimateEmailCost("", "claude-sonnet-4-5-20251101");
      expect(result1.inputTokens).toBe(500); // Just the overhead
    });

    it("should cost more for expensive models", () => {
      const email = "Test email content for cost comparison";

      const opusCost = estimateEmailCost(email, "claude-opus-4-5-20251101");
      const haikuCost = estimateEmailCost(email, "claude-haiku-4-5-20251101");

      expect(opusCost.estimatedCost).toBeGreaterThan(haikuCost.estimatedCost);
    });
  });

  describe("estimateBatchCost", () => {
    const testEmails = [
      { bodyText: "Email 1 content about a dividend payment" },
      { bodyText: "Email 2 content about a stock trade" },
      { bodyText: "Email 3 content about a wire transfer" },
    ];

    it("should calculate total cost for batch", () => {
      const result = estimateBatchCost(testEmails, "claude-sonnet-4-5-20251101");

      expect(result.totalEmails).toBe(3);
      expect(result.totalInputTokens).toBeGreaterThan(0);
      expect(result.totalOutputTokens).toBe(400 * 3);
      expect(result.estimatedCost).toBeGreaterThan(0);
      expect(result.costPerEmail).toBe(result.estimatedCost / 3);
    });

    it("should handle empty batch", () => {
      const result = estimateBatchCost([], "claude-sonnet-4-5-20251101");

      expect(result.totalEmails).toBe(0);
      expect(result.estimatedCost).toBe(0);
      expect(result.costPerEmail).toBe(0);
    });

    it("should throw for invalid model", () => {
      expect(() => estimateBatchCost(testEmails, "invalid-model")).toThrow("Unknown model");
    });

    it("should use bodyHtml when bodyText is missing", () => {
      const emailsWithHtml = [
        { bodyHtml: "<p>HTML content here</p>" },
        { bodyText: null, bodyHtml: "<div>More HTML</div>" },
      ];

      const result = estimateBatchCost(emailsWithHtml, "claude-sonnet-4-5-20251101");
      expect(result.totalInputTokens).toBeGreaterThan(1000); // Overhead for 2 emails
    });

    it("should handle emails with no content", () => {
      const emptyEmails = [{ bodyText: null, bodyHtml: null }, {}];

      const result = estimateBatchCost(emptyEmails, "claude-sonnet-4-5-20251101");
      expect(result.totalInputTokens).toBe(1000); // Just overhead (500 * 2)
    });
  });

  describe("formatCost", () => {
    it("should format costs >= $0.01 with 2 decimal places", () => {
      expect(formatCost(0.01)).toBe("$0.01");
      expect(formatCost(1.5)).toBe("$1.50");
      expect(formatCost(10.123)).toBe("$10.12");
    });

    it("should format costs < $0.01 with 4 decimal places", () => {
      expect(formatCost(0.009)).toBe("$0.0090");
      expect(formatCost(0.001)).toBe("$0.0010");
      expect(formatCost(0.0001)).toBe("$0.0001");
    });

    it("should handle zero", () => {
      expect(formatCost(0)).toBe("$0.0000");
    });
  });

  describe("isModelAvailable", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return false for invalid model", () => {
      expect(isModelAvailable("invalid-model")).toBe(false);
    });

    it("should return true for Anthropic model when API key is set", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      expect(isModelAvailable("claude-sonnet-4-5-20251101")).toBe(true);
    });

    it("should return false for Anthropic model when API key is not set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(isModelAvailable("claude-sonnet-4-5-20251101")).toBe(false);
    });

    it("should return true for OpenAI model when API key is set", () => {
      process.env.OPENAI_API_KEY = "test-key";
      expect(isModelAvailable("gpt-5.2")).toBe(true);
    });

    it("should return false for OpenAI model when API key is not set", () => {
      delete process.env.OPENAI_API_KEY;
      expect(isModelAvailable("gpt-5.2")).toBe(false);
    });
  });

  describe("getAvailableModels", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return only models with configured API keys", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      delete process.env.OPENAI_API_KEY;

      const available = getAvailableModels();
      expect(available.every((m) => m.provider === "anthropic")).toBe(true);
    });

    it("should return models from both providers when both keys are set", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";

      const available = getAvailableModels();
      const providers = new Set(available.map((m) => m.provider));
      expect(providers.has("anthropic")).toBe(true);
      expect(providers.has("openai")).toBe(true);
    });

    it("should return empty array when no API keys are set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;

      const available = getAvailableModels();
      expect(available).toEqual([]);
    });
  });
});
