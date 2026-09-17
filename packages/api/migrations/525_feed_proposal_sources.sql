BEGIN;
-- The existing immutable-source trigger covers newly added source columns.
ALTER TABLE feed_draft_suggestions ADD COLUMN source_proposal jsonb;
ALTER TABLE feed_draft_suggestions ADD CONSTRAINT feed_proposal_object
  CHECK (source_proposal IS NULL OR jsonb_typeof(source_proposal)='object');
COMMIT;
