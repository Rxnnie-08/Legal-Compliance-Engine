import bcrypt from 'bcryptjs';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { queryOne } from './db';
import { env } from './env';
import { HttpError } from './http';
import { SESSION_COOKIE, SESSION_HOURS, signToken, verifyToken } from './token';
import type { Role, SessionUser } from './types';

const BCRYPT_COST = 11;
// hash used to keep login timing similar when the e-mail does not exist
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_COST);

export const hashPassword = (plain: string) => bcrypt.hash(plain, BCRYPT_COST);

// ---- very small in-memory brute-force protection (per e-mail) ----
const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000;

function checkLocked(email: string) {
  const a = attempts.get(email);
  if (a && a.resetAt > Date.now() && a.count >= MAX_ATTEMPTS) {
    throw new HttpError(429, 'Too many failed sign-in attempts. Try again in 15 minutes.');
  }
}
function recordFailure(email: string) {
  const a = attempts.get(email);
  if (!a || a.resetAt <= Date.now()) attempts.set(email, { count: 1, resetAt: Date.now() + WINDOW_MS });
  else a.count += 1;
}

export async function authenticate(email: string, password: string): Promise<SessionUser> {
  const key = email.toLowerCase();
  checkLocked(key);
  const row = await queryOne<{ user_id: number; full_name: string; email: string; password_hash: string; role: Role; is_active: boolean }>(
    `SELECT user_id, full_name, email, password_hash, role, is_active FROM users WHERE lower(email) = $1`,
    [key],
  );
  const ok = await bcrypt.compare(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || !row.is_active) {
    recordFailure(key);
    throw new HttpError(401, 'Incorrect e-mail or password.');
  }
  attempts.delete(key);
  return { userId: row.user_id, fullName: row.full_name, email: row.email, role: row.role };
}

export async function startSession(userId: number) {
  const token = await signToken(userId);
  // `Secure` only when the request really arrived over HTTPS (so `npm start` on http://localhost still works)
  const https = (await headers()).get('x-forwarded-proto') === 'https';
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.isProd && https,
    path: '/',
    maxAge: SESSION_HOURS * 3600,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in user (re-read from the database so deactivation / role changes apply immediately). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const verified = await verifyToken(token);
  if (!verified) return null;
  const row = await queryOne<{ user_id: number; full_name: string; email: string; role: Role }>(
    `SELECT user_id, full_name, email, role FROM users WHERE user_id = $1 AND is_active`,
    [verified.userId],
  );
  return row ? { userId: row.user_id, fullName: row.full_name, email: row.email, role: row.role } : null;
}

/** For API route handlers: throws 401 / 403. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new HttpError(401, 'You are not signed in.');
  if (roles && !roles.includes(user.role)) throw new HttpError(403, 'Your role is not allowed to do this.');
  return user;
}

/** For server-rendered pages: redirects instead of throwing. */
export async function requirePageUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  if (roles && !roles.includes(user.role)) redirect('/');
  return user;
}
