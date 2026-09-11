-- Erase raw learning content while retaining immutable reference-only request identity.
BEGIN;
CREATE OR REPLACE FUNCTION erase_feed_learning_artifacts(p_sessions uuid[]) RETURNS void LANGUAGE plpgsql AS $$
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
  UPDATE feed_editorial_runs SET result='{"parts":{},"sourceErased":true}',usage='{}',status='cancelled',lease_id=NULL,lease_until=NULL,
      dispatched_part=NULL,last_error='learning_source_erased',updated_at=now()
    WHERE session_id=ANY(p_sessions) AND kind IN ('confirmation_learning','reconcile');
END $$;
COMMIT;
