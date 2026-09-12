-- Preserve verified membership refunds and disputes for an explicit policy decision.
BEGIN;
ALTER TABLE association_integration_events
  DROP CONSTRAINT association_integration_events_last_error_code_check;
ALTER TABLE association_integration_events
  ADD CONSTRAINT association_integration_events_last_error_code_check CHECK(last_error_code IN(
    'conflict','not_available','invalid_transition','not_authorized','credential_revoked','integration_scope_denied',
    'not_found','idempotency_conflict','invalid_input','transient_failure','processing_failure','attempt_limit','lease_lost',
    'membership_refund_policy_pending','membership_dispute_policy_pending'
  ));
COMMIT;
