import type { NextFunction, Request, Response } from 'express';
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

export interface TokenVerifier {
  verify(token: string): Promise<AuthUser>;
  issueLocal?(user: AuthUser): Promise<string>;
}

export function createVerifier(config: Config): TokenVerifier {
  const toUser = (p: JWTPayload): AuthUser => {
    if (!p.sub || !UUID.test(p.sub)) throw new HttpError(401, 'invalid_token', 'Token subject is not a user id');
    return { id: p.sub, email: typeof p.email === 'string' ? p.email : undefined };
  };

  if (config.AUTH_MODE === 'local') {
    const secret = new TextEncoder().encode(config.LOCAL_JWT_SECRET);
    return {
      async verify(token) {
        const { payload } = await jwtVerify(token, secret, { issuer: LOCAL_ISSUER, algorithms: ['HS256'] });
        return toUser(payload);
      },
      async issueLocal(user) {
        return new SignJWT({ email: user.email, role: 'authenticated' })
          .setProtectedHeader({ alg: 'HS256' })
          .setSubject(user.id)
          .setIssuer(LOCAL_ISSUER)
          .setIssuedAt()
          .setExpirationTime('12h')
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
