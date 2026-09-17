BEGIN;
CREATE TABLE feed_generation_estimates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL, assistant_id uuid NOT NULL, session_id uuid NOT NULL,
 actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_revision integer NOT NULL, request_id uuid NOT NULL, fingerprint text NOT NULL,
 request jsonb NOT NULL, estimate jsonb NOT NULL, context jsonb NOT NULL,
 expires_at timestamptz NOT NULL, run_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(session_id,id), UNIQUE(session_id,request_id), UNIQUE(run_id),
 FOREIGN KEY(workspace_id,assistant_id,session_id) REFERENCES sessions(workspace_id,assistant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(session_id,source_revision) REFERENCES feed_post_revisions(session_id,revision) ON DELETE CASCADE,
 FOREIGN KEY(session_id,run_id) REFERENCES feed_editorial_runs(session_id,id) ON DELETE CASCADE
);
ALTER TABLE feed_generation_estimates ENABLE ROW LEVEL SECURITY;
CREATE POLICY feed_member ON feed_generation_estimates USING(EXISTS(SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=feed_generation_estimates.workspace_id AND wm.user_id=nullif(current_setting('app.current_user_id',true),'')::uuid));
CREATE TRIGGER feed_scope BEFORE INSERT OR UPDATE OF workspace_id,assistant_id,session_id ON feed_generation_estimates FOR EACH ROW EXECUTE FUNCTION validate_feed_collaboration_scope();
CREATE FUNCTION protect_feed_generation_estimate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(OLD)-'run_id') IS DISTINCT FROM (to_jsonb(NEW)-'run_id') OR (OLD.run_id IS NOT NULL AND OLD.run_id IS DISTINCT FROM NEW.run_id) THEN
  RAISE EXCEPTION 'Feed generation estimate is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER feed_generation_estimate BEFORE UPDATE ON feed_generation_estimates FOR EACH ROW EXECUTE FUNCTION protect_feed_generation_estimate();
ALTER TABLE feed_draft_suggestions ADD COLUMN source_run_id uuid;
ALTER TABLE feed_draft_suggestions ADD FOREIGN KEY(session_id,source_run_id) REFERENCES feed_editorial_runs(session_id,id) ON DELETE CASCADE;
CREATE FUNCTION protect_feed_generation_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.source_run_id IS DISTINCT FROM NEW.source_run_id THEN RAISE EXCEPTION 'Feed generation source is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER feed_generation_source BEFORE UPDATE OF source_run_id ON feed_draft_suggestions FOR EACH ROW EXECUTE FUNCTION protect_feed_generation_source();
CREATE INDEX feed_generation_estimates_draft ON feed_generation_estimates(session_id,created_at DESC);
COMMIT;
