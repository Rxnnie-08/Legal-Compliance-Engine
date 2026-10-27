import { requireUser } from '@/lib/auth';
import { handle, ok, parseId } from '@/lib/http';
import { getCase, listDocumentsForCase } from '@/lib/repo';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => {
  const user = await requireUser();
  const id = parseId((await params).id);
  return ok({ case: await getCase(user, id), documents: await listDocumentsForCase(user, id) });
});
