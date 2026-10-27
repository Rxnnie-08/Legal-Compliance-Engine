import { query } from './db';
import { HttpError } from './http';
import { embedTexts } from './ollama';
import { COLLECTIONS, getVectors, searchSimilar } from './qdrant';
import { accessibleCaseIds, assertCaseAccess, caseAccess } from './repo';
import type { SearchHit, SessionUser } from './types';

const LIMIT = 15;
const RRF_K = 60; // Reciprocal Rank Fusion constant
// Nearest-neighbour search always returns *something*, so weak matches are cut off:
// keep a hit only if it is at least SEARCH_MIN_SCORE and within SEARCH_WINDOW of the best hit.
// (Cosine scores depend on the embedding model; tune these two numbers for yours.)
const MIN_SCORE = Number(process.env.SEARCH_MIN_SCORE ?? 0.3);
const WINDOW = Number(process.env.SEARCH_WINDOW ?? 0.2);

interface Hydrated {
  clause_id: number; document_id: number; document_title: string; case_id: number; case_number: string;
  position: number; heading: string | null; body: string;
}

async function hydrate(user: SessionUser, ids: number[]): Promise<Map<number, Hydrated>> {
  if (!ids.length) return new Map();
  const params: unknown[] = [ids];
  const rows = await query<Hydrated>(
    `SELECT c.clause_id, c.document_id, d.title AS document_title, cs.case_id, cs.case_number, c.position, c.heading, c.body
       FROM clauses c JOIN documents d ON d.document_id = c.document_id JOIN cases cs ON cs.case_id = d.case_id
      WHERE c.clause_id = ANY($1::int[]) AND ${caseAccess(user, 'cs', params)}`, params);
  return new Map(rows.map((r) => [r.clause_id, r]));
}

const excerpt = (s: string, n = 280) => (s.length > n ? s.slice(0, n).trimEnd() + '…' : s);

/** Full-text search (PostgreSQL tsvector + GIN index).  Matches are wrapped in << >> markers. */
export async function keywordSearch(user: SessionUser, q: string) {
  const params: unknown[] = [q];
  const clauses = await query<Omit<SearchHit, 'vector_score' | 'fused_score' | 'keyword_rank'> & { rank: number }>(
    `SELECT c.clause_id, c.document_id, d.title AS document_title, cs.case_id, cs.case_number, c.position, c.heading,
            ts_headline('english', c.body, tq, 'MaxFragments=1, MaxWords=38, MinWords=14, StartSel=<<, StopSel=>>') AS snippet,
            ts_rank(c.search_vector, tq) AS rank
       FROM clauses c
       JOIN documents d ON d.document_id = c.document_id
       JOIN cases cs ON cs.case_id = d.case_id,
            websearch_to_tsquery('english', $1) AS tq
      WHERE c.search_vector @@ tq AND ${caseAccess(user, 'cs', params)}
      ORDER BY rank DESC LIMIT ${LIMIT}`, params);

  const p2: unknown[] = [q];
  const documents = await query<{ document_id: number; title: string; case_number: string }>(
    `SELECT d.document_id, d.title, cs.case_number
       FROM documents d JOIN cases cs ON cs.case_id = d.case_id
      WHERE d.search_vector @@ websearch_to_tsquery('english', $1) AND ${caseAccess(user, 'cs', p2)}
      ORDER BY ts_rank(d.search_vector, websearch_to_tsquery('english', $1)) DESC LIMIT 8`, p2);

  return { clauses, documents };
}

/** Semantic search: embed the question, nearest neighbours in Qdrant (cosine), restricted to the user's cases. */
export async function semanticSearch(user: SessionUser, q: string): Promise<{ id: number; score: number }[]> {
  const caseIds = await accessibleCaseIds(user);
  if (!caseIds.length) return [];
  const [vector] = await embedTexts([q], 'query');
  const pts = await searchSimilar(COLLECTIONS.documents, vector, {
    limit: LIMIT,
    filter: { must: [{ key: 'case_id', match: { any: caseIds } }] },
  });
  const top = pts[0]?.score ?? 0;
  return pts
    .filter((p) => p.score >= MIN_SCORE && p.score >= top - WINDOW)
    .map((p) => ({ id: Number(p.payload.clause_id ?? p.id), score: p.score }));
}

