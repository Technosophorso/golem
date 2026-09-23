-- Exact release and revocation-aware shared authoring, without source declassification.
BEGIN;
ALTER TABLE feed_post_working_copies ADD COLUMN public_release jsonb;

-- A shared draft becomes unavailable if its current audience cannot read its
-- accumulated source footprint. Reuse at reads as well as write boundaries.
CREATE FUNCTION feed_draft_audience_allowed(draft_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM feed_post_working_copies w JOIN sessions s ON s.id=w.session_id
    WHERE (w.session_id=draft_id OR w.session_id IN(SELECT session_id FROM feed_comment_threads WHERE transcript_session_id=draft_id)) AND (
      EXISTS (SELECT 1 FROM workspace_members v WHERE v.workspace_id=s.workspace_id AND (
        sensitivity_rank(v.clearance)<sensitivity_rank(COALESCE(w.content->>'sourceSensitivity','public'))
        OR (effective_member_team_compartments(v.user_id,v.workspace_id) IS NOT NULL AND NOT
          ARRAY(SELECT jsonb_array_elements_text(COALESCE(w.content->'sourceCompartments','[]'::jsonb)))
          <@ effective_member_team_compartments(v.user_id,v.workspace_id))
      )) OR EXISTS (
        SELECT 1 FROM (
          SELECT 'file' AS kind,jsonb_array_elements_text(COALESCE(w.content->'sourceFileIds','[]'::jsonb)) AS id
          UNION ALL SELECT 'memory',jsonb_array_elements_text(COALESCE(w.content->'sourceMemoryIds','[]'::jsonb))
        ) refs WHERE NOT EXISTS (
          SELECT 1 FROM (
            SELECT 'file' AS kind,id,workspace_id,user_id,assistant_id,sensitivity,compartments,project_ids,valid_to,retracted_at FROM workspace_files
            UNION ALL SELECT 'memory',id,workspace_id,user_id,assistant_id,sensitivity,compartments,project_ids,valid_to,retracted_at FROM memories
          ) src WHERE src.kind=refs.kind AND src.id=refs.id::uuid AND src.workspace_id=s.workspace_id
            AND src.valid_to IS NULL AND src.retracted_at IS NULL
            AND sensitivity_rank(src.sensitivity)<=sensitivity_rank(COALESCE(w.content->>'sourceSensitivity','public'))
            AND src.compartments <@ ARRAY(SELECT jsonb_array_elements_text(COALESCE(w.content->'sourceCompartments','[]'::jsonb)))
            AND (src.assistant_id IS NULL OR src.assistant_id=s.assistant_id)
            AND NOT EXISTS(SELECT 1 FROM unnest(src.compartments) c WHERE c LIKE 'client:%')
            AND (s.context_project_id IS NULL OR src.project_ids <@ ARRAY[s.context_project_id])
            AND NOT EXISTS(SELECT 1 FROM workspace_members v WHERE v.workspace_id=s.workspace_id AND (
              (src.user_id IS NOT NULL AND src.user_id<>v.user_id)
              OR sensitivity_rank(src.sensitivity)>sensitivity_rank(v.clearance)
              OR (effective_member_team_compartments(v.user_id,v.workspace_id) IS NOT NULL AND
                NOT src.compartments <@ effective_member_team_compartments(v.user_id,v.workspace_id))
            ))
        )
      )
    )
  );
$$;
COMMIT;
