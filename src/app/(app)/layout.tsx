import Nav from '@/components/Nav';
import { requirePageUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <div className="shell">
      <Nav name={user.fullName} role={user.role} />
      <main className="main">{children}</main>
    </div>
  );
}
