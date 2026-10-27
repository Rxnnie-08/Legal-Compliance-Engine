-- =====================================================================
--  Legal Document Discovery & Compliance Engine  -  PostgreSQL schema
--  Run once on an empty database:  npm run db:init
--  Re-create from scratch:         npm run db:reset
-- =====================================================================
--  Advanced features demonstrated in this file
--    1. Transactions     : used by the application (see src/lib/documents.ts) and
--                          the stored procedures below run inside them
--    2. Triggers         : 8 triggers (integrity, auto-flagging, scoring, audit)
--    3. Stored procedures: sp_record_scan, sp_reevaluate_all (+ functions)
--    4. Views            : v_document_overview, v_case_summary, v_rule_stats
--    5. Indexing         : B-tree, partial, GIN (full-text)
--    6. Full-text search : generated tsvector columns + GIN indexes
--  (7. Vector similarity search lives in Qdrant, see src/lib/qdrant.ts)
-- =====================================================================

-- ---------------------------------------------------------------------
-- Enumerated types (database-level input validation)
-- ---------------------------------------------------------------------
CREATE TYPE user_role      AS ENUM ('admin', 'reviewer', 'client');
CREATE TYPE case_status    AS ENUM ('open', 'under_review', 'closed');
CREATE TYPE severity_level AS ENUM ('low', 'medium', 'high', 'critical');
CREATE TYPE rule_type      AS ENUM ('required', 'restricted');
CREATE TYPE doc_status     AS ENUM ('uploaded', 'scanning', 'scanned', 'failed');
CREATE TYPE issue_kind     AS ENUM ('missing', 'non_standard', 'restricted_present');
CREATE TYPE issue_status   AS ENUM ('open', 'resolved', 'dismissed');

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE users (
    user_id       SERIAL       PRIMARY KEY,
    full_name     VARCHAR(100) NOT NULL CHECK (char_length(btrim(full_name)) >= 2),
    email         VARCHAR(255) NOT NULL CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
    password_hash TEXT         NOT NULL CHECK (char_length(password_hash) >= 20),  -- bcrypt hash, never plain text
    role          user_role    NOT NULL,
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);
-- case-insensitive uniqueness of e-mail addresses
CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email));

-- ---------------------------------------------------------------------
-- cases  (a client matter that contains documents)
-- ---------------------------------------------------------------------
CREATE SEQUENCE case_number_seq START 1;

