import type { NextFunction, Request, Response } from 'express';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Config } from './config.js';
import { HttpError } from './http.js';

export interface AuthUser {
  id: string;
  email?: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_ISSUER = 'travelsphere-local-dev';
const ISSUER = 'travelsphere';
const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** scrypt with a random salt, stored as "scrypt$<salt b64>$<hash b64>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${(await scryptAsync(password, salt, 64)).toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  const [scheme, salt, hash] = (stored ?? '').split('$');
  const ok = scheme === 'scrypt';
  // Hash even without a stored password, so an unknown email takes as long as a wrong password
  const actual = await scryptAsync(password, ok ? Buffer.from(salt, 'base64') : Buffer.alloc(16), 64);
  const expected = ok ? Buffer.from(hash, 'base64') : Buffer.alloc(64);
  return ok && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
  issueLocal?(user: AuthUser): Promise<string>;
}

export function createVerifier(config: Config): TokenVerifier {
  const toUser = (p: JWTPayload): AuthUser => {
    if (!p.sub || !UUID.test(p.sub)) throw new HttpError(401, 'invalid_token', 'Token subject is not a user id');
    return { id: p.sub, email: typeof p.email === 'string' ? p.email : undefined };
  };

  if (config.AUTH_MODE === 'local' || config.AUTH_MODE === 'password') {
    const issuer = config.AUTH_MODE === 'local' ? LOCAL_ISSUER : ISSUER;
    const secret = new TextEncoder().encode(config.AUTH_MODE === 'local' ? config.LOCAL_JWT_SECRET : config.JWT_SECRET);
    return {
      async verify(token) {
        const { payload } = await jwtVerify(token, secret, { issuer, algorithms: ['HS256'] });
        return toUser(payload);
      },
      async issueLocal(user) {
        return new SignJWT({ email: user.email, role: 'authenticated' })
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(user.id)
          .setIssuer(issuer)
          .setIssuedAt()
          .setExpirationTime('30d')
          .sign(secret);
      },
    };
  }

  // Supabase: asymmetric keys via JWKS (current projects) or the legacy shared HS256 secret
  const jwks = config.SUPABASE_URL
    ? createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', config.SUPABASE_URL))
    : undefined;
  const legacy = config.SUPABASE_JWT_SECRET ? new TextEncoder().encode(config.SUPABASE_JWT_SECRET) : undefined;

  return {
    async verify(token) {
      const opts = { audience: 'authenticated' };
      if (jwks) {
        try {
          return toUser((await jwtVerify(token, jwks, opts)).payload);
        } catch (err) {
          if (!legacy) throw err;
        }
      }
      return toUser((await jwtVerify(token, legacy!, { ...opts, algorithms: ['HS256'] })).payload);
    },
  };
}

/** Express middleware: requires a valid bearer token and sets req.user. */
export function requireAuth(verifier: TokenVerifier) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const header = req.headers.authorization || '';
    const match = /^Bearer\s+(.+)$/i.exec(header);
    if (!match) return next(new HttpError(401, 'unauthenticated', 'Sign in required'));
    try {
      req.user = await verifier.verify(match[1]);
      next();
    } catch (err) {
      next(err instanceof HttpError ? err : new HttpError(401, 'invalid_token', 'Session is invalid or expired'));
    }
  };
}
