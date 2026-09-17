BEGIN;
-- Scope is revalidated whenever its identity changes. A foreign-key SET NULL
-- during workspace erasure must not require the parent being erased to live.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['feed_post_revisions','feed_collaboration_mutations',
    'feed_comment_threads','feed_draft_suggestions','feed_editorial_runs','feed_review_findings'] LOOP
    EXECUTE format('DROP TRIGGER feed_scope ON %I',t);
    EXECUTE format('CREATE TRIGGER feed_scope BEFORE INSERT OR UPDATE OF workspace_id,assistant_id,session_id ON %I FOR EACH ROW EXECUTE FUNCTION validate_feed_collaboration_scope()',t);
  END LOOP;
END $$;
COMMIT;
