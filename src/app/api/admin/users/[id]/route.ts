import { requireUser } from '@/lib/auth';
import { handle, ok, parseId, readJson } from '@/lib/http';
import { updateUser } from '@/lib/repo';
import { updateUserSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireUser(['admin']);
  await updateUser(admin, parseId((await params).id), updateUserSchema.parse(await readJson(req)));
  return ok();
});
