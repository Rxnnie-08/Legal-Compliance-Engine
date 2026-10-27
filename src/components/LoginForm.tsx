'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { call } from '@/lib/client';

const DEMO = [
  { role: 'Administrator', email: 'admin@lce.test', password: 'Admin@12345' },
  { role: 'Reviewer', email: 'reviewer@lce.test', password: 'Reviewer@12345' },
  { role: 'Client', email: 'client@lce.test', password: 'Client@12345' },
];

export default function LoginForm() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await call('POST', '/api/auth/login', { email, password });
      router.push('/');
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>Sign in</h2>
      <div className="field" style={{ marginTop: 14 }}>
        <label htmlFor="email">E-mail</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {error && <div className="msg err" role="alert">{error}</div>}
      <button className="btn" style={{ marginTop: 16, width: '100%' }} disabled={busy}>
        {busy && <span className="spin" />}Sign in
      </button>
      <p className="demo">
        Demo accounts (created by the seed script):{' '}
        {DEMO.map((d, i) => (
          <span key={d.email}>
            {i > 0 && ', '}
            <button type="button" onClick={() => { setEmail(d.email); setPassword(d.password); }}>{d.role}</button>
          </span>
        ))}
      </p>
    </form>
  );
}
