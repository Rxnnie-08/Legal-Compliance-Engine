import { requireUser } from '@/lib/auth';
import { handle, ok, parseId } from '@/lib/http';
import { similarClauses } from '@/lib/search';

type Ctx = { params: Promise<{ id: string }> };

export const GET = handle<Ctx>(async (_req, { params }) => ok(await similarClauses(await requireUser(), parseId((await params).id))));
