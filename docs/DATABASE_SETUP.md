# Database Setup Guide

This guide explains how to set up separate databases for development and production.

## Overview

The application uses **two separate databases**:
- **Development Database**: Local PostgreSQL on your machine
- **Production Database**: Hosted PostgreSQL (Vercel Postgres, Supabase, etc.)

This separation ensures:
- Local development doesn't affect production data
- You can reset/test locally without risk
- Production data remains secure and stable

## Quick Setup

### 1. Local Development Database

#### Option A: Using Docker (Recommended)

```bash
# Start PostgreSQL in Docker
docker run --name email-extractor-dev \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=email_extractor_dev \
  -p 5432:5432 \
  -d postgres:16

# Verify it's running
docker ps | grep email-extractor-dev
```

#### Option B: Using Homebrew (macOS)

```bash
# Install PostgreSQL
brew install postgresql@16

# Start PostgreSQL service
brew services start postgresql@16

# Create database
createdb email_extractor_dev
```

#### Option C: Using official PostgreSQL installer

Download from: https://www.postgresql.org/download/

### 2. Configure Local Environment

Create `.env.local` in the project root:

```bash
# Copy the example file
cp .env.example .env.local
```

Edit `.env.local` and set your local database URL:

```env
# For Docker setup (default)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/email_extractor_dev

# For Homebrew setup
DATABASE_URL=postgresql://$(whoami)@localhost:5432/email_extractor_dev

# Add your API keys
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
```

### 3. Initialize Local Database

```bash
# Apply migrations to create schema
npm run db:migrate-sql

# Seed essential data (prompts, etc.)
npm run db:seed  # If seed script exists
```

Your local development database is now ready!

## Production Database Setup (Vercel)

### Option 1: Vercel Postgres (Recommended for Vercel deployment)

1. **Go to Vercel Dashboard**
   - Navigate to your project
   - Click **Storage** tab
   - Click **Create Database**
   - Select **Postgres**

2. **Create Database**
   - Choose region close to your users
   - Select plan (Hobby is free)
   - Click **Create**

3. **Get Connection String**
   - Vercel automatically adds `POSTGRES_URL` to your project
   - Rename it to `DATABASE_URL` in environment variables

4. **Configure Environment Variables**
   - Go to **Settings** → **Environment Variables**
   - Vercel should have automatically added these:
     - `POSTGRES_URL`
     - `POSTGRES_PRISMA_URL`
     - `POSTGRES_URL_NON_POOLING`

5. **Add Required Variables**

Click **Add Environment Variable** and add each of these:

| Variable Name | Value | Environments |
|--------------|-------|--------------|
| `DATABASE_URL` | (use the `POSTGRES_PRISMA_URL` value) | Production, Preview |
| `ANTHROPIC_API_KEY` | `sk-ant-api03-...` | Production, Preview |
| `OPENAI_API_KEY` | `sk-...` | Production, Preview |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `AIza...` | Production, Preview |
| `GEMINI_API_KEY` | `AIza...` | Production, Preview |

**Important:**
- Use `POSTGRES_PRISMA_URL` value for `DATABASE_URL` (it includes connection pooling)
- Check all three: Production, Preview, Development (if you want)

### Option 2: External Database (Supabase, Railway, etc.)

1. **Create PostgreSQL Database** on your hosting provider

2. **Get Connection String**
   ```
   postgresql://user:password@host:5432/database_name
   ```

3. **Add to Vercel**
   - Go to Vercel Dashboard → Your Project
   - Settings → Environment Variables
   - Add `DATABASE_URL` with your connection string
   - Select environments: Production, Preview

### Option 3: Neon (Serverless Postgres)

1. **Sign up at** https://neon.tech
2. **Create Project** → Get connection string
3. **Add to Vercel** as `DATABASE_URL`

## Vercel Environment Variables Setup

### Where to Add Variables

**Vercel Dashboard:**
1. Go to https://vercel.com/dashboard
2. Select your project
3. Click **Settings** (top nav)
4. Click **Environment Variables** (left sidebar)
5. Click **Add Environment Variable**

### Variables to Add

**Copy these from your `.env.local`:**

```
DATABASE_URL=postgresql://...your-production-database...
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=AIza...
GEMINI_API_KEY=AIza...
```

