#!/usr/bin/env tsx
/**
 * Schema Reset Script
 *
 * DANGER: This script drops ALL tables, types, and data from the database
 * and recreates the schema from scratch using drizzle-kit push.
 *
 * Usage:
 *   npm run db:reset-schema
 *
 * Only use this for:
 * - Local development reset
 * - Fresh environment setup
 * - Test environment reset
 *
 * NEVER run this on production!
 */

import postgres from "postgres";
import { config } from "dotenv";
import { execSync } from "child_process";

// Load environment variables
config({ path: ".env.local" });

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL environment variable is not set");
  process.exit(1);
}

// TypeScript narrowing doesn't work across function boundaries, so we assert here
const DB_URL: string = DATABASE_URL;

// Safety check - require explicit confirmation
const args = process.argv.slice(2);
const confirmed = args.includes("--confirm");
const forceProduction = args.includes("--force-production");

if (!confirmed) {
  console.error("\n⚠️  DANGER: This will DROP ALL DATA in the database!\n");
  console.error("To proceed, run:");
  console.error("  npm run db:reset-schema -- --confirm\n");
  process.exit(1);
}

// Additional safety - prevent running on production (unless --force-production)
const isProductionDatabase =
  process.env.NODE_ENV === "production" ||
  process.env.VERCEL === "1" ||
  DB_URL.includes("prod") ||
  DB_URL.includes("neon.tech") ||
  DB_URL.includes("vercel-storage") ||
  DB_URL.includes("supabase.co");

if (isProductionDatabase && !forceProduction) {
  console.error("\n❌ Cannot run reset on production database!\n");
  console.error("This script is for local development only.");
  console.error("Database URL suggests this is a production/hosted database.\n");
  console.error("\n⚠️  To FORCE reset on production (⚠️  DESTROYS ALL DATA ⚠️):");
  console.error("  npm run db:reset-schema -- --confirm --force-production\n");
  process.exit(1);
}

// Configure SSL based on database type
const needsSSL = isProductionDatabase;

const sql = postgres(DB_URL, {
  ssl: needsSSL ? { rejectUnauthorized: false } : false,
});

async function dropAllTables() {
  console.log("\n🗑️  Dropping all tables and types...\n");

  try {
    // Get all table names
    const tables = await sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `;

    // Drop all tables with CASCADE
    for (const { tablename } of tables) {
      console.log(`  Dropping table: ${tablename}`);
      await sql.unsafe(`DROP TABLE IF EXISTS "${tablename}" CASCADE`);
    }

    // Get all enums/types
    const types = await sql`
      SELECT typname
      FROM pg_type
      WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND typtype = 'e'
    `;

    // Drop all custom types
    for (const { typname } of types) {
      console.log(`  Dropping type: ${typname}`);
      await sql.unsafe(`DROP TYPE IF EXISTS "${typname}" CASCADE`);
    }

    console.log("\n✅ All tables and types dropped\n");
  } catch (error) {
    console.error("❌ Failed to drop tables:", error);
    throw error;
  }
}

async function recreateSchema() {
  console.log("🔄 Recreating schema from schema.ts using drizzle-kit push...\n");

  try {
    // Use drizzle-kit push to recreate the schema
    execSync("npx drizzle-kit push", {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: DB_URL },
    });

    console.log("\n✅ Schema recreated successfully\n");
  } catch (error) {
    console.error("❌ Failed to recreate schema:", error);
    throw error;
  }
}

async function seedEssentialData() {
  console.log("🌱 Seeding essential data...\n");

  try {
    // Run the seed-prompts script if it exists
    try {
      execSync("tsx scripts/seed-prompts.ts", {
        stdio: "inherit",
        env: { ...process.env, DATABASE_URL: DB_URL },
      });
      console.log("  ✓ Seeded prompts\n");
    } catch (e) {
      console.log("  ⏭  No prompts seed script or already seeded\n");
    }

    console.log("✅ Essential data seeded\n");
  } catch (error) {
    console.error("❌ Failed to seed data:", error);
    throw error;
  }
}

async function resetDatabase() {
  // Show extra warning for production databases
  if (forceProduction) {
    console.log("\n" + "=".repeat(60));
    console.log("  ⚠️  FORCING PRODUCTION DATABASE RESET ⚠️");
    console.log("  ALL DATA WILL BE PERMANENTLY DELETED");
    console.log("=".repeat(60) + "\n");
    console.log("Database: " + DB_URL.replace(/:[^:@]+@/, ":****@") + "\n");
    console.log("Waiting 5 seconds... Press Ctrl+C to cancel\n");

    // Give user time to cancel
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log("\n" + "=".repeat(60));
  console.log("  DATABASE RESET - ALL DATA WILL BE LOST");
  console.log("=".repeat(60) + "\n");

  await dropAllTables();
  await recreateSchema();
  await seedEssentialData();

  console.log("=".repeat(60));
  console.log("  ✅ Database reset complete!");
  console.log("=".repeat(60) + "\n");
}

resetDatabase()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("\n❌ Reset failed:", error);
    await sql.end();
    process.exit(1);
  });
