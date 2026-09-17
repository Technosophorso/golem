-- Submission-owned, non-ingested image attachments for bounded public intake.
-- [COMP:crm/submission-attachments]
BEGIN;

CREATE TABLE association_submission_attachments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  submission_id  UUID NOT NULL,
  attachment_key TEXT NOT NULL CHECK(attachment_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  original_name  TEXT NOT NULL CHECK(length(btrim(original_name)) BETWEEN 1 AND 200),
  mime_type      TEXT NOT NULL CHECK(mime_type IN('image/jpeg','image/png','image/webp')),
  content_bytes  BYTEA NOT NULL CHECK(octet_length(content_bytes) BETWEEN 1 AND 1048576),
  size_bytes     INTEGER NOT NULL CHECK(size_bytes=octet_length(content_bytes)),
  sha256         TEXT NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,submission_id,attachment_key),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,submission_id)
    REFERENCES association_enquiries(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX association_submission_attachments_submission
  ON association_submission_attachments(workspace_id,submission_id,created_at,id);

CREATE FUNCTION public.association_submission_attachment_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'Submission attachments are immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER association_submission_attachment_immutable
  BEFORE UPDATE ON association_submission_attachments
  FOR EACH ROW EXECUTE FUNCTION public.association_submission_attachment_immutable();

ALTER TABLE association_submission_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY association_submission_attachments_member
  ON association_submission_attachments
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members
    WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members
    WHERE user_id=current_setting('app.current_user_id',true)::uuid));

CREATE TRIGGER crm_privacy_write_admission
  BEFORE INSERT OR UPDATE OR DELETE ON association_submission_attachments
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();

-- Recovery capture is schema-driven; register the table in this release.
SELECT public.crm_install_erasure_capture();

COMMIT;
