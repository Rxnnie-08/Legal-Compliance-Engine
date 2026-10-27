// Data-access layer: every SQL statement of the application lives here.
// Route Handlers and Server Components both call these functions, so database
// credentials never leave the server and every query is parameterised.
import { audit, query, queryOne, withTx } from './db';
import { HttpError } from './http';
import { hashPassword } from './auth';
import { COLLECTIONS, deleteByDocument, deletePoint, upsertPoints } from './qdrant';
import { embedTexts } from './ollama';
import type {
  CaseSummary, ClauseRow, DocumentOverview, IssueRow, IssueStatus, ReferenceClause, Role, RuleRow, ScanResultRow, SessionUser,
} from './types';

// ---------------------------------------------------------------------------
// access control (row-level, enforced in SQL)
// ---------------------------------------------------------------------------

/**
 * SQL condition restricting `alias` (an alias of the `cases` table) to the cases the user may see:
 *   admin    -> everything
 *   reviewer -> cases they created or are assigned to
 *   client   -> cases where they are the client
 */
export function caseAccess(user: SessionUser, alias: string, params: unknown[]): string {
  if (user.role === 'admin') return 'TRUE';
  params.push(user.userId);
  const n = params.length;
  if (user.role === 'client') return `${alias}.client_id = $${n}`;
  return `(${alias}.created_by = $${n} OR EXISTS (SELECT 1 FROM case_assignments ca WHERE ca.case_id = ${alias}.case_id AND ca.user_id = $${n}))`;
}

export async function accessibleCaseIds(user: SessionUser): Promise<number[]> {
  const params: unknown[] = [];
  const rows = await query<{ case_id: number }>(`SELECT c.case_id FROM cases c WHERE ${caseAccess(user, 'c', params)}`, params);
  return rows.map((r) => r.case_id);
}

