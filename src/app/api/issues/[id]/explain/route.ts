import { requireUser } from '@/lib/auth';
import { explainIssue } from '@/lib/explain';
import { handle, ok, parseId } from '@/lib/http';

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(['admin', 'reviewer']);
  const force = new URL(req.url).searchParams.get('regenerate') === '1';
  return ok({ explanation: await explainIssue(user, parseId((await params).id), force) });
});
