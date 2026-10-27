'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import type { Role } from '@/lib/types';
import { call } from '@/lib/client';

const LINKS: { href: string; label: string; roles: Role[]; group?: string }[] = [
  { href: '/', label: 'Dashboard', roles: ['admin', 'reviewer', 'client'] },
  { href: '/cases', label: 'Cases', roles: ['admin', 'reviewer', 'client'] },
  { href: '/search', label: 'Search clauses', roles: ['admin', 'reviewer', 'client'] },
  { href: '/admin/rules', label: 'Rules and clause library', roles: ['admin'], group: 'Administration' },
  { href: '/admin/users', label: 'Users', roles: ['admin'] },
  { href: '/admin/audit', label: 'Audit log', roles: ['admin'] },
];

export default function Nav({ name, role }: { name: string; role: Role }) {
  const path = usePathname();
  const router = useRouter();
  const active = (href: string) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/'));

  async function logout() {
    await call('POST', '/api/auth/logout').catch(() => undefined);
    router.push('/login');
    router.refresh();
  }

  let lastGroup: string | undefined;
  return (
    <aside className="side">
      <div className="brand">
        Clause Review
        <small>Legal discovery and compliance</small>
      </div>
      <nav className="nav" aria-label="Main">
        {LINKS.filter((l) => l.roles.includes(role)).map((l) => {
          const header = l.group && l.group !== lastGroup ? <div className="group" key={`g-${l.group}`}>{l.group}</div> : null;
          lastGroup = l.group ?? lastGroup;
          return (
            <span key={l.href} style={{ display: 'contents' }}>
              {header}
              <Link href={l.href} aria-current={active(l.href) ? 'page' : undefined}>{l.label}</Link>
            </span>
          );
        })}
      </nav>
      <div className="me">
        <b>{name}</b>
        <span className="role">{role === 'client' ? 'Client (read-only)' : role === 'reviewer' ? 'Reviewer' : 'Administrator'}</span>
        <div><button onClick={logout}>Sign out</button></div>
      </div>
    </aside>
  );
}
