import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, verifyToken } from '@/lib/token';

// First line of defence: no valid session cookie -> /login (pages) or 401 (API).
// Role checks and row-level access are enforced again on the server, per request.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === '/login' || pathname === '/api/auth/login') return NextResponse.next();

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const valid = token ? await verifyToken(token) : null;
  if (valid) return NextResponse.next();

  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'You are not signed in.' }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'] };
