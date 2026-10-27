'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';
import { SeverityBadge } from './ui';
import type { ReferenceClause, RuleRow } from '@/lib/types';

type R = RuleRow & { reference_count: number; documents_scanned: number; open_violations: number };

export default function RulesAdmin({ rules, references }: { rules: R[]; references: ReferenceClause[] }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [nr, setNr] = useState({ ruleCode: '', title: '', description: '', ruleType: 'required', severity: 'medium', presentThreshold: '0.72', standardThreshold: '0.80' });
  const [refDraft, setRefDraft] = useState<Record<number, { label: string; clauseText: string }>>({});
  const [thr, setThr] = useState<Record<number, { p: string; s: string }>>({});

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key); setMsg(null);
    try { await fn(); setMsg({ t: 'ok', s: ok }); router.refresh(); }
    catch (e) { setMsg({ t: 'err', s: (e as Error).message }); }
    setBusy(null);
  }

  return (
    <div className="stack">
      <div className="row">
        <button className="btn" onClick={() => setShowNew(!showNew)}>{showNew ? 'Close' : 'New rule'}</button>
        <button className="btn secondary" disabled={busy === 'reeval'} onClick={() => run('reeval', () => call('POST', '/api/admin/reevaluate'), 'All stored scans were re-evaluated with the current thresholds (stored procedure sp_reevaluate_all).')}>
          {busy === 'reeval' && <span className="spin" />}Re-apply thresholds to all documents
        </button>
      </div>
      {msg && <div className={`msg ${msg.t}`} role="alert" style={{ marginTop: 0 }}>{msg.s}</div>}

      {showNew && (
        <form className="card" onSubmit={(e) => { e.preventDefault(); run('new', () => call('POST', '/api/admin/rules', { ...nr, presentThreshold: Number(nr.presentThreshold), standardThreshold: Number(nr.standardThreshold) }), 'Rule created. Add at least one reference clause to it.').then(() => setShowNew(false)); }}>
          <h2>New rule</h2>
          <div className="form-grid">
            <div className="field"><label htmlFor="rc">Code</label><input id="rc" required pattern="[A-Z0-9_]{2,30}" placeholder="E.G. DATA_PROTECTION" value={nr.ruleCode} onChange={(e) => setNr({ ...nr, ruleCode: e.target.value.toUpperCase() })} /></div>
            <div className="field"><label htmlFor="rt">Title</label><input id="rt" required minLength={3} value={nr.title} onChange={(e) => setNr({ ...nr, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="rty">Type</label><select id="rty" value={nr.ruleType} onChange={(e) => setNr({ ...nr, ruleType: e.target.value })}><option value="required">Required: flag when missing or non-standard</option><option value="restricted">Restricted: flag when present</option></select></div>
            <div className="field"><label htmlFor="rs">Severity</label><select id="rs" value={nr.severity} onChange={(e) => setNr({ ...nr, severity: e.target.value })}>{['low', 'medium', 'high', 'critical'].map((s) => <option key={s}>{s}</option>)}</select></div>
            <div className="field"><label htmlFor="rp">Present threshold (0–1)</label><input id="rp" type="number" step="0.01" min="0" max="1" required value={nr.presentThreshold} onChange={(e) => setNr({ ...nr, presentThreshold: e.target.value })} /></div>
            <div className="field"><label htmlFor="rst">Standard threshold (0–1)</label><input id="rst" type="number" step="0.01" min="0" max="1" required value={nr.standardThreshold} onChange={(e) => setNr({ ...nr, standardThreshold: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="rd">Description</label><textarea id="rd" required minLength={10} value={nr.description} onChange={(e) => setNr({ ...nr, description: e.target.value })} /></div>
          <div style={{ marginTop: 14 }}><button className="btn" disabled={busy === 'new'}>Create rule</button></div>
        </form>
      )}

      {rules.map((r) => {
        const refs = references.filter((x) => x.rule_id === r.rule_id);
        const t = thr[r.rule_id] ?? { p: String(r.present_threshold), s: String(r.standard_threshold) };
        const draft = refDraft[r.rule_id] ?? { label: '', clauseText: '' };
        return (
          <section className="card" key={r.rule_id} style={{ opacity: r.is_active ? 1 : 0.65 }}>
            <div className="row between">
              <div className="row"><h2 style={{ margin: 0 }}>{r.title}</h2><SeverityBadge severity={r.severity} /><span className="badge st-closed">{r.rule_type}</span>{!r.is_active && <span className="badge st-dismissed">disabled</span>}</div>
              <button className="btn ghost small" onClick={() => run(`a${r.rule_id}`, () => call('PATCH', `/api/admin/rules/${r.rule_id}`, { isActive: !r.is_active }), r.is_active ? 'Rule disabled.' : 'Rule enabled.')}>{r.is_active ? 'Disable' : 'Enable'}</button>
            </div>
            <p className="small muted" style={{ margin: '6px 0 10px' }}><span className="mono">{r.rule_code}</span> · {r.description}</p>
            <p className="small muted">{r.documents_scanned} documents scanned · {r.open_violations} open violations</p>

            <div className="row" style={{ margin: '12px 0' }}>
              <div><label htmlFor={`p${r.rule_id}`}>Present threshold</label><input id={`p${r.rule_id}`} type="number" step="0.01" min="0" max="1" style={{ width: 110 }} value={t.p} onChange={(e) => setThr({ ...thr, [r.rule_id]: { ...t, p: e.target.value } })} /></div>
              <div><label htmlFor={`s${r.rule_id}`}>Standard threshold</label><input id={`s${r.rule_id}`} type="number" step="0.01" min="0" max="1" style={{ width: 110 }} value={t.s} onChange={(e) => setThr({ ...thr, [r.rule_id]: { ...t, s: e.target.value } })} /></div>
              <button className="btn secondary small" style={{ alignSelf: 'flex-end' }} onClick={() => run(`t${r.rule_id}`, () => call('PATCH', `/api/admin/rules/${r.rule_id}`, { presentThreshold: Number(t.p), standardThreshold: Number(t.s) }), 'Thresholds saved. Use "Re-apply thresholds" to update existing documents.')}>Save thresholds</button>
            </div>

            <h3 style={{ margin: '14px 0 6px' }}>Reference clauses ({refs.length})</h3>
            {refs.length === 0 && <p className="small" style={{ color: 'var(--crit)' }}>This rule has no reference clauses, so it is never checked.</p>}
            {refs.map((x) => (
              <div key={x.ref_id} className="quote">
                <div className="row between"><b style={{ fontFamily: 'var(--sans)', fontSize: 13 }}>{x.label}</b>
                  <button className="btn danger small" onClick={() => confirm('Delete this reference clause (and its vector)?') && run(`d${x.ref_id}`, () => call('DELETE', `/api/admin/references/${x.ref_id}`), 'Reference clause deleted.')}>Delete</button></div>
                {x.clause_text}
              </div>
            ))}
            <details style={{ marginTop: 10 }}>
              <summary className="small" style={{ cursor: 'pointer', color: 'var(--accent)' }}>Add a reference clause</summary>
              <div className="field" style={{ marginTop: 8 }}><label htmlFor={`l${r.rule_id}`}>Label</label><input id={`l${r.rule_id}`} value={draft.label} onChange={(e) => setRefDraft({ ...refDraft, [r.rule_id]: { ...draft, label: e.target.value } })} /></div>
              <div className="field"><label htmlFor={`c${r.rule_id}`}>Standard wording (at least 30 characters)</label><textarea id={`c${r.rule_id}`} value={draft.clauseText} onChange={(e) => setRefDraft({ ...refDraft, [r.rule_id]: { ...draft, clauseText: e.target.value } })} /></div>
              <button className="btn secondary small" style={{ marginTop: 10 }} disabled={busy === `r${r.rule_id}`}
                onClick={() => run(`r${r.rule_id}`, async () => { await call('POST', `/api/admin/rules/${r.rule_id}/references`, draft); setRefDraft({ ...refDraft, [r.rule_id]: { label: '', clauseText: '' } }); }, 'Reference clause saved and embedded.')}>
                {busy === `r${r.rule_id}` && <span className="spin" />}Save and embed
              </button>
            </details>
          </section>
        );
      })}
    </div>
  );
}
