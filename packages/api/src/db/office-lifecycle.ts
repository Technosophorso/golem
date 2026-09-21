/** Shared retention statement. Linked template drafts follow their registry,
 * never an independent purge clock. [COMP:api/office-store] */
export const OFFICE_LIFECYCLE_SWEEP_SQL = `
  WITH linked_drafts AS MATERIALIZED (
    SELECT d.* FROM office_artifacts d JOIN office_templates t ON t.draft_artifact_id=d.id
    WHERE t.lifecycle_state IN ('trash','retained')
      AND d.workspace_id=t.workspace_id AND d.mode='template'
    FOR UPDATE OF d
  ), advanced_artifacts AS (
    UPDATE office_artifacts a SET
      lifecycle_state=CASE WHEN lifecycle_state='trash' THEN 'retained' ELSE 'purged' END,
      updated_at=now()
    WHERE legal_hold=FALSE
      AND NOT EXISTS (SELECT 1 FROM office_templates t WHERE t.draft_artifact_id=a.id)
      AND (
      (lifecycle_state='trash' AND retain_at <= now()) OR
      (lifecycle_state='retained' AND purge_at <= now())
    )
    RETURNING id,workspace_id,head_version,lifecycle_state
  ), revoked AS (
    UPDATE office_offline_packages p SET revoked_at=now(),complete=FALSE,updated_at=now()
     FROM advanced_artifacts a WHERE p.artifact_id=a.id AND a.lifecycle_state='purged' AND p.revoked_at IS NULL
  ), artifact_audit AS (
    INSERT INTO office_audit_events(workspace_id,artifact_id,event_type,artifact_version,reason)
    SELECT workspace_id,id,'office.lifecycle.'||lifecycle_state,head_version,'Retention clock elapsed' FROM advanced_artifacts
  ), advanced_templates AS (
    UPDATE office_templates t SET
      lifecycle_state=CASE WHEN lifecycle_state='trash' THEN 'retained' ELSE 'purged' END,
      updated_at=now()
    WHERE legal_hold=FALSE
      AND (t.draft_artifact_id IS NULL OR EXISTS (
        SELECT 1 FROM linked_drafts d WHERE d.id=t.draft_artifact_id
          AND d.workspace_id=t.workspace_id AND d.mode='template'
          AND d.legal_hold=FALSE AND d.lifecycle_state <> 'purged'
      )) AND (
      (lifecycle_state='trash' AND retain_at <= now()) OR
      (lifecycle_state='retained' AND purge_at <= now() AND NOT EXISTS (
        SELECT 1 FROM office_artifacts a JOIN office_template_versions v ON v.id=a.template_version_id
         WHERE v.template_id=t.id AND a.lifecycle_state <> 'purged'
      ))
    )
    RETURNING *
  ), advanced_drafts AS (
    UPDATE office_artifacts a SET
      lifecycle_state=t.lifecycle_state, trashed_at=t.trashed_at,
      retain_at=t.retain_at,purge_at=t.purge_at,updated_at=now()
    FROM advanced_templates t WHERE a.id=t.draft_artifact_id
      AND a.workspace_id=t.workspace_id AND a.mode='template'
    RETURNING a.*
  ), revoked_drafts AS (
    UPDATE office_offline_packages p SET revoked_at=now(),complete=FALSE,updated_at=now()
    FROM advanced_drafts a WHERE p.artifact_id=a.id AND a.lifecycle_state='purged' AND p.revoked_at IS NULL
  ), draft_audit AS (
    INSERT INTO office_audit_events(workspace_id,artifact_id,event_type,artifact_version,reason)
    SELECT workspace_id,id,'office.lifecycle.'||lifecycle_state,head_version,'Template retention clock elapsed' FROM advanced_drafts
  ), template_audit AS (
    INSERT INTO office_audit_events(workspace_id,event_type,reason,metadata)
    SELECT workspace_id,'office.template.lifecycle.'||lifecycle_state,'Retention clock elapsed',jsonb_build_object('templateId',id) FROM advanced_templates
  )
  SELECT (SELECT count(*) FROM advanced_artifacts)+(SELECT count(*) FROM advanced_templates) AS advanced
`