/** Throws 404 (not 403, so existence is not leaked) when the user cannot see the case. */
export async function assertCaseAccess(user: SessionUser, caseId: number): Promise<void> {
  const params: unknown[] = [caseId];
  const row = await queryOne(`SELECT 1 FROM cases c WHERE c.case_id = $1 AND ${caseAccess(user, 'c', params)}`, params);
  if (!row) throw new HttpError(404, 'Case not found.');
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------
export interface UserRow { user_id: number; full_name: string; email: string; role: Role; is_active: boolean; created_at: string }

export const listUsers = () =>
  query<UserRow>(`SELECT user_id, full_name, email, role, is_active, created_at FROM users ORDER BY role, full_name`);

export const listUsersByRole = (role: Role) =>
  query<{ user_id: number; full_name: string; email: string }>(
    `SELECT user_id, full_name, email FROM users WHERE role = $1 AND is_active ORDER BY full_name`, [role]);

export async function createUser(actor: SessionUser, v: { fullName: string; email: string; password: string; role: Role }) {
  const hash = await hashPassword(v.password);
  return withTx(actor.userId, async (c) => {
    const r = await c.query(
      `INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, lower($2), $3, $4) RETURNING user_id`,
      [v.fullName, v.email, hash, v.role]);
    await audit(c, actor.userId, 'user.create', 'user', r.rows[0].user_id, { email: v.email.toLowerCase(), role: v.role });
    return r.rows[0].user_id as number;
  });
}

export async function updateUser(actor: SessionUser, userId: number, v: { role?: Role; isActive?: boolean; password?: string }) {
  if (userId === actor.userId && (v.isActive === false || (v.role && v.role !== actor.role))) {
    throw new HttpError(400, 'You cannot deactivate or change the role of your own account.');
  }
  const hash = v.password ? await hashPassword(v.password) : null;
  await withTx(actor.userId, async (c) => {
    const r = await c.query(
      `UPDATE users SET role = COALESCE($2::user_role, role), is_active = COALESCE($3, is_active), password_hash = COALESCE($4, password_hash)
       WHERE user_id = $1 RETURNING user_id`,
      [userId, v.role ?? null, v.isActive ?? null, hash]);
    if (!r.rowCount) throw new HttpError(404, 'User not found.');
    const left = await c.query(`SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND is_active`);
    if (left.rows[0].n === 0) throw new HttpError(400, 'At least one active administrator is required.');
    await audit(c, actor.userId, 'user.update', 'user', userId, { role: v.role, isActive: v.isActive, passwordChanged: !!v.password });
  });
}

// ---------------------------------------------------------------------------
// cases
// ---------------------------------------------------------------------------
export async function listCases(user: SessionUser): Promise<CaseSummary[]> {
  const params: unknown[] = [];
  return query<CaseSummary>(
    `SELECT s.* FROM v_case_summary s
      WHERE s.case_id IN (SELECT c.case_id FROM cases c WHERE ${caseAccess(user, 'c', params)})
      ORDER BY s.created_at DESC`, params);
}

export interface CaseDetail extends CaseSummary { description: string | null; reviewers: { user_id: number; full_name: string; email: string }[] }

export async function getCase(user: SessionUser, caseId: number): Promise<CaseDetail> {
  const params: unknown[] = [caseId];
  const row = await queryOne<CaseSummary & { description: string | null }>(
    `SELECT s.*, c.description FROM v_case_summary s JOIN cases c ON c.case_id = s.case_id
      WHERE s.case_id = $1 AND ${caseAccess(user, 'c', params)}`, params);
  if (!row) throw new HttpError(404, 'Case not found.');
  const reviewers = await query<{ user_id: number; full_name: string; email: string }>(
    `SELECT u.user_id, u.full_name, u.email FROM case_assignments ca JOIN users u ON u.user_id = ca.user_id
      WHERE ca.case_id = $1 ORDER BY u.full_name`, [caseId]);
  return { ...row, reviewers };
}

export async function createCase(user: SessionUser, v: { title: string; description?: string; clientId: number }) {
  return withTx(user.userId, async (c) => {
    const r = await c.query(
      `INSERT INTO cases (title, description, client_id, created_by) VALUES ($1, $2, $3, $4) RETURNING case_id, case_number`,
      [v.title, v.description ?? null, v.clientId, user.userId]);
    const { case_id, case_number } = r.rows[0];
    if (user.role === 'reviewer') {
      await c.query(`INSERT INTO case_assignments (case_id, user_id) VALUES ($1, $2)`, [case_id, user.userId]);
    }
    await audit(c, user.userId, 'case.create', 'case', case_id, { case_number, title: v.title, clientId: v.clientId });
    return { caseId: case_id as number, caseNumber: case_number as string };
  });
}

export async function assignReviewer(user: SessionUser, caseId: number, reviewerId: number) {
  await assertCaseAccess(user, caseId);
  await withTx(user.userId, async (c) => {
    await c.query(`INSERT INTO case_assignments (case_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [caseId, reviewerId]);
    await audit(c, user.userId, 'case.assign', 'case', caseId, { reviewerId });
  });
}

export async function unassignReviewer(user: SessionUser, caseId: number, reviewerId: number) {
  await assertCaseAccess(user, caseId);
  await withTx(user.userId, async (c) => {
    await c.query(`DELETE FROM case_assignments WHERE case_id = $1 AND user_id = $2`, [caseId, reviewerId]);
    await audit(c, user.userId, 'case.unassign', 'case', caseId, { reviewerId });
  });
}

// ---------------------------------------------------------------------------
// documents, clauses, issues
// ---------------------------------------------------------------------------
export async function listDocumentsForCase(user: SessionUser, caseId: number): Promise<DocumentOverview[]> {
  await assertCaseAccess(user, caseId);
  return query<DocumentOverview>(`SELECT * FROM v_document_overview WHERE case_id = $1 ORDER BY uploaded_at DESC`, [caseId]);
}

export interface DocumentReport {
  document: DocumentOverview;
  clauses: ClauseRow[];
  issues: IssueRow[];
  scanResults: ScanResultRow[];
}

export async function getDocumentReport(user: SessionUser, documentId: number): Promise<DocumentReport> {
  const params: unknown[] = [documentId];
  const document = await queryOne<DocumentOverview>(
    `SELECT v.* FROM v_document_overview v
      WHERE v.document_id = $1 AND v.case_id IN (SELECT c.case_id FROM cases c WHERE ${caseAccess(user, 'c', params)})`, params);
  if (!document) throw new HttpError(404, 'Document not found.');

  const [clauses, issues, scanResults] = await Promise.all([
    query<ClauseRow>(`SELECT clause_id, position, heading, body FROM clauses WHERE document_id = $1 ORDER BY position`, [documentId]),
    query<IssueRow>(
      `SELECT fi.issue_id, fi.document_id, fi.rule_id, r.rule_code, r.title AS rule_title, r.description AS rule_description, r.rule_type,
              fi.clause_id, cl.position AS clause_position, cl.body AS clause_body, fi.kind, fi.severity, fi.similarity,
              fi.explanation, fi.explained_at, fi.status, u.full_name AS resolved_by_name, fi.resolved_at
         FROM flagged_issues fi
         JOIN clause_rules r ON r.rule_id = fi.rule_id
         LEFT JOIN clauses cl ON cl.clause_id = fi.clause_id
         LEFT JOIN users u ON u.user_id = fi.resolved_by
        WHERE fi.document_id = $1
        ORDER BY (fi.status = 'open') DESC,
                 CASE fi.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, fi.issue_id`, [documentId]),
    query<ScanResultRow>(
      `SELECT r.rule_id, r.rule_code, r.title AS rule_title, r.rule_type, r.severity, r.present_threshold, r.standard_threshold,
              sr.best_similarity, sr.best_clause_id, cl.position AS best_clause_position, rc.label AS best_ref_label
         FROM scan_results sr
         JOIN clause_rules r ON r.rule_id = sr.rule_id
         LEFT JOIN clauses cl ON cl.clause_id = sr.best_clause_id
         LEFT JOIN reference_clauses rc ON rc.ref_id = sr.best_ref_id
        WHERE sr.document_id = $1 ORDER BY r.rule_id`, [documentId]),
  ]);
  return { document, clauses, issues, scanResults };
}

export async function deleteDocument(user: SessionUser, documentId: number) {
  const params: unknown[] = [documentId];
  const doc = await queryOne<{ title: string }>(
    `SELECT d.title FROM documents d WHERE d.document_id = $1 AND d.case_id IN (SELECT c.case_id FROM cases c WHERE ${caseAccess(user, 'c', params)})`, params);
  if (!doc) throw new HttpError(404, 'Document not found.');
  await withTx(user.userId, async (c) => {
    await c.query(`DELETE FROM documents WHERE document_id = $1`, [documentId]); // clauses, scans, issues cascade
    await audit(c, user.userId, 'document.delete', 'document', documentId, { title: doc.title });
  });
  await deleteByDocument(documentId);
}

export async function updateIssueStatus(user: SessionUser, issueId: number, status: IssueStatus) {
  const params: unknown[] = [issueId];
  const row = await queryOne(
    `SELECT fi.issue_id FROM flagged_issues fi
       JOIN documents d ON d.document_id = fi.document_id
       JOIN cases c ON c.case_id = d.case_id
      WHERE fi.issue_id = $1 AND ${caseAccess(user, 'c', params)}`, params);
  if (!row) throw new HttpError(404, 'Issue not found.');
  await withTx(user.userId, async (c) => {
    await c.query(`UPDATE flagged_issues SET status = $2 WHERE issue_id = $1`, [issueId, status]);
  });
}

// ---------------------------------------------------------------------------
// dashboard
// ---------------------------------------------------------------------------
export async function dashboard(user: SessionUser) {
  const scope = (p: unknown[]) => `v.case_id IN (SELECT c.case_id FROM cases c WHERE ${caseAccess(user, 'c', p)})`;

  const p1: unknown[] = [];
  const totals = await queryOne<{ documents: number; scanned: number; avg_score: number | null; open_issues: number; critical_open: number; cases: number }>(
    `SELECT COUNT(*)::int AS documents,
            COUNT(*) FILTER (WHERE v.status = 'scanned')::int AS scanned,
            ROUND(AVG(v.compliance_score), 0)::float AS avg_score,
            COALESCE(SUM(v.open_issues), 0)::int AS open_issues,
            COALESCE(SUM(v.critical_open), 0)::int AS critical_open,
            COUNT(DISTINCT v.case_id)::int AS cases
       FROM v_document_overview v WHERE ${scope(p1)}`, p1);

  const p2: unknown[] = [];
  const attention = await query<DocumentOverview>(
    `SELECT v.* FROM v_document_overview v WHERE v.status = 'scanned' AND ${scope(p2)}
      ORDER BY v.compliance_score ASC, v.critical_open DESC LIMIT 6`, p2);

  const p3: unknown[] = [];
  const byRule = await query<{ rule_id: number; rule_code: string; title: string; severity: string; open_violations: number }>(
    `SELECT r.rule_id, r.rule_code, r.title, r.severity, COUNT(fi.issue_id)::int AS open_violations
       FROM clause_rules r
       LEFT JOIN flagged_issues fi ON fi.rule_id = r.rule_id AND fi.status = 'open'
            AND fi.document_id IN (SELECT v.document_id FROM v_document_overview v WHERE ${scope(p3)})
      WHERE r.is_active GROUP BY r.rule_id ORDER BY open_violations DESC, r.rule_id`, p3);

  return { totals: totals!, attention, byRule };
}

// ---------------------------------------------------------------------------
// admin: rules, reference clauses, audit
// ---------------------------------------------------------------------------
export interface RuleWithStats extends RuleRow {
  reference_count: number;
  documents_scanned: number;
  open_violations: number;
}

export const listRules = () =>
  query<RuleWithStats>(
    `SELECT r.*, (SELECT COUNT(*)::int FROM reference_clauses rc WHERE rc.rule_id = r.rule_id) AS reference_count,
            s.documents_scanned::int AS documents_scanned, s.open_violations::int AS open_violations
       FROM clause_rules r JOIN v_rule_stats s ON s.rule_id = r.rule_id ORDER BY r.rule_id`);

export const listReferences = () =>
  query<ReferenceClause>(`SELECT ref_id, rule_id, label, clause_text FROM reference_clauses ORDER BY rule_id, ref_id`);

export async function createRule(actor: SessionUser, v: {
  ruleCode: string; title: string; description: string; ruleType: 'required' | 'restricted';
  severity: string; presentThreshold: number; standardThreshold: number;
}) {
  return withTx(actor.userId, async (c) => {
    const r = await c.query(
      `INSERT INTO clause_rules (rule_code, title, description, rule_type, severity, present_threshold, standard_threshold)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING rule_id`,
      [v.ruleCode, v.title, v.description, v.ruleType, v.severity, v.presentThreshold, v.standardThreshold]);
    await audit(c, actor.userId, 'rule.create', 'rule', r.rows[0].rule_id, { code: v.ruleCode });
    return r.rows[0].rule_id as number;
  });
}

export async function updateRule(actor: SessionUser, ruleId: number, v: {
  title?: string; description?: string; severity?: string; presentThreshold?: number; standardThreshold?: number; isActive?: boolean;
}) {
  await withTx(actor.userId, async (c) => {
    const r = await c.query(
      `UPDATE clause_rules SET title = COALESCE($2, title), description = COALESCE($3, description),
              severity = COALESCE($4::severity_level, severity), present_threshold = COALESCE($5, present_threshold),
              standard_threshold = COALESCE($6, standard_threshold), is_active = COALESCE($7, is_active)
        WHERE rule_id = $1 RETURNING rule_id`,
      [ruleId, v.title ?? null, v.description ?? null, v.severity ?? null, v.presentThreshold ?? null, v.standardThreshold ?? null, v.isActive ?? null]);
    if (!r.rowCount) throw new HttpError(404, 'Rule not found.');
    await audit(c, actor.userId, 'rule.update', 'rule', ruleId, v);
  });
}

/** Re-apply the current thresholds to every stored scan (stored procedure, no re-embedding needed). */
export async function reevaluateAll(actor: SessionUser) {
  await withTx(actor.userId, async (c) => {
    await c.query(`CALL sp_reevaluate_all()`);
    await audit(c, actor.userId, 'rules.reevaluate', 'rule', null, {});
  });
}

/** Store a reference clause in PostgreSQL and its embedding in Qdrant. */
export async function addReference(actor: SessionUser, ruleId: number, v: { label: string; clauseText: string }) {
  const rule = await queryOne<{ rule_code: string }>(`SELECT rule_code FROM clause_rules WHERE rule_id = $1`, [ruleId]);
  if (!rule) throw new HttpError(404, 'Rule not found.');
  const [vector] = await embedTexts([v.clauseText]);
  let refId = 0;
  try {
    await withTx(actor.userId, async (c) => {
      const r = await c.query(
        `INSERT INTO reference_clauses (rule_id, label, clause_text) VALUES ($1, $2, $3) RETURNING ref_id`, [ruleId, v.label, v.clauseText]);
      refId = r.rows[0].ref_id;
      await upsertPoints(COLLECTIONS.references, [{ id: refId, vector, payload: { ref_id: refId, rule_id: ruleId, rule_code: rule.rule_code, label: v.label } }]);
      await audit(c, actor.userId, 'reference.create', 'rule', ruleId, { refId, label: v.label });
    });
  } catch (e) {
    if (refId) await deletePoint(COLLECTIONS.references, refId).catch(() => undefined);
    throw e;
  }
  return refId;
}

export async function deleteReference(actor: SessionUser, refId: number) {
  await withTx(actor.userId, async (c) => {
    const r = await c.query(`DELETE FROM reference_clauses WHERE ref_id = $1 RETURNING rule_id`, [refId]);
    if (!r.rowCount) throw new HttpError(404, 'Reference clause not found.');
    await audit(c, actor.userId, 'reference.delete', 'rule', r.rows[0].rule_id, { refId });
  });
  await deletePoint(COLLECTIONS.references, refId);
}

export interface AuditRow { log_id: number; created_at: string; actor: string; action: string; entity_type: string; entity_id: number | null; details: Record<string, unknown> }

export async function listAudit(entityType?: string, limit = 200) {
  const params: unknown[] = [];
  let where = '';
  if (entityType) { params.push(entityType); where = `WHERE a.entity_type = $1`; }
  params.push(limit);
  return query<AuditRow>(
    `SELECT a.log_id, a.created_at, COALESCE(u.full_name, 'system') AS actor, a.action, a.entity_type, a.entity_id, a.details
       FROM audit_log a LEFT JOIN users u ON u.user_id = a.user_id ${where}
      ORDER BY a.log_id DESC LIMIT $${params.length}`, params);
}
