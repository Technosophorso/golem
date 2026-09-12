-- Immutable source usage for digest-only promotion migration.
-- [COMP:crm/production-import]
BEGIN;

ALTER TABLE association_promotions
  ADD COLUMN source_system TEXT,
  ADD COLUMN source_site TEXT,
  ADD COLUMN source_promotion_id TEXT,
  ADD COLUMN source_redeemed_uses INTEGER NOT NULL DEFAULT 0 CHECK(source_redeemed_uses BETWEEN 0 AND 1000000),
  ADD COLUMN source_import JSONB,
  ADD CONSTRAINT association_promotions_source_shape CHECK(
    (source_system IS NULL AND source_site IS NULL AND source_promotion_id IS NULL
      AND source_redeemed_uses=0 AND source_import IS NULL)
    OR (source_system ~ '^[a-z][a-z0-9_-]{0,62}$'
      AND length(btrim(source_site)) BETWEEN 1 AND 500
      AND length(btrim(source_promotion_id)) BETWEEN 1 AND 500
      AND jsonb_typeof(source_import)='object'
      AND source_import ?& ARRAY['jobId','row','fingerprint'])
  ),
  ADD CONSTRAINT association_promotions_source_cap CHECK(
    max_uses IS NULL OR source_redeemed_uses<=max_uses
  );

CREATE UNIQUE INDEX association_promotions_source_identity
  ON association_promotions(workspace_id,source_system,source_site,source_promotion_id)
  WHERE source_system IS NOT NULL;

CREATE TABLE association_promotion_source_contact_uses (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  promotion_id   UUID NOT NULL,
  contact_id     UUID,
  uses           INTEGER NOT NULL CHECK(uses BETWEEN 1 AND 1000000),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,promotion_id,contact_id),
  FOREIGN KEY(workspace_id,promotion_id)
    REFERENCES association_promotions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,contact_id)
    REFERENCES entities(workspace_id,id) ON DELETE RESTRICT
);
CREATE INDEX association_promotion_source_contact_uses_contact
  ON association_promotion_source_contact_uses(workspace_id,promotion_id,contact_id);

CREATE FUNCTION public.association_promotion_source_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.source_system,NEW.source_site,NEW.source_promotion_id,
    NEW.source_redeemed_uses,NEW.source_import)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.source_system,OLD.source_site,OLD.source_promotion_id,
    OLD.source_redeemed_uses,OLD.source_import) THEN
    RAISE EXCEPTION 'Imported promotion source evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER association_promotion_source_evidence_immutable
  BEFORE UPDATE ON association_promotions FOR EACH ROW
  WHEN (OLD.source_system IS NOT NULL)
  EXECUTE FUNCTION public.association_promotion_source_evidence_immutable();

CREATE FUNCTION public.association_promotion_source_contact_use_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.promotion_id,NEW.uses)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.promotion_id,OLD.uses) THEN
    RAISE EXCEPTION 'Imported promotion contact usage is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER association_promotion_source_contact_use_immutable
  BEFORE UPDATE ON association_promotion_source_contact_uses FOR EACH ROW
  EXECUTE FUNCTION public.association_promotion_source_contact_use_immutable();

CREATE TRIGGER crm_privacy_write_admission
  BEFORE INSERT OR UPDATE OR DELETE ON association_promotion_source_contact_uses
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();

COMMIT;
