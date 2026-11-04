import type { NextFunction, Request, Response } from 'express';
import { z, ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

/** Parse and validate; throws a 400 with field-level details. */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new HttpError(400, 'validation_failed', 'Some fields are invalid', fieldErrors(result.error));
  }
  return result.data;
}

const fieldErrors = (e: ZodError) =>
  e.issues.map(i => ({ field: i.path.join('.') || '(body)', message: i.message }));

/** Wrap async handlers so rejections reach the error middleware (Express 5 also does this natively). */
export const route =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

// Postgres error codes we translate into client errors
const PG_CODES: Record<string, [number, string, string]> = {
  '23505': [409, 'conflict', 'A record with these values already exists'],
  '23503': [400, 'invalid_reference', 'A referenced record does not exist'],
  '23514': [400, 'constraint_violation', 'A value is outside the allowed range'],
  '22P02': [400, 'invalid_input', 'A value has an invalid format'],
  '22007': [400, 'invalid_input', 'A date or time has an invalid format'],
  '22008': [400, 'invalid_input', 'A date or time is out of range'],
  '42501': [403, 'forbidden', 'You do not have permission for this action'],
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  const pgCode = (err as { code?: string })?.code;
  if (pgCode && PG_CODES[pgCode]) {
    const [status, code, message] = PG_CODES[pgCode];
    return res.status(status).json({ error: { code, message } });
  }
  if ((err as { type?: string })?.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'invalid_json', message: 'Request body is not valid JSON' } });
  }
  // Never leak internals; log server-side without request bodies (may contain personal data)
  console.error('[unhandled]', (err as Error)?.message || err);
  return res.status(500).json({ error: { code: 'internal', message: 'Something went wrong' } });
}
