BEGIN;
CREATE FUNCTION delete_feed_thread_transcript() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM sessions WHERE id=OLD.transcript_session_id AND channel_type='feed_thread';
  RETURN OLD;
END $$;
CREATE TRIGGER feed_thread_transcript_lifetime AFTER DELETE ON feed_comment_threads
  FOR EACH ROW EXECUTE FUNCTION delete_feed_thread_transcript();
COMMIT;
