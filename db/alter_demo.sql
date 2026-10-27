-- =====================================================================
--  ALTER / DROP demonstration (rubric: "CREATE, ALTER, DROP").
--  Everything runs in one transaction and is rolled back, so the real
--  schema is left untouched.   Run: npm run db:alter
-- =====================================================================
BEGIN;

-- ALTER TABLE : add a column with a constraint, backfill it, tighten it
ALTER TABLE cases ADD COLUMN priority SMALLINT;
UPDATE cases SET priority = 3 WHERE priority IS NULL;
ALTER TABLE cases
    ALTER COLUMN priority SET DEFAULT 3,
    ALTER COLUMN priority SET NOT NULL,
    ADD CONSTRAINT chk_cases_priority CHECK (priority BETWEEN 1 AND 5);

-- ALTER TABLE : add / drop an index-backed unique constraint
CREATE INDEX idx_cases_priority ON cases (priority);
DROP INDEX idx_cases_priority;

-- ALTER TYPE : extend an enum
ALTER TYPE case_status ADD VALUE IF NOT EXISTS 'archived';

-- ALTER TABLE ... RENAME
ALTER TABLE cases RENAME COLUMN priority TO urgency;
ALTER TABLE cases RENAME COLUMN urgency TO priority;

-- DROP : remove a constraint, a column, a view, a trigger
ALTER TABLE cases DROP CONSTRAINT chk_cases_priority;
ALTER TABLE cases DROP COLUMN priority;

CREATE VIEW v_tmp_open_cases AS SELECT case_id, title FROM cases WHERE status = 'open';
DROP VIEW v_tmp_open_cases;

DROP TRIGGER trg_assignment_role ON case_assignments;
-- (re-create it so that the rollback-free session would stay consistent)
CREATE TRIGGER trg_assignment_role
    BEFORE INSERT OR UPDATE ON case_assignments
    FOR EACH ROW EXECUTE FUNCTION trg_fn_assignment_role();

SELECT 'ALTER / DROP demo finished (rolled back)' AS result;
ROLLBACK;
