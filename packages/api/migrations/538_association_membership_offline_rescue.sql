-- Reviewed offline-payment rescue with immutable finance evidence.
-- [COMP:crm/association-membership-rescue]
BEGIN;

CREATE TABLE association_membership_offline_rescues (
  id                         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id               UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id                 UUID NOT NULL,
  plan_id                    UUID NOT NULL,
  idempotency_key            TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint        TEXT NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
  status                     TEXT NOT NULL DEFAULT 'outstanding'
                               CHECK(status IN('outstanding','settled','reversed','cancelled')),
  amount_minor               BIGINT NOT NULL CHECK(amount_minor > 0),
  currency                   TEXT NOT NULL CHECK(currency ~ '^[A-Z]{3}$'),
  starts_at                  TIMESTAMPTZ NOT NULL,
  ends_at                    TIMESTAMPTZ NOT NULL,
  due_at                     TIMESTAMPTZ NOT NULL,
  reason                     TEXT NOT NULL CHECK(length(btrim(reason)) BETWEEN 1 AND 2000),
  membership_id              UUID,
  settlement_request_id      TEXT CHECK(settlement_request_id IS NULL OR length(settlement_request_id) BETWEEN 1 AND 200),
  settlement_fingerprint     TEXT CHECK(settlement_fingerprint IS NULL OR settlement_fingerprint ~ '^[0-9a-f]{64}$'),
  settlement_method          TEXT CHECK(settlement_method IS NULL OR settlement_method IN('bank_transfer','cash','cheque','other')),
  settlement_reference       TEXT CHECK(settlement_reference IS NULL OR length(btrim(settlement_reference)) BETWEEN 1 AND 500),
  settlement_occurred_at     TIMESTAMPTZ,
  settlement_note            TEXT CHECK(settlement_note IS NULL OR length(settlement_note) <= 2000),
  settlement_by_user_id      UUID REFERENCES users(id) ON DELETE RESTRICT,
  reversal_request_id        TEXT CHECK(reversal_request_id IS NULL OR length(reversal_request_id) BETWEEN 1 AND 200),
  reversal_fingerprint       TEXT CHECK(reversal_fingerprint IS NULL OR reversal_fingerprint ~ '^[0-9a-f]{64}$'),
  reversal_reference        TEXT CHECK(reversal_reference IS NULL OR length(btrim(reversal_reference)) BETWEEN 1 AND 500),
  reversal_occurred_at       TIMESTAMPTZ,
  reversal_reason            TEXT CHECK(reversal_reason IS NULL OR length(btrim(reversal_reason)) BETWEEN 1 AND 2000),
  reversed_by_user_id        UUID REFERENCES users(id) ON DELETE RESTRICT,
  cancellation_request_id    TEXT CHECK(cancellation_request_id IS NULL OR length(cancellation_request_id) BETWEEN 1 AND 200),
  cancellation_fingerprint   TEXT CHECK(cancellation_fingerprint IS NULL OR cancellation_fingerprint ~ '^[0-9a-f]{64}$'),
  cancellation_reason        TEXT CHECK(cancellation_reason IS NULL OR length(btrim(cancellation_reason)) BETWEEN 1 AND 2000),
  cancelled_by_user_id       UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK(ends_at > starts_at),
  CHECK(
    (status='outstanding' AND membership_id IS NULL
      AND settlement_request_id IS NULL AND settlement_fingerprint IS NULL AND settlement_method IS NULL
      AND settlement_reference IS NULL AND settlement_occurred_at IS NULL AND settlement_note IS NULL AND settlement_by_user_id IS NULL
      AND reversal_request_id IS NULL AND reversal_fingerprint IS NULL AND reversal_reference IS NULL
      AND reversal_occurred_at IS NULL AND reversal_reason IS NULL AND reversed_by_user_id IS NULL
      AND cancellation_request_id IS NULL AND cancellation_fingerprint IS NULL AND cancellation_reason IS NULL AND cancelled_by_user_id IS NULL)
    OR
    (status='settled' AND membership_id IS NOT NULL
      AND settlement_request_id IS NOT NULL AND settlement_fingerprint IS NOT NULL AND settlement_method IS NOT NULL
      AND settlement_reference IS NOT NULL AND settlement_occurred_at IS NOT NULL AND settlement_by_user_id IS NOT NULL
      AND reversal_request_id IS NULL AND reversal_fingerprint IS NULL AND reversal_reference IS NULL
      AND reversal_occurred_at IS NULL AND reversal_reason IS NULL AND reversed_by_user_id IS NULL
      AND cancellation_request_id IS NULL AND cancellation_fingerprint IS NULL AND cancellation_reason IS NULL AND cancelled_by_user_id IS NULL)
    OR
    (status='reversed' AND membership_id IS NOT NULL
      AND settlement_request_id IS NOT NULL AND settlement_fingerprint IS NOT NULL AND settlement_method IS NOT NULL
      AND settlement_reference IS NOT NULL AND settlement_occurred_at IS NOT NULL AND settlement_by_user_id IS NOT NULL
      AND reversal_request_id IS NOT NULL AND reversal_fingerprint IS NOT NULL AND reversal_reference IS NOT NULL
      AND reversal_occurred_at IS NOT NULL AND reversal_reason IS NOT NULL AND reversed_by_user_id IS NOT NULL
      AND cancellation_request_id IS NULL AND cancellation_fingerprint IS NULL AND cancellation_reason IS NULL AND cancelled_by_user_id IS NULL)
    OR
    (status='cancelled' AND membership_id IS NULL
      AND settlement_request_id IS NULL AND settlement_fingerprint IS NULL AND settlement_method IS NULL
      AND settlement_reference IS NULL AND settlement_occurred_at IS NULL AND settlement_note IS NULL AND settlement_by_user_id IS NULL
      AND reversal_request_id IS NULL AND reversal_fingerprint IS NULL AND reversal_reference IS NULL
      AND reversal_occurred_at IS NULL AND reversal_reason IS NULL AND reversed_by_user_id IS NULL
      AND cancellation_request_id IS NOT NULL AND cancellation_fingerprint IS NOT NULL AND cancellation_reason IS NOT NULL AND cancelled_by_user_id IS NOT NULL)
  ),
  UNIQUE(workspace_id,idempotency_key),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,contact_id) REFERENCES entities(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,plan_id) REFERENCES association_membership_plans(workspace_id,id) ON DELETE RESTRICT,
  FOREIGN KEY(workspace_id,membership_id) REFERENCES association_memberships(workspace_id,id) ON DELETE RESTRICT
);

