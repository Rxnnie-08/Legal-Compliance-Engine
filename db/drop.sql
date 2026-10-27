-- DROP everything created by schema.sql (used by `npm run db:reset`).  DESTROYS ALL DATA.
DROP VIEW      IF EXISTS v_rule_stats, v_case_summary, v_document_overview CASCADE;
DROP TABLE     IF EXISTS audit_log, flagged_issues, scan_results, clauses, documents,
                         reference_clauses, clause_rules, case_assignments, cases, users CASCADE;
DROP SEQUENCE  IF EXISTS case_number_seq;
DROP PROCEDURE IF EXISTS sp_record_scan(INT, JSONB);
DROP PROCEDURE IF EXISTS sp_reevaluate_all();
DROP FUNCTION  IF EXISTS fn_evaluate_scan_result(INT), fn_compute_compliance_score(INT), fn_current_app_user(),
                         trg_fn_case_client_role(), trg_fn_assignment_role(), trg_fn_scan_result_evaluate(),
                         trg_fn_issue_resolution(), trg_fn_issue_score(), trg_fn_document_audit(),
                         trg_fn_issue_audit(), trg_fn_audit_immutable() CASCADE;
DROP TYPE      IF EXISTS issue_status, issue_kind, doc_status, rule_type, severity_level, case_status, user_role CASCADE;
