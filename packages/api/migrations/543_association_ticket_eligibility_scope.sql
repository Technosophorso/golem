-- Make restricted-ticket admission explicit and retain the exact membership
-- evidence used for every attendee-level decision.

BEGIN;

ALTER TABLE association_ticket_types
  ADD COLUMN eligibility_required BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN eligibility_scope TEXT NOT NULL DEFAULT 'buyer'
    CHECK (eligibility_scope IN ('buyer','attendees','buyer_and_attendees')),
  ADD CONSTRAINT association_ticket_required_eligibility_has_plans
    CHECK (NOT eligibility_required OR cardinality(eligible_plan_keys) > 0),
  ADD CONSTRAINT association_ticket_attendee_eligibility_has_plans
    CHECK (eligibility_scope = 'buyer' OR cardinality(eligible_plan_keys) > 0);

UPDATE association_ticket_types
   SET eligibility_required = TRUE
 WHERE cardinality(eligible_plan_keys) > 0;

ALTER TABLE association_registrations
  ADD COLUMN eligible_membership_id UUID,
  ADD CONSTRAINT association_registrations_eligible_membership_fkey
    FOREIGN KEY (workspace_id, eligible_membership_id)
    REFERENCES association_memberships(workspace_id, id) ON DELETE RESTRICT;

CREATE INDEX association_registrations_eligible_membership
  ON association_registrations(workspace_id, eligible_membership_id)
  WHERE eligible_membership_id IS NOT NULL;

COMMIT;