CREATE INDEX association_membership_offline_rescues_queue
  ON association_membership_offline_rescues(workspace_id,status,due_at,id);
CREATE INDEX association_membership_offline_rescues_contact
  ON association_membership_offline_rescues(workspace_id,contact_id,created_at DESC,id DESC);

CREATE FUNCTION public.association_membership_offline_rescue_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.contact_id,NEW.plan_id,NEW.idempotency_key,NEW.request_fingerprint,
      NEW.amount_minor,NEW.currency,NEW.starts_at,NEW.ends_at,NEW.due_at,NEW.reason,NEW.created_by_user_id,NEW.created_at)
    IS DISTINCT FROM
    ROW(OLD.workspace_id,OLD.contact_id,OLD.plan_id,OLD.idempotency_key,OLD.request_fingerprint,
      OLD.amount_minor,OLD.currency,OLD.starts_at,OLD.ends_at,OLD.due_at,OLD.reason,OLD.created_by_user_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Offline rescue request is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.settlement_request_id IS NOT NULL AND ROW(NEW.membership_id,NEW.settlement_request_id,NEW.settlement_fingerprint,
      NEW.settlement_method,NEW.settlement_reference,NEW.settlement_occurred_at,NEW.settlement_note,NEW.settlement_by_user_id)
    IS DISTINCT FROM ROW(OLD.membership_id,OLD.settlement_request_id,OLD.settlement_fingerprint,
      OLD.settlement_method,OLD.settlement_reference,OLD.settlement_occurred_at,OLD.settlement_note,OLD.settlement_by_user_id) THEN
    RAISE EXCEPTION 'Offline settlement evidence is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.reversal_request_id IS NOT NULL AND ROW(NEW.reversal_request_id,NEW.reversal_fingerprint,NEW.reversal_reference,
      NEW.reversal_occurred_at,NEW.reversal_reason,NEW.reversed_by_user_id)
    IS DISTINCT FROM ROW(OLD.reversal_request_id,OLD.reversal_fingerprint,OLD.reversal_reference,
      OLD.reversal_occurred_at,OLD.reversal_reason,OLD.reversed_by_user_id) THEN
    RAISE EXCEPTION 'Offline reversal evidence is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.cancellation_request_id IS NOT NULL AND ROW(NEW.cancellation_request_id,NEW.cancellation_fingerprint,
      NEW.cancellation_reason,NEW.cancelled_by_user_id)
    IS DISTINCT FROM ROW(OLD.cancellation_request_id,OLD.cancellation_fingerprint,
      OLD.cancellation_reason,OLD.cancelled_by_user_id) THEN
    RAISE EXCEPTION 'Offline rescue cancellation is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT ((OLD.status='outstanding' AND NEW.status IN('outstanding','settled','cancelled'))
    OR (OLD.status='settled' AND NEW.status IN('settled','reversed'))
    OR (OLD.status='reversed' AND NEW.status='reversed')
    OR (OLD.status='cancelled' AND NEW.status='cancelled')) THEN
    RAISE EXCEPTION 'Invalid offline rescue transition' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER association_membership_offline_rescue_guard
  BEFORE UPDATE ON association_membership_offline_rescues
  FOR EACH ROW EXECUTE FUNCTION public.association_membership_offline_rescue_guard();
CREATE TRIGGER association_membership_offline_rescue_updated_at
  BEFORE UPDATE ON association_membership_offline_rescues
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

ALTER TABLE association_membership_offline_rescues ENABLE ROW LEVEL SECURITY;
CREATE POLICY association_membership_offline_rescues_member ON association_membership_offline_rescues
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));

COMMIT;
