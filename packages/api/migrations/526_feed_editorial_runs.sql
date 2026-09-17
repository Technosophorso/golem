BEGIN;
CREATE TABLE feed_editorial_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL, assistant_id uuid NOT NULL, session_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('review','text_generation','image_generation','confirmation_learning','reconcile')),
  source_revision integer NOT NULL, request_id uuid NOT NULL, fingerprint text NOT NULL,
  logical_key text NOT NULL, request jsonb NOT NULL, context jsonb NOT NULL,
  model text NOT NULL, parent_run_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed','cancelled','unknown_outcome')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  lease_id uuid, lease_until timestamptz, dispatched_part text,
  result jsonb NOT NULL DEFAULT '{"parts":{}}', coverage jsonb NOT NULL DEFAULT '{}',
  usage jsonb NOT NULL DEFAULT '{}', last_error text, summary_thread_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(session_id,id), UNIQUE(session_id,request_id),
  FOREIGN KEY (workspace_id,assistant_id,session_id) REFERENCES sessions(workspace_id,assistant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (session_id,source_revision) REFERENCES feed_post_revisions(session_id,revision) ON DELETE CASCADE,
  FOREIGN KEY (session_id,parent_run_id) REFERENCES feed_editorial_runs(session_id,id),
  FOREIGN KEY (session_id,summary_thread_id) REFERENCES feed_comment_threads(session_id,id)
);
CREATE UNIQUE INDEX feed_editorial_one_active ON feed_editorial_runs(session_id,actor_user_id,kind,logical_key) WHERE status IN ('pending','running');
CREATE INDEX feed_editorial_pending ON feed_editorial_runs(created_at) WHERE status IN ('pending','running');
CREATE INDEX feed_editorial_logical ON feed_editorial_runs(session_id,actor_user_id,kind,logical_key,created_at DESC);
CREATE TABLE feed_review_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL, assistant_id uuid NOT NULL, session_id uuid NOT NULL,
  run_id uuid NOT NULL, finding_key text NOT NULL, issue_key text NOT NULL,
  evidence_hash text NOT NULL, finding jsonb NOT NULL, thread_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id,finding_key),
  FOREIGN KEY(workspace_id,assistant_id,session_id) REFERENCES sessions(workspace_id,assistant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(session_id,run_id) REFERENCES feed_editorial_runs(session_id,id) ON DELETE CASCADE,
  FOREIGN KEY(session_id,thread_id) REFERENCES feed_comment_threads(session_id,id) ON DELETE CASCADE
);
CREATE INDEX feed_review_issue ON feed_review_findings(session_id,issue_key,created_at DESC);
CREATE FUNCTION protect_feed_editorial_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD.workspace_id,OLD.assistant_id,OLD.session_id,OLD.actor_user_id,OLD.kind,OLD.source_revision,OLD.request_id,OLD.fingerprint,OLD.logical_key,OLD.request,OLD.context,OLD.model,OLD.parent_run_id)
    IS DISTINCT FROM
     (NEW.workspace_id,NEW.assistant_id,NEW.session_id,NEW.actor_user_id,NEW.kind,NEW.source_revision,NEW.request_id,NEW.fingerprint,NEW.logical_key,NEW.request,NEW.context,NEW.model,NEW.parent_run_id) THEN
    RAISE EXCEPTION 'Feed editorial request is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feed_editorial_request BEFORE UPDATE ON feed_editorial_runs FOR EACH ROW EXECUTE FUNCTION protect_feed_editorial_request();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['feed_editorial_runs','feed_review_findings'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY feed_member ON %I USING (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=%I.workspace_id AND wm.user_id=nullif(current_setting(''app.current_user_id'',true),'''')::uuid))',t,t);
    EXECUTE format('CREATE TRIGGER feed_scope BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION validate_feed_collaboration_scope()',t);
  END LOOP;
END $$;
COMMIT;