export async function search(user: SessionUser, q: string, mode: 'hybrid' | 'semantic' | 'keyword') {
  const [kw, sem] = await Promise.all([
    mode === 'semantic' ? null : keywordSearch(user, q),
    mode === 'keyword' ? null : semanticSearch(user, q),
  ]);

  const fused = new Map<number, { keyword_rank: number | null; vector_score: number | null; fused: number; snippet?: string }>();
  const bump = (id: number, patch: Partial<{ keyword_rank: number; vector_score: number; snippet: string }>, rank: number) => {
    const cur = fused.get(id) ?? { keyword_rank: null, vector_score: null, fused: 0 };
    fused.set(id, { ...cur, ...patch, fused: cur.fused + 1 / (RRF_K + rank) });
  };
  kw?.clauses.forEach((r, i) => bump(r.clause_id, { keyword_rank: r.rank, snippet: r.snippet }, i + 1));
  sem?.forEach((r, i) => bump(r.id, { vector_score: r.score }, i + 1));

  const ids = [...fused.keys()];
  const data = await hydrate(user, ids);
  const hits: SearchHit[] = ids
    .filter((id) => data.has(id))
    .map((id) => {
      const d = data.get(id)!;
      const f = fused.get(id)!;
      return {
        clause_id: id, document_id: d.document_id, document_title: d.document_title, case_id: d.case_id, case_number: d.case_number,
        position: d.position, heading: d.heading, snippet: f.snippet ?? excerpt(d.body),
        keyword_rank: f.keyword_rank, vector_score: f.vector_score, fused_score: f.fused,
      };
    })
    .sort((a, b) => b.fused_score - a.fused_score)
    .slice(0, LIMIT);

  return { hits, documents: kw?.documents ?? [] };
}

/** "Find clauses similar to this one" - uses the clause's stored vector, no new embedding needed. */
export async function similarClauses(user: SessionUser, clauseId: number) {
  const src = await query<{ case_id: number }>(
    `SELECT d.case_id FROM clauses c JOIN documents d ON d.document_id = c.document_id WHERE c.clause_id = $1`, [clauseId]);
  if (!src.length) throw new HttpError(404, 'Clause not found.');
  await assertCaseAccess(user, src[0].case_id);

  const vec = (await getVectors(COLLECTIONS.documents, [clauseId])).get(clauseId);
  if (!vec) throw new HttpError(404, 'This clause has no stored vector.');
  const caseIds = await accessibleCaseIds(user);
  const pts = await searchSimilar(COLLECTIONS.documents, vec, {
    limit: 8,
    filter: { must: [{ key: 'case_id', match: { any: caseIds } }], must_not: [{ has_id: [clauseId] }] },
  });
  const topScore = pts[0]?.score ?? 0;
  pts.splice(0, pts.length, ...pts.filter((p) => p.score >= MIN_SCORE && p.score >= topScore - WINDOW));
  const data = await hydrate(user, pts.map((p) => p.id));
  const [source] = [...(await hydrate(user, [clauseId])).values()];
  const hits: SearchHit[] = pts
    .filter((p) => data.has(p.id))
    .map((p) => {
      const d = data.get(p.id)!;
      return {
        clause_id: p.id, document_id: d.document_id, document_title: d.document_title, case_id: d.case_id, case_number: d.case_number,
        position: d.position, heading: d.heading, snippet: excerpt(d.body), keyword_rank: null, vector_score: p.score, fused_score: p.score,
      };
    });
  return { source, hits };
}
