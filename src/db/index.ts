import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { getSSLConfig } from "@/lib/db-config";

// Connection string from environment
const connectionString = process.env.DATABASE_URL!;

// Create postgres connection with automatic SSL detection
// For query purposes (used by drizzle)
// Configure connection pool to handle concurrent extractions + API calls
const queryClient = postgres(connectionString, {
  ssl: getSSLConfig(connectionString),
  max: 20, // Maximum connections in pool (default is 10)
  idle_timeout: 30, // Close idle connections after 30 seconds
  connect_timeout: 10, // Timeout for new connections
});

// Create drizzle database instance
export const db = drizzle(queryClient, { schema });

// Export query client for connection management (closing, etc.)
export const sql = queryClient;

// Export schema for convenience
export * from "./schema";
