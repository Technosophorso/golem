BEGIN;
-- Internal capability records. Never exposed through member RLS or a REST read.
CREATE TABLE workflow_channel_questions (
  token text PRIMARY KEY,
  integration_id uuid NOT NULL REFERENCES channel_integrations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  assistant_id uuid NOT NULL REFERENCES assistants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  message_id text,
  question jsonb NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  consumed_at timestamptz,
  answer_message_id text,
  UNIQUE (integration_id, channel_id, message_id)
);
CREATE INDEX workflow_channel_questions_pending ON workflow_channel_questions
  (integration_id, channel_id, user_id) WHERE consumed_at IS NULL;
ALTER TABLE workflow_channel_questions ENABLE ROW LEVEL SECURITY;
COMMIT;
