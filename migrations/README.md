# Database Migrations

This directory contains SQL migration files that are applied to the database in order.

## Migration Files

Migrations are numbered sequentially and applied in order:
- `003_email_extractions.sql` - Email extractions tracking system
- `004_add_paused_status.sql` - Add paused status to jobs

## Running Migrations

### Locally
```bash
npm run db:migrate-sql
```

### On Vercel
Migrations run automatically as part of the build process via the `vercel-build` script in package.json.

## Creating New Migrations

1. Create a new file in this directory with the format: `00X_description.sql`
2. Use `IF NOT EXISTS` clauses for idempotent operations when possible
3. Test locally with `npm run db:migrate-sql`
4. Commit and push - Vercel will apply it automatically on next deploy

## Migration Tracking

Applied migrations are tracked in the `_migrations` table. The migration runner:
- Creates `_migrations` table if it doesn't exist
- Checks which migrations have been applied
- Applies pending migrations in order
- Records each migration after successful application

## Notes

- Migrations are applied sequentially - order matters!
- Each migration should be idempotent (safe to run multiple times)
- Never modify a migration file after it's been applied to production
- Use `IF NOT EXISTS` or `IF EXISTS` clauses when appropriate
