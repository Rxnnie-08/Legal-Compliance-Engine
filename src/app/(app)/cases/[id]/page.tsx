import Link from 'next/link';
import { requirePageUser } from '@/lib/auth';
import { getCase, listDocumentsForCase, listUsersByRole } from '@/lib/repo';
import { HttpError } from '@/lib/http';
import { notFound } from 'next/navigation';
import { Score, StatusBadge, fmtDate } from '@/components/ui';
import UploadForm from '@/components/UploadForm';
import ReviewerPanel from '@/components/ReviewerPanel';

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();

  let c, docs;
  try {
    [c, docs] = await Promise.all([getCase(user, id), listDocumentsForCase(user, id)]);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const staff = user.role !== 'client';
  const reviewers = staff ? await listUsersByRole('reviewer') : [];

  return (
    <>
      <div className="crumbs"><Link href="/cases">Cases</Link> / {c.case_number}</div>
      <div className="page-head">
        <div>
          <h1>{c.title}</h1>
          <p>{c.description || 'No description.'}</p>
        </div>
        <StatusBadge status={c.status} />
      </div>

      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="stat"><div className="n" style={{ fontSize: 20 }}>{c.client_name}</div><div className="l">client</div></div>
        <div className="stat"><div className="n">{c.document_count}</div><div className="l">documents</div></div>
        <div className="stat"><div className="n">{c.avg_score ?? '–'}</div><div className="l">average score</div></div>
        <div className="stat"><div className="n">{c.open_issues}</div><div className="l">open issues</div></div>
      </div>

      <div className="stack">
        {staff && <UploadForm caseId={c.case_id} />}

        <section className="card">
          <h2>Documents</h2>
          {docs.length === 0 ? <div className="empty">No documents in this case yet.{staff && ' Upload a contract above.'}</div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Document</th><th>Status</th><th>Score</th><th>Open issues</th><th>Uploaded</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.document_id}>
                    <td><Link href={`/documents/${d.document_id}`}><b>{d.title}</b></Link><div className="muted small">by {d.uploaded_by_name}</div></td>
                    <td><StatusBadge status={d.status} /></td>
                    <td><Score value={d.compliance_score} /></td>
                    <td className="small">
                      {d.open_issues === 0 ? <span className="muted">none</span> : (
                        <>{d.critical_open > 0 && <span className="badge sev-critical">{d.critical_open} critical</span>}{' '}
                          {d.high_open > 0 && <span className="badge sev-high">{d.high_open} high</span>}{' '}
                          {d.medium_open > 0 && <span className="badge sev-medium">{d.medium_open} medium</span>}{' '}
                          {d.low_open > 0 && <span className="badge sev-low">{d.low_open} low</span>}</>
                      )}
                    </td>
                    <td className="muted small">{fmtDate(d.uploaded_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
        </section>

        <ReviewerPanel caseId={c.case_id} assigned={c.reviewers} candidates={reviewers} canEdit={staff} />
      </div>
    </>
  );
}
