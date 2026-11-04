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
  if (c.AUTH_MODE === 'supabase' && !c.SUPABASE_URL && !c.SUPABASE_JWT_SECRET) {
    throw new Error('AUTH_MODE=supabase requires SUPABASE_URL (JWKS) or SUPABASE_JWT_SECRET');
  }

  return { ...c, corsOrigins: c.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean) };
}
