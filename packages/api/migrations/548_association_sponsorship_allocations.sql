-- Recipient-bound sponsorship allocations and atomic invitation redemption.
-- [COMP:crm/association-sponsorship]
BEGIN;

CREATE TABLE association_sponsorship_allocations (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  sponsor_contact_id     UUID NOT NULL,
  sponsor_membership_id  UUID NOT NULL,
  beneficiary_plan_id    UUID NOT NULL,
  idempotency_key        TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint    TEXT NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
  seat_limit             INTEGER NOT NULL CHECK(seat_limit BETWEEN 1 AND 10000),
  starts_at              TIMESTAMPTZ NOT NULL,
  ends_at                TIMESTAMPTZ NOT NULL,
  invitation_ttl_hours   INTEGER NOT NULL CHECK(invitation_ttl_hours BETWEEN 1 AND 2160),
  status                 TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','cancelled')),
  cancellation_reason    TEXT CHECK(cancellation_reason IS NULL OR length(btrim(cancellation_reason)) BETWEEN 1 AND 2000),
  cancelled_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK(ends_at > starts_at),
  CHECK((status='cancelled')=(cancelled_at IS NOT NULL)),
  CHECK((status='cancelled')=(cancellation_reason IS NOT NULL)),
  UNIQUE(workspace_id,idempotency_key),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,sponsor_contact_id)
    REFERENCES entities(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,sponsor_membership_id)
    REFERENCES association_memberships(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,beneficiary_plan_id)
    REFERENCES association_membership_plans(workspace_id,id) ON DELETE RESTRICT
);
CREATE INDEX association_sponsorship_allocations_sponsor
  ON association_sponsorship_allocations(workspace_id,sponsor_contact_id,status,ends_at,id);

ALTER TABLE association_memberships
  ADD COLUMN sponsorship_allocation_id UUID,
  ADD CONSTRAINT association_memberships_sponsorship_allocation
    FOREIGN KEY(workspace_id,sponsorship_allocation_id)
    REFERENCES association_sponsorship_allocations(workspace_id,id) ON DELETE CASCADE;
CREATE INDEX association_memberships_sponsorship
  ON association_memberships(workspace_id,sponsorship_allocation_id,contact_id);
CREATE UNIQUE INDEX association_memberships_one_sponsored_plan
  ON association_memberships(workspace_id,sponsorship_allocation_id,contact_id,plan_id)
  WHERE sponsorship_allocation_id IS NOT NULL AND status IN('pending','active');

CREATE TABLE association_sponsorship_invitations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  allocation_id         UUID NOT NULL,
  nominee_contact_id    UUID NOT NULL,
  token_hash            TEXT NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key       TEXT NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
  request_fingerprint   TEXT NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','redeemed','revoked')),
  expires_at            TIMESTAMPTZ NOT NULL,
  redeemed_contact_id   UUID,
  membership_id         UUID,
  redeemed_at           TIMESTAMPTZ,
  revocation_reason     TEXT CHECK(revocation_reason IS NULL OR length(btrim(revocation_reason)) BETWEEN 1 AND 2000),
  revoked_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((status='redeemed')=(redeemed_at IS NOT NULL)),
  CHECK((status='redeemed')=(redeemed_contact_id IS NOT NULL)),
  CHECK((status='redeemed')=(membership_id IS NOT NULL)),
  CHECK((status='revoked')=(revoked_at IS NOT NULL)),
  CHECK((status='revoked')=(revocation_reason IS NOT NULL)),
  UNIQUE(workspace_id,idempotency_key),
  UNIQUE(workspace_id,token_hash),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,allocation_id)
    REFERENCES association_sponsorship_allocations(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,nominee_contact_id)
    REFERENCES entities(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,redeemed_contact_id)
    REFERENCES entities(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,membership_id)
    REFERENCES association_memberships(workspace_id,id) ON DELETE CASCADE
);
CREATE INDEX association_sponsorship_invitations_allocation
  ON association_sponsorship_invitations(workspace_id,allocation_id,status,expires_at,id);
CREATE INDEX association_sponsorship_invitations_nominee
  ON association_sponsorship_invitations(workspace_id,nominee_contact_id,status,created_at DESC,id DESC);
CREATE UNIQUE INDEX association_sponsorship_one_live_nomination
  ON association_sponsorship_invitations(workspace_id,allocation_id,nominee_contact_id)
  WHERE status IN('pending','redeemed');

CREATE TRIGGER association_sponsorship_allocations_updated_at BEFORE UPDATE ON association_sponsorship_allocations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();
CREATE TRIGGER association_sponsorship_invitations_updated_at BEFORE UPDATE ON association_sponsorship_invitations
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_updated_at();

CREATE FUNCTION association_membership_is_effective(
  membership_workspace_id uuid, membership_id uuid, lifecycle_status text,
  starts_at timestamptz, ends_at timestamptz, instant timestamptz
) RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT crm_entitlement_is_effective(lifecycle_status,starts_at,ends_at,instant)
    AND NOT EXISTS(
      SELECT 1 FROM association_memberships child
      JOIN association_sponsorship_allocations allocation
        ON allocation.workspace_id=child.workspace_id AND allocation.id=child.sponsorship_allocation_id
      JOIN association_memberships sponsor
        ON sponsor.workspace_id=allocation.workspace_id AND sponsor.id=allocation.sponsor_membership_id
      WHERE child.workspace_id=membership_workspace_id AND child.id=membership_id
        AND NOT (
          allocation.status='active' AND allocation.starts_at<=instant AND instant<allocation.ends_at
          AND sponsor.sponsorship_allocation_id IS NULL
          AND crm_entitlement_is_effective(sponsor.status,sponsor.starts_at,sponsor.ends_at,instant)
        )
    )
$$;

ALTER TABLE association_sponsorship_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE association_sponsorship_invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY association_sponsorship_allocations_member ON association_sponsorship_allocations
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY association_sponsorship_invitations_member ON association_sponsorship_invitations
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON association_sponsorship_allocations
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON association_sponsorship_invitations
  FOR EACH ROW EXECUTE FUNCTION public.crm_privacy_guard_write();

SELECT public.crm_install_erasure_capture();
COMMIT;
