BEGIN;
CREATE OR REPLACE FUNCTION protect_feed_suggestion_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD)-'status'-'acceptance_receipt'-'source_message_id'-'application_id') IS DISTINCT FROM
     (to_jsonb(NEW)-'status'-'acceptance_receipt'-'source_message_id'-'application_id') THEN
    RAISE EXCEPTION 'Feed proposal source is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.application_id IS DISTINCT FROM NEW.application_id AND NOT
    (NEW.application_id IS NULL AND NOT EXISTS(SELECT 1 FROM decision_applications WHERE id=OLD.application_id)) THEN
    RAISE EXCEPTION 'Feed proposal application source is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.source_message_id IS DISTINCT FROM NEW.source_message_id AND NOT
    (NEW.source_message_id IS NULL AND NOT EXISTS(SELECT 1 FROM session_messages WHERE id=OLD.source_message_id)) THEN
    RAISE EXCEPTION 'Feed proposal message source is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
COMMIT;
