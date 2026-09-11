BEGIN;
-- A row hidden by RLS still exists. Immutable provenance may only be nulled by
-- actual FK erasure, so this existence guard must see the referenced row.
ALTER FUNCTION protect_feed_suggestion_source() SECURITY DEFINER;
ALTER FUNCTION protect_feed_suggestion_source() SET search_path = public;
COMMIT;
