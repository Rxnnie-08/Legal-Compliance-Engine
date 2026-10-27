import { requireUser } from '@/lib/auth';
import { handle, ok, parseId, readJson } from '@/lib/http';
import { assignReviewer, unassignReviewer } from '@/lib/repo';
import { assignSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(['admin', 'reviewer']);
  const { userId } = assignSchema.parse(await readJson(req));
  await assignReviewer(user, parseId((await params).id), userId);
  return ok();
});

export const DELETE = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(['admin', 'reviewer']);
  const { userId } = assignSchema.parse(await readJson(req));
  await unassignReviewer(user, parseId((await params).id), userId);
  return ok();
});
