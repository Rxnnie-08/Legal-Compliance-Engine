// JWT helpers built on `jose` only, so that they also run in the Edge runtime (middleware).
import { SignJWT, jwtVerify } from 'jose';

export const SESSION_COOKIE = 'lce_session';
export const SESSION_HOURS = 8;

function key(): Uint8Array {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error('JWT_SECRET must be set and at least 32 characters long.');
  return new TextEncoder().encode(s);
}

export async function signToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_HOURS}h`)
    .sign(key());
}

export async function verifyToken(token: string): Promise<{ userId: number } | null> {
  try {
    const { payload } = await jwtVerify(token, key(), { algorithms: ['HS256'] });
    const id = Number(payload.sub);
    return Number.isInteger(id) ? { userId: id } : null;
  } catch {
    return null;
  }
}
