# Deployment Guide

## Vercel Deployment

This application is optimized for deployment on Vercel, but there are important considerations based on your Vercel plan.

### Plan Requirements

#### Hobby Plan (Free)
- ✅ **Supported** for small-scale usage
- ⚠️ **Limitations:**
  - **10 second function timeout** - Large file uploads may timeout
  - **4.5MB request payload limit** - Cannot upload files larger than 4.5MB total
  - **1GB bandwidth per month** - Suitable for testing and small deployments

#### Pro Plan ($20/month per user)
- ✅ **Recommended** for production use
- **Benefits:**
  - **60 second function timeout** - Handles most file uploads
  - **10MB request payload limit** - Supports larger email batches
  - **100GB bandwidth per month** - Suitable for production workloads
  - **Longer build times** - Complex migrations won't timeout

#### Enterprise Plan
- ✅ **Best** for large-scale production
- **Benefits:**
  - **900 second (15 minute) function timeout** - Handles very large batches
  - **Custom payload limits** - Negotiate higher limits
  - **Unlimited bandwidth** - No usage concerns

### File Upload Constraints

The upload endpoints have been configured with these constraints:

**Hobby Plan:**
```
Maximum file size: 4.5MB total
Function timeout: 10 seconds
Recommended: Upload small batches (< 50 emails at a time)
```

**Pro+ Plan:**
```
Maximum file size: 10MB total (configurable)
Function timeout: 60-300 seconds (configurable)
Recommended: Upload in reasonable batches (< 500 emails)
```

### Configuration Files

#### `vercel.json`
Configures function-specific settings:
- `maxDuration`: Function timeout (requires Pro+ for > 10s)
- `memory`: Allocated memory (3008MB max for Pro)

#### `next.config.ts`
Configures Next.js behavior:
- `serverActions.bodySizeLimit`: Applies to Server Actions only (not API routes)

### Environment Variables

Required environment variables in Vercel dashboard:

```bash
# Database (automatically set if using Vercel Postgres)
DATABASE_URL=postgresql://...

# AI API Keys
ANTHROPIC_API_KEY=sk-ant-api03-...
OPENAI_API_KEY=sk-...
GOOGLE_GENERATIVE_AI_API_KEY=AIza...

# Vercel Blob Storage (automatically set if enabled)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

### Deployment Checklist

1. **Configure Environment Variables**
   - Add all required API keys in Vercel dashboard
   - Enable Vercel Postgres for database
   - (Optional) Enable Vercel Blob for file storage backup

2. **Verify Plan Limits**
   - Check if your usage fits within Hobby plan limits
   - Consider upgrading to Pro if uploading > 4.5MB files

3. **Database Migrations**
   - Migrations run automatically via `vercel-build` script
   - Ensure `DATABASE_URL` is set before deployment

4. **Monitor First Deployment**
   - Check Vercel logs for any errors
   - Test file upload with small batches first
   - Verify database connectivity

### Common Issues

#### "Request timeout" or "Function timeout"
**Cause:** Upload taking longer than plan allows (10s for Hobby, 60s for Pro)

**Solutions:**
- Split files into smaller batches
- Upgrade to Pro or Enterprise plan
- Use the streaming upload endpoint for progress tracking

#### "Payload too large" or "413 Request Entity Too Large"
**Cause:** File size exceeds plan limit (4.5MB for Hobby, 10MB for Pro)

**Solutions:**
- Reduce file count in each upload batch
- Compress .eml files into smaller .zip archives
- Upgrade to Pro plan for 10MB limit
- Contact Vercel for custom Enterprise limits

#### "Database connection failed"
**Cause:** `DATABASE_URL` not set or invalid

**Solutions:**
- Verify environment variable is set in Vercel dashboard
- Check connection string format matches your database provider
- Use connection pooling URL for Neon/Supabase databases

#### "Blob storage error" (non-critical)
**Cause:** `BLOB_READ_WRITE_TOKEN` not set

**Impact:** File backup to blob storage skipped (emails still saved to database)

**Solution:** Enable Vercel Blob in your project settings (optional feature)

### Performance Optimization

For large-scale deployments:

1. **Use Streaming Upload** - Better progress tracking and error handling
2. **Enable Connection Pooling** - Use pooled database URL for concurrent requests
3. **Batch Processing** - Upload in batches of 100-500 emails
4. **Monitor Function Logs** - Check Vercel logs for performance bottlenecks

### Upgrade Path

If you're hitting Hobby plan limits:

1. **Upgrade to Pro** ($20/month per user)
   - Go to Vercel dashboard → Project Settings → Usage
   - Click "Upgrade to Pro"
   - Immediate access to higher limits

2. **Alternative: Split Deployments**
   - Deploy processing jobs to separate functions
   - Use queue/webhook pattern for long-running tasks
   - Keep hobby plan for light workloads

### Support Resources

- [Vercel Plan Comparison](https://vercel.com/pricing)
- [Vercel Function Limits](https://vercel.com/docs/functions/serverless-functions/runtimes#max-duration)
- [Next.js API Routes](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)
