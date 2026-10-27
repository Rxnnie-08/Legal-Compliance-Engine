-- =====================================================================
--  Database test-suite.  Run with:  npm run db:test
--  Everything happens inside one transaction that is ROLLED BACK at the end,
--  so no data is left behind.  Any failed ASSERT aborts the run with a message.
-- =====================================================================
BEGIN;

-- ---------- fixtures ----------
INSERT INTO users (full_name, email, password_hash, role) VALUES
  ('Test Admin',    'ta@test.dev', repeat('x', 60), 'admin'),
  ('Test Reviewer', 'tr@test.dev', repeat('x', 60), 'reviewer'),
  ('Test Client',   'tc@test.dev', repeat('x', 60), 'client');

INSERT INTO clause_rules (rule_code, title, description, rule_type, severity, present_threshold, standard_threshold) VALUES
  ('T_MISSING',  'required rule (will be missing)',      'd', 'required',   'high',     0.600, 0.800),
  ('T_NONSTD',   'required rule (non standard)',         'd', 'required',   'medium',   0.600, 0.800),
  ('T_OK',       'required rule (compliant)',            'd', 'required',   'critical', 0.600, 0.800),
  ('T_RESTRICT', 'restricted rule (risky clause found)', 'd', 'restricted', 'critical', 0.600, 0.600);

SELECT set_config('app.current_user_id', (SELECT user_id::text FROM users WHERE email = 'tr@test.dev'), true);

INSERT INTO cases (title, client_id, created_by)
VALUES ('Test case', (SELECT user_id FROM users WHERE email='tc@test.dev'), (SELECT user_id FROM users WHERE email='tr@test.dev'));

-- ---------- 1. role-integrity triggers ----------
DO $$
DECLARE ok BOOLEAN := FALSE;
BEGIN
    BEGIN
        INSERT INTO cases (title, client_id, created_by)
        VALUES ('bad', (SELECT user_id FROM users WHERE email='tr@test.dev'), (SELECT user_id FROM users WHERE email='ta@test.dev'));
    EXCEPTION WHEN check_violation THEN ok := TRUE; END;
    ASSERT ok, 'a case must not accept a non-client as its client';

    ok := FALSE;
    BEGIN
        INSERT INTO case_assignments (case_id, user_id)
        SELECT c.case_id, u.user_id FROM cases c, users u WHERE u.email = 'tc@test.dev';
    EXCEPTION WHEN check_violation THEN ok := TRUE; END;
    ASSERT ok, 'a client must not be assignable as reviewer';

    INSERT INTO case_assignments (case_id, user_id)
    SELECT c.case_id, u.user_id FROM cases c, users u WHERE u.email = 'tr@test.dev';
    RAISE NOTICE 'PASS 1  role-integrity triggers';
END $$;

-- ---------- fixtures: document + clauses ----------
INSERT INTO documents (case_id, uploaded_by, title, original_filename, mime_type, file_size_bytes, status)
SELECT c.case_id, u.user_id, 'Master Services Agreement', 'msa.pdf', 'application/pdf', 1234, 'scanning'
FROM cases c, users u WHERE u.email = 'tr@test.dev';

INSERT INTO clauses (document_id, position, heading, body)
SELECT d.document_id, g, 'Clause ' || g, 'The supplier shall indemnify the customer against third party claims, clause ' || g
FROM documents d, generate_series(1, 3) g;

-- ---------- 2. stored procedure + auto-flagging trigger + score ----------
DO $$
DECLARE
    v_doc INT; v_clause INT; n INT; v_score NUMERIC; v_payload JSONB;
BEGIN
    SELECT document_id INTO v_doc FROM documents;
    SELECT clause_id  INTO v_clause FROM clauses WHERE document_id = v_doc AND position = 1;

    -- (CALL arguments cannot contain sub-queries, so build the payload first)
    v_payload := jsonb_build_array(
        jsonb_build_object('rule_id', (SELECT rule_id FROM clause_rules WHERE rule_code='T_MISSING'),  'clause_id', v_clause, 'similarity', 0.40),
        jsonb_build_object('rule_id', (SELECT rule_id FROM clause_rules WHERE rule_code='T_NONSTD'),   'clause_id', v_clause, 'similarity', 0.70),
        jsonb_build_object('rule_id', (SELECT rule_id FROM clause_rules WHERE rule_code='T_OK'),       'clause_id', v_clause, 'similarity', 0.90),
        jsonb_build_object('rule_id', (SELECT rule_id FROM clause_rules WHERE rule_code='T_RESTRICT'), 'clause_id', v_clause, 'similarity', 0.75)
    );
    CALL sp_record_scan(v_doc, v_payload);

    SELECT count(*) INTO n FROM flagged_issues WHERE document_id = v_doc;
    ASSERT n = 3, format('expected 3 auto-created issues, got %s', n);

    ASSERT (SELECT kind FROM flagged_issues fi JOIN clause_rules r USING (rule_id) WHERE r.rule_code='T_MISSING'  ) = 'missing',            'T_MISSING must be flagged missing';
    ASSERT (SELECT kind FROM flagged_issues fi JOIN clause_rules r USING (rule_id) WHERE r.rule_code='T_NONSTD'   ) = 'non_standard',       'T_NONSTD must be non_standard';
    ASSERT (SELECT kind FROM flagged_issues fi JOIN clause_rules r USING (rule_id) WHERE r.rule_code='T_RESTRICT' ) = 'restricted_present', 'T_RESTRICT must be restricted_present';
    ASSERT NOT EXISTS (SELECT 1 FROM flagged_issues fi JOIN clause_rules r USING (rule_id) WHERE r.rule_code='T_OK'), 'T_OK must not be flagged';

    -- penalties: high 20 + medium 10 + critical 35 = 65  ->  score 35
    SELECT compliance_score INTO v_score FROM documents WHERE document_id = v_doc;
    ASSERT v_score = 35, format('expected score 35, got %s', v_score);
    ASSERT (SELECT status FROM documents WHERE document_id = v_doc) = 'scanned', 'document must be marked scanned';
    RAISE NOTICE 'PASS 2  sp_record_scan, auto-flag trigger, score = %', v_score;