CREATE TABLE cases (
    case_id     SERIAL       PRIMARY KEY,
    case_number VARCHAR(30)  NOT NULL UNIQUE
                DEFAULT ('CASE-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('case_number_seq')::text, 4, '0')),
    title       VARCHAR(200) NOT NULL CHECK (char_length(btrim(title)) > 0),
    description TEXT,
    client_id   INT          NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    created_by  INT          NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    status      case_status  NOT NULL DEFAULT 'open',
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_cases_client     ON cases (client_id);
CREATE INDEX idx_cases_created_by ON cases (created_by);

-- many-to-many: reviewers <-> cases
CREATE TABLE case_assignments (
    case_id     INT         NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    user_id     INT         NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (case_id, user_id)
);
CREATE INDEX idx_case_assignments_user ON case_assignments (user_id);

-- ---------------------------------------------------------------------
-- clause_rules  +  reference_clauses  (the compliance rule library)
-- ---------------------------------------------------------------------
CREATE TABLE clause_rules (
    rule_id            SERIAL        PRIMARY KEY,
    rule_code          VARCHAR(30)   NOT NULL UNIQUE CHECK (rule_code ~ '^[A-Z0-9_]+$'),
    title              VARCHAR(120)  NOT NULL,
    description        TEXT          NOT NULL,
    rule_type          rule_type     NOT NULL DEFAULT 'required',
    severity           severity_level NOT NULL,
    -- cosine-similarity thresholds (see docs/DOCUMENTATION.md, "retrieval strategy")
    --   required  rule: best < present_threshold  -> clause is MISSING
    --                   best < standard_threshold -> clause present but NON-STANDARD
    --   restricted rule: best >= present_threshold -> risky clause is PRESENT
    present_threshold  NUMERIC(4,3)  NOT NULL CHECK (present_threshold  BETWEEN 0 AND 1),
    standard_threshold NUMERIC(4,3)  NOT NULL CHECK (standard_threshold BETWEEN 0 AND 1),
    is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
    CONSTRAINT chk_threshold_order CHECK (standard_threshold >= present_threshold)
);

CREATE TABLE reference_clauses (
    ref_id      SERIAL       PRIMARY KEY,
    rule_id     INT          NOT NULL REFERENCES clause_rules(rule_id) ON DELETE CASCADE,
    label       VARCHAR(80)  NOT NULL,
    clause_text TEXT         NOT NULL CHECK (char_length(clause_text) >= 30),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_reference_clauses_rule ON reference_clauses (rule_id);

-- ---------------------------------------------------------------------
-- documents  +  clauses
-- ---------------------------------------------------------------------
CREATE TABLE documents (
    document_id       SERIAL       PRIMARY KEY,
    case_id           INT          NOT NULL REFERENCES cases(case_id) ON DELETE CASCADE,
    uploaded_by       INT          NOT NULL REFERENCES users(user_id) ON DELETE RESTRICT,
    title             VARCHAR(200) NOT NULL CHECK (char_length(btrim(title)) > 0),
    original_filename VARCHAR(255) NOT NULL,
    mime_type         VARCHAR(100) NOT NULL,
    file_size_bytes   INT          NOT NULL CHECK (file_size_bytes > 0),
    status            doc_status   NOT NULL DEFAULT 'uploaded',
    compliance_score  NUMERIC(5,2) CHECK (compliance_score BETWEEN 0 AND 100),
    uploaded_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    scanned_at        TIMESTAMPTZ,
    search_vector     TSVECTOR GENERATED ALWAYS AS
                      (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(original_filename, ''))) STORED
);
CREATE INDEX idx_documents_case   ON documents (case_id);
CREATE INDEX idx_documents_search ON documents USING GIN (search_vector);

CREATE TABLE clauses (
    clause_id     SERIAL  PRIMARY KEY,
    document_id   INT     NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    position      INT     NOT NULL CHECK (position >= 1),
    heading       VARCHAR(200),
    body          TEXT    NOT NULL CHECK (char_length(btrim(body)) > 0),
    search_vector TSVECTOR GENERATED ALWAYS AS (to_tsvector('english', body)) STORED,
    CONSTRAINT uq_clause_position UNIQUE (document_id, position)
);
CREATE INDEX idx_clauses_search ON clauses USING GIN (search_vector);

-- ---------------------------------------------------------------------
-- scan_results : best vector match per (document, rule), written by sp_record_scan
-- flagged_issues: compliance problems, created automatically by a trigger
-- ---------------------------------------------------------------------
CREATE TABLE scan_results (
    scan_id         SERIAL       PRIMARY KEY,
    document_id     INT          NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    rule_id         INT          NOT NULL REFERENCES clause_rules(rule_id) ON DELETE RESTRICT,
    best_clause_id  INT          REFERENCES clauses(clause_id) ON DELETE SET NULL,
    best_ref_id     INT          REFERENCES reference_clauses(ref_id) ON DELETE SET NULL,
    best_similarity NUMERIC(5,4) NOT NULL CHECK (best_similarity BETWEEN -1 AND 1),
    scanned_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_scan_doc_rule UNIQUE (document_id, rule_id)
);

CREATE TABLE flagged_issues (
    issue_id     SERIAL         PRIMARY KEY,
    document_id  INT            NOT NULL REFERENCES documents(document_id) ON DELETE CASCADE,
    rule_id      INT            NOT NULL REFERENCES clause_rules(rule_id) ON DELETE RESTRICT,
    clause_id    INT            REFERENCES clauses(clause_id) ON DELETE SET NULL,  -- closest clause found
    kind         issue_kind     NOT NULL,
    severity     severity_level NOT NULL,
    similarity   NUMERIC(5,4)   NOT NULL CHECK (similarity BETWEEN -1 AND 1),
    explanation  TEXT,                       -- RAG: LLM-written plain-English explanation
    explained_at TIMESTAMPTZ,
    status       issue_status   NOT NULL DEFAULT 'open',
    resolved_by  INT            REFERENCES users(user_id) ON DELETE SET NULL,
    resolved_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT uq_issue_doc_rule UNIQUE (document_id, rule_id),
    CONSTRAINT chk_resolved_consistency CHECK ((status = 'open') = (resolved_at IS NULL))
);
CREATE INDEX idx_issues_document ON flagged_issues (document_id);
CREATE INDEX idx_issues_open     ON flagged_issues (severity, document_id) WHERE status = 'open';   -- partial index

-- ---------------------------------------------------------------------
-- audit_log : append-only trail (immutability enforced by trigger below)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
    log_id      BIGSERIAL   PRIMARY KEY,
    user_id     INT         REFERENCES users(user_id) ON DELETE RESTRICT,
    action      VARCHAR(50) NOT NULL,
    entity_type VARCHAR(30) NOT NULL,
    entity_id   INT,
    details     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity  ON audit_log (entity_type, entity_id);
CREATE INDEX idx_audit_created ON audit_log (created_at DESC);

-- =====================================================================
--  FUNCTIONS
-- =====================================================================

-- The application sets `app.current_user_id` at the start of every transaction
-- (SELECT set_config('app.current_user_id', '<id>', true)), so that triggers can
-- record WHO caused a change.
CREATE FUNCTION fn_current_app_user() RETURNS INT
LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.current_user_id', true), '')::int
$$;

-- Compliance score = 100 minus a penalty per OPEN issue, weighted by severity.
CREATE FUNCTION fn_compute_compliance_score(p_document_id INT) RETURNS NUMERIC
LANGUAGE sql STABLE AS $$
    SELECT GREATEST(0, 100 - COALESCE(SUM(
        CASE severity
            WHEN 'critical' THEN 35
            WHEN 'high'     THEN 20
            WHEN 'medium'   THEN 10
            ELSE 5
        END), 0))::numeric(5,2)
    FROM flagged_issues
    WHERE document_id = p_document_id AND status = 'open'
$$;

-- Business rule engine: turns one scan_results row into (or removes) a flagged issue.
CREATE FUNCTION fn_evaluate_scan_result(p_scan_id INT) RETURNS VOID
LANGUAGE plpgsql AS $$
DECLARE
    s      scan_results%ROWTYPE;
    r      clause_rules%ROWTYPE;
    v_kind issue_kind := NULL;
BEGIN
    SELECT * INTO s FROM scan_results WHERE scan_id = p_scan_id;
    IF NOT FOUND THEN RETURN; END IF;
    SELECT * INTO r FROM clause_rules WHERE rule_id = s.rule_id;

    IF r.is_active THEN
        IF r.rule_type = 'required' THEN
            IF    s.best_similarity < r.present_threshold  THEN v_kind := 'missing';
            ELSIF s.best_similarity < r.standard_threshold THEN v_kind := 'non_standard';
            END IF;
        ELSE  -- restricted: a risky clause must NOT be present
            IF s.best_similarity >= r.present_threshold THEN v_kind := 'restricted_present'; END IF;
        END IF;
    END IF;

    IF v_kind IS NULL THEN
        -- compliant (or rule disabled): remove any still-open flag
        DELETE FROM flagged_issues
         WHERE document_id = s.document_id AND rule_id = s.rule_id AND status = 'open';
    ELSE
        INSERT INTO flagged_issues (document_id, rule_id, clause_id, kind, severity, similarity)
        VALUES (s.document_id, s.rule_id, s.best_clause_id, v_kind, r.severity, s.best_similarity)
        ON CONFLICT (document_id, rule_id) DO UPDATE
           SET clause_id   = EXCLUDED.clause_id,
               explanation = CASE WHEN flagged_issues.kind IS DISTINCT FROM EXCLUDED.kind
                                  THEN NULL ELSE flagged_issues.explanation END,
               kind        = EXCLUDED.kind,
               severity    = EXCLUDED.severity,
               similarity  = EXCLUDED.similarity
         WHERE flagged_issues.status = 'open';   -- never overwrite a reviewer's decision
    END IF;
END $$;

-- =====================================================================
--  STORED PROCEDURES
-- =====================================================================

-- Called by the application, inside the upload transaction, with the best vector
-- match per rule:  [{"rule_id":1,"clause_id":10,"ref_id":3,"similarity":0.81}, ...]
CREATE PROCEDURE sp_record_scan(p_document_id INT, p_results JSONB)
LANGUAGE plpgsql AS $$
DECLARE
    item JSONB;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM documents WHERE document_id = p_document_id) THEN
        RAISE EXCEPTION 'Document % does not exist', p_document_id USING ERRCODE = 'no_data_found';
    END IF;
    IF jsonb_typeof(p_results) <> 'array' THEN
        RAISE EXCEPTION 'p_results must be a JSON array' USING ERRCODE = 'invalid_parameter_value';
    END IF;

    FOR item IN SELECT * FROM jsonb_array_elements(p_results) LOOP
        INSERT INTO scan_results (document_id, rule_id, best_clause_id, best_ref_id, best_similarity)
        VALUES (p_document_id,
                (item->>'rule_id')::int,
                NULLIF(item->>'clause_id', '')::int,
                NULLIF(item->>'ref_id', '')::int,
                (item->>'similarity')::numeric)
        ON CONFLICT (document_id, rule_id) DO UPDATE
           SET best_clause_id  = EXCLUDED.best_clause_id,
               best_ref_id     = EXCLUDED.best_ref_id,
               best_similarity = EXCLUDED.best_similarity,
               scanned_at      = now();
        -- trg_scan_result_evaluate fires here and creates / updates flagged_issues
    END LOOP;

    UPDATE documents
       SET status = 'scanned',
           scanned_at = now(),
           compliance_score = fn_compute_compliance_score(p_document_id)
     WHERE document_id = p_document_id;
END $$;

-- Re-apply the CURRENT rule thresholds to every stored scan (no re-embedding needed).
CREATE PROCEDURE sp_reevaluate_all()
LANGUAGE plpgsql AS $$
DECLARE
    s RECORD;
BEGIN
    FOR s IN SELECT scan_id FROM scan_results LOOP
        PERFORM fn_evaluate_scan_result(s.scan_id);
    END LOOP;
    UPDATE documents d
       SET compliance_score = fn_compute_compliance_score(d.document_id)
     WHERE d.status = 'scanned';
END $$;

-- =====================================================================
--  TRIGGERS
-- =====================================================================

-- 1) integrity: a case's client must have the 'client' role
CREATE FUNCTION trg_fn_case_client_role() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.client_id AND role = 'client') THEN
        RAISE EXCEPTION 'cases.client_id % must reference a user with role client', NEW.client_id
              USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_case_client_role
    BEFORE INSERT OR UPDATE OF client_id ON cases
    FOR EACH ROW EXECUTE FUNCTION trg_fn_case_client_role();

