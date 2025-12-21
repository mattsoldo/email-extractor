# Production Database Operations

This guide covers safe operations on production databases, including migrations, backups, and troubleshooting.

## ⚠️ Important Safety Rules

### DO NOT ❌
- **Never run `db:reset-schema`** on production (blocked by script)
- **Never manually DROP tables** without a backup
- **Never test migrations directly** on production
- **Never share production credentials** or connection strings

### DO ✅
- **Always test migrations locally first**
- **Always have a backup** before major changes
- **Always use the migration system** (automatic on Vercel)
- **Always verify** in staging/preview environment first

---

## SSL Connections

All hosted databases (Neon, Vercel Postgres, Supabase, etc.) require SSL connections.

### Automatic SSL Detection

The application automatically detects when SSL is needed based on:
1. `NODE_ENV=production`
2. `VERCEL=1` environment variable
3. Database URL contains known providers:
   - `neon.tech` (Vercel's default)
   - `vercel-storage`
   - `supabase.co`
   - `amazonaws.com` (AWS RDS)
   - `railway.app`
   - `render.com`

**You don't need to configure SSL manually** - it's handled automatically.

### Manual SSL Configuration

If using a custom database provider, you may need to force SSL:

**Option 1: Use `?sslmode=require` in URL**
```
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

**Option 2: Set environment variable**
```
DATABASE_SSL=true
```

---

## Running Migrations on Production

### Automatic (Vercel - Recommended)

Migrations run automatically during deployment:

```
vercel deploy
  ↓
1. vercel-build runs
  ↓
2. npm run db:migrate-sql (applies pending migrations)
  ↓
3. npm run build (builds app)
  ↓
4. Deployment completes
```

**If migrations fail:**
- Deployment is automatically cancelled
- Previous version stays live
- No broken deployment reaches production

### Manual (If Needed)

If you need to run migrations manually on production:

```bash
# 1. Pull production environment variables
vercel env pull .env.production

# 2. Run migrations (SSL handled automatically)
DATABASE_URL="$(grep DATABASE_URL .env.production | cut -d '=' -f2-)" \
  npm run db:migrate-sql

# 3. Verify success
# Check output for: ✅ Migration complete!
```

### Via Vercel CLI

```bash
# Connect to Vercel production
vercel --prod

# In Vercel shell, run migrations
npm run db:migrate-sql
```

---

## Database Backups

### Automated Backups

**Vercel Postgres:**
- Automatic daily backups (Pro plan)
- Point-in-time recovery available
- Managed automatically

**Neon:**
- Continuous backups
- Point-in-time recovery (7-30 days depending on plan)
- Automatic

**Supabase:**
- Daily automated backups
- Point-in-time recovery (Pro plan)
- Automatic

### Manual Backup

Before major operations, create a manual backup:

```bash
# 1. Get production DATABASE_URL
vercel env pull .env.production

# 2. Backup database
pg_dump "$(grep DATABASE_URL .env.production | cut -d '=' -f2-)" \
  > backup_$(date +%Y%m%d_%H%M%S).sql

# 3. Compress backup (optional)
gzip backup_*.sql
```

### Restore from Backup

```bash
# 1. Restore to database
psql "$(grep DATABASE_URL .env.production | cut -d '=' -f2-)" \
  < backup_20231220_150000.sql
```

---

## Connecting to Production Database

### View Data (Read-Only)

**Using psql:**
```bash
# Pull env vars
vercel env pull .env.production

# Connect with psql
psql "$(grep DATABASE_URL .env.production | cut -d '=' -f2-)"

# Inside psql:
\dt          # List tables
\d jobs      # Describe jobs table
SELECT * FROM jobs LIMIT 10;
\q           # Quit
```

**Using Drizzle Studio:**
```bash
# Set production DATABASE_URL temporarily
export DATABASE_URL="postgresql://..."

# Open Drizzle Studio
npm run db:studio

# Opens browser at localhost:4983
```

**Using Neon Console:**
- Go to https://console.neon.tech
- Select your project
- Click "SQL Editor"
- Run queries in browser

### Modify Data (Dangerous!)

Only make changes if absolutely necessary and with proper precautions:

```sql
-- Always use transactions
BEGIN;

-- Make your changes
UPDATE jobs SET status = 'completed' WHERE id = 'job_123';

-- Review changes
SELECT * FROM jobs WHERE id = 'job_123';

-- If correct: COMMIT
-- If wrong: ROLLBACK
COMMIT;
```

---

## Troubleshooting

### SSL Connection Errors

**Error:** `no pg_hba.conf entry` or `SSL required`

**Solution:**
1. Verify DATABASE_URL includes full connection string
2. Check if URL needs `?sslmode=require` parameter
3. Ensure app is up-to-date (SSL auto-detection added)

### Migration Fails on Deployment

**Check Vercel deployment logs:**
1. Go to Vercel Dashboard → Deployments
2. Click failed deployment
3. Check "Build Logs"
4. Look for migration error message

**Common causes:**
- Database connection timeout (check network/firewall)
- Invalid SQL in migration file
- Missing database permissions
- Database is full/quota exceeded

**Fix:**
1. Test migration locally first
2. If migration SQL is wrong, create corrective migration
3. If connection issue, check database provider settings
4. Redeploy after fixing

### Database Connection Timeout

**Symptoms:**
- Deployment takes very long and fails
- "Connection timed out" errors
- Migration script hangs

**Causes:**
- Database is under heavy load
- Network issues
- Database IP allowlist doesn't include Vercel IPs
- Database is paused/sleeping (some providers auto-pause)

**Solutions:**
1. **Check database status** in provider dashboard
2. **Wake up database** if auto-paused
3. **Check IP allowlist** - Vercel needs access
4. **Increase timeout** if database is slow
5. **Upgrade plan** if hitting connection limits

### "Cannot run reset on production database"

**This is intentional!** The `db:reset-schema` script blocks production databases.

**If you really need to reset production:**
1. **Don't!** Consider carefully if this is necessary
2. **Backup first!** Use `pg_dump` to save current data
3. **Manual approach:**
   ```sql
   -- Connect to database
   -- Drop all tables manually
   DROP SCHEMA public CASCADE;
   CREATE SCHEMA public;

   -- Run migrations
   npm run db:migrate-sql
   ```

---

## Monitoring

### Check Migration Status

```bash
# Connect to production database
psql "$DATABASE_URL"

# Check applied migrations
SELECT * FROM _migrations ORDER BY applied_at DESC;

# Check for recent jobs
SELECT id, type, status, created_at
FROM jobs
ORDER BY created_at DESC
LIMIT 10;
```

### Query Performance

```sql
-- Long-running queries
SELECT pid, now() - query_start as duration, query
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY duration DESC;

-- Table sizes
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## Emergency Procedures

### Database is Corrupted

1. **Stop all writes** - pause app if possible
2. **Restore from backup**
3. **Run migrations** to bring schema up to date
4. **Verify data integrity**
5. **Resume operations**

### Migration Applied Incorrectly

1. **Don't panic** - don't make it worse
2. **Backup current state**
3. **Create corrective migration** (002_fix_previous.sql)
4. **Test locally**
5. **Deploy correction**

### Need to Rollback Migration

**PostgreSQL doesn't support migration rollback built-in.**

**Manual rollback:**
1. Create a reverse migration (002_rollback_001.sql)
2. Manually write SQL to undo changes
3. Test thoroughly locally
4. Deploy

**Better approach:**
- Don't rollback, create corrective migration forward
- Easier to track history
- Less risky

---

## Best Practices

### Before Deploying

- [ ] Test migrations locally first
- [ ] Review SQL in migration files
- [ ] Check if migration is idempotent
- [ ] Backup production database
- [ ] Test in preview environment if available
- [ ] Have rollback plan ready

### After Deploying

- [ ] Verify deployment succeeded
- [ ] Check migration logs for success
- [ ] Test critical functionality
- [ ] Monitor error rates
- [ ] Keep backup for 30 days minimum

### Regular Maintenance

- [ ] **Weekly:** Review query performance
- [ ] **Monthly:** Review table sizes and growth
- [ ] **Monthly:** Test backup restoration
- [ ] **Quarterly:** Review and archive old data
- [ ] **As needed:** Vacuum/analyze database

---

## Getting Help

### Deployment Issues
- Check Vercel deployment logs first
- Review migration error messages
- See troubleshooting section above

### Database Provider Support
- **Neon:** https://neon.tech/docs/introduction
- **Vercel:** https://vercel.com/docs/storage/vercel-postgres
- **Supabase:** https://supabase.com/docs

### Application Issues
- GitHub Issues: https://github.com/mattsoldo/email-extractor/issues
- Include relevant log excerpts (redact credentials!)
