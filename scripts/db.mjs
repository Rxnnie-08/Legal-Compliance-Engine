// Tiny SQL runner so that nobody needs the `psql` binary.
//   node scripts/db.mjs init     -> create all tables, views, triggers, procedures
//   node scripts/db.mjs reset    -> drop everything, then init   (DESTROYS DATA)
//   node scripts/db.mjs test     -> create a THROWAWAY database, install schema.sql, run db/tests.sql, drop it
//                                   (your real data is never touched; needs the CREATEDB privilege)
//   node scripts/db.mjs queries  -> run db/queries.sql and print the results
//   node scripts/db.mjs alter    -> run db/alter_demo.sql (ALTER / DROP demonstration)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// load .env.local without extra dependencies
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set. Copy .env.example to .env.local and edit it.');
  process.exit(1);
}

const sql = (f) => readFileSync(path.join(root, 'db', f), 'utf8');
const command = process.argv[2];
const files = {
  init: ['schema.sql'],
  reset: ['drop.sql', 'schema.sql'],
  test: ['tests.sql'],
  queries: ['queries.sql'],
  alter: ['alter_demo.sql'],
}[command];

if (!files) {
  console.error('Usage: node scripts/db.mjs <init|reset|test|queries|alter>');
  process.exit(1);
}

if (command === 'test') {
  // run the test-suite in its own empty database
  const base = new URL(url);
  const scratch = `lce_test_${process.pid}_${Date.now() % 100000}`;
  const admin = new pg.Client({ connectionString: url });
  let created = false;
  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${scratch}`);
    created = true;
    base.pathname = '/' + scratch;
    const t = new pg.Client({ connectionString: base.toString() });
    t.on('notice', (n) => console.log('  ' + n.message));
    await t.connect();
    try {
      console.log(`> installing db/schema.sql into throwaway database ${scratch}`);
      await t.query(sql('schema.sql'));
      console.log('> running db/tests.sql');
      await t.query(sql('tests.sql'));
      console.log('done (test).');
    } finally {
      await t.end();
    }
  } catch (e) {
    console.error(`\nFAILED: ${e.message}`);
    if (e.where) console.error(`  where: ${e.where}`);
    process.exitCode = 1;
  } finally {
    if (created) await admin.query(`DROP DATABASE IF EXISTS ${scratch}`).catch(() => undefined);
    await admin.end();
  }
  process.exit(process.exitCode ?? 0);
}

const client = new pg.Client({ connectionString: url });
client.on('notice', (n) => console.log('  ' + n.message));

try {
  await client.connect();
  for (const f of files) {
    console.log(`> running db/${f}`);
    const res = await client.query(sql(f));
    if (command === 'queries') {
      for (const r of Array.isArray(res) ? res : [res]) {
        if (!r.rows?.length) continue;
        console.log(`\n-- ${r.command}: ${r.rowCount} row(s)`);
        console.table(r.rows);
      }
    }
  }
  console.log(`done (${command}).`);
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  if (e.where) console.error(`  where: ${e.where}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
