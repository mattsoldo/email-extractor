# Database Migrations

This directory contains SQL migration files that are applied to the database in order.

## Current Migrations

- `001_complete_schema.sql` - **Complete baseline schema** (v0.4.0)
  - Creates all tables, enums, indexes from scratch
  - Includes: ai_models, prompts, email_extractions, paused job status, etc.
  - Safe to run multiple times (uses IF NOT EXISTS)

## Migration Strategy

### Fresh Database (New Installation)
1. Run `npm run db:migrate-sql`
2. The baseline schema (001) will be applied
3. Future incremental migrations (002+) will be applied in order

### Existing Database (Already in Production)
- The migration runner tracks applied migrations in `_migrations` table
- Already-applied migrations are skipped automatically
- New migrations are applied incrementally

### Creating New Migrations

For **incremental changes** (recommended for production):
1. Create `002_description.sql`, `003_description.sql`, etc.
2. Use `ALTER TABLE` statements for modifications
3. Test locally: `npm run db:migrate-sql`
4. Commit and push - Vercel applies automatically

For **complete schema regeneration** (local dev only):
```bash
npm run db:reset-schema -- --confirm
```

## Running Migrations

### Locally - Apply Pending Migrations
```bash
npm run db:migrate-sql
```

### Locally - Complete Reset (⚠️ DESTROYS ALL DATA)
```bash
npm run db:reset-schema -- --confirm
```

This will:
1. Drop all tables and data
2. Recreate schema from `src/db/schema.ts` using drizzle-kit
3. Seed essential data (prompts, etc.)

**Safety:** Cannot run on production databases

### On Vercel - Automatic Migration
Migrations run automatically during deployment via `vercel-build` script.

The build process:
1. Runs `npm run db:migrate-sql` (applies pending migrations)
2. Builds Next.js app (only if migrations succeed)
3. Deploys (only if build succeeds)

**Important:** If migrations fail, deployment is prevented.

### Manual Vercel Migration (If Needed)

If you need to manually run migrations on Vercel:

```bash
# Using Vercel CLI
vercel env pull .env.production
DATABASE_URL="$(grep DATABASE_URL .env.production | cut -d '=' -f2-)" npm run db:migrate-sql
```

Or use Vercel's shell access in the dashboard.

## Migration Tracking

Applied migrations are tracked in the `_migrations` table:
- Filename is stored (e.g., "001_complete_schema.sql")
- Applied timestamp is recorded
- Subsequent runs skip already-applied migrations

## Best Practices

### DO ✅
- Use `IF NOT EXISTS` for CREATE statements when possible
- Test migrations locally before pushing
- Make migrations idempotent (safe to run multiple times)
- Create incremental migrations for production changes
- Keep migrations small and focused

### DON'T ❌
- Never modify a migration file after it's been applied to production
- Don't run `db:reset-schema` on production (it's blocked anyway)
- Don't skip migration numbers - keep them sequential
- Don't mix schema changes with data changes in one migration

## Troubleshooting

### "Migration already applied" but schema is wrong
The migration may have failed partway through. Check `_migrations` table:
```sql
SELECT * FROM _migrations ORDER BY applied_at DESC;
```

If a migration is recorded but incomplete, manually fix the schema or:
```sql
DELETE FROM _migrations WHERE filename = 'problematic_migration.sql';
```
Then re-run migrations.

### Need to rebuild schema from scratch (dev only)
```bash
npm run db:reset-schema -- --confirm
```

### Production schema is out of sync
1. Create a corrective migration (002+) that fixes the issue
2. Test locally first
3. Deploy - it will be applied automatically

## Archive

Historical migrations that have been consolidated into 001:
- `archive/003_email_extractions.sql` - Email extractions table (now in 001)
- `archive/004_add_paused_status.sql` - Paused job status (now in 001)

These are kept for historical reference but are no longer applied.
