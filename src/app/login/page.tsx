import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';
import LoginForm from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/');
  return (
    <div className="login">
      <section className="intro">
        <h1>Find the clause that should not be there, or is not there.</h1>
        <p>
          Upload a contract and it is compared, clause by clause, with your library of standard wording. Missing protections
          and risky terms are flagged and explained in plain English.
        </p>
        <div className="sample">
          &ldquo;The Contractor shall indemnify the Company against all claims, <em>without any limit</em> on the amount of the Contractor&rsquo;s liability.&rdquo;
          <small>Flagged: indemnification without a liability cap (critical)</small>
        </div>
      </section>
      <section className="form"><LoginForm /></section>
    </div>
  );
}
