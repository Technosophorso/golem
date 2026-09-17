-- Replay-safe source orders for silent Wix and legacy booking migration.
-- [COMP:crm/production-import]
BEGIN;

-- Migration 538 introduced this Association financial table after the
-- privacy trigger registry. Bring it under the same admission lock before
-- adding another import writer.
CREATE TRIGGER crm_privacy_write_admission
  BEFORE INSERT OR UPDATE OR DELETE ON association_membership_offline_rescues
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();

ALTER TABLE association_orders
  ADD COLUMN source_system TEXT,
  ADD COLUMN source_site TEXT,
  ADD COLUMN source_order_id TEXT,
  ADD COLUMN source_occurred_at TIMESTAMPTZ,
  ADD COLUMN source_order_status TEXT,
  ADD COLUMN source_import BOOLEAN NOT NULL DEFAULT false,
  ADD CONSTRAINT association_orders_source_import_shape CHECK (
    (source_import
      AND source_system ~ '^[a-z][a-z0-9_-]{0,62}$'
      AND length(btrim(source_site)) BETWEEN 1 AND 500
      AND length(btrim(source_order_id)) BETWEEN 1 AND 500
      AND source_occurred_at IS NOT NULL
      AND source_order_status IN ('pending','paid','failed','cancelled','refunded'))
    OR (NOT source_import AND source_system IS NULL AND source_site IS NULL
      AND source_order_id IS NULL AND source_occurred_at IS NULL
      AND source_order_status IS NULL)
  );

CREATE UNIQUE INDEX association_orders_source_identity
  ON association_orders(workspace_id,source_system,source_site,source_order_id)
  WHERE source_import;

CREATE FUNCTION public.association_source_order_evidence_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF OLD.source_import AND ROW(
    NEW.workspace_id,NEW.contact_id,NEW.request_fingerprint,NEW.currency,
    NEW.subtotal_minor,NEW.discount_minor,NEW.total_minor,NEW.source_system,
    NEW.source_site,NEW.source_order_id,NEW.source_occurred_at,
    NEW.source_order_status,NEW.source_import
  ) IS DISTINCT FROM ROW(
    OLD.workspace_id,OLD.contact_id,OLD.request_fingerprint,OLD.currency,
    OLD.subtotal_minor,OLD.discount_minor,OLD.total_minor,OLD.source_system,
    OLD.source_site,OLD.source_order_id,OLD.source_occurred_at,
    OLD.source_order_status,OLD.source_import
  ) THEN
    RAISE EXCEPTION 'Imported source order evidence is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER association_source_order_evidence_immutable
  BEFORE UPDATE ON association_orders FOR EACH ROW
  EXECUTE FUNCTION public.association_source_order_evidence_immutable();

ALTER TABLE association_order_lines
  DROP CONSTRAINT association_order_lines_pricing_basis_check,
  ADD CONSTRAINT association_order_lines_pricing_basis_check
    CHECK(pricing_basis IN ('public','member','source'));

ALTER TABLE association_registrations
  DROP CONSTRAINT association_registrations_source_kind_check,
  DROP CONSTRAINT association_registrations_source_pair_check,
  ADD CONSTRAINT association_registrations_source_kind_check
    CHECK(source_kind IN ('commerce','source_order','manual','form','workflow','import')),
  ADD CONSTRAINT association_registrations_source_pair_check CHECK(
    (source_kind IN('commerce','source_order') AND order_id IS NOT NULL
      AND order_line_id IS NOT NULL AND ticket_id IS NOT NULL)
    OR (source_kind NOT IN('commerce','source_order') AND order_id IS NULL
      AND order_line_id IS NULL AND ticket_id IS NULL)
  );

CREATE OR REPLACE FUNCTION public.association_registration_inventory_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE controlled boolean; ended boolean; reviewer uuid;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF ROW(NEW.workspace_id,NEW.event_id,NEW.ticket_id,NEW.order_id,NEW.order_line_id,NEW.source_kind,NEW.source_id,NEW.historical_import)
      IS DISTINCT FROM ROW(OLD.workspace_id,OLD.event_id,OLD.ticket_id,OLD.order_id,OLD.order_line_id,OLD.source_kind,OLD.source_id,OLD.historical_import)
    THEN RAISE EXCEPTION 'Registration source identity is immutable' USING ERRCODE='23514'; END IF;
    IF NEW.source_kind NOT IN('commerce','source_order') AND NEW.status NOT IN('registered','attended','cancelled','no_show') THEN
      RAISE EXCEPTION 'Non-commerce participation cannot acquire commerce status' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_kind='commerce' THEN
    IF NEW.historical_import THEN RAISE EXCEPTION 'Commerce registration is not historical import' USING ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF NEW.source_kind='source_order' THEN
    reviewer:=NULLIF(current_setting('app.association_source_order_actor',true),'')::uuid;
    SELECT ends_at<=clock_timestamp() INTO ended FROM association_events
      WHERE workspace_id=NEW.workspace_id AND id=NEW.event_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source order event unavailable' USING ERRCODE='23503'; END IF;
    IF reviewer IS NULL OR NOT EXISTS(
      SELECT 1 FROM workspace_members WHERE workspace_id=NEW.workspace_id
        AND user_id=reviewer AND role IN('owner','admin')) THEN
      RAISE EXCEPTION 'Source order import requires a current workspace owner or admin' USING ERRCODE='23514';
    END IF;
    IF NEW.historical_import IS DISTINCT FROM ended THEN
      RAISE EXCEPTION 'Source order history must match the event boundary' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status NOT IN('registered','attended','cancelled','no_show') THEN
    RAISE EXCEPTION 'Non-commerce participation cannot create a commerce reservation' USING ERRCODE='23514';
  END IF;
  -- Catalog changes also lock this event before creating a ticket.
  SELECT capacity IS NOT NULL,ends_at<=clock_timestamp() INTO controlled,ended
    FROM association_events WHERE workspace_id=NEW.workspace_id AND id=NEW.event_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Participation event unavailable' USING ERRCODE='23503'; END IF;
  controlled:=controlled OR EXISTS(SELECT 1 FROM association_ticket_types WHERE workspace_id=NEW.workspace_id AND event_id=NEW.event_id);
  IF NEW.historical_import THEN
    reviewer:=NULLIF(current_setting('app.crm_historical_actor',true),'')::uuid;
    IF NEW.source_kind<>'import' OR NOT ended OR reviewer IS NULL OR NOT EXISTS(
      SELECT 1 FROM workspace_members WHERE workspace_id=NEW.workspace_id AND user_id=reviewer AND role IN('owner','admin')) THEN
      RAISE EXCEPTION 'Historical participation requires an admin and an ended event' USING ERRCODE='23514';
    END IF;
  ELSIF controlled THEN
    RAISE EXCEPTION 'Controlled event admission requires an Association order' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
