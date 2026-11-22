import { z } from 'zod';

const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  /** "supabase": verify Supabase-issued JWTs. "local": dev-only tokens issued by this server. */
  AUTH_MODE: z.enum(['local', 'supabase']).default('local'),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_JWT_SECRET: z.string().min(32).optional(),
  LOCAL_JWT_SECRET: z.string().min(32).optional(),
  CORS_ORIGINS: z.string().default('http://127.0.0.1:3000,http://localhost:3000'),
  /** Python risk-intelligence service (FastAPI). Internal only — never exposed to browsers. */
  RISK_SERVICE_URL: z.string().url().default('http://127.0.0.1:8001'),
  RISK_SERVICE_TOKEN: z.string().min(32).optional(),
  RISK_SERVICE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300_000).default(120_000),
  /** Destination assessments younger than this are served from the database instead of recomputed. */
  ASSESSMENT_MAX_AGE_MIN: z.coerce.number().int().min(1).max(1440).default(30),
  /** Firebase Cloud Messaging (HTTP v1). Both required to send push; otherwise alerts stay in-app. */
  FCM_PROJECT_ID: z.string().min(1).optional(),
  FCM_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
  /** LiteAPI (Nuitée) hotel inventory. Free sandbox key: https://connect.nuitee.com → Developer tools. */
  LITEAPI_API_KEY: z.string().min(10).optional(),
  /** sandbox: bookings are simulated. production: real reservations billed to the LiteAPI account. */
  LITEAPI_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
  /** Production bookings stay disabled unless this is explicitly true. */
  LITEAPI_ALLOW_LIVE_BOOKINGS: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  LITEAPI_TIMEOUT_MS: z.coerce.number().int().min(2000).max(120_000).default(30_000),
});

export type Config = z.infer<typeof Env> & { corsOrigins: string[] };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid server configuration — ${issues}`);
  }
  const c = parsed.data;

  if (c.AUTH_MODE === 'local') {
    if (c.NODE_ENV === 'production') {
      throw new Error('AUTH_MODE=local is a development mode and is refused when NODE_ENV=production');
    }
    if (!c.LOCAL_JWT_SECRET) throw new Error('AUTH_MODE=local requires LOCAL_JWT_SECRET (32+ characters)');
  }
  if (c.NODE_ENV === 'production' && !c.RISK_SERVICE_TOKEN) {
    throw new Error('RISK_SERVICE_TOKEN (32+ characters) is required when NODE_ENV=production');
  }
  if (c.AUTH_MODE === 'supabase' && !c.SUPABASE_URL && !c.SUPABASE_JWT_SECRET) {
    throw new Error('AUTH_MODE=supabase requires SUPABASE_URL (JWKS) or SUPABASE_JWT_SECRET');
  }

  return { ...c, corsOrigins: c.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) };
}
