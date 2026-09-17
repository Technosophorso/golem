-- Immutable Wix/legacy membership lineage without imported provider authority.
-- [COMP:crm/production-import]
BEGIN;

CREATE TABLE association_membership_source_imports (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  membership_id            UUID NOT NULL,
  source_system            TEXT NOT NULL CHECK(source_system ~ '^[a-z][a-z0-9_-]{0,62}$'),
  source_site              TEXT NOT NULL CHECK(length(btrim(source_site)) BETWEEN 1 AND 500),
  source_membership_id     TEXT NOT NULL CHECK(length(btrim(source_membership_id)) BETWEEN 1 AND 500),
  source_plan_id           TEXT NOT NULL CHECK(length(btrim(source_plan_id)) BETWEEN 1 AND 500),
  source_member_id         TEXT CHECK(source_member_id IS NULL OR length(btrim(source_member_id)) BETWEEN 1 AND 500),
  source_order_id          TEXT CHECK(source_order_id IS NULL OR length(btrim(source_order_id)) BETWEEN 1 AND 500),
  source_subscription_id   TEXT CHECK(source_subscription_id IS NULL OR length(btrim(source_subscription_id)) BETWEEN 1 AND 500),
  source_payment_provider  TEXT CHECK(source_payment_provider IS NULL OR source_payment_provider ~ '^[a-z][a-z0-9_-]{0,62}$'),
  source_payment_reference TEXT CHECK(source_payment_reference IS NULL OR length(btrim(source_payment_reference)) BETWEEN 1 AND 500),
  source_status            TEXT NOT NULL CHECK(length(btrim(source_status)) BETWEEN 1 AND 100),
  source_renewal_status    TEXT NOT NULL CHECK(length(btrim(source_renewal_status)) BETWEEN 1 AND 100),
  source_payment_status    TEXT CHECK(source_payment_status IS NULL OR length(btrim(source_payment_status)) BETWEEN 1 AND 100),
  source_refund_status     TEXT CHECK(source_refund_status IS NULL OR length(btrim(source_refund_status)) BETWEEN 1 AND 100),
  purchased_at             TIMESTAMPTZ NOT NULL,
  cancelled_at             TIMESTAMPTZ,
  relationships            JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(relationships)='object'),
  metadata                 JSONB NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object'),
  import_job_id            UUID NOT NULL,
  import_row               INTEGER NOT NULL CHECK(import_row>0),
  request_fingerprint      TEXT NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((source_payment_provider IS NULL)=(source_payment_reference IS NULL)),
  CHECK(cancelled_at IS NULL OR cancelled_at>=purchased_at),
  UNIQUE(workspace_id,membership_id),
  UNIQUE(workspace_id,source_system,source_site,source_membership_id),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,membership_id)
    REFERENCES association_memberships(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX association_membership_source_imports_plan
  ON association_membership_source_imports(workspace_id,source_plan_id,created_at,id);
CREATE INDEX association_membership_source_imports_subscription
  ON association_membership_source_imports(workspace_id,source_system,source_subscription_id)
  WHERE source_subscription_id IS NOT NULL;

CREATE FUNCTION public.association_source_membership_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE reviewer uuid; membership public.association_memberships;
BEGIN
  reviewer:=NULLIF(current_setting('app.association_source_membership_actor',true),'')::uuid;
  IF reviewer IS NULL OR NOT EXISTS(
    SELECT 1 FROM workspace_members WHERE workspace_id=NEW.workspace_id
      AND user_id=reviewer AND role IN('owner','admin')) THEN
    RAISE EXCEPTION 'Source membership import requires a current workspace owner or admin' USING ERRCODE='23514';
  END IF;
  SELECT * INTO membership FROM association_memberships
    WHERE workspace_id=NEW.workspace_id AND id=NEW.membership_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source membership target is unavailable' USING ERRCODE='23503';
  END IF;
  IF membership.provider IS NOT NULL OR membership.provider_membership_id IS NOT NULL
      OR membership.provider_period_id IS NOT NULL OR membership.predecessor_id IS NOT NULL
      OR membership.renewal_mode='auto' THEN
    RAISE EXCEPTION 'Imported source membership cannot claim provider or automatic-renewal authority' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER association_source_membership_guard
  BEFORE INSERT ON association_membership_source_imports FOR EACH ROW
  EXECUTE FUNCTION public.association_source_membership_guard();

CREATE FUNCTION public.association_source_membership_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  RAISE EXCEPTION 'Imported source membership evidence is immutable' USING ERRCODE='23514';
END;
$$;
CREATE TRIGGER association_source_membership_evidence_immutable
  BEFORE UPDATE ON association_membership_source_imports FOR EACH ROW
  EXECUTE FUNCTION public.association_source_membership_evidence_immutable();

ALTER TABLE association_membership_source_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY association_membership_source_imports_member ON association_membership_source_imports
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE TRIGGER crm_privacy_write_admission
  BEFORE INSERT OR UPDATE OR DELETE ON association_membership_source_imports
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();

SELECT public.crm_install_erasure_capture();
COMMIT;
