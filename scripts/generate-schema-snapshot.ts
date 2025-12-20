#!/usr/bin/env tsx
/**
 * Schema Snapshot Generator
 *
 * Generates a complete SQL snapshot of the current schema from schema.ts
 * This can be used as a baseline for fresh database installations.
 *
 * Usage: npm run db:snapshot
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";

console.log("\n📸 Generating schema snapshot from schema.ts...\n");

try {
  // Step 1: Clean old generated migrations
  const drizzleDir = join(process.cwd(), "drizzle");
  const metaDir = join(drizzleDir, "meta");

  console.log("  🧹 Cleaning old drizzle migrations...");

  // Keep a backup of meta if you want, or just remove everything
  const oldFiles = readdirSync(drizzleDir).filter((f) => f.endsWith(".sql"));
  for (const file of oldFiles) {
    unlinkSync(join(drizzleDir, file));
  }

  // Step 2: Generate fresh migration from schema.ts
  console.log("  🔄 Generating migration from schema.ts...");
  execSync("npm run db:generate", { stdio: "inherit" });

  // Step 3: Find the generated migration file
  const newFiles = readdirSync(drizzleDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (newFiles.length === 0) {
    throw new Error("No migration file generated");
  }

  const latestMigration = newFiles[newFiles.length - 1];
  const migrationPath = join(drizzleDir, latestMigration);

  console.log(`  📄 Found migration: ${latestMigration}`);

  // Step 4: Read the migration content
  const migrationContent = readFileSync(migrationPath, "utf-8");

  // Step 5: Create a complete schema snapshot
  const snapshotPath = join(
    process.cwd(),
    "migrations",
    "001_complete_schema.sql"
  );

  const snapshotHeader = `-- Complete Schema Snapshot
-- Generated: ${new Date().toISOString()}
-- Source: src/db/schema.ts
--
-- This file contains the complete database schema.
-- It can be used to initialize a fresh database from scratch.
--
-- For existing databases, use incremental migrations (002+).

`;

  writeFileSync(snapshotPath, snapshotHeader + migrationContent);

  console.log(`\n  ✅ Schema snapshot created: migrations/001_complete_schema.sql`);
  console.log(
    `\n  💡 To use this snapshot for a fresh database:`
  );
  console.log(`     1. Drop existing database or create new one`);
  console.log(`     2. Run: npm run db:migrate-sql`);
  console.log(`     3. The snapshot will be applied as the first migration\n`);
} catch (error) {
  console.error("\n❌ Failed to generate snapshot:", error);
  process.exit(1);
}
