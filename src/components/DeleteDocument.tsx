'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

export default function DeleteDocument({ documentId, caseId }: { documentId: number; caseId: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function del() {
    if (!confirm('Delete this document, its clauses, vectors and issues? This cannot be undone.')) return;
    setBusy(true);
    try { await call('DELETE', `/api/documents/${documentId}`); router.push(`/cases/${caseId}`); router.refresh(); }
    catch (e) { alert((e as Error).message); setBusy(false); }
  }
  return <button className="btn danger small" onClick={del} disabled={busy}>Delete</button>;
}
