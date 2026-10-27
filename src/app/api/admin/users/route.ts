import { requireUser } from '@/lib/auth';
import { handle, ok, readJson } from '@/lib/http';
import { createUser, listUsers } from '@/lib/repo';
import { createUserSchema } from '@/lib/validation';

export const GET = handle(async () => {
  await requireUser(['admin']);
  return ok({ users: await listUsers() });
});

export const POST = handle(async (req) => {
  const admin = await requireUser(['admin']);
  return ok({ userId: await createUser(admin, createUserSchema.parse(await readJson(req))) }, 201);
});
