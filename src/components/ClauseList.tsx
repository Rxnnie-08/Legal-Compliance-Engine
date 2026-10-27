'use client';
import { useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/client';
import type { ClauseRow, SearchHit } from '@/lib/types';

export default function ClauseList({ clauses, flagged, canSimilar }: { clauses: ClauseRow[]; flagged: Record<number, string>; canSimilar: boolean }) {
  const [similar, setSimilar] = useState<Record<number, SearchHit[] | 'loading' | string>>({});

  async function find(id: number) {
    setSimilar((s) => ({ ...s, [id]: 'loading' }));
    try {
      const r = await call<{ hits: SearchHit[] }>('GET', `/api/clauses/${id}/similar`);
      setSimilar((s) => ({ ...s, [id]: r.hits }));
    } catch (e) { setSimilar((s) => ({ ...s, [id]: (e as Error).message })); }
  }

  return (
    <div>
      {clauses.map((c) => {
        const sim = similar[c.clause_id];
        return (
          <div key={c.clause_id} className={`clause ${flagged[c.clause_id] ? 'flag' : ''}`} id={`clause-${c.position}`}>
            <div className="no">{c.position}</div>
            <div>
              {c.heading && <div className="small" style={{ fontWeight: 600 }}>{c.heading}{flagged[c.clause_id] && <span className="badge sev-high" style={{ marginLeft: 8 }}>flagged: {flagged[c.clause_id]}</span>}</div>}
              {!c.heading && flagged[c.clause_id] && <div className="small"><span className="badge sev-high">flagged: {flagged[c.clause_id]}</span></div>}
              <p className="body">{c.body}</p>
              {canSimilar && (
                <div style={{ marginTop: 6 }}>
                  <button className="btn ghost small" onClick={() => find(c.clause_id)} disabled={sim === 'loading'}>
                    {sim === 'loading' && <span className="spin" />}Find similar clauses in other documents
                  </button>
                </div>
              )}
              {Array.isArray(sim) && (
                <div style={{ marginTop: 8 }}>
                  {sim.length === 0 ? <p className="small muted">No similar clauses found elsewhere.</p> : sim.map((h) => (
                    <div key={h.clause_id} className="small" style={{ padding: '4px 0', borderTop: '1px solid var(--line-2)' }}>
                      <span className="sim">{(h.vector_score ?? 0).toFixed(2)}</span>{' '}
                      <Link href={`/documents/${h.document_id}#clause-${h.position}`}>{h.document_title}</Link>{' '}
                      <span className="muted">({h.case_number}, clause {h.position})</span>
                      <div className="muted">{h.snippet}</div>
                    </div>
                  ))}
                </div>
              )}
              {typeof sim === 'string' && sim !== 'loading' && <div className="msg err">{sim}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
