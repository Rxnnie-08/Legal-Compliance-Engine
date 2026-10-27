import { requireUser } from '@/lib/auth';
import { handle, ok, readJson } from '@/lib/http';
import { createRule, listReferences, listRules } from '@/lib/repo';
import { createRuleSchema } from '@/lib/validation';

export const GET = handle(async () => {
  await requireUser(['admin']);
  return ok({ rules: await listRules(), references: await listReferences() });
});

export const POST = handle(async (req) => {
  const admin = await requireUser(['admin']);
  return ok({ ruleId: await createRule(admin, createRuleSchema.parse(await readJson(req))) }, 201);
});
