import { requireUser } from '@/lib/auth';
import { handle, ok, parseId, readJson } from '@/lib/http';
import { updateRule } from '@/lib/repo';
import { updateRuleSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handle<Ctx>(async (req, { params }) => {
  const admin = await requireUser(['admin']);
  await updateRule(admin, parseId((await params).id), updateRuleSchema.parse(await readJson(req)));
  return ok();
});
