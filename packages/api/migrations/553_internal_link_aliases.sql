BEGIN;

CREATE TABLE workspace_link_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  alias TEXT,
  alias_key TEXT NOT NULL UNIQUE,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT workspace_link_alias_shape CHECK (
    alias IS NULL OR (length(alias) BETWEEN 1 AND 32 AND alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
  ),
  CONSTRAINT workspace_link_alias_key_shape CHECK (alias_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT workspace_link_alias_live_shape CHECK (
    NOT is_current OR (workspace_id IS NOT NULL AND alias IS NOT NULL AND deleted_at IS NULL)
  )
);

CREATE UNIQUE INDEX workspace_link_aliases_one_current_target
  ON workspace_link_aliases(workspace_id)
  WHERE is_current AND workspace_id IS NOT NULL;

CREATE INDEX workspace_link_aliases_target_history
  ON workspace_link_aliases(workspace_id, created_at DESC)
  WHERE workspace_id IS NOT NULL;

CREATE TABLE page_link_aliases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  namespace_workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id UUID REFERENCES saved_views(id) ON DELETE SET NULL,
  alias TEXT,
  alias_key TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  CONSTRAINT page_link_alias_shape CHECK (
    alias IS NULL OR (length(alias) BETWEEN 1 AND 64 AND alias ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
  ),
  CONSTRAINT page_link_alias_key_shape CHECK (alias_key ~ '^[0-9a-f]{64}$'),
  CONSTRAINT page_link_alias_live_shape CHECK (
    NOT is_current OR (page_id IS NOT NULL AND alias IS NOT NULL AND deleted_at IS NULL)
  ),
  UNIQUE(namespace_workspace_id, alias_key)
);

CREATE UNIQUE INDEX page_link_aliases_one_current_target
  ON page_link_aliases(page_id)
  WHERE is_current AND page_id IS NOT NULL;

CREATE INDEX page_link_aliases_target_history
  ON page_link_aliases(page_id, created_at DESC)
  WHERE page_id IS NOT NULL;

CREATE TRIGGER workspace_link_aliases_updated_at
  BEFORE UPDATE ON workspace_link_aliases
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE TRIGGER page_link_aliases_updated_at
  BEFORE UPDATE ON page_link_aliases
  FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

CREATE OR REPLACE FUNCTION enforce_page_link_alias_workspace()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.page_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM saved_views
     WHERE id = NEW.page_id
       AND workspace_id = NEW.namespace_workspace_id
  ) THEN
    RAISE EXCEPTION 'page link alias workspace does not match page workspace'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER page_link_aliases_enforce_workspace
  BEFORE INSERT OR UPDATE OF namespace_workspace_id, page_id ON page_link_aliases
  FOR EACH ROW EXECUTE FUNCTION enforce_page_link_alias_workspace();

CREATE OR REPLACE FUNCTION tombstone_workspace_link_aliases()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE workspace_link_aliases
     SET workspace_id = NULL,
         alias = NULL,
         is_current = false,
         created_by = NULL,
         deleted_at = now()
   WHERE workspace_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE TRIGGER workspaces_tombstone_internal_links
  BEFORE DELETE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION tombstone_workspace_link_aliases();

CREATE OR REPLACE FUNCTION tombstone_page_link_aliases()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE page_link_aliases
     SET page_id = NULL,
         alias = NULL,
         is_current = false,
         created_by = NULL,
         deleted_at = now()
   WHERE page_id = OLD.id;
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER saved_views_tombstone_internal_links_on_delete
  BEFORE DELETE ON saved_views
  FOR EACH ROW EXECUTE FUNCTION tombstone_page_link_aliases();

CREATE TRIGGER saved_views_tombstone_internal_links_on_workspace_move
  BEFORE UPDATE OF workspace_id ON saved_views
  FOR EACH ROW
  WHEN (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id)
  EXECUTE FUNCTION tombstone_page_link_aliases();

ALTER TABLE workspace_link_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_link_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY workspace_link_aliases_member ON workspace_link_aliases
  USING (
    COALESCE(current_setting('app.system_bypass', true), 'true') = 'true'
    OR workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
       WHERE wm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.system_bypass', true), 'true') = 'true'
    OR workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
       WHERE wm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

ALTER TABLE page_link_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE page_link_aliases FORCE ROW LEVEL SECURITY;
CREATE POLICY page_link_aliases_member ON page_link_aliases
  USING (
    COALESCE(current_setting('app.system_bypass', true), 'true') = 'true'
    OR namespace_workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
       WHERE wm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  )
  WITH CHECK (
    COALESCE(current_setting('app.system_bypass', true), 'true') = 'true'
    OR namespace_workspace_id IN (
      SELECT wm.workspace_id FROM workspace_members wm
       WHERE wm.user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

COMMIT;
