-- Retire the removed Google Tasks connector surface.
-- [COMP:api/mcp-inject]
BEGIN;

DELETE FROM session_resume_points
WHERE suspended_tool_name LIKE 'googleTasks%';

UPDATE pending_approvals
SET status = 'expired',
    responded_at = COALESCE(responded_at, now())
WHERE status = 'pending'
  AND tool_name LIKE 'googleTasks%';

DELETE FROM mcp_tool_settings
WHERE tool_name LIKE 'googleTasks%';

DELETE FROM workspace_tool_policy
WHERE tool_name LIKE 'googleTasks%';

UPDATE assistant_connector_grants
SET allowed_actions = ARRAY(
      SELECT action
      FROM unnest(allowed_actions) AS action
      WHERE action NOT LIKE 'googleTasks%'
    ),
    updated_at = now()
WHERE EXISTS (
  SELECT 1
  FROM unnest(allowed_actions) AS action
  WHERE action LIKE 'googleTasks%'
);

COMMIT;
