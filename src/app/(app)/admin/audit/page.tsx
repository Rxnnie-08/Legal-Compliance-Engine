import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { listAudit } from '@/lib/repo';
import { fmtDateTime } from '@/components/ui';

const TYPES = ['document', 'issue', 'case', 'rule', 'user'];

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  await requirePageUser(['admin']);
  const { type } = await searchParams;
  const active = TYPES.includes(type ?? '') ? type : undefined;
  const entries = await listAudit(active, 200);

  return (
    <>
      <div className="page-head"><div><h1>Audit log</h1><p>Every upload, flag, resolution and administrative change. The table is append-only: a database trigger rejects any UPDATE or DELETE.</p></div></div>
      <div className="row" style={{ marginBottom: 14 }}>
        <Link className={`btn small ${active ? 'ghost' : ''}`} href="/admin/audit">All</Link>
        {TYPES.map((t) => <Link key={t} className={`btn small ${active === t ? '' : 'ghost'}`} href={`/admin/audit?type=${t}`}>{t}</Link>)}
      </div>
      <section className="card">
        {entries.length === 0 ? <div className="empty">No entries.</div> : (
          <div className="table-wrap"><table>
            <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.log_id}>
                  <td className="small muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(e.created_at)}</td>
                  <td>{e.actor}</td>
                  <td><span className="mono">{e.action}</span></td>
                  <td className="small">{e.entity_type}{e.entity_id ? ` #${e.entity_id}` : ''}</td>
                  <td className="mono muted" style={{ maxWidth: 360, overflowWrap: 'anywhere' }}>{JSON.stringify(e.details)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
