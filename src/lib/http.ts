import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const ok = (data: unknown = { ok: true }, status = 200) => NextResponse.json(data, { status });

/** Parse an id coming from a URL segment. */
export function parseId(value: string, label = 'id'): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, `Invalid ${label}.`);
  return n;
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
}

// PostgreSQL error codes that are caused by bad input rather than by a bug
const PG_STATUS: Record<string, number> = {
  '23505': 409, // unique_violation
  '23503': 409, // foreign_key_violation
  '23514': 400, // check_violation
  '23502': 400, // not_null_violation
  '22P02': 400, // invalid_text_representation
  P0001: 400, // raise_exception
};

/** Wrap a route handler so that every error becomes a clean JSON response. */
export function handle<C = unknown>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    try {
      return await fn(req, ctx);
    } catch (err) {
      if (err instanceof HttpError) return NextResponse.json({ error: err.message }, { status: err.status });
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: err.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ') },
          { status: 400 },
        );
      }
      const e = err as { code?: string; message?: string; status?: number; name?: string };
      if (e.name === 'OllamaError') return NextResponse.json({ error: e.message }, { status: e.status ?? 503 });
      if (e.code && PG_STATUS[e.code]) {
        return NextResponse.json({ error: e.message ?? 'Database constraint violated.' }, { status: PG_STATUS[e.code] });
      }
      console.error('[api error]', err);
      return NextResponse.json({ error: 'Unexpected server error.' }, { status: 500 });
    }
  };
}
