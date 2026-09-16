-- A transaction-local custom setting reverts to an empty string after COMMIT
-- when the pooled connection has no session default. Human requests following
-- an agent request therefore see empty JSON scope settings. PostgreSQL may
-- evaluate casts while planning, before sibling AND/OR guards: normalize the
-- input at each cast while preserving the existing authorization predicate.
-- SQL NULL remains absent; JSON null is universe; [] is the General grant.
-- [COMP:api/context-scope-store]

ALTER POLICY saved_views_workspace_member ON public.saved_views
  USING (
    workspace_id IN (
      SELECT wm.workspace_id
        FROM public.workspace_members wm
       WHERE wm.user_id = (current_setting('app.current_user_id', true))::uuid
    )
    AND (
      (teamspace_id IS NULL
        AND created_by = (current_setting('app.current_user_id', true))::uuid)
      OR EXISTS (
        SELECT 1
          FROM public.teamspaces t
         WHERE t.id = saved_views.teamspace_id
           AND (
             (
               t.workspace_group_id IS NULL
               AND (
                 (
                   NULLIF(current_setting('app.agent_clearance', true), '') IS NULL
                   AND EXISTS (
                     SELECT 1 FROM public.teamspace_members tm
                      WHERE tm.teamspace_id = t.id
                        AND tm.user_id = (current_setting('app.current_user_id', true))::uuid
                   )
                 )
                 OR (
                   NULLIF(current_setting('app.agent_clearance', true), '') IS NOT NULL
                   AND public.sensitivity_rank(t.sensitivity)
                       <= public.sensitivity_rank(current_setting('app.agent_clearance', true))
                 )
               )
             )
             OR (
               t.workspace_group_id IS NOT NULL
               AND EXISTS (
                 SELECT 1
                   FROM public.workspace_groups g
                  WHERE g.id = t.workspace_group_id
                    AND (
                      (
                        NULLIF(current_setting('app.agent_clearance', true), '') IS NULL
                        AND (
                        public.effective_member_team_compartments(
                          (current_setting('app.current_user_id', true))::uuid,
                          t.workspace_id
                        ) IS NULL
                        OR ARRAY[g.compartment_key]::text[] <@
                           public.effective_member_team_compartments(
                             (current_setting('app.current_user_id', true))::uuid,
                             t.workspace_id
                           )
                        )
                      )
                      OR (
                        NULLIF(current_setting('app.agent_clearance', true), '') IS NOT NULL
                        AND NULLIF(current_setting('app.agent_compartments', true), '') IS NOT NULL
                        AND public.sensitivity_rank(t.sensitivity)
                            <= public.sensitivity_rank(current_setting('app.agent_clearance', true))
                        AND (
                          NULLIF(current_setting('app.agent_compartments', true), '')::jsonb = 'null'::jsonb
                          OR NULLIF(current_setting('app.agent_compartments', true), '')::jsonb ? g.compartment_key
                        )
                      )
                    )
               )
             )
           )
      )
    )
    AND (
      NULLIF(current_setting('app.agent_clearance', true), '') IS NULL
      OR NULLIF(current_setting('app.agent_project_ids', true), '') IS NULL
      OR NULLIF(current_setting('app.agent_project_ids', true), '')::jsonb = 'null'::jsonb
      OR project_id IS NULL
      OR NULLIF(current_setting('app.agent_project_ids', true), '')::jsonb ? project_id::text
    )
  );
