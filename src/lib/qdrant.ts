import { QdrantClient } from '@qdrant/js-client-rest';
import { env } from './env';
import { embedTexts } from './ollama';

export const COLLECTIONS = {
  documents: 'document_clauses', // one point per clause of every uploaded document
  references: 'reference_clauses', // one point per reference ("standard") clause
} as const;

declare global {
  // eslint-disable-next-line no-var
  var __lceQdrant: QdrantClient | undefined;
  // eslint-disable-next-line no-var
  var __lceDim: number | undefined;
  // eslint-disable-next-line no-var
  var __lceReady: Set<string> | undefined;
}

export function getQdrant(): QdrantClient {
  if (!globalThis.__lceQdrant) {
    globalThis.__lceQdrant = new QdrantClient({ url: env.qdrantUrl, apiKey: env.qdrantApiKey, checkCompatibility: false });
  }
  return globalThis.__lceQdrant;
}

/** The embedding dimension depends on the model, so ask the model once. */
export async function getEmbeddingDim(): Promise<number> {
  if (!globalThis.__lceDim) {
    const [v] = await embedTexts(['dimension probe']);
    globalThis.__lceDim = v.length;
  }
  return globalThis.__lceDim;
}

/** Create the collection (cosine distance) and its payload indexes if they do not exist yet. */
export async function ensureCollection(name: string): Promise<void> {
  globalThis.__lceReady ??= new Set();
  if (globalThis.__lceReady.has(name)) return;
  const q = getQdrant();
  const dim = await getEmbeddingDim();

  if (!(await q.collectionExists(name)).exists) {
    await q.createCollection(name, { vectors: { size: dim, distance: 'Cosine' } });
    const intFields = name === COLLECTIONS.documents ? ['document_id', 'case_id'] : ['rule_id'];
    for (const field of intFields) {
      await q.createPayloadIndex(name, { field_name: field, field_schema: 'integer', wait: true });
    }
  } else {
    const info = await q.getCollection(name);
    const vectors = info.config.params.vectors as { size?: number } | undefined;
    if (vectors?.size && vectors.size !== dim) {
      throw new Error(
        `Qdrant collection "${name}" has vector size ${vectors.size} but the embedding model "${env.embedModel}" produces ${dim}. ` +
          `Delete the collection (or use another Qdrant instance) and run "npm run seed" again.`,
      );
    }
  }
  globalThis.__lceReady.add(name);
}

export interface VectorPoint {
  id: number;
  vector: number[];
  payload: Record<string, unknown>;
}

export async function upsertPoints(collection: string, points: VectorPoint[]): Promise<void> {
  if (!points.length) return;
  await ensureCollection(collection);
  const q = getQdrant();
  const CHUNK = 64;
  for (let i = 0; i < points.length; i += CHUNK) {
    await q.upsert(collection, { wait: true, points: points.slice(i, i + CHUNK) });
  }
}

export async function deleteByDocument(documentId: number): Promise<void> {
  const q = getQdrant();
  if (!(await q.collectionExists(COLLECTIONS.documents)).exists) return;
  await q.delete(COLLECTIONS.documents, { wait: true, filter: { must: [{ key: 'document_id', match: { value: documentId } }] } });
}

export async function deletePoint(collection: string, id: number): Promise<void> {
  const q = getQdrant();
  if (!(await q.collectionExists(collection)).exists) return;
  await q.delete(collection, { wait: true, points: [id] });
}

export interface ScoredPoint {
  id: number;
  score: number;
  payload: Record<string, any>;
}

type Filter = NonNullable<Parameters<QdrantClient['query']>[1]>['filter'];

/** Nearest-neighbour search (cosine similarity). */
export async function searchSimilar(
  collection: string,
  vector: number[],
  opts: { limit?: number; filter?: Filter } = {},
): Promise<ScoredPoint[]> {
  await ensureCollection(collection);
  const res = await getQdrant().query(collection, {
    query: vector,
    limit: opts.limit ?? 10,
    filter: opts.filter,
    with_payload: true,
  });
  return res.points.map((p) => ({ id: Number(p.id), score: p.score, payload: (p.payload ?? {}) as Record<string, any> }));
}

/** Several nearest-neighbour searches in one round-trip. */
export async function searchBatch(
  collection: string,
  searches: { vector: number[]; limit?: number; filter?: Filter }[],
): Promise<ScoredPoint[][]> {
  if (!searches.length) return [];
  await ensureCollection(collection);
  const res = await getQdrant().queryBatch(collection, {
    searches: searches.map((s) => ({ query: s.vector, limit: s.limit ?? 1, filter: s.filter, with_payload: true })),
  });
  return res.map((r) => r.points.map((p) => ({ id: Number(p.id), score: p.score, payload: (p.payload ?? {}) as Record<string, any> })));
}

export async function getVectors(collection: string, ids: number[]): Promise<Map<number, number[]>> {
  const out = new Map<number, number[]>();
  if (!ids.length) return out;
  const pts = await getQdrant().retrieve(collection, { ids, with_vector: true, with_payload: false });
  for (const p of pts) {
    if (Array.isArray(p.vector)) out.set(Number(p.id), p.vector as number[]);
  }
  return out;
}
