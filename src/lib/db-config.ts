/**
 * Database Configuration Utilities
 *
 * Centralized logic for database connection configuration,
 * SSL detection, and environment detection.
 */

export function detectSSLRequirement(databaseUrl?: string): boolean {
  const url = databaseUrl || process.env.DATABASE_URL || "";

  // Check environment indicators
  const isProductionEnv =
    process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

  // Check for known hosted database providers (they require SSL)
  const hostedProviders = [
    "neon.tech", // Neon (Vercel's default)
    "vercel-storage", // Vercel Postgres
    "supabase.co", // Supabase
    "amazonaws.com", // AWS RDS
    "digitalocean.com", // DigitalOcean
    "railway.app", // Railway
    "render.com", // Render
    "planetscale.com", // PlanetScale
  ];

  const isHostedDatabase = hostedProviders.some((provider) =>
    url.includes(provider)
  );

  return isProductionEnv || isHostedDatabase;
}

export function getSSLConfig(databaseUrl?: string) {
  const needsSSL = detectSSLRequirement(databaseUrl);

  if (!needsSSL) {
    return false;
  }

  // For hosted databases, we typically need SSL but with relaxed certificate validation
  // This is because many hosted providers use self-signed or internal certificates
  return {
    rejectUnauthorized: false,
  };
}

export function isProductionDatabase(databaseUrl?: string): boolean {
  const url = databaseUrl || process.env.DATABASE_URL || "";

  // Check for production indicators in URL
  const productionIndicators = [
    "prod",
    "production",
    "neon.tech",
    "vercel-storage",
    "supabase.co",
  ];

  return productionIndicators.some((indicator) =>
    url.toLowerCase().includes(indicator)
  );
}

export function isDevelopmentDatabase(databaseUrl?: string): boolean {
  const url = databaseUrl || process.env.DATABASE_URL || "";

  // Check for development indicators
  const devIndicators = ["localhost", "127.0.0.1", "dev", "local"];

  return devIndicators.some((indicator) =>
    url.toLowerCase().includes(indicator)
  );
}
