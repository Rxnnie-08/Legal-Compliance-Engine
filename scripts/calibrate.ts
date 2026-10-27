// Prints the best cosine similarity of each rule for each sample contract, WITHOUT writing to the database.
// Use it to tune clause_rules.present_threshold / standard_threshold for the embedding model you run.
//   npm run calibrate
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { getPool, query } from '../src/lib/db';
import { splitIntoClauses } from '../src/lib/chunking';
import { embedTexts } from '../src/lib/ollama';
import { COLLECTIONS, getVectors } from '../src/lib/qdrant';

function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
  return d / Math.sqrt(na * nb);
}

async function main() {
  const rules = await query<{ rule_id: number; rule_code: string; rule_type: string; present_threshold: number; standard_threshold: number }>(
    `SELECT rule_id, rule_code, rule_type, present_threshold, standard_threshold FROM clause_rules WHERE is_active ORDER BY rule_id`);
  const refs = await query<{ ref_id: number; rule_id: number }>(`SELECT ref_id, rule_id FROM reference_clauses`);
  const refVec = await getVectors(COLLECTIONS.references, refs.map((r) => r.ref_id));

  const dir = path.join(process.cwd(), 'samples');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.txt'))) {
    const chunks = splitIntoClauses(readFileSync(path.join(dir, f), 'utf8'));
    const vecs = await embedTexts(chunks.map((c) => c.body), 'document');
    console.log(`\n${f}  (${chunks.length} clauses)`);
    const rows = rules.map((r) => {
      let best = -1, at = 0;
      for (const ref of refs.filter((x) => x.rule_id === r.rule_id)) {
        const rv = refVec.get(ref.ref_id);
        if (!rv) continue;
        vecs.forEach((v, i) => { const s = cosine(v, rv); if (s > best) { best = s; at = i; } });
      }
      const verdict = r.rule_type === 'required'
        ? best < r.present_threshold ? 'MISSING' : best < r.standard_threshold ? 'non-standard' : 'ok'
        : best >= r.present_threshold ? 'RESTRICTED PRESENT' : 'ok';
      return { rule: r.rule_code, best_similarity: +best.toFixed(3), clause: `#${chunks[at]?.position} ${chunks[at]?.heading ?? ''}`, present_thr: r.present_threshold, standard_thr: r.standard_threshold, verdict };
    });
    console.table(rows);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => getPool().end());
