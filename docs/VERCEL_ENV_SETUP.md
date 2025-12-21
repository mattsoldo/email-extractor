# Vercel Environment Variables - Quick Setup

## 📍 Where to Add Variables

**Vercel Dashboard:**
1. Go to https://vercel.com/dashboard
2. Select your project: `email-extractor`
3. Click **Settings** (top navigation)
4. Click **Environment Variables** (left sidebar)

---

## 🔑 Variables to Add

Copy these values from your `.env.local` file and add them to Vercel:

### 1. DATABASE_URL

**If using Vercel Postgres:**
- Vercel auto-creates this when you add Postgres storage
- Use the value from `POSTGRES_PRISMA_URL` (includes connection pooling)

**If using external database:**
```
DATABASE_URL
└─ Value: postgresql://user:password@host:5432/database_name
└─ Environments: ✅ Production, ✅ Preview
```

---

### 2. ANTHROPIC_API_KEY

```
ANTHROPIC_API_KEY
└─ Value: sk-ant-api03-...
└─ Environments: ✅ Production, ✅ Preview
```

Get from: https://console.anthropic.com/

---

### 3. OPENAI_API_KEY

```
OPENAI_API_KEY
└─ Value: sk-...
└─ Environments: ✅ Production, ✅ Preview
```

Get from: https://platform.openai.com/api-keys

---

### 4. GOOGLE_GENERATIVE_AI_API_KEY

```
GOOGLE_GENERATIVE_AI_API_KEY
└─ Value: AIza...
└─ Environments: ✅ Production, ✅ Preview
```

Get from: https://makersuite.google.com/app/apikey

---

### 5. GEMINI_API_KEY

```
GEMINI_API_KEY
└─ Value: AIza... (same as above)
└─ Environments: ✅ Production, ✅ Preview
```

---

## ✅ Checklist

After adding each variable:

- [ ] `DATABASE_URL` added
- [ ] `ANTHROPIC_API_KEY` added
- [ ] `OPENAI_API_KEY` added
- [ ] `GOOGLE_GENERATIVE_AI_API_KEY` added
- [ ] `GEMINI_API_KEY` added
- [ ] All marked for **Production** environment
- [ ] All marked for **Preview** environment
- [ ] Values match your `.env.local` (but with production database URL)
- [ ] Redeploy project to apply new variables

---

## 🚀 After Adding Variables

**Option 1: Automatic Redeploy**
- Push any commit to trigger deployment
- Or click **Deployments** → **Redeploy** (3-dot menu)

**Option 2: Manual Trigger**
```bash
git commit --allow-empty -m "chore: Trigger redeploy with env vars"
git push
```

---

## 🔍 Verify Setup

After deployment:

1. Go to **Deployments** → Select latest deployment
2. Click **View Function Logs**
3. Check for migration success: `✅ Migration complete!`
4. Check for build success: `✓ Compiled successfully`

---

## 📝 Summary Table

| Variable | Required | Environment | Notes |
|----------|----------|-------------|-------|
| `DATABASE_URL` | ✅ Yes | Prod, Preview | Use `POSTGRES_PRISMA_URL` for Vercel Postgres |
| `ANTHROPIC_API_KEY` | ✅ Yes | Prod, Preview | Claude API key |
| `OPENAI_API_KEY` | ✅ Yes | Prod, Preview | GPT API key |
| `GOOGLE_GENERATIVE_AI_API_KEY` | ✅ Yes | Prod, Preview | Gemini API key |
| `GEMINI_API_KEY` | ✅ Yes | Prod, Preview | Same as above |

---

## 🆘 Troubleshooting

### "Missing environment variable" error

**Check:**
1. Variable name is spelled exactly right (case-sensitive)
2. Value has no extra spaces or quotes
3. Environment is selected (Production/Preview)
4. Project was redeployed after adding variable

### Build fails after adding env vars

**Check deployment logs:**
1. Go to Deployments → Click failed deployment
2. Check **Build Logs** for specific error
3. Most common: DATABASE_URL is incorrect format

### Database connection fails

**Check:**
1. DATABASE_URL format: `postgresql://user:pass@host:5432/dbname`
2. Database allows connections from Vercel IP ranges
3. SSL is enabled for production database (most require it)

---

## 🔐 Security Notes

- Never commit `.env.local` (already in `.gitignore`)
- Never screenshot environment variables with actual values
- Rotate API keys regularly
- Use different API keys for dev and prod if possible
- Enable IP restrictions on your database if supported
