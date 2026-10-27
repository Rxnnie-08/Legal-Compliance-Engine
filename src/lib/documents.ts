import { query, withTx } from './db';
import { HttpError } from './http';
import { splitIntoClauses } from './chunking';
import { embedTexts } from './ollama';
import { COLLECTIONS, deleteByDocument, getVectors, searchBatch, upsertPoints } from './qdrant';
import { assertCaseAccess } from './repo';
import type { SessionUser } from './types';

export interface IngestResult {
  documentId: number;
  clauseCount: number;
  complianceScore: number | null;
  openIssues: number;
}

const clamp = (n: number) => Math.max(-1, Math.min(1, Math.round(n * 10000) / 10000));

/**
 * Upload pipeline:   text -> clauses -> embeddings -> (SQL transaction) -> vectors in Qdrant
 *                    -> vector similarity against the reference library -> sp_record_scan.
 *
 * The SQL part is ONE transaction: the document row, its clauses, the scan results and the
 * trigger-generated flags are committed together or not at all.  Qdrant cannot join that
 * transaction, so if anything fails we roll back SQL and delete the points we already wrote
 * (compensating action).
 */
export async function ingestDocument(
  user: SessionUser,
  input: { caseId: number; title: string; filename: string; mime: string; size: number; text: string },
): Promise<IngestResult> {
  await assertCaseAccess(user, input.caseId);

  const chunks = splitIntoClauses(input.text);
  if (!chunks.length) throw new HttpError(422, 'No readable clauses were found in this document.');

  // active rules that actually have reference clauses
  const refs = await query<{ ref_id: number; rule_id: number }>(
    `SELECT rc.ref_id, rc.rule_id FROM reference_clauses rc JOIN clause_rules r ON r.rule_id = rc.rule_id WHERE r.is_active ORDER BY rc.ref_id`);
  if (!refs.length) throw new HttpError(409, 'There are no active compliance rules with reference clauses. Ask an administrator to add some (or run "npm run seed").');
  const refVectors = await getVectors(COLLECTIONS.references, refs.map((r) => r.ref_id));
  if (refVectors.size === 0) {
    throw new HttpError(409, 'The reference clause library is not indexed in Qdrant yet. Run "npm run seed" (Ollama and Qdrant must be running).');
  }

  // slow external call first, outside the database transaction
  const vectors = await embedTexts(chunks.map((c) => c.body), 'document');

  let documentId: number | null = null;
  try {
    return await withTx(user.userId, async (c) => {
      const doc = await c.query(
        `INSERT INTO documents (case_id, uploaded_by, title, original_filename, mime_type, file_size_bytes, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'scanning') RETURNING document_id`,
        [input.caseId, user.userId, input.title, input.filename.slice(0, 255), input.mime.slice(0, 100), input.size]);
      const docId: number = doc.rows[0].document_id;
      documentId = docId;

      const inserted = await c.query(
        `INSERT INTO clauses (document_id, position, heading, body)
         SELECT $1, p, h, b FROM unnest($2::int[], $3::text[], $4::text[]) AS t(p, h, b)
         RETURNING clause_id, position`,
        [docId, chunks.map((x) => x.position), chunks.map((x) => x.heading), chunks.map((x) => x.body)]);
      const idByPosition = new Map<number, number>(inserted.rows.map((r) => [r.position as number, r.clause_id as number]));

      // 1) store the clause vectors (NoSQL / vector side)
      await upsertPoints(
        COLLECTIONS.documents,
        chunks.map((ch, i) => ({
          id: idByPosition.get(ch.position)!,
          vector: vectors[i],
          payload: { document_id: docId, case_id: input.caseId, clause_id: idByPosition.get(ch.position)!, position: ch.position },
        })),
      );

      // 2) for every reference clause, find the most similar clause of THIS document
      const refList = refs.filter((r) => refVectors.has(r.ref_id));
      const hits = await searchBatch(
        COLLECTIONS.documents,
        refList.map((r) => ({
          vector: refVectors.get(r.ref_id)!,
          limit: 1,
          filter: { must: [{ key: 'document_id', match: { value: docId } }] },
        })),
      );

      // 3) best match per rule
      const best = new Map<number, { rule_id: number; clause_id: number; ref_id: number; similarity: number }>();
      refList.forEach((r, i) => {
        const hit = hits[i]?.[0];
        if (!hit) return;
        const sim = clamp(hit.score);
        const cur = best.get(r.rule_id);
        if (!cur || sim > cur.similarity) best.set(r.rule_id, { rule_id: r.rule_id, clause_id: hit.id, ref_id: r.ref_id, similarity: sim });
      });

      // 4) hand the results to the stored procedure; triggers create flags, score and audit rows
      await c.query(`CALL sp_record_scan($1, $2::jsonb)`, [docId, JSON.stringify([...best.values()])]);

      const summary = await c.query(
        `SELECT compliance_score, (SELECT COUNT(*)::int FROM flagged_issues WHERE document_id = $1 AND status = 'open') AS open_issues
           FROM documents WHERE document_id = $1`, [docId]);
      return {
        documentId: docId,
        clauseCount: chunks.length,
        complianceScore: summary.rows[0].compliance_score as number | null,
        openIssues: summary.rows[0].open_issues as number,
      };
    });
  } catch (err) {
    if (documentId !== null) await deleteByDocument(documentId).catch(() => undefined); // compensate
    throw err;
  }
}
