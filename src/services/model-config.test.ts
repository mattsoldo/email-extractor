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
  isProviderConfigured,
  getConfiguredProviders,
} from "./model-config";

describe("model-config", () => {
  describe("AVAILABLE_MODELS", () => {
    it("should have at least one model", () => {
      expect(AVAILABLE_MODELS.length).toBeGreaterThan(0);
    });

    it("should have models from all three providers", () => {
      const providers = new Set(AVAILABLE_MODELS.map((m) => m.provider));
      expect(providers.has("anthropic")).toBe(true);
      expect(providers.has("openai")).toBe(true);
      expect(providers.has("google")).toBe(true);
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

    it("should have Claude 4.5 series models", () => {
      const claudeModels = getModelsByProvider("anthropic");
      const claude45 = claudeModels.filter((m) => m.name.includes("4.5"));
      expect(claude45.length).toBeGreaterThan(0);
    });

    it("should have GPT-5 series models", () => {
      const openaiModels = getModelsByProvider("openai");
      const gpt5 = openaiModels.filter((m) => m.id.includes("gpt-5"));
      expect(gpt5.length).toBeGreaterThan(0);
    });

    it("should have Gemini models", () => {
      const googleModels = getModelsByProvider("google");
      const gemini = googleModels.filter((m) => m.id.includes("gemini"));
      expect(gemini.length).toBeGreaterThan(0);
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
    it("should return model config for valid Claude ID", () => {
      const model = getModelConfig("claude-sonnet-4-5-20241022");
      expect(model).toBeDefined();
      expect(model?.name).toBe("Claude Sonnet 4.5");
    });

    it("should return model config for valid GPT ID", () => {
      const model = getModelConfig("gpt-5");
      expect(model).toBeDefined();
      expect(model?.name).toBe("GPT-5");
    });

    it("should return model config for valid Gemini ID", () => {
      const model = getModelConfig("gemini-2.0-flash");
      expect(model).toBeDefined();
      expect(model?.name).toBe("Gemini 2.0 Flash");
    });

    it("should return undefined for invalid ID", () => {
      const model = getModelConfig("non-existent-model");
      expect(model).toBeUndefined();
    });
  });

  describe("model ID validation", () => {
    it("should use valid Anthropic model ID format", () => {
      const anthropicModels = getModelsByProvider("anthropic");
      // Anthropic model IDs should match claude-{variant}-{version}-{date} pattern
      const validPattern = /^claude-[a-z0-9-]+-\d{8}$/;

      for (const model of anthropicModels) {
        expect(model.id).toMatch(validPattern);
      }
    });

    it("should use valid OpenAI model ID format", () => {
      const openaiModels = getModelsByProvider("openai");
      // OpenAI model IDs should start with gpt- or o1
      for (const model of openaiModels) {
        expect(model.id).toMatch(/^(gpt-|o1)/);
      }
    });

    it("should use valid Google model ID format", () => {
      const googleModels = getModelsByProvider("google");
      // Google model IDs should start with gemini-
      for (const model of googleModels) {
        expect(model.id).toMatch(/^gemini-/);
      }
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

    it("should return only Google models", () => {
      const models = getModelsByProvider("google");
      expect(models.length).toBeGreaterThan(0);
      expect(models.every((m) => m.provider === "google")).toBe(true);
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
    it("should calculate cost for valid Claude model", () => {
      const emailContent = "This is a test email with some content about dividends.";
      const result = estimateEmailCost(emailContent, "claude-sonnet-4-5-20241022");

      expect(result.inputTokens).toBeGreaterThan(500); // Content + 500 overhead
      expect(result.outputTokens).toBe(400); // Fixed estimate
      expect(result.estimatedCost).toBeGreaterThan(0);
    });

    it("should calculate cost for valid Gemini model", () => {
      const emailContent = "This is a test email with some content about dividends.";
      const result = estimateEmailCost(emailContent, "gemini-2.0-flash");

      expect(result.inputTokens).toBeGreaterThan(500);
      expect(result.outputTokens).toBe(400);
      expect(result.estimatedCost).toBeGreaterThan(0);
    });

    it("should throw for invalid model", () => {
      expect(() => estimateEmailCost("test", "invalid-model")).toThrow("Unknown model");
    });

    it("should include prompt overhead in tokens", () => {
      const result1 = estimateEmailCost("", "claude-sonnet-4-5-20241022");
      expect(result1.inputTokens).toBe(500); // Just the overhead
    });

    it("should cost more for expensive models", () => {
      const email = "Test email content for cost comparison";

      // Opus is more expensive than Haiku
      const expensiveCost = estimateEmailCost(email, "claude-opus-4-5-20251101");
      const cheapCost = estimateEmailCost(email, "claude-haiku-4-5-20241022");

      expect(expensiveCost.estimatedCost).toBeGreaterThan(cheapCost.estimatedCost);
    });

    it("should show Gemini Flash as cheapest option", () => {
      const email = "Test email content for cost comparison";

      const geminiFashCost = estimateEmailCost(email, "gemini-2.0-flash");
      const claudeHaikuCost = estimateEmailCost(email, "claude-haiku-4-5-20241022");

      expect(geminiFashCost.estimatedCost).toBeLessThan(claudeHaikuCost.estimatedCost);
    });
  });

  describe("estimateBatchCost", () => {
    const testEmails = [
      { bodyText: "Email 1 content about a dividend payment" },
      { bodyText: "Email 2 content about a stock trade" },
      { bodyText: "Email 3 content about a wire transfer" },
    ];

    it("should calculate total cost for batch", () => {
      const result = estimateBatchCost(testEmails, "claude-sonnet-4-5-20241022");

      expect(result.totalEmails).toBe(3);
      expect(result.totalInputTokens).toBeGreaterThan(0);
      expect(result.totalOutputTokens).toBe(400 * 3);
      expect(result.estimatedCost).toBeGreaterThan(0);
      expect(result.costPerEmail).toBe(result.estimatedCost / 3);
    });

    it("should handle empty batch", () => {
      const result = estimateBatchCost([], "claude-sonnet-4-5-20241022");

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

      const result = estimateBatchCost(emailsWithHtml, "claude-sonnet-4-5-20241022");
      expect(result.totalInputTokens).toBeGreaterThan(1000); // Overhead for 2 emails
    });

    it("should handle emails with no content", () => {
      const emptyEmails = [{ bodyText: null, bodyHtml: null }, {}];

      const result = estimateBatchCost(emptyEmails, "claude-sonnet-4-5-20241022");
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

  describe("isProviderConfigured", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return true for Anthropic when API key is set", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      expect(isProviderConfigured("anthropic")).toBe(true);
    });

    it("should return true for OpenAI when API key is set", () => {
      process.env.OPENAI_API_KEY = "test-key";
      expect(isProviderConfigured("openai")).toBe(true);
    });

    it("should return true for Google when GOOGLE_API_KEY is set", () => {
      process.env.GOOGLE_API_KEY = "test-key";
      expect(isProviderConfigured("google")).toBe(true);
    });

    it("should return true for Google when GEMINI_API_KEY is set", () => {
      delete process.env.GOOGLE_API_KEY;
      process.env.GEMINI_API_KEY = "test-key";
      expect(isProviderConfigured("google")).toBe(true);
    });

    it("should return false when no API key is set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
      expect(isProviderConfigured("anthropic")).toBe(false);
      expect(isProviderConfigured("openai")).toBe(false);
      expect(isProviderConfigured("google")).toBe(false);
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
      expect(isModelAvailable("claude-sonnet-4-5-20241022")).toBe(true);
    });

    it("should return false for Anthropic model when API key is not set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      expect(isModelAvailable("claude-sonnet-4-5-20241022")).toBe(false);
    });

    it("should return true for OpenAI model when API key is set", () => {
      process.env.OPENAI_API_KEY = "test-key";
      expect(isModelAvailable("gpt-5")).toBe(true);
    });

    it("should return false for OpenAI model when API key is not set", () => {
      delete process.env.OPENAI_API_KEY;
      expect(isModelAvailable("gpt-5")).toBe(false);
    });

    it("should return true for Google model when API key is set", () => {
      process.env.GOOGLE_API_KEY = "test-key";
      expect(isModelAvailable("gemini-2.0-flash")).toBe(true);
    });

    it("should return false for Google model when API key is not set", () => {
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;
      expect(isModelAvailable("gemini-2.0-flash")).toBe(false);
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
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const available = getAvailableModels();
      expect(available.every((m) => m.provider === "anthropic")).toBe(true);
    });

    it("should return models from all providers when all keys are set", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";
      process.env.GOOGLE_API_KEY = "test-key";

      const available = getAvailableModels();
      const providers = new Set(available.map((m) => m.provider));
      expect(providers.has("anthropic")).toBe(true);
      expect(providers.has("openai")).toBe(true);
      expect(providers.has("google")).toBe(true);
    });

    it("should return empty array when no API keys are set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.OPENAI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GEMINI_API_KEY;

      const available = getAvailableModels();
      expect(available).toEqual([]);
    });
  });

  describe("getConfiguredProviders", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it("should return only configured providers", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.GOOGLE_API_KEY = "test-key";
      delete process.env.OPENAI_API_KEY;

      const providers = getConfiguredProviders();
      expect(providers).toContain("anthropic");
      expect(providers).toContain("google");
      expect(providers).not.toContain("openai");
    });

    it("should return all providers when all are configured", () => {
      process.env.ANTHROPIC_API_KEY = "test-key";
      process.env.OPENAI_API_KEY = "test-key";
      process.env.GOOGLE_API_KEY = "test-key";

      const providers = getConfiguredProviders();
      expect(providers).toHaveLength(3);
      expect(providers).toContain("anthropic");
      expect(providers).toContain("openai");
      expect(providers).toContain("google");
    });
  });
});
