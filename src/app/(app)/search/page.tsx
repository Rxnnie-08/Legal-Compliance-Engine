import { requirePageUser } from '@/lib/auth';
import SearchClient from '@/components/SearchClient';

export default async function SearchPage() {
  await requirePageUser();
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Search clauses</h1>
          <p>Describe what you are looking for in your own words, or search for exact terms. Hybrid search combines both.</p>
        </div>
      </div>
      <SearchClient />
    </>
  );
}