-- 2) integrity: only reviewers can be assigned to a case
CREATE FUNCTION trg_fn_assignment_role() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.user_id AND role = 'reviewer' AND is_active) THEN
        RAISE EXCEPTION 'Only active users with role reviewer can be assigned to a case (user %)', NEW.user_id
              USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_assignment_role
    BEFORE INSERT OR UPDATE ON case_assignments
    FOR EACH ROW EXECUTE FUNCTION trg_fn_assignment_role();

-- 3) auto-flagging: every scan result is evaluated against its rule
CREATE FUNCTION trg_fn_scan_result_evaluate() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    PERFORM fn_evaluate_scan_result(NEW.scan_id);
    RETURN NULL;
END $$;
CREATE TRIGGER trg_scan_result_evaluate
    AFTER INSERT OR UPDATE ON scan_results
    FOR EACH ROW EXECUTE FUNCTION trg_fn_scan_result_evaluate();

-- 4) workflow: stamp who resolved an issue and when (keeps chk_resolved_consistency true)
CREATE FUNCTION trg_fn_issue_resolution() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NEW.status = 'open' THEN
            NEW.resolved_at := NULL;
            NEW.resolved_by := NULL;
        ELSE
            NEW.resolved_at := now();
            NEW.resolved_by := fn_current_app_user();
        END IF;
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER trg_issue_resolution
    BEFORE UPDATE ON flagged_issues
    FOR EACH ROW EXECUTE FUNCTION trg_fn_issue_resolution();

