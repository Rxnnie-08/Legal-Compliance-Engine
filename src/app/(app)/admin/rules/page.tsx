import { requirePageUser } from '@/lib/auth';
import { listReferences, listRules } from '@/lib/repo';
import RulesAdmin from '@/components/RulesAdmin';

export default async function RulesPage() {
  await requirePageUser(['admin']);
  const [rules, references] = await Promise.all([listRules(), listReferences()]);
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Rules and clause library</h1>
          <p>Each rule has standard (&ldquo;reference&rdquo;) clauses. New uploads are compared with them by vector similarity; thresholds decide what is flagged.</p>
        </div>
      </div>
      <RulesAdmin rules={rules} references={references} />
    </>
  );
}
