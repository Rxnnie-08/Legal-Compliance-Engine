import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { dashboard } from '@/lib/repo';
import { Score, SeverityBadge } from '@/components/ui';

export default async function Dashboard() {
  const user = await requirePageUser();
  const { totals, attention, byRule } = await dashboard(user);
  const maxV = Math.max(1, ...byRule.map((r) => r.open_violations));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>{user.role === 'client' ? 'Compliance status of the documents in your cases.' : 'Where your contracts need attention right now.'}</p>
        </div>
        {user.role !== 'client' && <Link href="/cases" className="btn">Open cases</Link>}
      </div>

      <div className="grid cols-4">
        <div className="stat"><div className="n">{totals.documents}</div><div className="l">documents in {totals.cases} case{totals.cases === 1 ? '' : 's'}</div></div>
        <div className="stat"><div className="n">{totals.avg_score ?? '–'}</div><div className="l">average compliance score</div></div>
        <div className="stat"><div className="n">{totals.open_issues}</div><div className="l">open issues</div></div>
        <div className={`stat ${totals.critical_open ? 'warn' : ''}`}><div className="n">{totals.critical_open}</div><div className="l">critical issues open</div></div>
      </div>

      <div className="split" style={{ marginTop: 16 }}>
        <section className="card">
          <h2>Documents needing attention</h2>
          {attention.length === 0 ? (
            <div className="empty">No scanned documents yet. {user.role !== 'client' && <>Open a case and upload a contract to see it here.</>}</div>
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th>Document</th><th>Case</th><th>Score</th><th className="num">Open</th></tr></thead>
              <tbody>
                {attention.map((d) => (
                  <tr key={d.document_id}>
                    <td><Link href={`/documents/${d.document_id}`}>{d.title}</Link></td>
                    <td className="muted small">{d.case_number}</td>
                    <td><Score value={d.compliance_score} /></td>
                    <td className="num">{d.open_issues}{d.critical_open > 0 && <> <SeverityBadge severity="critical" /></>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>

        <section className="card">
          <h2>Open violations by rule</h2>
          {byRule.length === 0 ? <div className="empty">No active rules.</div> : (
            <div className="stack">
              {byRule.map((r) => (
                <div key={r.rule_id}>
                  <div className="row between small"><span>{r.title}</span><b>{r.open_violations}</b></div>
                  <div style={{ height: 6, background: 'var(--line-2)', borderRadius: 3, marginTop: 4 }}>
                    <div style={{ width: `${(r.open_violations / maxV) * 100}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
