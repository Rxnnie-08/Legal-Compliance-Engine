import { requireUser } from '@/lib/auth';
import { handle, ok, parseId, readJson } from '@/lib/http';
import { updateIssueStatus } from '@/lib/repo';
import { issueStatusSchema } from '@/lib/validation';

type Ctx = { params: Promise<{ id: string }> };

// Only staff can resolve / dismiss / re-open an issue; clients are read-only.
export const PATCH = handle<Ctx>(async (req, { params }) => {
  const user = await requireUser(['admin', 'reviewer']);
  const { status } = issueStatusSchema.parse(await readJson(req));
  await updateIssueStatus(user, parseId((await params).id), status);
  return ok();
});
