-- Exact client confirmation keys close the lost-response import job window.
-- [COMP:crm/production-import]
BEGIN;

ALTER TABLE crm_import_jobs ADD COLUMN confirmation_key UUID;
CREATE UNIQUE INDEX crm_import_jobs_confirmation_key
  ON crm_import_jobs(workspace_id,confirmation_key)
  WHERE confirmation_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.crm_import_job_input_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.privacy_erased THEN RAISE EXCEPTION 'import_job_retired' USING ERRCODE='55000'; END IF;
  IF NEW.privacy_erased AND OLD.status='completed'
    AND to_jsonb(OLD)-ARRAY['mapping','mapping_hash','source_hash','trusted_identity','integration_grants','created_by_user_id','confirmed_by_user_id','updated_at','privacy_erased','privacy_erased_at']
      =to_jsonb(NEW)-ARRAY['mapping','mapping_hash','source_hash','trusted_identity','integration_grants','created_by_user_id','confirmed_by_user_id','updated_at','privacy_erased','privacy_erased_at']
    THEN RETURN NEW; END IF;
  IF NEW.privacy_erased OR ROW(OLD.workspace_id,OLD.staged_file_id,OLD.source_id,OLD.integration_credential_id,
      OLD.integration_grants,OLD.entity_kind,OLD.mapping,OLD.mapping_hash,OLD.source_hash,OLD.trusted_identity,OLD.confirmation_key)
    IS DISTINCT FROM ROW(NEW.workspace_id,NEW.staged_file_id,NEW.source_id,NEW.integration_credential_id,
      NEW.integration_grants,NEW.entity_kind,NEW.mapping,NEW.mapping_hash,NEW.source_hash,NEW.trusted_identity,NEW.confirmation_key) THEN
    RAISE EXCEPTION 'CRM import job input and authority are immutable; confirm a new job' USING ERRCODE='55000';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
