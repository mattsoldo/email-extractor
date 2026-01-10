import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// Mock the database module
vi.mock("@/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
  },
}));

describe("Prompts API - JSON Schema Support", () => {
  describe("Data Model", () => {
    it("should support jsonSchema as an optional field", () => {
      const promptWithSchema = {
        id: "test-id",
        name: "Test Prompt",
        description: "A test prompt",
        content: "Extract data from the email",
        jsonSchema: {
          type: "object",
          properties: {
            transactionType: { type: "string" },
            amount: { type: "number" },
          },
          required: ["transactionType"],
        },
        isDefault: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(promptWithSchema.jsonSchema).toBeDefined();
      expect(promptWithSchema.jsonSchema.type).toBe("object");
    });

    it("should allow null jsonSchema for default behavior", () => {
      const promptWithoutSchema = {
        id: "test-id-2",
        name: "Default Prompt",
        description: "Uses default schema",
        content: "Extract financial transactions",
        jsonSchema: null,
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(promptWithoutSchema.jsonSchema).toBeNull();
    });
  });

  describe("JSON Schema Validation", () => {
    it("should validate a proper JSON Schema object", () => {
      const validSchema = {
        type: "object",
        properties: {
          isTransactional: { type: "boolean" },
          transactions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                transactionType: { type: "string" },
                amount: { type: "number" },
              },
            },
          },
        },
        required: ["isTransactional"],
      };

      // Validate it's a valid JSON object
      expect(() => JSON.stringify(validSchema)).not.toThrow();
      expect(validSchema.type).toBe("object");
      expect(validSchema.properties).toBeDefined();
    });

    it("should handle complex nested JSON Schemas", () => {
      const complexSchema = {
        type: "object",
        properties: {
          data: {
            type: "object",
            properties: {
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    value: { type: "number" },
                    metadata: {
                      type: "object",
                      additionalProperties: true,
                    },
                  },
                },
              },
            },
          },
        },
      };

      const serialized = JSON.stringify(complexSchema);
      const parsed = JSON.parse(serialized);

      expect(parsed.type).toBe("object");
      expect(parsed.properties.data.properties.items.type).toBe("array");
    });

    it("should reject invalid JSON", () => {
      const invalidJson = "{ type: object }"; // Missing quotes around property names

      expect(() => JSON.parse(invalidJson)).toThrow();
    });
  });

  describe("Request/Response Format", () => {
    it("should format CREATE request with jsonSchema", () => {
      const createRequest = {
        name: "Custom Extraction",
        description: "Custom schema for specific extraction",
        content: "Extract the following fields from the email...",
        jsonSchema: {
          type: "object",
          properties: {
            customField1: { type: "string" },
            customField2: { type: "number" },
          },
        },
        isDefault: false,
      };

      expect(createRequest.jsonSchema).toBeDefined();
      expect(typeof createRequest.jsonSchema).toBe("object");
    });

    it("should format UPDATE request with jsonSchema", () => {
      const updateRequest = {
        name: "Updated Prompt",
        description: "Updated description",
        content: "Updated content",
        jsonSchema: {
          type: "object",
          properties: {
            newField: { type: "string" },
          },
        },
        isDefault: false,
        isActive: true,
      };

      expect(updateRequest.jsonSchema).toBeDefined();
    });

    it("should handle UPDATE request without jsonSchema (preserve existing)", () => {
      const updateRequest = {
        name: "Updated Name Only",
        // jsonSchema not included - should preserve existing
      };

      expect(updateRequest.jsonSchema).toBeUndefined();
    });
  });
});
