'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';
import { fmtDate } from './ui';

type U = { user_id: number; full_name: string; email: string; role: 'admin' | 'reviewer' | 'client'; is_active: boolean; created_at: string };

export default function UsersAdmin({ users, meId }: { users: U[]; meId: number }) {
  const router = useRouter();
  const [f, setF] = useState({ fullName: '', email: '', password: '', role: 'reviewer' });
  const [msg, setMsg] = useState<{ t: 'ok' | 'err'; s: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await call('POST', '/api/admin/users', f); setMsg({ t: 'ok', s: 'User created.' }); setF({ fullName: '', email: '', password: '', role: 'reviewer' }); router.refresh(); }
    catch (err) { setMsg({ t: 'err', s: (err as Error).message }); }
    setBusy(false);
  }
  async function patch(id: number, body: object) {
    setMsg(null);
    try { await call('PATCH', `/api/admin/users/${id}`, body); router.refresh(); }
    catch (err) { setMsg({ t: 'err', s: (err as Error).message }); }
  }

  return (
    <div className="stack">
      <form className="card" onSubmit={create}>
        <h2>Add a user</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="un">Full name</label><input id="un" required minLength={2} value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
          <div className="field"><label htmlFor="ue">E-mail</label><input id="ue" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="field"><label htmlFor="up">Initial password</label><input id="up" type="password" required minLength={8} autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /><div className="help">At least 8 characters, with a letter and a digit.</div></div>
          <div className="field"><label htmlFor="ur">Role</label>
            <select id="ur" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
              <option value="admin">Administrator: manages users and rules</option>
              <option value="reviewer">Reviewer: uploads and reviews contracts</option>
              <option value="client">Client: read-only view of own cases</option>
            </select></div>
        </div>
        <div style={{ marginTop: 14 }}><button className="btn" disabled={busy}>{busy && <span className="spin" />}Create user</button></div>
        {msg && <div className={`msg ${msg.t}`} role="alert">{msg.s}</div>}
      </form>

      <section className="card">
        <h2>All users</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>Name</th><th>E-mail</th><th>Role</th><th>Status</th><th>Created</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id}>
                <td>{u.full_name}{u.user_id === meId && <span className="muted small"> (you)</span>}</td>
                <td className="small">{u.email}</td>
                <td>
                  <select aria-label={`Role of ${u.full_name}`} value={u.role} disabled={u.user_id === meId} onChange={(e) => patch(u.user_id, { role: e.target.value })} style={{ width: 'auto' }}>
                    <option value="admin">admin</option><option value="reviewer">reviewer</option><option value="client">client</option>
                  </select>
                </td>
                <td><span className={`badge ${u.is_active ? 'st-resolved' : 'st-dismissed'}`}>{u.is_active ? 'active' : 'disabled'}</span></td>
                <td className="muted small">{fmtDate(u.created_at)}</td>
                <td>{u.user_id !== meId && <button className="btn ghost small" onClick={() => patch(u.user_id, { isActive: !u.is_active })}>{u.is_active ? 'Disable' : 'Enable'}</button>}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
    </div>
  );
}
