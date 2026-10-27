import { requirePageUser } from '@/lib/auth';
import { listUsers } from '@/lib/repo';
import UsersAdmin from '@/components/UsersAdmin';

export default async function UsersPage() {
  const me = await requirePageUser(['admin']);
  const users = await listUsers();
  return (
    <>
      <div className="page-head"><div><h1>Users</h1><p>Create accounts and control who can sign in. Passwords are stored as bcrypt hashes.</p></div></div>
      <UsersAdmin users={users.map((u) => ({ ...u, created_at: String(u.created_at) }))} meId={me.userId} />
    </>
  );
}
