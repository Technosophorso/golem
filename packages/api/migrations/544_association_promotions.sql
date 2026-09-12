-- Canonical coupon authority with secret-free order evidence. [COMP:crm/association-promotions]
BEGIN;

CREATE TABLE association_promotions (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  promotion_key              TEXT NOT NULL CHECK (promotion_key ~ '^[a-z][a-z0-9_-]{0,62}$'),
  name                       TEXT NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  code_digest                TEXT NOT NULL CHECK (code_digest ~ '^[0-9a-f]{64}$'),
  discount_type              TEXT NOT NULL CHECK (discount_type IN ('percentage','full','buy_x_get_y')),
  percentage_basis_points    INTEGER CHECK (percentage_basis_points BETWEEN 1 AND 10000),
  buy_quantity               INTEGER CHECK (buy_quantity BETWEEN 1 AND 1000),
  get_quantity               INTEGER CHECK (get_quantity BETWEEN 1 AND 1000),
  target_kind                TEXT NOT NULL CHECK (target_kind IN ('event','ticket')),
  target_ids                 UUID[] NOT NULL CHECK (cardinality(target_ids) BETWEEN 1 AND 100),
  valid_from                 TIMESTAMPTZ,
  valid_to                   TIMESTAMPTZ,
  max_uses                   INTEGER CHECK (max_uses IS NULL OR max_uses > 0),
  max_uses_per_contact       INTEGER CHECK (max_uses_per_contact IS NULL OR max_uses_per_contact > 0),
  combines_with_member_price BOOLEAN NOT NULL DEFAULT false,
  release_on_full_refund     BOOLEAN NOT NULL DEFAULT false,
  status                     TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','disabled')),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to > valid_from),
  CHECK (
    (discount_type='percentage' AND percentage_basis_points IS NOT NULL AND buy_quantity IS NULL AND get_quantity IS NULL)
    OR (discount_type='full' AND percentage_basis_points IS NULL AND buy_quantity IS NULL AND get_quantity IS NULL)
    OR (discount_type='buy_x_get_y' AND percentage_basis_points IS NULL AND buy_quantity IS NOT NULL AND get_quantity IS NOT NULL)
  ),
  UNIQUE (workspace_id, promotion_key),
  UNIQUE (workspace_id, code_digest),
  UNIQUE (workspace_id, id)
);
CREATE INDEX association_promotions_status
  ON association_promotions(workspace_id,status,valid_from,valid_to,id);

CREATE TABLE association_promotion_uses (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  promotion_id           UUID NOT NULL,
  order_id               UUID NOT NULL,
  contact_id             UUID,
  state                  TEXT NOT NULL CHECK (state IN ('reserved','redeemed','released')),
  reservation_expires_at TIMESTAMPTZ,
  released_reason        TEXT CHECK (released_reason IS NULL OR length(released_reason) BETWEEN 1 AND 100),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((state='reserved')=(reservation_expires_at IS NOT NULL)),
  CHECK ((state='released')=(released_reason IS NOT NULL)),
  UNIQUE (workspace_id, order_id),
  UNIQUE (workspace_id, id),
  FOREIGN KEY (workspace_id,promotion_id)
    REFERENCES association_promotions(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY (workspace_id,order_id)
    REFERENCES association_orders(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id,contact_id)
    REFERENCES entities(workspace_id,id) ON DELETE RESTRICT
);
CREATE INDEX association_promotion_uses_capacity
  ON association_promotion_uses(workspace_id,promotion_id,state,reservation_expires_at);
CREATE INDEX association_promotion_uses_contact
  ON association_promotion_uses(workspace_id,promotion_id,contact_id,state,reservation_expires_at);

ALTER TABLE association_orders
  ADD COLUMN promotion_id UUID,
  ADD COLUMN promotion_snapshot JSONB,
  ADD CONSTRAINT association_orders_promotion_fkey
    FOREIGN KEY(workspace_id,promotion_id) REFERENCES association_promotions(workspace_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT association_orders_promotion_snapshot_shape CHECK(
    (promotion_id IS NULL AND promotion_snapshot IS NULL)
    OR (promotion_id IS NOT NULL AND jsonb_typeof(promotion_snapshot)='object')
  );

ALTER TABLE association_order_lines
  ADD COLUMN member_discount_minor BIGINT NOT NULL DEFAULT 0 CHECK(member_discount_minor>=0),
  ADD COLUMN promotion_discount_minor BIGINT NOT NULL DEFAULT 0 CHECK(promotion_discount_minor>=0),
  ADD COLUMN source_discount_minor BIGINT NOT NULL DEFAULT 0 CHECK(source_discount_minor>=0);
UPDATE association_order_lines SET
  member_discount_minor=CASE WHEN pricing_basis='member' THEN discount_minor ELSE 0 END,
  source_discount_minor=CASE WHEN pricing_basis='source' THEN discount_minor ELSE 0 END;
ALTER TABLE association_order_lines ADD CONSTRAINT association_order_lines_discount_parts
  CHECK(discount_minor=member_discount_minor+promotion_discount_minor+source_discount_minor);

CREATE FUNCTION public.association_promotion_use_transition_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.promotion_id,NEW.order_id)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.promotion_id,OLD.order_id) THEN
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
CREATE TRIGGER association_promotion_use_transition_guard
  BEFORE UPDATE ON association_promotion_uses FOR EACH ROW
  EXECUTE FUNCTION public.association_promotion_use_transition_guard();

CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON association_promotions
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON association_promotion_uses
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();

COMMIT;
