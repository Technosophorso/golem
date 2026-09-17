-- Feed-owned composition history and collaboration. No Page/Office artifacts.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS feed_sessions_scope_key ON sessions(workspace_id, assistant_id, id);
ALTER TABLE feed_post_working_copies ADD COLUMN discussion_sequence bigint NOT NULL DEFAULT 0 CHECK (discussion_sequence >= 0);

CREATE TABLE feed_collaboration_mutations (
  session_id uuid NOT NULL, mutation_id uuid NOT NULL,
  workspace_id uuid NOT NULL, assistant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','assistant')),
  fingerprint text NOT NULL, command_kind text NOT NULL, receipt jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, mutation_id),
  FOREIGN KEY (workspace_id, assistant_id, session_id) REFERENCES sessions(workspace_id, assistant_id, id) ON DELETE CASCADE
);
CREATE TABLE feed_post_revisions (
  session_id uuid NOT NULL, revision integer NOT NULL CHECK (revision > 0),
  workspace_id uuid NOT NULL, assistant_id uuid NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_kind text NOT NULL CHECK (actor_kind IN ('user','assistant')),
  mutation_id uuid, content jsonb NOT NULL, forward_commands jsonb NOT NULL,
  inverse_commands jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, revision),
  FOREIGN KEY (workspace_id, assistant_id, session_id) REFERENCES sessions(workspace_id, assistant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, mutation_id) REFERENCES feed_collaboration_mutations(session_id, mutation_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE feed_comment_threads (
  id uuid PRIMARY KEY, session_id uuid NOT NULL, workspace_id uuid NOT NULL, assistant_id uuid NOT NULL,
  transcript_session_id uuid NOT NULL UNIQUE, anchor jsonb NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('user','assistant')),
  resolved boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, id),
  FOREIGN KEY (workspace_id, assistant_id, session_id) REFERENCES sessions(workspace_id, assistant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, assistant_id, transcript_session_id) REFERENCES sessions(workspace_id, assistant_id, id) ON DELETE CASCADE
);
CREATE TABLE feed_draft_suggestions (
  id uuid PRIMARY KEY, session_id uuid NOT NULL, workspace_id uuid NOT NULL, assistant_id uuid NOT NULL,
  author_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  author_kind text NOT NULL CHECK (author_kind IN ('user','assistant')),
  source_revision integer NOT NULL, edits jsonb NOT NULL, rationale text NOT NULL,
  thread_id uuid, parent_id uuid, source_message_id uuid REFERENCES session_messages(id) ON DELETE SET NULL,
  source_tool_call_id text, application_id uuid REFERENCES decision_applications(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected','deferred','undone','superseded')),
  acceptance_receipt jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, id),
  FOREIGN KEY (workspace_id, assistant_id, session_id) REFERENCES sessions(workspace_id, assistant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (session_id, source_revision) REFERENCES feed_post_revisions(session_id, revision) ON DELETE CASCADE,
  FOREIGN KEY (session_id, thread_id) REFERENCES feed_comment_threads(session_id, id),
  FOREIGN KEY (session_id, parent_id) REFERENCES feed_draft_suggestions(session_id, id)
);
CREATE INDEX feed_mutations_chronology ON feed_collaboration_mutations(workspace_id,session_id,created_at);
CREATE INDEX feed_threads_draft ON feed_comment_threads(session_id,resolved,created_at);
CREATE INDEX feed_suggestions_draft ON feed_draft_suggestions(session_id,status,created_at);
CREATE INDEX feed_revisions_workspace ON feed_post_revisions(workspace_id,assistant_id,created_at);

CREATE FUNCTION validate_feed_collaboration_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sessions s JOIN assistants a ON a.id=s.assistant_id
    WHERE s.id=NEW.session_id AND s.workspace_id=NEW.workspace_id AND s.assistant_id=NEW.assistant_id
      AND s.mode='draft' AND s.channel_type <> 'feed_thread' AND a.workspace_id=NEW.workspace_id
      AND a.kind='app' AND a.app_type='distribution') THEN
    RAISE EXCEPTION 'Feed draft scope mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE FUNCTION validate_feed_thread_transcript() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM sessions WHERE id=NEW.transcript_session_id AND channel_type='feed_thread'
    AND mode IS DISTINCT FROM 'draft' AND workspace_id=NEW.workspace_id AND assistant_id=NEW.assistant_id) THEN
    RAISE EXCEPTION 'Feed transcript scope mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feed_thread_transcript BEFORE INSERT OR UPDATE ON feed_comment_threads FOR EACH ROW EXECUTE FUNCTION validate_feed_thread_transcript();
CREATE FUNCTION prevent_feed_downgrade() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.content->>'schemaVersion'='2' AND (NEW.content->>'schemaVersion') IS DISTINCT FROM '2' THEN
    RAISE EXCEPTION 'Upgraded Feed composition requires typed commands' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feed_no_downgrade BEFORE UPDATE ON feed_post_working_copies FOR EACH ROW EXECUTE FUNCTION prevent_feed_downgrade();
CREATE FUNCTION protect_feed_suggestion_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD)-'status'-'acceptance_receipt'-'source_message_id'-'application_id') IS DISTINCT FROM
     (to_jsonb(NEW)-'status'-'acceptance_receipt'-'source_message_id'-'application_id') THEN
    RAISE EXCEPTION 'Feed proposal source is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feed_suggestion_source BEFORE UPDATE ON feed_draft_suggestions FOR EACH ROW EXECUTE FUNCTION protect_feed_suggestion_source();
CREATE TRIGGER feed_revision_immutable BEFORE UPDATE ON feed_post_revisions FOR EACH ROW EXECUTE FUNCTION reject_decision_append_only_update();
CREATE TRIGGER feed_receipt_immutable BEFORE UPDATE ON feed_collaboration_mutations FOR EACH ROW EXECUTE FUNCTION reject_decision_append_only_update();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['feed_post_revisions','feed_collaboration_mutations','feed_comment_threads','feed_draft_suggestions'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY feed_member ON %I USING (EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id=%I.workspace_id AND wm.user_id=nullif(current_setting(''app.current_user_id'',true),'''')::uuid))',t,t);
    EXECUTE format('CREATE TRIGGER feed_scope BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION validate_feed_collaboration_scope()',t);
  END LOOP;
END $$;
COMMIT;
