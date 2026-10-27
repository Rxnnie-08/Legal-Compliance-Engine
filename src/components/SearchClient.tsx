'use client';
import { useState } from 'react';
import Link from 'next/link';
import { call } from '@/lib/client';
import type { SearchHit } from '@/lib/types';

type Mode = 'hybrid' | 'semantic' | 'keyword';
const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'hybrid', label: 'Hybrid', hint: 'Full-text (PostgreSQL) and vector (Qdrant) results fused with Reciprocal Rank Fusion' },
  { id: 'semantic', label: 'Semantic', hint: 'Meaning-based: nearest clause vectors in Qdrant' },
  { id: 'keyword', label: 'Keyword', hint: 'Exact words: PostgreSQL full-text search with a GIN index' },
];

function Highlight({ text }: { text: string }) {
  const parts = text.split(/(<<|>>)/);
  let on = false;
  return <>{parts.map((p, i) => (p === '<<' ? ((on = true), null) : p === '>>' ? ((on = false), null) : on ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

export default function SearchClient() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Mode>('hybrid');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ hits: SearchHit[]; documents: { document_id: number; title: string; case_number: string }[] } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try { setResult(await call('GET', `/api/search?q=${encodeURIComponent(q)}&mode=${mode}`)); }
    catch (err) { setError((err as Error).message); setResult(null); }
    setBusy(false);
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={submit}>
        <div className="row">
          <input aria-label="Search" style={{ flex: 1, minWidth: 240 }} required minLength={2} maxLength={300} placeholder="e.g. liability is unlimited, or: notice period before ending the contract" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" disabled={busy}>{busy && <span className="spin" />}Search</button>
        </div>
        <div className="row" style={{ marginTop: 10 }} role="radiogroup" aria-label="Search mode">
          {MODES.map((m) => (
            <label key={m.id} title={m.hint} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', margin: 0, fontWeight: mode === m.id ? 700 : 500 }}>
              <input type="radio" name="mode" style={{ width: 'auto' }} checked={mode === m.id} onChange={() => setMode(m.id)} />{m.label}
            </label>
          ))}
        </div>
        <p className="help">{MODES.find((m) => m.id === mode)!.hint}</p>
        {error && <div className="msg err" role="alert">{error}</div>}
      </form>

      {result && (
        <section className="card">
          <h2>{result.hits.length} clause{result.hits.length === 1 ? '' : 's'} found</h2>
          {result.documents.length > 0 && mode !== 'semantic' && (
            <p className="small muted" style={{ marginBottom: 10 }}>
              Matching document titles: {result.documents.map((d, i) => <span key={d.document_id}>{i > 0 && ', '}<Link href={`/documents/${d.document_id}`}>{d.title}</Link></span>)}
            </p>
          )}
          {result.hits.length === 0 ? <div className="empty">Nothing matched. Try different words or switch to semantic search.</div> : result.hits.map((h) => (
            <div key={h.clause_id} style={{ padding: '12px 0', borderTop: '1px solid var(--line-2)' }}>
              <div className="row between">
                <div><Link href={`/documents/${h.document_id}#clause-${h.position}`}><b>{h.document_title}</b></Link> <span className="muted small">{h.case_number} · clause {h.position}{h.heading ? ` · ${h.heading}` : ''}</span></div>
                <div className="small muted">
                  {h.vector_score != null && <span title="cosine similarity">vector <span className="sim">{h.vector_score.toFixed(2)}</span></span>}
                  {h.vector_score != null && h.keyword_rank != null && ' · '}
                  {h.keyword_rank != null && <span title="ts_rank">keyword <span className="sim">{h.keyword_rank.toFixed(2)}</span></span>}
                </div>
              </div>
              <p style={{ fontFamily: 'var(--serif)', marginTop: 4 }}><Highlight text={h.snippet} /></p>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