END $$;

-- ---------- 3. audit trigger ----------
DO $$
BEGIN
    ASSERT (SELECT count(*) FROM audit_log WHERE action = 'document.upload')  = 1, 'upload must be audited';
    ASSERT (SELECT count(*) FROM audit_log WHERE action = 'document.scanned') = 1, 'scan completion must be audited';
    ASSERT (SELECT count(*) FROM audit_log WHERE action = 'issue.flagged')    = 3, 'each flag must be audited';
    ASSERT (SELECT count(*) FROM audit_log WHERE action = 'issue.flagged' AND user_id IS NOT NULL) = 3, 'audit rows must carry app.current_user_id';
    RAISE NOTICE 'PASS 3  audit triggers';
END $$;

-- ---------- 4. resolving an issue: resolution trigger + score trigger ----------
DO $$
DECLARE v_doc INT; v_issue INT; v_score NUMERIC;
BEGIN
    SELECT document_id INTO v_doc FROM documents;
    SELECT fi.issue_id INTO v_issue FROM flagged_issues fi JOIN clause_rules r USING (rule_id) WHERE r.rule_code = 'T_RESTRICT';

    UPDATE flagged_issues SET status = 'resolved' WHERE issue_id = v_issue;

    ASSERT (SELECT resolved_at IS NOT NULL AND resolved_by IS NOT NULL FROM flagged_issues WHERE issue_id = v_issue),
           'resolved_at / resolved_by must be stamped automatically';
    SELECT compliance_score INTO v_score FROM documents WHERE document_id = v_doc;
    ASSERT v_score = 70, format('score must rise to 70 after resolving the critical issue, got %s', v_score);
    ASSERT (SELECT count(*) FROM audit_log WHERE action = 'issue.resolved') = 1, 'resolution must be audited';

    UPDATE flagged_issues SET status = 'open' WHERE issue_id = v_issue;   -- re-open
    ASSERT (SELECT resolved_at IS NULL FROM flagged_issues WHERE issue_id = v_issue), 're-opening clears resolved_at';
    ASSERT (SELECT compliance_score FROM documents WHERE document_id = v_doc) = 35, 'score returns to 35 when re-opened';
    RAISE NOTICE 'PASS 4  resolution + score triggers';
END $$;

-- ---------- 5. re-evaluation procedure respects reviewer decisions ----------
DO $$
DECLARE v_doc INT;
BEGIN
    SELECT document_id INTO v_doc FROM documents;

    -- reviewer dismisses the non-standard flag
    UPDATE flagged_issues SET status = 'dismissed'
     WHERE rule_id = (SELECT rule_id FROM clause_rules WHERE rule_code = 'T_NONSTD');

    -- admin relaxes two rules so that both scans become compliant
    UPDATE clause_rules SET present_threshold = 0.30, standard_threshold = 0.35 WHERE rule_code = 'T_MISSING';
    UPDATE clause_rules SET present_threshold = 0.50, standard_threshold = 0.60 WHERE rule_code = 'T_NONSTD';
    CALL sp_reevaluate_all();

    ASSERT NOT EXISTS (SELECT 1 FROM flagged_issues fi JOIN clause_rules r USING (rule_id) WHERE r.rule_code = 'T_MISSING'),
           'open flag must disappear when the scan becomes compliant';
    ASSERT (SELECT status FROM flagged_issues fi JOIN clause_rules r USING (rule_id) WHERE r.rule_code = 'T_NONSTD') = 'dismissed',
           'a dismissed flag must survive re-evaluation';
    RAISE NOTICE 'PASS 5  sp_reevaluate_all';
