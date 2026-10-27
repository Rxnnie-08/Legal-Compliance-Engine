import { requireUser } from '@/lib/auth';
import { handle, ok } from '@/lib/http';
import { reevaluateAll } from '@/lib/repo';

export const POST = handle(async () => {
  await reevaluateAll(await requireUser(['admin']));
  return ok();
});