-- 5) derived data: keep documents.compliance_score in sync with the open issues
CREATE FUNCTION trg_fn_issue_score() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
    v_doc INT := COALESCE(NEW.document_id, OLD.document_id);
BEGIN
    UPDATE documents
       SET compliance_score = fn_compute_compliance_score(v_doc)
     WHERE document_id = v_doc AND status = 'scanned';
    RETURN NULL;
END $$;
CREATE TRIGGER trg_issue_score
    AFTER INSERT OR UPDATE OF status, severity OR DELETE ON flagged_issues
    FOR EACH ROW EXECUTE FUNCTION trg_fn_issue_score();

-- 6) audit: document lifecycle
CREATE FUNCTION trg_fn_document_audit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
        VALUES (COALESCE(fn_current_app_user(), NEW.uploaded_by), 'document.upload', 'document', NEW.document_id,
                jsonb_build_object('title', NEW.title, 'case_id', NEW.case_id, 'file', NEW.original_filename));
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
        VALUES (fn_current_app_user(), 'document.' || NEW.status::text, 'document', NEW.document_id,
                jsonb_build_object('from', OLD.status, 'to', NEW.status, 'score', NEW.compliance_score));
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER trg_document_audit
    AFTER INSERT OR UPDATE OF status ON documents
    FOR EACH ROW EXECUTE FUNCTION trg_fn_document_audit();

