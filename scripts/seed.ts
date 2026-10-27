// Seeds demo users, the compliance rule library (PostgreSQL) and indexes the reference
// clauses in Qdrant.  Safe to run more than once.
//   npm run seed
import { readFileSync } from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { getPool, query, queryOne } from '../src/lib/db';
import { embedTexts } from '../src/lib/ollama';
import { COLLECTIONS, upsertPoints } from '../src/lib/qdrant';

const DEMO_USERS = [
  { name: 'Demo Admin', email: 'admin@lce.test', password: 'Admin@12345', role: 'admin' },
  { name: 'Demo Reviewer', email: 'reviewer@lce.test', password: 'Reviewer@12345', role: 'reviewer' },
  { name: 'Demo Client', email: 'client@lce.test', password: 'Client@12345', role: 'client' },
] as const;

interface RuleSeed {
  rule_code: string; title: string; description: string; rule_type: 'required' | 'restricted'; severity: string;
  present_threshold: number; standard_threshold: number; references: { label: string; text: string }[];
}

async function main() {
  console.log('Seeding users...');
  for (const u of DEMO_USERS) {
    const hash = await bcrypt.hash(u.password, 11);
    await query(
      `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, $4) ON CONFLICT ((lower(email))) DO NOTHING`,
      [u.name, u.email, hash, u.role]);
  }

  console.log('Seeding compliance rules and reference clauses...');
  const rules: RuleSeed[] = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'reference_clauses.json'), 'utf8'));
  for (const r of rules) {
    const row = await queryOne<{ rule_id: number }>(
      `INSERT INTO clause_rules (rule_code, title, description, rule_type, severity, present_threshold, standard_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (rule_code) DO UPDATE SET rule_code = EXCLUDED.rule_code RETURNING rule_id`,
      [r.rule_code, r.title, r.description, r.rule_type, r.severity, r.present_threshold, r.standard_threshold]);
    const existing = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM reference_clauses WHERE rule_id = $1`, [row!.rule_id]);
    if (existing!.n === 0) {
      for (const ref of r.references) {
        await query(`INSERT INTO reference_clauses (rule_id, label, clause_text) VALUES ($1, $2, $3)`, [row!.rule_id, ref.label, ref.text]);
      }
    }
  }

  console.log('Embedding reference clauses with Ollama and storing them in Qdrant...');
  const refs = await query<{ ref_id: number; rule_id: number; rule_code: string; label: string; clause_text: string }>(
    `SELECT rc.ref_id, rc.rule_id, r.rule_code, rc.label, rc.clause_text FROM reference_clauses rc JOIN clause_rules r ON r.rule_id = rc.rule_id ORDER BY rc.ref_id`);
  const vectors = await embedTexts(refs.map((r) => r.clause_text), 'document');
  await upsertPoints(COLLECTIONS.references, refs.map((r, i) => ({
    id: r.ref_id, vector: vectors[i], payload: { ref_id: r.ref_id, rule_id: r.rule_id, rule_code: r.rule_code, label: r.label },
  })));
  console.log(`  indexed ${refs.length} reference clauses (vector size ${vectors[0].length}).`);

  const hasCase = await queryOne(`SELECT 1 FROM cases LIMIT 1`);
  if (!hasCase) {
    const reviewer = await queryOne<{ user_id: number }>(`SELECT user_id FROM users WHERE lower(email) = 'reviewer@lce.test'`);
    const client = await queryOne<{ user_id: number }>(`SELECT user_id FROM users WHERE lower(email) = 'client@lce.test'`);
    if (reviewer && client) {
      const c = await queryOne<{ case_id: number }>(
        `INSERT INTO cases (title, description, client_id, created_by) VALUES ($1, $2, $3, $4) RETURNING case_id`,
        ['Harbor Retail supplier contract review', 'Review incoming supplier and consulting agreements before signature.', client.user_id, reviewer.user_id]);
      await query(`INSERT INTO case_assignments (case_id, user_id) VALUES ($1, $2)`, [c!.case_id, reviewer.user_id]);
      console.log('  created demo case.');
    }
  }

  console.log('\nDone. Demo logins (change these passwords outside of local development!):');
  for (const u of DEMO_USERS) console.log(`  ${u.role.padEnd(9)} ${u.email}  /  ${u.password}`);
}

main()
  .catch((e) => { console.error('\nSeed failed:', e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => getPool().end());
