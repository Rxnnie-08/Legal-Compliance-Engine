import { requireUser } from '@/lib/auth';
import { handle, ok, parseId } from '@/lib/http';
import { deleteReference } from '@/lib/repo';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const admin = await requireUser(['admin']);
  await deleteReference(admin, parseId((await params).id));
  return ok();
});
