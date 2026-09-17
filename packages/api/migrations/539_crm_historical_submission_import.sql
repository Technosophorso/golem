-- Replay-safe source identity for silent historical form imports.
-- [COMP:crm/production-import]
BEGIN;

ALTER TABLE association_enquiries
  ADD COLUMN source_site TEXT,
  ADD COLUMN source_form TEXT,
  ADD COLUMN historical_import BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT association_enquiries_historical_source_check CHECK (
    (historical_import AND source_site IS NOT NULL AND source_form IS NOT NULL
      AND length(btrim(source_site)) BETWEEN 1 AND 500
      AND length(btrim(source_form)) BETWEEN 1 AND 500)
    OR (NOT historical_import AND source_site IS NULL AND source_form IS NULL)
  );

DO $$
DECLARE source_identity_constraint name;
BEGIN
  SELECT conname INTO source_identity_constraint
    FROM pg_constraint
    WHERE conrelid = 'public.association_enquiries'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (workspace_id, source, source_submission_id)';
  IF source_identity_constraint IS NULL THEN
    RAISE EXCEPTION 'association enquiry source identity constraint is unavailable';
  END IF;
  EXECUTE format('ALTER TABLE association_enquiries DROP CONSTRAINT %I', source_identity_constraint);
END;
$$;

CREATE UNIQUE INDEX association_enquiries_source_identity
  ON association_enquiries (
    workspace_id,
    source,
    COALESCE(source_site, ''),
    COALESCE(source_form, ''),
    source_submission_id
  );

COMMIT;
