-- Immutable provider refund/dispute evidence and bounded order summaries. [COMP:crm/association-finance]
BEGIN;

ALTER TABLE association_orders
  ADD COLUMN refunded_minor bigint NOT NULL DEFAULT 0 CHECK(refunded_minor>=0 AND refunded_minor<=total_minor),
  ADD COLUMN refund_state text NOT NULL DEFAULT 'none'
    CHECK(refund_state IN('none','pending','partial','partial_pending','partial_failed','full','failed')),
  ADD COLUMN dispute_state text NOT NULL DEFAULT 'none'
    CHECK(dispute_state IN('none','open','won','lost','mixed'));

UPDATE association_orders SET refunded_minor=total_minor,refund_state='full' WHERE status='refunded';

ALTER TABLE association_provider_events
  ADD COLUMN event_kind text NOT NULL DEFAULT 'settlement'
    CHECK(event_kind IN('settlement','refund','dispute')),
  ADD COLUMN provider_adjustment_reference text
    CHECK(provider_adjustment_reference IS NULL OR length(provider_adjustment_reference) BETWEEN 1 AND 500),
  ADD COLUMN financial_status text
    CHECK(financial_status IS NULL OR financial_status IN('pending','succeeded','failed','cancelled','open','won','lost','prevented')),
  ADD COLUMN financial_amount_minor bigint CHECK(financial_amount_minor IS NULL OR financial_amount_minor>0),
  ADD COLUMN financial_currency text CHECK(financial_currency IS NULL OR financial_currency ~ '^[A-Z]{3}$');

ALTER TABLE association_provider_events ALTER COLUMN target_status DROP NOT NULL;
ALTER TABLE association_provider_events DROP CONSTRAINT association_provider_events_target_status_check;
ALTER TABLE association_provider_events ADD CONSTRAINT association_provider_events_kind_shape CHECK(
  (event_kind='settlement' AND target_status IN('paid','failed','cancelled','refunded')
    AND provider_adjustment_reference IS NULL AND financial_status IS NULL
    AND financial_amount_minor IS NULL AND financial_currency IS NULL)
  OR
  (event_kind='refund' AND target_status IS NULL AND provider_adjustment_reference IS NOT NULL
    AND financial_status IN('pending','succeeded','failed','cancelled')
    AND financial_amount_minor IS NOT NULL AND financial_currency IS NOT NULL)
  OR
  (event_kind='dispute' AND target_status IS NULL AND provider_adjustment_reference IS NOT NULL
    AND financial_status IN('open','won','lost','prevented')
    AND financial_amount_minor IS NOT NULL AND financial_currency IS NOT NULL)
);

CREATE INDEX association_provider_financial_objects
  ON association_provider_events(workspace_id,order_id,event_kind,provider_adjustment_reference,occurred_at DESC,created_at DESC,id DESC)
  WHERE event_kind IN('refund','dispute');

COMMIT;
