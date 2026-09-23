-- Revocable account/device authentication sessions.
-- [COMP:api/auth-sessions]
BEGIN;

ALTER TABLE users
  ADD COLUMN auth_version integer NOT NULL DEFAULT 0
  CHECK (auth_version >= 0);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_version integer NOT NULL CHECK (auth_version >= 0),
  device_label text NOT NULL CHECK (length(device_label) BETWEEN 1 AND 160),
  user_agent text CHECK (user_agent IS NULL OR length(user_agent) <= 1024),
  last_ip text CHECK (last_ip IS NULL OR length(last_ip) <= 128),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL DEFAULT (clock_timestamp() + interval '30 days'),
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);

CREATE INDEX auth_sessions_user_live
  ON auth_sessions (user_id, last_seen_at DESC, id)
  WHERE revoked_at IS NULL;

ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_sessions_own ON auth_sessions
  USING (
    user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  )
  WITH CHECK (
    user_id = nullif(current_setting('app.current_user_id', true), '')::uuid
  );

COMMIT;
