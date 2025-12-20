#!/usr/bin/env tsx
/**
 * Migration Runner
 *
 * Runs SQL migration files from the migrations/ directory in order.
 * Tracks applied migrations in a _migrations table.
 *
 * Usage: npm run db:migrate-sql
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import postgres from "postgres";
import { config } from "dotenv";

// Load environment variables from .env.local
config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set");
  process.exit(1);
}

const sql = postgres(DATABASE_URL, {
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

async function ensureMigrationsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP DEFAULT NOW()
    )
  `;
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await sql`SELECT filename FROM _migrations`;
  return new Set(result.map((row) => row.filename));
}

async function applyMigration(filename: string, content: string) {
  console.log(`  Applying ${filename}...`);

  try {
    // Run the migration SQL
    await sql.unsafe(content);

    // Record that it was applied
    await sql`INSERT INTO _migrations (filename) VALUES (${filename})`;

    console.log(`  ✓ Applied ${filename}`);
  } catch (error) {
    console.error(`  ❌ Failed to apply ${filename}:`, error);
    throw error;
  }
}

async function runMigrations() {
  console.log("🔄 Running database migrations...\n");

  // Ensure migrations tracking table exists
  await ensureMigrationsTable();

  // Get list of already applied migrations
  const appliedMigrations = await getAppliedMigrations();
  console.log(`📋 ${appliedMigrations.size} migrations already applied\n`);

  // Read migration files from migrations/ directory
  const migrationsDir = join(process.cwd(), "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // Sort to ensure consistent order

  console.log(`📁 Found ${files.length} migration files\n`);

  let appliedCount = 0;

  for (const filename of files) {
    if (appliedMigrations.has(filename)) {
      console.log(`  ⏭  Skipping ${filename} (already applied)`);
      continue;
    }

    const filepath = join(migrationsDir, filename);
    const content = readFileSync(filepath, "utf-8");

    await applyMigration(filename, content);
    appliedCount++;
  }

  console.log(`\n✅ Migration complete! Applied ${appliedCount} new migration(s)`);
}

runMigrations()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  });
