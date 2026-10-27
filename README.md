# Legal Document Discovery & Compliance Engine

Upload a contract and the system compares every clause with a library of standard clauses, flags missing or risky
terms, scores the document, and explains each flag in plain English.

| Layer | Technology | Why |
|---|---|---|
| Web app + API | **Next.js 15** (App Router, Route Handlers) | required by the course |
| SQL database | **PostgreSQL 16** | users, cases, documents, rules, flags, audit trail: relational integrity and transactions |
| Vector database | **Qdrant** | clause embeddings and cosine nearest-neighbour search |
| Embeddings and LLM | **Ollama** (local, free): `nomic-embed-text` + `llama3.2` | no API key or cost |

Full report material (ER diagram, schema, justification, queries, test results) is in
[`docs/DOCUMENTATION.md`](docs/DOCUMENTATION.md).

## 1. Prerequisites

* Node.js 20 or newer
* Docker (for PostgreSQL and Qdrant) **or** your own PostgreSQL 14+ and Qdrant instances
* [Ollama](https://ollama.com) installed and running

## 2. Set up

```bash
# 1. databases
docker compose up -d                    # PostgreSQL on :5432, Qdrant on :6333

# 2. models (one-time download, a few GB in total)
ollama pull nomic-embed-text
ollama pull llama3.2

# 3. app
npm install
cp .env.example .env.local              # then set JWT_SECRET (command is in the file)
npm run setup                           # creates tables/triggers/procedures, seeds users, rules, embeds the library
npm run dev                             # http://localhost:3000
```

Demo logins created by the seed script (**change them outside local development**):

| Role | E-mail | Password |
|---|---|---|
| Administrator | admin@lce.test | Admin@12345 |
| Reviewer | reviewer@lce.test | Reviewer@12345 |
| Client | client@lce.test | Client@12345 |

Try it: sign in as the reviewer, open the demo case, upload `samples/risky_consulting_agreement.pdf`
and then `samples/compliant_services_agreement.pdf`, and compare the reports.

## 3. Calibrate the thresholds for your model (important)

Whether a clause counts as "missing" or "non-standard" depends on cosine similarity between your embedding model's
vectors, and every model has a different score range. The defaults in `data/reference_clauses.json` are a starting
point. Run:

```bash
npm run calibrate
```

It prints the best similarity of every rule for both sample contracts (without writing to the database). Adjust the
two thresholds per rule in **Administration > Rules and clause library**, then press **Re-apply thresholds to all
documents** (this calls the stored procedure `sp_reevaluate_all`, no re-embedding needed).

## 4. Useful commands

| Command | What it does |
|---|---|
| `npm run db:test` | SQL test-suite for triggers, procedures, views, constraints; runs in a throwaway database, your data is untouched |
| `npm run e2e` | 48 end-to-end checks against the running app (roles, upload, flags, RAG, search, admin) |
| `npm run db:queries` | runs the demo queries from `db/queries.sql` and prints results |
| `npm run db:alter` | ALTER / DROP demonstration (rolled back) |
| `npm run db:reset` | **drops everything** and recreates the schema |
| `npm run calibrate` | threshold calibration table |

Without a GPU or model download you can develop against `node scripts/fake-ollama.mjs` (a stand-in server with
lexical, non-semantic embeddings). It exists only for testing the plumbing.

## 5. Roles

| Role | Can do |
|---|---|
| Administrator | everything, plus users, rules, reference clauses, audit log |
| Reviewer | create cases, upload documents, review/resolve/dismiss issues, search; sees cases they created or are assigned to |
| Client | read-only access to the reports and search results of their own cases |

Access is enforced in three places: middleware (valid session), route handlers (role), and SQL (`caseAccess` row-level
filter), so a client can never read another client's case even by guessing ids (the API answers 404).

## 6. Project layout

```
db/schema.sql         tables, constraints, indexes, triggers, procedures, views
db/tests.sql          SQL test-suite          db/queries.sql  report queries     db/alter_demo.sql  ALTER/DROP demo
data/reference_clauses.json   rule library (rules + standard clauses)
samples/              one compliant and one risky contract (txt + pdf)
src/lib/              db, qdrant, ollama, chunking, ingestion (documents.ts), search, explain (RAG), auth, repo (all SQL)
src/app/api/          route handlers        src/app/(app)/   pages        src/components/   UI
scripts/              db runner, seed, e2e, calibrate, stand-in Ollama
```


