-- Materialize the existing assistant-shared visibility-double branch.
-- Authorship stays in created_by_user_id; the visibility check still rejects
-- rows with both user_id and assistant_id absent.
BEGIN;
ALTER TABLE memories ALTER COLUMN user_id DROP NOT NULL;
COMMIT;
