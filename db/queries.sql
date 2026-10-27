-- =====================================================================
--  Important queries (for the report / viva).   Run: npm run db:queries
--  Works on any data; most useful after `npm run seed` and a few uploads.
-- =====================================================================

-- Q1  JOIN + ORDER BY : documents that need attention first (lowest score)
SELECT d.document_id, d.title, c.case_number, u.full_name AS uploaded_by, d.compliance_score
FROM documents d
JOIN cases c ON c.case_id = d.case_id
JOIN users u ON u.user_id = d.uploaded_by
WHERE d.status = 'scanned'
ORDER BY d.compliance_score ASC, d.uploaded_at DESC
LIMIT 10;

-- Q2  GROUP BY + HAVING + aggregates : rules that are violated in more than one open issue
SELECT r.rule_code, r.severity, COUNT(*) AS open_violations, ROUND(AVG(fi.similarity), 3) AS avg_similarity
FROM flagged_issues fi
JOIN clause_rules r ON r.rule_id = fi.rule_id
WHERE fi.status = 'open'
GROUP BY r.rule_id
HAVING COUNT(*) > 1
ORDER BY open_violations DESC;

-- Q3  Sub-query : documents scoring below the average of all scanned documents
SELECT document_id, title, compliance_score
FROM documents
WHERE compliance_score < (SELECT AVG(compliance_score) FROM documents WHERE status = 'scanned')
ORDER BY compliance_score;

-- Q4  Correlated sub-query : reviewers who have not uploaded any document
SELECT u.user_id, u.full_name
FROM users u
WHERE u.role = 'reviewer'
  AND NOT EXISTS (SELECT 1 FROM documents d WHERE d.uploaded_by = u.user_id);

-- Q5  Window function : rank documents inside each case by compliance score
SELECT case_id, document_id, title, compliance_score,
       RANK() OVER (PARTITION BY case_id ORDER BY compliance_score DESC NULLS LAST) AS rank_in_case
FROM documents;

-- Q6  View : the reviewer dashboard
SELECT * FROM v_document_overview ORDER BY critical_open DESC, open_issues DESC;

-- Q7  View : per-case roll-up (case list)
SELECT * FROM v_case_summary ORDER BY created_at DESC;

-- Q8  View : which rules are hardest to satisfy
SELECT * FROM v_rule_stats ORDER BY open_violations DESC;

-- Q9  Full-text search (GIN index) with ranking and highlighted snippet
SELECT c.clause_id, d.title,
       ts_rank(c.search_vector, q) AS rank,
       ts_headline('english', c.body, q, 'MaxFragments=1, MaxWords=25, MinWords=10') AS snippet
FROM clauses c
JOIN documents d ON d.document_id = c.document_id,
     websearch_to_tsquery('english', 'terminate notice') AS q
WHERE c.search_vector @@ q
ORDER BY rank DESC
LIMIT 10;

-- Q10 Many-to-many : which reviewers work on which cases
SELECT c.case_number, c.title, STRING_AGG(u.full_name, ', ' ORDER BY u.full_name) AS reviewers
FROM cases c
JOIN case_assignments ca ON ca.case_id = c.case_id
JOIN users u ON u.user_id = ca.user_id
GROUP BY c.case_id;

-- Q11 Audit trail for one entity type, newest first
SELECT a.created_at, COALESCE(u.full_name, 'system') AS actor, a.action, a.entity_type, a.entity_id, a.details
FROM audit_log a
LEFT JOIN users u ON u.user_id = a.user_id
ORDER BY a.created_at DESC
LIMIT 20;

-- Q12 Compliance score computed by the stored function (should equal documents.compliance_score)
SELECT document_id, compliance_score AS stored_score, fn_compute_compliance_score(document_id) AS recomputed_score
FROM documents WHERE status = 'scanned';

-- =====================================================================
--  DML demonstration (INSERT / UPDATE / DELETE) - rolled back at the end
-- =====================================================================
BEGIN;
INSERT INTO clause_rules (rule_code, title, description, severity, present_threshold, standard_threshold)
VALUES ('DEMO_RULE', 'Demo rule', 'Inserted by queries.sql', 'low', 0.5, 0.7);

UPDATE clause_rules SET severity = 'medium', standard_threshold = 0.75 WHERE rule_code = 'DEMO_RULE';

SELECT rule_code, severity, present_threshold, standard_threshold FROM clause_rules WHERE rule_code = 'DEMO_RULE';

DELETE FROM clause_rules WHERE rule_code = 'DEMO_RULE';
ROLLBACK;
