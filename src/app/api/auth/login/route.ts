import { authenticate, startSession } from '@/lib/auth';
import { handle, ok, readJson } from '@/lib/http';
import { loginSchema } from '@/lib/validation';

export const POST = handle(async (req) => {
  const { email, password } = loginSchema.parse(await readJson(req));
  const user = await authenticate(email, password);
  await startSession(user.userId);
  return ok({ user });
});
