import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { listCases, listUsersByRole } from '@/lib/repo';
import { Score, StatusBadge, fmtDate } from '@/components/ui';
import NewCaseForm from '@/components/NewCaseForm';

export default async function CasesPage() {
  const user = await requirePageUser();
  const [cases, clients] = await Promise.all([listCases(user), user.role === 'client' ? [] : listUsersByRole('client')]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Cases</h1>
          <p>{user.role === 'client' ? 'Matters your legal team is handling for you.' : 'Each case groups the contracts of one client matter.'}</p>
        </div>
      </div>

      <div className="stack">
        {user.role !== 'client' && <NewCaseForm clients={clients} />}
        <section className="card">
          {cases.length === 0 ? <div className="empty">No cases yet.</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Case</th><th>Client</th><th>Status</th><th className="num">Documents</th><th>Avg score</th><th className="num">Open issues</th><th>Created</th></tr></thead>
              <tbody>
                {cases.map((c) => (
                  <tr key={c.case_id}>
                    <td><Link href={`/cases/${c.case_id}`}><b>{c.title}</b></Link><div className="muted small mono">{c.case_number}</div></td>
                    <td>{c.client_name}</td>
                    <td><StatusBadge status={c.status} /></td>
                    <td className="num">{c.document_count}</td>
                    <td><Score value={c.avg_score} /></td>
                    <td className="num">{c.open_issues}</td>
                    <td className="muted small">{fmtDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>
      </div>
    </>
  );
}
