import { requireUser } from '@/lib/auth';
import { handle, ok, readJson } from '@/lib/http';
import { createCase, listCases } from '@/lib/repo';
import { createCaseSchema } from '@/lib/validation';

export const GET = handle(async () => ok({ cases: await listCases(await requireUser()) }));

export const POST = handle(async (req) => {
  const user = await requireUser(['admin', 'reviewer']);
  const body = createCaseSchema.parse(await readJson(req));
  return ok(await createCase(user, body), 201);
});