END $$;

-- ---------- 6. append-only audit log ----------
DO $$
DECLARE ok BOOLEAN := FALSE;
BEGIN
    BEGIN UPDATE audit_log SET action = 'tampered'; EXCEPTION WHEN restrict_violation THEN ok := TRUE; END;
    ASSERT ok, 'audit_log UPDATE must be blocked';
    ok := FALSE;
    BEGIN DELETE FROM audit_log; EXCEPTION WHEN restrict_violation THEN ok := TRUE; END;
    ASSERT ok, 'audit_log DELETE must be blocked';
    RAISE NOTICE 'PASS 6  audit_log is append-only';
END $$;

-- ---------- 7. declarative constraints ----------
DO $$
DECLARE ok BOOLEAN;
BEGIN
    ok := FALSE; BEGIN INSERT INTO users (full_name, email, password_hash, role) VALUES ('Bad Mail', 'not-an-email', repeat('x', 60), 'client');
                 EXCEPTION WHEN check_violation THEN ok := TRUE; END;
    ASSERT ok, 'invalid e-mail must be rejected';

    ok := FALSE; BEGIN INSERT INTO users (full_name, email, password_hash, role) VALUES ('Dup Mail', 'TA@test.dev', repeat('x', 60), 'client');
                 EXCEPTION WHEN unique_violation THEN ok := TRUE; END;
    ASSERT ok, 'e-mail uniqueness must be case-insensitive';

    ok := FALSE; BEGIN INSERT INTO users (full_name, email, password_hash, role) VALUES ('Plain Pw', 'pw@test.dev', 'short', 'client');
                 EXCEPTION WHEN check_violation THEN ok := TRUE; END;
    ASSERT ok, 'a short (non-hash) password value must be rejected';

    ok := FALSE; BEGIN UPDATE documents SET compliance_score = 150;
                 EXCEPTION WHEN check_violation THEN ok := TRUE; END;
    ASSERT ok, 'compliance_score > 100 must be rejected';

    ok := FALSE; BEGIN INSERT INTO clause_rules (rule_code, title, description, severity, present_threshold, standard_threshold)
                       VALUES ('T_BAD', 't', 'd', 'low', 0.9, 0.5);
                 EXCEPTION WHEN check_violation THEN ok := TRUE; END;
    ASSERT ok, 'standard_threshold < present_threshold must be rejected';

    ok := FALSE; BEGIN INSERT INTO clause_rules (rule_code, title, description, severity, present_threshold, standard_threshold)
                       VALUES ('lower_case', 't', 'd', 'low', 0.5, 0.6);
                 EXCEPTION WHEN check_violation THEN ok := TRUE; END;
    ASSERT ok, 'rule_code format must be enforced';

    ok := FALSE; BEGIN INSERT INTO documents (case_id, uploaded_by, title, original_filename, mime_type, file_size_bytes)
                       SELECT case_id, created_by, 'x', 'x.pdf', 'application/pdf', 0 FROM cases;
                 EXCEPTION WHEN check_violation THEN ok := TRUE; END;
    ASSERT ok, 'a zero-byte document must be rejected';
    RAISE NOTICE 'PASS 7  declarative constraints';
END $$;

-- ---------- 8. full-text search, views, case number ----------
DO $$
DECLARE n INT; r RECORD;
BEGIN
    SELECT count(*) INTO n FROM clauses WHERE search_vector @@ websearch_to_tsquery('english', 'indemnify claims');
    ASSERT n = 3, format('full-text search should match 3 clauses, got %s', n);

    SELECT count(*) INTO n FROM documents WHERE search_vector @@ websearch_to_tsquery('english', 'services agreement');
    ASSERT n = 1, 'document title search should match';

    SELECT * INTO r FROM v_document_overview LIMIT 1;
    ASSERT r.open_issues = 1 AND r.critical_open = 1, format('view open_issues expected 1 (critical), got %s / %s', r.open_issues, r.critical_open);

    SELECT * INTO r FROM v_case_summary LIMIT 1;
    ASSERT r.document_count = 1 AND r.open_issues = 1, 'v_case_summary roll-up wrong';

    ASSERT (SELECT case_number FROM cases LIMIT 1) ~ '^CASE-\d{4}-\d{4}$', 'case_number default format';
    RAISE NOTICE 'PASS 8  full-text search, views, case-number default';
END $$;

-- ---------- 9. cascades ----------
DO $$
BEGIN
    DELETE FROM documents;
    ASSERT (SELECT count(*) FROM clauses)        = 0, 'clauses must cascade-delete';
    ASSERT (SELECT count(*) FROM scan_results)   = 0, 'scan_results must cascade-delete';
    ASSERT (SELECT count(*) FROM flagged_issues) = 0, 'flagged_issues must cascade-delete';
    RAISE NOTICE 'PASS 9  cascading deletes';
END $$;

ROLLBACK;
