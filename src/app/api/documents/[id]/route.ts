import { requireUser } from '@/lib/auth';
import { handle, ok, parseId } from '@/lib/http';
import { deleteDocument, getDocumentReport } from '@/lib/repo';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => ok(await getDocumentReport(await requireUser(), parseId((await params).id))));

export const DELETE = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser(['admin', 'reviewer']);
  await deleteDocument(user, parseId((await params).id));
  return ok();
});
