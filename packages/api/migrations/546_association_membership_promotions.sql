-- Canonical plan-scoped promotion reservations and provider binding.
-- [COMP:crm/association-membership-promotions]
BEGIN;

ALTER TABLE association_promotions
  DROP CONSTRAINT IF EXISTS association_promotions_discount_type_check,
  DROP CONSTRAINT IF EXISTS association_promotions_target_kind_check,
  DROP CONSTRAINT IF EXISTS association_promotions_check1,
  ADD COLUMN amount_minor BIGINT,
  ADD COLUMN currency TEXT,
  ADD COLUMN recurrence_mode TEXT NOT NULL DEFAULT 'once',
  ADD COLUMN recurrence_cycles INTEGER,
  ADD COLUMN apply_mode TEXT NOT NULL DEFAULT 'each_eligible_item';

ALTER TABLE association_promotions
  ADD CONSTRAINT association_promotions_discount_type_check
    CHECK (discount_type IN ('percentage','fixed_amount','full','buy_x_get_y')),
  ADD CONSTRAINT association_promotions_target_kind_check
    CHECK (target_kind IN ('event','ticket','plan')),
  ADD CONSTRAINT association_promotions_currency_check
    CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT association_promotions_recurrence_mode_check
    CHECK (recurrence_mode IN ('once','forever','repeating')),
  ADD CONSTRAINT association_promotions_apply_mode_check
    CHECK (apply_mode IN ('once_per_order','each_eligible_item')),
  ADD CONSTRAINT association_promotions_rule_shape_check CHECK (
    (discount_type='percentage' AND percentage_basis_points IS NOT NULL
      AND amount_minor IS NULL AND currency IS NULL AND buy_quantity IS NULL AND get_quantity IS NULL)
    OR (discount_type='fixed_amount' AND percentage_basis_points IS NULL
      AND amount_minor > 0 AND currency IS NOT NULL AND buy_quantity IS NULL AND get_quantity IS NULL)
    OR (discount_type='full' AND percentage_basis_points IS NULL
      AND amount_minor IS NULL AND currency IS NULL AND buy_quantity IS NULL AND get_quantity IS NULL)
    OR (discount_type='buy_x_get_y' AND percentage_basis_points IS NULL
      AND amount_minor IS NULL AND currency IS NULL AND buy_quantity IS NOT NULL AND get_quantity IS NOT NULL)
  ),
  ADD CONSTRAINT association_promotions_apply_shape_check CHECK (
    discount_type<>'buy_x_get_y' OR apply_mode='each_eligible_item'
  ),
  ADD CONSTRAINT association_promotions_recurrence_shape_check CHECK (
    ((target_kind IN ('event','ticket')) AND recurrence_mode='once' AND recurrence_cycles IS NULL)
    OR (target_kind='plan' AND discount_type<>'buy_x_get_y'
      AND ((recurrence_mode IN ('once','forever') AND recurrence_cycles IS NULL)
        OR (recurrence_mode='repeating' AND recurrence_cycles BETWEEN 2 AND 120)))
  );

CREATE TABLE association_membership_checkouts (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id              UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id                UUID NOT NULL,
  plan_id                   UUID NOT NULL,
  idempotency_key           TEXT NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 200),
  request_fingerprint       TEXT NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  status                    TEXT NOT NULL DEFAULT 'reserved'
                              CHECK (status IN ('reserved','provider_bound','paid','failed','expired','cancelled')),
  currency                  TEXT NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  subtotal_minor            BIGINT NOT NULL CHECK (subtotal_minor > 0),
  discount_minor            BIGINT NOT NULL CHECK (discount_minor > 0 AND discount_minor <= subtotal_minor),
  total_minor               BIGINT NOT NULL CHECK (total_minor >= 0),
  promotion_id              UUID NOT NULL,
  promotion_snapshot        JSONB NOT NULL CHECK (jsonb_typeof(promotion_snapshot)='object'),
  reservation_expires_at    TIMESTAMPTZ NOT NULL,
  provider                  TEXT,
  provider_reference        TEXT,
  provider_coupon_reference TEXT,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id,idempotency_key),
  UNIQUE (workspace_id,id),
  FOREIGN KEY (workspace_id,contact_id) REFERENCES entities(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,plan_id) REFERENCES association_membership_plans(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,promotion_id) REFERENCES association_promotions(workspace_id,id) ON DELETE RESTRICT,
  CHECK (subtotal_minor-discount_minor=total_minor),
  CHECK ((provider IS NULL)=(provider_reference IS NULL)),
  CHECK ((provider IS NULL)=(provider_coupon_reference IS NULL)),
  CHECK (status NOT IN ('provider_bound','paid') OR provider IS NOT NULL)
);
CREATE UNIQUE INDEX association_membership_checkouts_provider
  ON association_membership_checkouts(workspace_id,provider,provider_reference)
  WHERE provider IS NOT NULL;
