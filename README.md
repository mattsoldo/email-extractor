# Email Transaction Extractor

An intelligent system for extracting and managing financial transactions from email notifications using AI.

## Features

- 🤖 **AI-Powered Extraction** - Uses Claude, GPT, and Gemini to extract transactions
- 📧 **Email Processing** - Automatically parses .eml files and extracts structured data
- 🔄 **Multi-Run Comparison** - Compare extraction results from different AI models
- 📊 **Transaction Management** - Track, categorize, and export financial transactions
- 🎯 **Account Consolidation** - Automatically suggests account groupings
- ⏸️ **Pausable Jobs** - Pause and resume long-running extraction tasks
- 🔐 **Separate Dev/Prod** - Isolated databases for development and production

## Quick Start

### Prerequisites

- Node.js 18+ and pnpm
- PostgreSQL 16+ (or Docker)
- API keys for AI providers (Anthropic, OpenAI, Google)

### 1. Clone and Install

```bash
git clone https://github.com/mattsoldo/email-extractor.git
cd email-extractor
pnpm install
```

### 2. Set Up Local Database

**Using Docker (Recommended):**
```bash
docker run --name email-extractor-dev \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=email_extractor_dev \
  -p 5432:5432 \
  -d postgres:16
```

**Or see:** [docs/DATABASE_SETUP.md](docs/DATABASE_SETUP.md) for other options

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env.local

# Edit .env.local and add:
# - DATABASE_URL (local PostgreSQL)
# - ANTHROPIC_API_KEY
# - OPENAI_API_KEY
# - GOOGLE_GENERATIVE_AI_API_KEY
```

### 4. Initialize Database

```bash
# Run migrations to create schema
npm run db:migrate-sql

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Documentation

- **[Database Setup Guide](docs/DATABASE_SETUP.md)** - Complete database configuration
- **[Vercel Environment Setup](docs/VERCEL_ENV_SETUP.md)** - Deploy to production
- **[Migration Guide](migrations/README.md)** - Database migration system

## Development

### Available Scripts

```bash
# Development
npm run dev              # Start dev server with Turbopack
npm run build            # Build for production
npm run start            # Start production server

# Database
npm run db:migrate-sql   # Apply pending migrations
npm run db:reset-schema  # Reset database (⚠️ destroys data)
npm run db:studio        # Open Drizzle Studio
npm run db:snapshot      # Generate schema snapshot

# Testing
npm test                 # Run tests with Vitest
npm run test:coverage    # Generate coverage report
```

### Database Migrations

**Apply migrations:**
```bash
npm run db:migrate-sql
```

**Create new migration:**
1. Modify `src/db/schema.ts`
2. Run `npm run db:generate`
3. Review generated migration in `drizzle/`
4. Test locally
5. Commit and deploy

**Reset database (development only):**
```bash
npm run db:reset-schema -- --confirm
```

## Deployment

### Vercel (Recommended)

1. **Import project** to Vercel from GitHub
2. **Add environment variables** - See [VERCEL_ENV_SETUP.md](docs/VERCEL_ENV_SETUP.md)
3. **Deploy** - Migrations run automatically

Required environment variables:
- `DATABASE_URL` - Production PostgreSQL URL
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `GEMINI_API_KEY`

### Other Platforms

The app is a standard Next.js application and can be deployed to any platform supporting Node.js:
- Ensure migrations run before starting: `npm run db:migrate-sql && npm start`
- Set all required environment variables
- Use PostgreSQL 16+ for the database

## Architecture

### Tech Stack

- **Framework**: Next.js 16 with App Router
- **Database**: PostgreSQL with Drizzle ORM
- **AI**: Anthropic Claude, OpenAI GPT, Google Gemini
- **UI**: React 19, Tailwind CSS, Radix UI
- **Testing**: Vitest

### Project Structure

```
├── src/
│   ├── app/              # Next.js app router pages
│   ├── components/       # React components
│   ├── db/               # Database schema and connection
│   ├── services/         # Business logic
│   └── config/           # Configuration
├── migrations/           # SQL migration files
├── scripts/              # Utility scripts
└── docs/                 # Documentation
```

## Features in Detail

### AI Model Management

Configure and compare different AI models:
- **Models page**: Configure costs, context windows
- **Run comparison**: Side-by-side extraction comparison
- **Winner selection**: Choose best extraction per email

### Email Processing

1. Upload .eml files (drag & drop or folder scan)
2. AI extracts transactions (dividends, trades, transfers, etc.)
3. Review and validate extractions
4. Export to CSV or use data in-app

### Account Consolidation

- Automatically detect accounts across emails
- Suggest groupings for the same account
- Create "corpus" for consolidated views

### Pausable Extractions

- Pause long-running extraction jobs
- Resume without losing progress
- Cancel and clean up transactions

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT

## Support

- **Issues**: https://github.com/mattsoldo/email-extractor/issues
- **Docs**: See `docs/` directory
