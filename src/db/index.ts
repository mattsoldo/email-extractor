import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getSSLConfig } from "@/lib/db-config";

// Connection string from environment
const connectionString = process.env.DATABASE_URL!;

// Create postgres connection with automatic SSL detection
// For query purposes (used by drizzle)
const queryClient = postgres(connectionString, {
  ssl: getSSLConfig(connectionString),
});

// Create drizzle database instance
export const db = drizzle(queryClient, { schema });

// Export schema for convenience
export * from "./schema";