-- 7) audit: issue lifecycle
CREATE FUNCTION trg_fn_issue_audit() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
        VALUES (fn_current_app_user(), 'issue.flagged', 'issue', NEW.issue_id,
                jsonb_build_object('document_id', NEW.document_id, 'rule_id', NEW.rule_id,
                                   'kind', NEW.kind, 'severity', NEW.severity, 'similarity', NEW.similarity));
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO audit_log (user_id, action, entity_type, entity_id, details)
        VALUES (fn_current_app_user(), 'issue.' || NEW.status::text, 'issue', NEW.issue_id,
                jsonb_build_object('document_id', NEW.document_id, 'from', OLD.status, 'to', NEW.status));
    END IF;
    RETURN NULL;
END $$;
CREATE TRIGGER trg_issue_audit
    AFTER INSERT OR UPDATE OF status ON flagged_issues
    FOR EACH ROW EXECUTE FUNCTION trg_fn_issue_audit();

-- 8) the audit trail is append-only
CREATE FUNCTION trg_fn_audit_immutable() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only (% blocked)', TG_OP USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER trg_audit_immutable
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION trg_fn_audit_immutable();

-- =====================================================================
--  VIEWS
-- =====================================================================

-- Reviewer dashboard: one row per document with issue counts by severity
CREATE VIEW v_document_overview AS
SELECT d.document_id,
       d.title,
       d.status,
       d.compliance_score,
       d.uploaded_at,
       c.case_id,
       c.case_number,
       c.title      AS case_title,
       c.client_id,
       u.full_name  AS uploaded_by_name,
       COUNT(fi.issue_id) FILTER (WHERE fi.status = 'open')                              AS open_issues,
       COUNT(fi.issue_id) FILTER (WHERE fi.status = 'open' AND fi.severity = 'critical') AS critical_open,
       COUNT(fi.issue_id) FILTER (WHERE fi.status = 'open' AND fi.severity = 'high')     AS high_open,
       COUNT(fi.issue_id) FILTER (WHERE fi.status = 'open' AND fi.severity = 'medium')   AS medium_open,
       COUNT(fi.issue_id) FILTER (WHERE fi.status = 'open' AND fi.severity = 'low')      AS low_open
FROM documents d
JOIN cases c  ON c.case_id  = d.case_id
JOIN users u  ON u.user_id  = d.uploaded_by
LEFT JOIN flagged_issues fi ON fi.document_id = d.document_id
GROUP BY d.document_id, c.case_id, u.user_id;

-- Case list: roll-up per case
CREATE VIEW v_case_summary AS
SELECT c.case_id,
       c.case_number,
       c.title,
       c.status,
       c.created_at,
       c.client_id,
       c.created_by,
       cl.full_name                                    AS client_name,
       COUNT(DISTINCT d.document_id)                   AS document_count,
       ROUND(AVG(d.compliance_score), 1)               AS avg_score,
       COUNT(fi.issue_id) FILTER (WHERE fi.status = 'open') AS open_issues
FROM cases c
JOIN users cl ON cl.user_id = c.client_id
LEFT JOIN documents d       ON d.case_id = c.case_id
LEFT JOIN flagged_issues fi ON fi.document_id = d.document_id
GROUP BY c.case_id, cl.user_id;

-- Per-rule statistics for the dashboard
CREATE VIEW v_rule_stats AS
SELECT r.rule_id,
       r.rule_code,
       r.title,
       r.severity,
       COUNT(sr.scan_id)                                       AS documents_scanned,
       COUNT(fi.issue_id) FILTER (WHERE fi.status = 'open')    AS open_violations,
       ROUND(AVG(sr.best_similarity), 3)                       AS avg_best_similarity
FROM clause_rules r
LEFT JOIN scan_results   sr ON sr.rule_id = r.rule_id
LEFT JOIN flagged_issues fi ON fi.rule_id = r.rule_id AND fi.document_id = sr.document_id
GROUP BY r.rule_id;
