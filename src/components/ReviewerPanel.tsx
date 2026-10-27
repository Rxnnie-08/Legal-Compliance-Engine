'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

type P = { user_id: number; full_name: string; email: string };

export default function ReviewerPanel({ caseId, assigned, candidates, canEdit }: { caseId: number; assigned: P[]; candidates: P[]; canEdit: boolean }) {
  const router = useRouter();
  const [pick, setPick] = useState('');
  const [error, setError] = useState('');
  const ids = new Set(assigned.map((a) => a.user_id));
  const options = candidates.filter((c) => !ids.has(c.user_id));

  async function act(method: 'POST' | 'DELETE', userId: number | string) {
    setError('');
    try { await call(method, `/api/cases/${caseId}/reviewers`, { userId }); setPick(''); router.refresh(); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <section className="card">
      <h2>Reviewers on this case</h2>
      {assigned.length === 0 ? <p className="muted">No reviewers assigned.</p> : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {assigned.map((a) => (
            <li key={a.user_id} className="row between" style={{ padding: '6px 0', borderBottom: '1px solid var(--line-2)' }}>
              <span>{a.full_name} <span className="muted small">{a.email}</span></span>
              {canEdit && <button className="btn danger small" onClick={() => act('DELETE', a.user_id)}>Remove</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && options.length > 0 && (
        <div className="row" style={{ marginTop: 12 }}>
          <select aria-label="Reviewer to add" value={pick} onChange={(e) => setPick(e.target.value)} style={{ maxWidth: 320 }}>
            <option value="">Add a reviewer…</option>
            {options.map((o) => <option key={o.user_id} value={o.user_id}>{o.full_name}</option>)}
          </select>
          <button className="btn secondary" disabled={!pick} onClick={() => act('POST', pick)}>Assign</button>
        </div>
      )}
      {error && <div className="msg err" role="alert">{error}</div>}
    </section>
  );
}
