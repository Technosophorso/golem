-- Let the application registry admit future optional modules without another
-- storage migration. Runtime routes still reject keys absent from that registry.
BEGIN;

ALTER TABLE workspace_modules
  DROP CONSTRAINT workspace_modules_module_key_check;

ALTER TABLE workspace_modules
  ADD CONSTRAINT workspace_modules_module_key_check
  CHECK (module_key ~ '^[a-z][a-z0-9_-]{0,62}$');

COMMIT;
