// End-to-end test against a RUNNING app (npm run build && npm start, or npm run dev).
// Needs PostgreSQL, Qdrant and Ollama up and `npm run seed` done.   BASE_URL defaults to http://localhost:3000
//   npm run e2e
import { readFileSync } from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
let passed = 0, failed = 0;

function check(name: string, cond: unknown, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
}

class Session {
  cookie = '';
  async req(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
    const res = await this.fetchRaw(method, path, body);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, data };
  }
  async fetchRaw(method: string, path: string, body?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(BASE + path, { method, headers, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    return res;
  }
  async login(email: string, password: string) { return this.req('POST', '/api/auth/login', { email, password }); }
}

function upload(file: string, mime: string, caseId: number, title: string) {
  const fd = new FormData();
  fd.set('file', new File([readFileSync(`samples/${file}`)], file, { type: mime }));
  fd.set('caseId', String(caseId));
  fd.set('title', title);
  return fd;
}

async function main() {
  const admin = new Session(), rev = new Session(), cli = new Session(), anon = new Session();

  console.log('\nAuthentication');
  check('wrong password rejected', (await anon.login('admin@lce.test', 'nope')).status === 401);
  check('unauthenticated API call -> 401', (await anon.req('GET', '/api/cases')).status === 401);
  const pageRes = await anon.fetchRaw('GET', '/cases');
  check('unauthenticated page -> redirect to /login', pageRes.status === 307 && (pageRes.headers.get('location') ?? '').endsWith('/login'));
  check('admin login', (await admin.login('admin@lce.test', 'Admin@12345')).status === 200);
  check('reviewer login', (await rev.login('reviewer@lce.test', 'Reviewer@12345')).status === 200);
  check('client login', (await cli.login('client@lce.test', 'Client@12345')).status === 200);

  console.log('\nRole-based access');
  check('client cannot create case', (await cli.req('POST', '/api/cases', { title: 'x'.repeat(5), clientId: 1 })).status === 403);
  check('reviewer cannot open admin API', (await rev.req('GET', '/api/admin/users')).status === 403);
  check('client cannot open admin API', (await cli.req('GET', '/api/admin/rules')).status === 403);
  check('admin can list users', (await admin.req('GET', '/api/admin/users')).data.users?.length >= 3);

  console.log('\nUsers and cases');
  const email = `second.client.${Date.now()}@lce.test`;
  const nu = await admin.req('POST', '/api/admin/users', { fullName: 'Second Client', email, password: 'Second@12345', role: 'client' });
  check('admin creates a client', nu.status === 201, JSON.stringify(nu.data));
  check('weak password rejected', (await admin.req('POST', '/api/admin/users', { fullName: 'Weak', email: 'weak@lce.test', password: 'abc', role: 'client' })).status === 400);
  check('duplicate e-mail rejected (DB unique index)', (await admin.req('POST', '/api/admin/users', { fullName: 'Dup', email: email.toUpperCase(), password: 'Second@12345', role: 'client' })).status === 409);
  const other = new Session(); await other.login(email, 'Second@12345');

  const cases = (await rev.req('GET', '/api/cases')).data.cases as any[];
  const me = await rev.req('GET', '/api/cases');
  check('reviewer sees the demo case', cases.length >= 1);
  const caseId = (cases.find((c) => c.title.startsWith('Harbor Retail')) ?? cases[0]).case_id as number;
  check('client sees own case', ((await cli.req('GET', '/api/cases')).data.cases as any[]).some((c) => c.case_id === caseId));
  check('other client sees no cases', ((await other.req('GET', '/api/cases')).data.cases as any[]).length === 0);
  check('other client gets 404 for the case', (await other.req('GET', `/api/cases/${caseId}`)).status === 404);
  const newCase = await rev.req('POST', '/api/cases', { title: 'E2E test case', clientId: (await admin.req('GET', '/api/admin/users')).data.users.find((u: any) => u.email === email).user_id });
  check('reviewer creates a case (auto-assigned)', newCase.status === 201 && /^CASE-\d{4}-\d{4}$/.test(newCase.data.caseNumber), JSON.stringify(newCase.data));
  check('client rejected as non-client in case (trigger)', (await rev.req('POST', '/api/cases', { title: 'bad client', clientId: (await admin.req('GET', '/api/admin/users')).data.users.find((u: any) => u.role === 'admin').user_id })).status === 400);

  console.log('\nUpload and compliance scan');
  check('client cannot upload', (await cli.req('POST', '/api/documents', upload('risky_consulting_agreement.txt', 'text/plain', caseId, 'x'))).status === 403);
  check('unsupported file type rejected', (await rev.req('POST', '/api/documents', (() => { const f = new FormData(); f.set('file', new File(['hello'], 'a.exe', { type: 'application/x-msdownload' })); f.set('caseId', String(caseId)); return f; })())).status === 415);

  const good = await rev.req('POST', '/api/documents', upload('compliant_services_agreement.pdf', 'application/pdf', caseId, 'Compliant MSA (PDF)'));
  check('compliant PDF uploaded', good.status === 201, JSON.stringify(good.data));
  check('compliant PDF scores 100 with no issues', good.data.complianceScore === 100 && good.data.openIssues === 0, JSON.stringify(good.data));

  const bad = await rev.req('POST', '/api/documents', upload('risky_consulting_agreement.txt', 'text/plain', caseId, 'Risky consulting agreement'));
  check('risky contract uploaded', bad.status === 201, JSON.stringify(bad.data));
  check('risky contract has several issues and a low score', bad.data.openIssues >= 4 && bad.data.complianceScore < 50, JSON.stringify(bad.data));

  const report = (await rev.req('GET', `/api/documents/${bad.data.documentId}`)).data;
  const kinds = Object.fromEntries(report.issues.map((i: any) => [i.rule_code, i.kind]));
  check('non-compete flagged as restricted_present', kinds.NONCOMPETE === 'restricted_present', JSON.stringify(kinds));
  check('governing law flagged as missing', kinds.GOV_LAW === 'missing', JSON.stringify(kinds));
  check('flagged clause is linked', report.issues.find((i: any) => i.rule_code === 'NONCOMPETE')?.clause_position === 8);
  check('client can read the report', (await cli.req('GET', `/api/documents/${bad.data.documentId}`)).status === 200);
  check('other client cannot read the report', (await other.req('GET', `/api/documents/${bad.data.documentId}`)).status === 404);

  console.log('\nIssue workflow and RAG explanation');
  const issue = report.issues.find((i: any) => i.rule_code === 'NONCOMPETE');
  const ex = await rev.req('POST', `/api/issues/${issue.issue_id}/explain`);
  check('RAG explanation generated', ex.status === 200 && typeof ex.data.explanation === 'string' && ex.data.explanation.length > 20, JSON.stringify(ex.data));
  check('client cannot trigger explanation', (await cli.req('POST', `/api/issues/${issue.issue_id}/explain`)).status === 403);
  check('client cannot resolve an issue', (await cli.req('PATCH', `/api/issues/${issue.issue_id}`, { status: 'resolved' })).status === 403);
  const before = report.document.compliance_score as number;
  check('reviewer resolves an issue', (await rev.req('PATCH', `/api/issues/${issue.issue_id}`, { status: 'resolved' })).status === 200);
  const after = (await rev.req('GET', `/api/documents/${bad.data.documentId}`)).data;
  check('trigger raised the score and stamped the resolver', after.document.compliance_score > before && after.issues.find((i: any) => i.issue_id === issue.issue_id)?.resolved_by_name === 'Demo Reviewer', `${before} -> ${after.document.compliance_score}`);

  console.log('\nSearch');
  const kw = await rev.req('GET', '/api/search?q=indemnify&mode=keyword');
  check('keyword search finds clauses', kw.data.hits?.length >= 1 && /<<.*>>/.test(kw.data.hits[0].snippet), JSON.stringify(kw.data).slice(0, 200));
  const sem = await rev.req('GET', '/api/search?q=indemnify%20and%20defend%20against%20claims%20and%20damages&mode=semantic');
  check('semantic search returns hits with vector scores', sem.data.hits?.length >= 1 && typeof sem.data.hits[0].vector_score === 'number');
  const hyb = await rev.req('GET', '/api/search?q=terminate%20notice&mode=hybrid');
  check('hybrid search returns fused hits', hyb.data.hits?.length >= 1 && hyb.data.hits[0].fused_score > 0);
  check('other client sees no search results', ((await other.req('GET', '/api/search?q=indemnify&mode=hybrid')).data.hits ?? []).length === 0);
  const sim = await rev.req('GET', `/api/clauses/${report.clauses.find((c: any) => c.position === 7).clause_id}/similar`);
  check('similar-clause search works', sim.status === 200 && sim.data.hits.length >= 1);

  console.log('\nAdmin: rules, library, audit');
  const rules = (await admin.req('GET', '/api/admin/rules')).data;
  check('rules and references listed', rules.rules.length >= 5 && rules.references.length >= 10);
  const gov = rules.rules.find((r: any) => r.rule_code === 'GOV_LAW');
  check('invalid thresholds rejected by the database', (await admin.req('PATCH', `/api/admin/rules/${gov.rule_id}`, { presentThreshold: 0.9, standardThreshold: 0.1 })).status === 400);
  check('relax rule + re-evaluate (stored procedure)', (await admin.req('PATCH', `/api/admin/rules/${gov.rule_id}`, { presentThreshold: 0.05, standardThreshold: 0.06 })).status === 200 && (await admin.req('POST', '/api/admin/reevaluate')).status === 200);
  const relaxed = (await rev.req('GET', `/api/documents/${bad.data.documentId}`)).data;
  check('governing-law flag disappeared after re-evaluation', !relaxed.issues.some((i: any) => i.rule_code === 'GOV_LAW' && i.status === 'open'));
  await admin.req('PATCH', `/api/admin/rules/${gov.rule_id}`, { presentThreshold: gov.present_threshold, standardThreshold: gov.standard_threshold });
  await admin.req('POST', '/api/admin/reevaluate');
  const audit = (await admin.req('GET', '/api/admin/audit')).data.entries as any[];
  check('audit log recorded upload, flags, resolution', ['document.upload', 'issue.flagged', 'issue.resolved', 'document.scanned', 'issue.explained'].every((a) => audit.some((e) => e.action === a)));
  check('admin cannot disable themself', (await admin.req('PATCH', `/api/admin/users/${(await admin.req('GET', '/api/admin/users')).data.users.find((u: any) => u.email === 'admin@lce.test').user_id}`, { isActive: false })).status === 400);

  console.log('\nCleanup');
  check('reviewer deletes the test documents', (await rev.req('DELETE', `/api/documents/${good.data.documentId}`)).status === 200 && (await rev.req('DELETE', `/api/documents/${bad.data.documentId}`)).status === 200);
  check('deleted document is gone', (await rev.req('GET', `/api/documents/${bad.data.documentId}`)).status === 404);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
