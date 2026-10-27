import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { search } from '@/lib/search';
import { searchSchema } from '@/lib/validation';

export const GET = handle(async (req) => {
  const user = await requireUser();
  const sp = new URL(req.url).searchParams;
  const { q, mode } = searchSchema.parse({ q: sp.get('q') ?? '', mode: sp.get('mode') ?? undefined });
  return ok(await search(user, q, mode));
});
