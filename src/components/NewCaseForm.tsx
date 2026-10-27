'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

export default function NewCaseForm({ clients }: { clients: { user_id: number; full_name: string; email: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [clientId, setClientId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const r = await call<{ caseId: number }>('POST', '/api/cases', { title, description: description || undefined, clientId });
      router.push(`/cases/${r.caseId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  if (!open) return <div><button className="btn" onClick={() => setOpen(true)}>New case</button></div>;
  return (
    <form className="card" onSubmit={submit}>
      <h2>New case</h2>
      <div className="form-grid">
        <div className="field"><label htmlFor="ct">Title</label><input id="ct" required minLength={3} maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div className="field">
          <label htmlFor="cc">Client</label>
          <select id="cc" required value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Choose a client…</option>
            {clients.map((c) => <option key={c.user_id} value={c.user_id}>{c.full_name} ({c.email})</option>)}
          </select>
          {clients.length === 0 && <div className="help">No client accounts exist yet. An administrator can create one under Users.</div>}
        </div>
      </div>
      <div className="field"><label htmlFor="cd">Description (optional)</label><textarea id="cd" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
      {error && <div className="msg err" role="alert">{error}</div>}
      <div className="row" style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy}>{busy && <span className="spin" />}Create case</button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
