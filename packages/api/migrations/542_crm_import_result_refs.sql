BEGIN;

-- Successful import receipts retain the stable target identifiers required
-- for source-to-target reconciliation. The array is bounded because it is
-- returned through an operator-only CSV endpoint after an import completes.
ALTER TABLE crm_import_rows
  ADD COLUMN result_refs JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE crm_import_rows
  ADD CONSTRAINT crm_import_rows_result_refs_valid CHECK (
    jsonb_typeof(result_refs) = 'array'
    AND pg_column_size(result_refs) <= 65536
  );

COMMIT;