**For each variable:**
1. Paste the **Key** (e.g., `DATABASE_URL`)
2. Paste the **Value** (your actual URL/key)
3. Check which environments:
   - ✅ **Production** (always)
   - ✅ **Preview** (recommended for testing)
   - ⬜ **Development** (optional, uses .env.local)
4. Click **Add**

### Screenshot Guide

```
┌─────────────────────────────────────────────────────┐
│  Settings > Environment Variables                   │
├─────────────────────────────────────────────────────┤
│                                                      │
│  ┌─────────────────────────────────────────────┐   │
│  │ Key:   DATABASE_URL                         │   │
│  │ Value: postgresql://user:pass@host/db       │   │
│  │                                              │   │
│  │ Environments:                                │   │
│  │ ☑ Production  ☑ Preview  ☐ Development     │   │
│  │                                              │   │
│  │                [Save]                        │   │
│  └─────────────────────────────────────────────┘   │
│                                                      │
└─────────────────────────────────────────────────────┘
```

## Database Migration Strategy

### Local Development

```bash
# Apply pending migrations
npm run db:migrate-sql

# Reset database (⚠️ destroys all data)
npm run db:reset-schema -- --confirm

# Generate new migration from schema changes
npm run db:generate
```

### Production (Vercel)

**Automatic (Recommended):**
- Migrations run automatically on every deployment
- Configured via `vercel-build` script in package.json
- Safe - deployments fail if migrations fail

**Manual (if needed):**
```bash
# Pull production environment variables
vercel env pull .env.production

# Run migrations manually
DATABASE_URL="$(grep DATABASE_URL .env.production | cut -d '=' -f2-)" npm run db:migrate-sql
```

## Verifying Setup

### Local Database

```bash
# Connect to local database
psql $DATABASE_URL

# Inside psql:
\dt  # List tables
\q   # Quit
```

### Production Database

```bash
# Pull Vercel env
vercel env pull .env.vercel

# Connect to production
psql $(grep POSTGRES_URL .env.vercel | cut -d '=' -f2-)

# Or using DATABASE_URL
psql $(grep DATABASE_URL .env.vercel | cut -d '=' -f2-)
```

## Troubleshooting

### Local database connection failed

**Check if PostgreSQL is running:**
```bash
# For Docker
docker ps | grep postgres

# For Homebrew
brew services list | grep postgres

# Try connecting
psql -h localhost -U postgres -d email_extractor_dev
```

### Vercel deployment fails with database error

1. **Check environment variables** are set correctly
2. **Check DATABASE_URL** format (should include credentials)
3. **Check database allows connections** from Vercel's IP ranges
4. **View deployment logs** in Vercel dashboard

### Migrations fail on Vercel

1. **Check logs** in Vercel deployment
2. **Run migrations manually** first to test
3. **Check database permissions** (user needs CREATE, ALTER rights)

## Security Best Practices

### ✅ DO
- Use different databases for dev and prod
- Use different credentials for each environment
- Add `.env.local` to `.gitignore` (already done)
- Rotate API keys regularly
- Use connection pooling for production
- Enable SSL for production database connections

### ❌ DON'T
- Never commit `.env.local` or any file with real credentials
- Never use production database URL in local development
- Never share API keys in Slack/email/screenshots
- Don't use weak passwords for database users
- Don't expose database ports to the internet

## Database Backups

### Local Development
Not critical since it's development data, but you can:
```bash
pg_dump $DATABASE_URL > backup.sql
```

### Production
**Automated backups:**
- Vercel Postgres: Automatic daily backups (Pro plan)
- Supabase: Automatic backups included
- Neon: Point-in-time recovery

**Manual backup:**
```bash
# Pull env
vercel env pull .env.vercel

# Backup
pg_dump $(grep POSTGRES_URL .env.vercel | cut -d '=' -f2-) > prod_backup_$(date +%Y%m%d).sql
```

## Need Help?

- **Vercel Postgres docs**: https://vercel.com/docs/storage/vercel-postgres
- **PostgreSQL docs**: https://www.postgresql.org/docs/
- **Project issues**: https://github.com/mattsoldo/email-extractor/issues