CREATE INDEX association_membership_checkouts_contact
  ON association_membership_checkouts(workspace_id,contact_id,created_at,id);
CREATE INDEX association_membership_checkouts_expiry
  ON association_membership_checkouts(workspace_id,status,reservation_expires_at,id);

ALTER TABLE association_promotion_uses
  DROP CONSTRAINT association_promotion_uses_workspace_id_order_id_key,
  ALTER COLUMN order_id DROP NOT NULL,
  ADD COLUMN membership_checkout_id UUID,
  ADD CONSTRAINT association_promotion_uses_membership_checkout_fkey
    FOREIGN KEY (workspace_id,membership_checkout_id)
      REFERENCES association_membership_checkouts(workspace_id,id) ON DELETE CASCADE,
  ADD CONSTRAINT association_promotion_uses_target_shape
    CHECK ((order_id IS NULL)<>(membership_checkout_id IS NULL));
CREATE UNIQUE INDEX association_promotion_uses_order_unique
  ON association_promotion_uses(workspace_id,order_id) WHERE order_id IS NOT NULL;
CREATE UNIQUE INDEX association_promotion_uses_membership_checkout_unique
  ON association_promotion_uses(workspace_id,membership_checkout_id) WHERE membership_checkout_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.association_promotion_use_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.promotion_id,NEW.order_id,NEW.membership_checkout_id)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.promotion_id,OLD.order_id,OLD.membership_checkout_id) THEN
    RAISE EXCEPTION 'Promotion use identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.state='released' AND NEW.state<>OLD.state THEN
    RAISE EXCEPTION 'A released promotion use is terminal' USING ERRCODE='23514';
  END IF;
  IF OLD.state='redeemed' AND NEW.state='reserved' THEN
    RAISE EXCEPTION 'A redeemed promotion use cannot return to reserved' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.association_membership_checkout_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.contact_id,NEW.plan_id,NEW.idempotency_key,NEW.request_fingerprint,
      NEW.currency,NEW.subtotal_minor,NEW.discount_minor,NEW.total_minor,NEW.promotion_id,
      NEW.promotion_snapshot,NEW.reservation_expires_at)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.contact_id,OLD.plan_id,OLD.idempotency_key,OLD.request_fingerprint,
      OLD.currency,OLD.subtotal_minor,OLD.discount_minor,OLD.total_minor,OLD.promotion_id,
      OLD.promotion_snapshot,OLD.reservation_expires_at) THEN
    RAISE EXCEPTION 'Membership checkout evidence is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.status IN ('paid','failed','expired','cancelled') AND NEW.status<>OLD.status THEN
    RAISE EXCEPTION 'A terminal membership checkout cannot transition' USING ERRCODE='23514';
  END IF;
  IF OLD.status='provider_bound' AND NEW.status='reserved' THEN
    RAISE EXCEPTION 'A provider-bound membership checkout cannot return to reserved' USING ERRCODE='23514';
  END IF;
  IF OLD.provider IS NOT NULL AND ROW(NEW.provider,NEW.provider_reference,NEW.provider_coupon_reference)
    IS DISTINCT FROM ROW(OLD.provider,OLD.provider_reference,OLD.provider_coupon_reference) THEN
    RAISE EXCEPTION 'Membership checkout provider binding is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER association_membership_checkout_transition_guard
  BEFORE UPDATE ON association_membership_checkouts FOR EACH ROW
  EXECUTE FUNCTION public.association_membership_checkout_transition_guard();
CREATE TRIGGER association_membership_checkout_updated_at
  BEFORE UPDATE ON association_membership_checkouts FOR EACH ROW
  EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE association_membership_checkouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY association_membership_checkouts_member ON association_membership_checkouts
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));

CREATE TRIGGER crm_privacy_write_admission
  BEFORE INSERT OR UPDATE OR DELETE ON association_membership_checkouts
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();

-- Recovery capture is schema-driven; register and attach the new table in the
-- same release that creates it.
SELECT public.crm_install_erasure_capture();

COMMIT;
