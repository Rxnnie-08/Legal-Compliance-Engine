import { requireUser } from '@/lib/auth';
import { handle, ok, parseId, readJson } from '@/lib/http';
import { addReference } from '@/lib/repo';
import { referenceSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export const POST = handle<Ctx>(async (req, { params }) => {
  const admin = await requireUser(['admin']);
  const refId = await addReference(admin, parseId((await params).id), referenceSchema.parse(await readJson(req)));
  return ok({ refId }, 201);
});
