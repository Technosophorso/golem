-- Feed evidence owns its derived learning content, including old memory versions.
BEGIN;
CREATE FUNCTION erase_feed_learning_artifacts(p_sessions uuid[]) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rule_ids uuid[]; memory_ids uuid[];
BEGIN
  IF coalesce(cardinality(p_sessions),0)=0 THEN RETURN; END IF;
  SELECT coalesce(array_agg(DISTINCT id),'{}') INTO rule_ids FROM (
    SELECT r.id FROM assistant_playbook_rules r JOIN feed_learning_outputs o
      ON o.artifact_refs @> jsonb_build_array(jsonb_build_object('kind','assistant_playbook_rule','id',r.id::text))
      WHERE o.session_id=ANY(p_sessions)
    UNION SELECT r.id FROM assistant_playbook_rules r JOIN decision_derivations d
      ON d.artifact_kind='assistant_playbook_rule' AND d.artifact_id=r.id::text
      JOIN decision_events e ON e.id=d.decision_event_id WHERE e.session_id=ANY(p_sessions)
  ) affected;
  SELECT coalesce(array_agg(DISTINCT id),'{}') INTO memory_ids FROM (
    SELECT m.id FROM memories m WHERE m.source_session_id=ANY(p_sessions)
      AND (m.tags @> ARRAY['feed-post-decision'] OR m.tags @> ARRAY['feed-editorial-voice'])
    UNION SELECT m.id FROM memories m JOIN decision_derivations d ON d.artifact_kind='memory' AND d.artifact_id=m.id::text
      JOIN decision_events e ON e.id=d.decision_event_id
      WHERE e.session_id=ANY(p_sessions) OR (e.source_kind='assistant_playbook_rule' AND e.source_id=ANY(rule_ids::text[]))
  ) affected;
  -- Native versioned corrections preserve source_session_id, while this also
  -- follows any older version whose latest artifact is a linked voice memory.
  WITH RECURSIVE versions(id) AS (
    SELECT unnest(memory_ids) UNION SELECT m.id FROM memories m JOIN versions v ON m.superseded_by=v.id
  ) SELECT coalesce(array_agg(id),'{}') INTO memory_ids FROM versions;
  UPDATE brain_row_versions SET before_image=NULL,erased_at=now()
    WHERE primitive='memory' AND row_id=ANY(memory_ids) AND erased_at IS NULL;
  DELETE FROM memories WHERE id=ANY(memory_ids);
  UPDATE assistant_playbook_rules SET rule='',rationale=NULL,provenance='{"sourceErased":true}',status='retired',updated_at=now()
    WHERE id=ANY(rule_ids);
  UPDATE feed_learning_outputs SET status='suppressed',coverage='{"sourceErased":true}',updated_at=now()
    WHERE session_id=ANY(p_sessions);
  UPDATE feed_editorial_runs SET result='{"parts":{},"sourceErased":true}',context='{"sourceErased":true}',
      request='{"sourceErased":true}',usage='{}',status='cancelled',lease_id=NULL,lease_until=NULL,
      dispatched_part=NULL,last_error='learning_source_erased',updated_at=now()
    WHERE session_id=ANY(p_sessions) AND kind IN ('confirmation_learning','reconcile');
END $$;
CREATE OR REPLACE FUNCTION erase_feed_confirmation_artifacts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM erase_feed_learning_artifacts(ARRAY[OLD.session_id]);
  RETURN OLD;
END $$;

CREATE FUNCTION erase_feed_learning_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE affected uuid[];
BEGIN
  IF TG_TABLE_NAME='sessions' THEN
    -- Before the session FK cascades destroy the provenance links we traverse.
    IF OLD.mode='draft' AND OLD.channel_type<>'feed_thread' THEN
      PERFORM erase_feed_learning_artifacts(ARRAY[OLD.id]);
    END IF;
    RETURN OLD;
  END IF;
  SELECT coalesce(array_agg(DISTINCT c.session_id),'{}') INTO affected FROM feed_post_confirmations c
    WHERE CASE TG_TABLE_NAME
      WHEN 'session_messages' THEN c.history->'messageIds' ? OLD.id::text
      WHEN 'feed_draft_suggestions' THEN EXISTS(SELECT 1 FROM jsonb_array_elements(c.history->'proposals') p WHERE p->>'id'=OLD.id::text)
      WHEN 'goals' THEN c.history->'goal'->>'id'=OLD.id::text
      WHEN 'workspace_files' THEN c.history->'fileIds' ? OLD.id::text
      WHEN 'decision_events' THEN c.history->'eventIds' ? OLD.id::text
      ELSE false END;
  PERFORM erase_feed_learning_artifacts(affected);
  -- All confirmations in an affected draft can contain the erased history.
  -- Delete the chain together to retain the deferred prior-confirmation FK.
  DELETE FROM feed_post_confirmations WHERE session_id=ANY(affected);
  RETURN OLD;
END $$;
CREATE TRIGGER feed_learning_draft_erasure BEFORE DELETE ON sessions FOR EACH ROW EXECUTE FUNCTION erase_feed_learning_source();
CREATE TRIGGER feed_learning_message_erasure BEFORE DELETE ON session_messages FOR EACH ROW EXECUTE FUNCTION erase_feed_learning_source();
CREATE TRIGGER feed_learning_proposal_erasure BEFORE DELETE ON feed_draft_suggestions FOR EACH ROW EXECUTE FUNCTION erase_feed_learning_source();
CREATE TRIGGER feed_learning_goal_erasure BEFORE DELETE ON goals FOR EACH ROW EXECUTE FUNCTION erase_feed_learning_source();
CREATE TRIGGER feed_learning_file_erasure BEFORE DELETE ON workspace_files FOR EACH ROW EXECUTE FUNCTION erase_feed_learning_source();
CREATE TRIGGER feed_learning_decision_erasure BEFORE DELETE ON decision_events FOR EACH ROW EXECUTE FUNCTION erase_feed_learning_source();
COMMIT;
