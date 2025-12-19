/**
 * Vitest test setup file
 * This file runs before all tests
 */

import { vi } from "vitest";

// Mock environment variables for tests
process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
process.env.OPENAI_API_KEY = "test-openai-key";

// Global test utilities can be added here
