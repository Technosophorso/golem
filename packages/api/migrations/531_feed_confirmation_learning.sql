-- Feed-owned editorial confirmation and references into native learning stores.
BEGIN;
CREATE TABLE feed_post_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL, assistant_id uuid NOT NULL, session_id uuid NOT NULL,
  source_revision integer NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content jsonb NOT NULL, projection jsonb NOT NULL, history jsonb NOT NULL,
  history_cutoff timestamptz NOT NULL DEFAULT clock_timestamp(),
  discussion_sequence bigint NOT NULL CHECK (discussion_sequence>=0),
  scope jsonb NOT NULL, prior_confirmation_id uuid, review_run_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,id), UNIQUE(session_id,source_revision),
  FOREIGN KEY(workspace_id,assistant_id,session_id) REFERENCES sessions(workspace_id,assistant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(session_id,source_revision) REFERENCES feed_post_revisions(session_id,revision) ON DELETE CASCADE,
  FOREIGN KEY(session_id,prior_confirmation_id) REFERENCES feed_post_confirmations(session_id,id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(session_id,review_run_id) REFERENCES feed_editorial_runs(session_id,id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX feed_confirmations_history ON feed_post_confirmations(workspace_id,assistant_id,created_at DESC);
CREATE TRIGGER feed_confirmation_immutable BEFORE UPDATE ON feed_post_confirmations FOR EACH ROW EXECUTE FUNCTION reject_decision_append_only_update();

CREATE TABLE feed_learning_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL, assistant_id uuid NOT NULL, session_id uuid NOT NULL,
  confirmation_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('summary','reflection')),
  memory_id uuid REFERENCES memories(id) ON DELETE SET NULL,
  artifact_refs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(artifact_refs)='array'),
  scope jsonb NOT NULL, coverage jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','succeeded','failed','suppressed')),
  suppression_key text NOT NULL,
  excluded_event_ids uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(confirmation_id,actor_user_id,kind), UNIQUE(suppression_key),
  FOREIGN KEY(workspace_id,assistant_id,session_id) REFERENCES sessions(workspace_id,assistant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(session_id,confirmation_id) REFERENCES feed_post_confirmations(session_id,id) ON DELETE CASCADE
);
CREATE INDEX feed_learning_workspace ON feed_learning_outputs(workspace_id,assistant_id,created_at DESC);
CREATE INDEX feed_learning_excluded ON feed_learning_outputs USING gin(excluded_event_ids);
CREATE FUNCTION protect_feed_learning_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.workspace_id,OLD.assistant_id,OLD.session_id,OLD.confirmation_id,OLD.actor_user_id,OLD.kind,OLD.suppression_key)
    IS DISTINCT FROM
     (NEW.workspace_id,NEW.assistant_id,NEW.session_id,NEW.confirmation_id,NEW.actor_user_id,NEW.kind,NEW.suppression_key) THEN
    RAISE EXCEPTION 'Feed learning identity is immutable' USING ERRCODE='23514';
  END IF;
  IF OLD.memory_id IS NOT NULL AND NEW.memory_id IS NULL THEN NEW.status='suppressed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feed_learning_identity BEFORE UPDATE ON feed_learning_outputs FOR EACH ROW EXECUTE FUNCTION protect_feed_learning_identity();

ALTER TABLE assistant_playbook_rules DROP CONSTRAINT assistant_playbook_rules_applicability_kind_check;
ALTER TABLE assistant_playbook_rules ADD CONSTRAINT assistant_playbook_rules_applicability_kind_check CHECK(applicability_kind IN ('general','email','tool','feed'));
ALTER TABLE assistant_playbook_rules ADD COLUMN feed_scope jsonb,
  ADD COLUMN decision_compartments text[] NOT NULL DEFAULT '{}',
  ADD COLUMN decision_project_ids uuid[] NOT NULL DEFAULT '{}';
CREATE TRIGGER feed_playbook_context BEFORE INSERT OR UPDATE OF assistant_id,decision_compartments,decision_project_ids ON assistant_playbook_rules
  FOR EACH ROW EXECUTE FUNCTION validate_context_scope_arrays('assistant_workspace','decision_compartments','decision_project_ids');

-- Erasing the source draft cannot orphan a readable derived summary. Native
-- rule suppression keys survive retirement; no copied Feed prose enters a log.
CREATE FUNCTION erase_feed_confirmation_artifacts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE brain_row_versions SET before_image=NULL,erased_at=now()
    WHERE primitive='memory' AND row_id IN (SELECT memory_id FROM feed_learning_outputs WHERE confirmation_id=OLD.id) AND erased_at IS NULL;
  DELETE FROM memories WHERE id IN (SELECT memory_id FROM feed_learning_outputs WHERE confirmation_id=OLD.id);
  UPDATE assistant_playbook_rules SET status='retired',updated_at=now()
    WHERE id::text IN (SELECT ref->>'id' FROM feed_learning_outputs o CROSS JOIN LATERAL jsonb_array_elements(o.artifact_refs) ref WHERE o.confirmation_id=OLD.id AND ref->>'kind'='assistant_playbook_rule');
  RETURN OLD;
END $$;
CREATE TRIGGER feed_confirmation_erasure BEFORE DELETE ON feed_post_confirmations FOR EACH ROW EXECUTE FUNCTION erase_feed_confirmation_artifacts();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['feed_post_confirmations','feed_learning_outputs'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY feed_member ON %I USING (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=%I.workspace_id AND wm.user_id=nullif(current_setting(''app.current_user_id'',true),'''')::uuid))',t,t);
    EXECUTE format('CREATE TRIGGER feed_scope BEFORE INSERT OR UPDATE OF workspace_id,assistant_id,session_id ON %I FOR EACH ROW EXECUTE FUNCTION validate_feed_collaboration_scope()',t);
  END LOOP;
END $$;
COMMIT;
