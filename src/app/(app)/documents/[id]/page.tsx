import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageUser } from '@/lib/auth';
import { getDocumentReport } from '@/lib/repo';
import { HttpError } from '@/lib/http';
import { Score, StatusBadge, fmtDateTime } from '@/components/ui';
import IssueCard from '@/components/IssueCard';
import ClauseList from '@/components/ClauseList';
import DeleteDocument from '@/components/DeleteDocument';

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let r;
  try { r = await getDocumentReport(user, id); }
  catch (e) { if (e instanceof HttpError && e.status === 404) notFound(); throw e; }

  const { document: d, issues, clauses, scanResults } = r;
  const staff = user.role !== 'client';
  const open = issues.filter((i) => i.status === 'open');
  const closed = issues.filter((i) => i.status !== 'open');
  const flaggedClauses = new Map<number, string>();
  open.forEach((i) => { if (i.clause_id) flaggedClauses.set(i.clause_id, i.rule_title); });

  return (
    <>
      <div className="crumbs"><Link href="/cases">Cases</Link> / <Link href={`/cases/${d.case_id}`}>{d.case_number}</Link> / {d.title}</div>
      <div className="page-head">
        <div>
          <h1>{d.title}</h1>
          <p>Uploaded {fmtDateTime(d.uploaded_at)} by {d.uploaded_by_name} · {clauses.length} clauses analysed</p>
        </div>
        <div className="row"><StatusBadge status={d.status} />{staff && <DeleteDocument documentId={d.document_id} caseId={d.case_id} />}</div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="score-big" style={{ color: d.compliance_score == null ? 'var(--muted)' : d.compliance_score >= 80 ? 'var(--good)' : d.compliance_score >= 50 ? 'var(--med)' : 'var(--crit)' }}>{d.compliance_score == null ? '–' : Math.round(d.compliance_score)}</div><div className="l">compliance score (of 100)</div></div>
        <div className="stat"><div className="n">{d.open_issues}</div><div className="l">open issues</div></div>
        <div className={`stat ${d.critical_open ? 'warn' : ''}`}><div className="n">{d.critical_open}</div><div className="l">critical</div></div>
        <div className="stat"><div className="n">{scanResults.filter((s) => !issues.some((i) => i.rule_id === s.rule_id)).length}/{scanResults.length}</div><div className="l">rules satisfied</div></div>
      </div>

      <div className="split">
        <div className="stack">
          <section className="card">
            <h2>Issues to review</h2>
            {open.length === 0 ? <div className="empty">No open issues. Every active rule is satisfied or has been closed by a reviewer.</div>
              : open.map((i) => <IssueCard key={i.issue_id} issue={i} canEdit={staff} />)}
            {closed.length > 0 && (
              <details style={{ marginTop: 14 }}>
                <summary className="small muted" style={{ cursor: 'pointer' }}>{closed.length} closed issue{closed.length === 1 ? '' : 's'}</summary>
                <div style={{ marginTop: 10 }}>{closed.map((i) => <IssueCard key={i.issue_id} issue={i} canEdit={staff} />)}</div>
              </details>
            )}
          </section>

          <section className="card">
            <h2>Full text, clause by clause</h2>
            <ClauseList clauses={clauses} flagged={Object.fromEntries(flaggedClauses)} canSimilar={true} />
          </section>
        </div>

        <aside className="card" style={{ position: 'sticky', top: 16 }}>
          <h2>How each rule scored</h2>
          <p className="help" style={{ marginBottom: 10 }}>Best cosine similarity between a clause of this document and the library&rsquo;s standard wording.</p>
          <div className="table-wrap"><table>
            <thead><tr><th>Rule</th><th className="num">Match</th></tr></thead>
            <tbody>
              {scanResults.map((s) => {
                const flagged = issues.find((i) => i.rule_id === s.rule_id && i.status === 'open');
                return (
                  <tr key={s.rule_id}>
                    <td>{s.rule_title}<div className="muted small">{s.rule_type === 'restricted' ? 'flag if present ≥ ' + s.present_threshold : `ok ≥ ${s.standard_threshold}`}{s.best_clause_position ? ` · clause ${s.best_clause_position}` : ''}</div></td>
                    <td className="num"><span className="sim" style={{ color: flagged ? 'var(--crit)' : 'var(--good)' }}>{s.best_similarity.toFixed(2)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </aside>
      </div>
    </>
  );
}
