'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

export default function UploadForm({ caseId }: { caseId: number }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setBusy(true); setError('');
    const fd = new FormData();
    fd.set('file', file); fd.set('caseId', String(caseId)); if (title.trim()) fd.set('title', title.trim());
    try {
      const r = await call<{ documentId: number }>('POST', '/api/documents', fd);
      router.push(`/documents/${r.documentId}`);
    } catch (err) { setError((err as Error).message); setBusy(false); }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Upload a contract</h2>
      <div className="form-grid">
        <div className="field">
          <label htmlFor="file">File (PDF or .txt, up to 8 MB)</label>
          <input id="file" type="file" accept=".pdf,.txt,application/pdf,text/plain" required onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <div className="field">
          <label htmlFor="title">Title (optional)</label>
          <input id="title" maxLength={200} placeholder="Defaults to the file name" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
      </div>
      <p className="help">The contract is split into clauses, each clause is embedded, and every rule is checked. This can take up to a minute on a local model.</p>
      {error && <div className="msg err" role="alert">{error}</div>}
      <div style={{ marginTop: 14 }}>
        <button className="btn" disabled={busy || !file}>{busy && <span className="spin" />}{busy ? 'Scanning contract…' : 'Upload and scan'}</button>
      </div>
    </form>
  );
}
