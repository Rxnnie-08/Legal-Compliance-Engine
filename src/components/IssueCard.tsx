'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';
import { SeverityBadge, StatusBadge, kindLabel } from './ui';
import type { IssueRow } from '@/lib/types';

export default function IssueCard({ issue, canEdit }: { issue: IssueRow; canEdit: boolean }) {
  const router = useRouter();
  const [explanation, setExplanation] = useState(issue.explanation);
  const [busy, setBusy] = useState<'explain' | 'status' | null>(null);
  const [error, setError] = useState('');
  const closed = issue.status !== 'open';

  async function explain(regenerate = false) {
    setBusy('explain'); setError('');
    try {
      const r = await call<{ explanation: string }>('POST', `/api/issues/${issue.issue_id}/explain${regenerate ? '?regenerate=1' : ''}`);
      setExplanation(r.explanation);
    } catch (e) { setError((e as Error).message); }
    setBusy(null);
  }

  async function setStatus(status: 'open' | 'resolved' | 'dismissed') {
    setBusy('status'); setError('');
    try { await call('PATCH', `/api/issues/${issue.issue_id}`, { status }); router.refresh(); }
    catch (e) { setError((e as Error).message); setBusy(null); }
  }

  return (
    <article className={`issue sev-${issue.severity} ${closed ? 'done' : ''}`}>
      <div className="row between">
        <div className="row">
          <h3>{issue.rule_title}</h3>
          <SeverityBadge severity={issue.severity} />
          <span className="small muted">{kindLabel[issue.kind]}</span>
        </div>
        {closed && <StatusBadge status={issue.status} />}
      </div>
      <p className="small muted" style={{ marginTop: 4 }}>{issue.rule_description}</p>

      {issue.clause_body ? (
        <div className="quote">
          <div className="small muted" style={{ fontFamily: 'var(--sans)', marginBottom: 2 }}>
            {issue.rule_type === 'restricted' ? 'Matching clause' : 'Closest clause found'} (clause {issue.clause_position}, similarity <span className="sim">{issue.similarity.toFixed(2)}</span>)
          </div>
          {issue.clause_body.length > 420 ? issue.clause_body.slice(0, 420) + '…' : issue.clause_body}
        </div>
      ) : (
        <p className="small" style={{ margin: '8px 0' }}>No clause in this document resembles the standard wording (similarity {issue.similarity.toFixed(2)}).</p>
      )}

      {explanation && (
        <div className="explain">
          <div className="t">Plain-English explanation (generated locally by Ollama from the retrieved standard wording)</div>
          <p style={{ whiteSpace: 'pre-wrap' }}>{explanation}</p>
        </div>
      )}

      {closed && issue.resolved_by_name && <p className="small muted" style={{ marginTop: 8 }}>Marked {issue.status} by {issue.resolved_by_name}.</p>}
      {error && <div className="msg err" role="alert">{error}</div>}

      {canEdit && (
        <div className="row" style={{ marginTop: 12 }}>
          {!closed && (
            <button className="btn secondary small" onClick={() => explain(!!explanation)} disabled={busy !== null}>
              {busy === 'explain' && <span className="spin" />}{explanation ? 'Regenerate explanation' : 'Explain this issue'}
            </button>
          )}
          {!closed ? (
            <>
              <button className="btn small" onClick={() => setStatus('resolved')} disabled={busy !== null}>Mark resolved</button>
              <button className="btn ghost small" onClick={() => setStatus('dismissed')} disabled={busy !== null}>Dismiss</button>
            </>
          ) : (
            <button className="btn ghost small" onClick={() => setStatus('open')} disabled={busy !== null}>Re-open</button>
          )}
        </div>
      )}
    </article>
  );
}
