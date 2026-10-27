'use client';

/** Small fetch wrapper for client components: returns JSON or throws an Error with the server's message. */
export async function call<T = any>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data as T;
}
