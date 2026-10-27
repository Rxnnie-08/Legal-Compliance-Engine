import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { listAudit } from '@/lib/repo';

export const GET = handle(async (req) => {
  await requireUser(['admin']);
  const type = new URL(req.url).searchParams.get('type') ?? undefined;
  return ok({ entries: await listAudit(type) });
});
