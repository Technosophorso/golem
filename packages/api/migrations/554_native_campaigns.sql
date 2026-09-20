-- Native Feed campaigns, first-party attribution, and approved broadcasts.
-- [COMP:campaigns/store]
BEGIN;

-- Email is authored through the same open Feed draft and calendar contracts.
-- It is a channel capability, not a social-provider connection.
ALTER TABLE content_planning_drafts
  DROP CONSTRAINT IF EXISTS content_planning_drafts_platform_check,
  ADD CONSTRAINT content_planning_drafts_platform_check
  CHECK (platform IN ('instagram','threads','twitter','xhs','linkedin','email'));
ALTER TABLE content_plan_slots
  DROP CONSTRAINT IF EXISTS content_plan_slots_platform_check,
  ADD CONSTRAINT content_plan_slots_platform_check
  CHECK (platform IN ('instagram','threads','twitter','xhs','linkedin','email'));

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  objective text NOT NULL CHECK(length(objective) BETWEEN 1 AND 5000),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','active','completed','archived')),
  timezone text NOT NULL CHECK(length(timezone) BETWEEN 1 AND 100),
  primary_conversion_kind text NOT NULL CHECK(primary_conversion_kind IN('signup_completed','enquiry_submitted','activation_completed')),
  starts_at timestamptz,
  ends_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  UNIQUE(workspace_id,id),
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at),
  CHECK((state='archived')=(archived_at IS NOT NULL))
);

CREATE TABLE campaign_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK(channel IN('instagram','threads','twitter','xhs','linkedin','email')),
  placement_kind text NOT NULL CHECK(placement_kind IN('body','first_comment','profile','email_body')),
  placement_key text NOT NULL CHECK(placement_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  sending_account_ref uuid,
  approved_revision integer CHECK(approved_revision IS NULL OR approved_revision >= 0),
  publication_reference text CHECK(publication_reference IS NULL OR length(publication_reference) <= 2048),
  published_at timestamptz,
  dispatch_id uuid,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id),
  UNIQUE(campaign_id,session_id,channel,placement_key),
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE CASCADE,
  CHECK((publication_reference IS NULL)=(published_at IS NULL))
);

CREATE TABLE campaign_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  public_id text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text,'-',''),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
  allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(allowed_origins)='array' AND jsonb_array_length(allowed_origins) <= 32),
  conversion_definitions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(conversion_definitions)='array' AND jsonb_array_length(conversion_definitions) <= 32),
  storage_mode text NOT NULL DEFAULT 'none' CHECK(storage_mode IN('none','first_party')),
  cookie_domain text CHECK(cookie_domain IS NULL OR (length(cookie_domain) BETWEEN 1 AND 253 AND cookie_domain !~ '[/:]')),
  site_group_key text CHECK(site_group_key IS NULL OR site_group_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  raw_retention_days integer NOT NULL DEFAULT 90 CHECK(raw_retention_days BETWEEN 1 AND 90),
  aggregate_retention_months integer NOT NULL DEFAULT 13 CHECK(aggregate_retention_months BETWEEN 1 AND 13),
  enabled boolean NOT NULL DEFAULT true,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id)
);

CREATE TABLE campaign_site_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  key_prefix text NOT NULL UNIQUE CHECK(key_prefix ~ '^sk_campaign_[a-zA-Z0-9_-]{8,64}$'),
  secret_hash text NOT NULL CHECK(secret_hash ~ '^[a-f0-9]{64}$'),
  grants text[] NOT NULL DEFAULT ARRAY['conversion:write']::text[] CHECK(cardinality(grants) BETWEEN 1 AND 8),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  revoked_at timestamptz,
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES campaign_sites(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE campaign_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  placement_id uuid NOT NULL,
  public_id text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text,'-',''),
  destination_url text NOT NULL CHECK(length(destination_url) BETWEEN 1 AND 2048 AND destination_url ~ '^https?://'),
  destination_hash text NOT NULL CHECK(destination_hash ~ '^[a-f0-9]{64}$'),
  utm_snapshot jsonb NOT NULL CHECK(jsonb_typeof(utm_snapshot)='object'),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  disabled_at timestamptz,
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,placement_id) REFERENCES campaign_placements(workspace_id,id) ON DELETE CASCADE,
  CHECK((enabled AND disabled_at IS NULL) OR (NOT enabled AND disabled_at IS NOT NULL))
);

CREATE TABLE campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  event_id text NOT NULL CHECK(length(event_id) BETWEEN 20 AND 128),
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK(event_type IN('page_view','cta_clicked','form_started','conversion_hint','redirect_request')),
  evidence_level text NOT NULL CHECK(evidence_level IN('browser_observed','server_trusted','crm_committed')),
  link_id uuid REFERENCES campaign_links(id) ON DELETE SET NULL,
  session_key text CHECK(session_key IS NULL OR session_key ~ '^[a-f0-9]{64}$'),
  visitor_key text CHECK(visitor_key IS NULL OR visitor_key ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  page_path text CHECK(page_path IS NULL OR (length(page_path) BETWEEN 1 AND 500 AND page_path LIKE '/%')),
  referrer_origin text CHECK(referrer_origin IS NULL OR length(referrer_origin) <= 500),
  utm_snapshot jsonb CHECK(utm_snapshot IS NULL OR jsonb_typeof(utm_snapshot)='object'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text) <= 8192),
  is_test boolean NOT NULL DEFAULT false,
  bot_class text NOT NULL CHECK(bot_class IN('known_automated','unknown','observed_browser')),
  classification_version integer NOT NULL CHECK(classification_version > 0),
  expires_at timestamptz NOT NULL,
  UNIQUE(site_id,event_id),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES campaign_sites(workspace_id,id) ON DELETE CASCADE,
  CHECK((session_key IS NULL)=(visitor_key IS NULL))
);

CREATE TABLE campaign_subject_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id uuid,
  session_key text CHECK(session_key IS NULL OR session_key ~ '^[a-f0-9]{64}$'),
  contact_id uuid REFERENCES entities(id) ON DELETE CASCADE,
  application_subject_kind text,
  application_subject_id uuid,
  source text NOT NULL CHECK(source IN('verified_application_identity','committed_crm_intake','authorized_explicit_link')),
  purpose_key text NOT NULL CHECK(purpose_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object'),
  linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  erased_at timestamptz,
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES campaign_sites(workspace_id,id) ON DELETE CASCADE,
  CHECK((contact_id IS NOT NULL)::int + (application_subject_id IS NOT NULL)::int = 1),
  CHECK((application_subject_id IS NULL)=(application_subject_kind IS NULL))
);

CREATE TABLE campaign_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  conversion_kind text NOT NULL CHECK(conversion_kind IN('signup_completed','enquiry_submitted','activation_completed')),
  external_outcome_id text NOT NULL CHECK(length(external_outcome_id) BETWEEN 1 AND 500),
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  occurred_at timestamptz NOT NULL,
  evidence_level text NOT NULL CHECK(evidence_level IN('server_trusted','crm_committed')),
  subject_link_id uuid REFERENCES campaign_subject_links(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES entities(id) ON DELETE SET NULL,
  attribution_snapshot jsonb NOT NULL CHECK(jsonb_typeof(attribution_snapshot)='object'),
  value_minor bigint CHECK(value_minor IS NULL OR value_minor >= 0),
  currency text CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(metadata)='object' AND octet_length(metadata::text) <= 8192),
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,site_id,conversion_kind,external_outcome_id),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES campaign_sites(workspace_id,id) ON DELETE CASCADE,
  CHECK((value_minor IS NULL)=(currency IS NULL))
);

CREATE TABLE campaign_conversion_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  site_id uuid NOT NULL,
  outcome_kind text NOT NULL CHECK(outcome_kind IN('signup_completed','enquiry_submitted','activation_completed')),
  external_outcome_id text NOT NULL CHECK(length(external_outcome_id) BETWEEN 1 AND 500),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','completed','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 20),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text CHECK(last_error IS NULL OR length(last_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,site_id,outcome_kind,external_outcome_id),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,site_id) REFERENCES campaign_sites(workspace_id,id) ON DELETE CASCADE,
  CHECK((state='leased')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE TABLE campaign_email_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL,
  placement_id uuid NOT NULL,
  approved_revision integer NOT NULL CHECK(approved_revision >= 0),
  sender_ref uuid NOT NULL,
  reply_to text CHECK(reply_to IS NULL OR length(reply_to) <= 320),
  purpose_key text NOT NULL CHECK(purpose_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  segment_id uuid NOT NULL,
  segment_version integer NOT NULL CHECK(segment_version > 0),
  audience_snapshot jsonb NOT NULL CHECK(jsonb_typeof(audience_snapshot)='object'),
  content_snapshot jsonb NOT NULL CHECK(jsonb_typeof(content_snapshot)='object'),
  tracking_options jsonb NOT NULL CHECK(jsonb_typeof(tracking_options)='object'),
  authority_snapshot jsonb NOT NULL CHECK(jsonb_typeof(authority_snapshot)='object'),
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','ready','scheduled','sending','paused','completed','cancelled','needs_attention')),
  scheduled_at timestamptz,
  approved_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id),
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,placement_id) REFERENCES campaign_placements(workspace_id,id) ON DELETE CASCADE
);

ALTER TABLE campaign_placements ADD CONSTRAINT campaign_placements_dispatch_fk
  FOREIGN KEY(dispatch_id) REFERENCES campaign_email_dispatches(id) ON DELETE SET NULL;

CREATE TABLE campaign_email_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dispatch_id uuid NOT NULL,
  contact_id uuid NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  email_address text NOT NULL CHECK(length(email_address) BETWEEN 3 AND 320),
  address_hash text NOT NULL CHECK(address_hash ~ '^[a-f0-9]{64}$'),
  personalization_snapshot jsonb NOT NULL CHECK(jsonb_typeof(personalization_snapshot)='object'),
  eligibility_snapshot jsonb NOT NULL CHECK(jsonb_typeof(eligibility_snapshot)='object'),
  delivery_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','suppressed','admitted','accepted','rejected','uncertain','cancelled')),
  exclusion_reason text CHECK(exclusion_reason IS NULL OR length(exclusion_reason) <= 500),
  admitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,id),
  UNIQUE(workspace_id,delivery_id),
  FOREIGN KEY(workspace_id,dispatch_id) REFERENCES campaign_email_dispatches(workspace_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX campaign_email_recipients_one_address
  ON campaign_email_recipients(dispatch_id,lower(email_address));

CREATE TABLE campaign_email_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dispatch_id uuid NOT NULL,
  recipient_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','completed','failed','needs_attention','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 10),
  available_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text CHECK(last_error IS NULL OR length(last_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(workspace_id,recipient_id),
  FOREIGN KEY(workspace_id,dispatch_id) REFERENCES campaign_email_dispatches(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,recipient_id) REFERENCES campaign_email_recipients(workspace_id,id) ON DELETE CASCADE,
  CHECK((state='leased')=(lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);

CREATE TABLE campaign_unsubscribe_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL,
  purpose_key text NOT NULL CHECK(purpose_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  all_marketing boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,recipient_id) REFERENCES campaign_email_recipients(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE campaign_email_link_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL,
  link_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK(token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,recipient_id) REFERENCES campaign_email_recipients(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,link_id) REFERENCES campaign_links(workspace_id,id) ON DELETE CASCADE
);

CREATE TABLE campaign_daily_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  metric_date date NOT NULL,
  campaign_id uuid NOT NULL,
  placement_id uuid,
  link_id uuid,
  site_id uuid,
  conversion_kind text,
  attribution_model text NOT NULL CHECK(attribution_model IN('first_touch','last_touch')),
  is_test boolean NOT NULL DEFAULT false,
  raw_redirect_requests bigint NOT NULL DEFAULT 0 CHECK(raw_redirect_requests >= 0),
  filtered_redirect_requests bigint NOT NULL DEFAULT 0 CHECK(filtered_redirect_requests >= 0),
  page_views bigint NOT NULL DEFAULT 0 CHECK(page_views >= 0),
  sessions bigint CHECK(sessions IS NULL OR sessions >= 0),
  visitors bigint CHECK(visitors IS NULL OR visitors >= 0),
  verified_conversions bigint NOT NULL DEFAULT 0 CHECK(verified_conversions >= 0),
  leads bigint NOT NULL DEFAULT 0 CHECK(leads >= 0),
  deals bigint NOT NULL DEFAULT 0 CHECK(deals >= 0),
  email_accepted bigint NOT NULL DEFAULT 0 CHECK(email_accepted >= 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,campaign_id) REFERENCES campaigns(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,placement_id) REFERENCES campaign_placements(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,link_id) REFERENCES campaign_links(workspace_id,id) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,site_id) REFERENCES campaign_sites(workspace_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX campaign_daily_metrics_dimensions
  ON campaign_daily_metrics(workspace_id,metric_date,campaign_id,
    coalesce(placement_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(link_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(site_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(conversion_kind,''),attribution_model,is_test);

CREATE TABLE campaign_command_receipts (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 8 AND 200),
  request_fingerprint text NOT NULL CHECK(request_fingerprint ~ '^[a-f0-9]{64}$'),
  actor_kind text NOT NULL CHECK(actor_kind IN('user','assistant','brain_key','oauth_token','home_app','workflow','system_job')),
  actor_reference text NOT NULL CHECK(length(actor_reference) BETWEEN 1 AND 500),
  result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(workspace_id,idempotency_key)
);

CREATE INDEX campaign_placements_campaign ON campaign_placements(workspace_id,campaign_id,created_at);
CREATE INDEX campaign_links_reporting ON campaign_links(workspace_id,campaign_id,placement_id,created_at);
CREATE INDEX campaign_events_reporting ON campaign_events(workspace_id,site_id,occurred_at,event_type) WHERE NOT is_test;
CREATE INDEX campaign_events_expiry ON campaign_events(expires_at);
CREATE INDEX campaign_conversions_reporting ON campaign_conversions(workspace_id,occurred_at,conversion_kind) WHERE NOT is_test;
CREATE INDEX campaign_conversion_outbox_due ON campaign_conversion_outbox(available_at,id) WHERE state IN('pending','leased');
CREATE INDEX campaign_email_dispatches_due ON campaign_email_dispatches(scheduled_at,id) WHERE state='scheduled';
CREATE INDEX campaign_email_jobs_due ON campaign_email_jobs(available_at,id) WHERE state IN('pending','leased');
CREATE INDEX campaign_subject_links_contact ON campaign_subject_links(workspace_id,contact_id,linked_at DESC) WHERE contact_id IS NOT NULL AND erased_at IS NULL;

CREATE FUNCTION validate_campaign_placement_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM sessions s JOIN assistants a ON a.id=s.assistant_id
     WHERE s.id=NEW.session_id AND a.workspace_id=NEW.workspace_id
  ) THEN RAISE EXCEPTION 'campaign placement session workspace mismatch' USING ERRCODE='23514';
  END IF;
  IF NEW.channel='email' AND NEW.placement_kind<>'email_body' THEN
    RAISE EXCEPTION 'email placements require email_body' USING ERRCODE='23514';
  END IF;
  IF NEW.channel<>'email' AND NEW.placement_kind='email_body' THEN
    RAISE EXCEPTION 'email_body requires email channel' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_placements_workspace_check BEFORE INSERT OR UPDATE OF workspace_id,session_id,channel,placement_kind ON campaign_placements
  FOR EACH ROW EXECUTE FUNCTION validate_campaign_placement_workspace();

CREATE FUNCTION validate_campaign_entity_workspace() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.contact_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM entities WHERE id=NEW.contact_id AND workspace_id=NEW.workspace_id AND kind='person') THEN
    RAISE EXCEPTION 'campaign contact workspace mismatch' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='campaign_conversions' AND (to_jsonb(NEW)->>'deal_id') IS NOT NULL
    AND NOT EXISTS(SELECT 1 FROM entities WHERE id=(to_jsonb(NEW)->>'deal_id')::uuid AND workspace_id=NEW.workspace_id AND kind='deal') THEN
    RAISE EXCEPTION 'campaign deal workspace mismatch' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_subject_links_entity_check BEFORE INSERT OR UPDATE OF workspace_id,contact_id ON campaign_subject_links
  FOR EACH ROW EXECUTE FUNCTION validate_campaign_entity_workspace();
CREATE TRIGGER campaign_conversions_entity_check BEFORE INSERT OR UPDATE OF workspace_id,contact_id,deal_id ON campaign_conversions
  FOR EACH ROW EXECUTE FUNCTION validate_campaign_entity_workspace();
CREATE TRIGGER campaign_email_recipients_entity_check BEFORE INSERT OR UPDATE OF workspace_id,contact_id ON campaign_email_recipients
  FOR EACH ROW EXECUTE FUNCTION validate_campaign_entity_workspace();

CREATE FUNCTION protect_campaign_link_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.campaign_id,NEW.placement_id,NEW.public_id,NEW.destination_url,NEW.destination_hash,NEW.utm_snapshot,NEW.created_by,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.campaign_id,OLD.placement_id,OLD.public_id,OLD.destination_url,OLD.destination_hash,OLD.utm_snapshot,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'campaign link snapshot is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_links_immutable BEFORE UPDATE ON campaign_links FOR EACH ROW EXECUTE FUNCTION protect_campaign_link_snapshot();

CREATE FUNCTION protect_campaign_event_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'campaign event snapshot is immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER campaign_events_immutable BEFORE UPDATE ON campaign_events FOR EACH ROW EXECUTE FUNCTION protect_campaign_event_snapshot();

CREATE FUNCTION protect_campaign_conversion_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'campaign conversion snapshot is immutable' USING ERRCODE='23514'; END;
$$;
CREATE TRIGGER campaign_conversions_immutable BEFORE UPDATE ON campaign_conversions FOR EACH ROW EXECUTE FUNCTION protect_campaign_conversion_snapshot();

CREATE FUNCTION protect_campaign_dispatch_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.campaign_id,NEW.placement_id,NEW.approved_revision,NEW.sender_ref,NEW.reply_to,NEW.purpose_key,NEW.segment_id,NEW.segment_version,NEW.audience_snapshot,NEW.content_snapshot,NEW.tracking_options,NEW.authority_snapshot,NEW.request_fingerprint,NEW.scheduled_at,NEW.approved_by,NEW.approved_at,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.campaign_id,OLD.placement_id,OLD.approved_revision,OLD.sender_ref,OLD.reply_to,OLD.purpose_key,OLD.segment_id,OLD.segment_version,OLD.audience_snapshot,OLD.content_snapshot,OLD.tracking_options,OLD.authority_snapshot,OLD.request_fingerprint,OLD.scheduled_at,OLD.approved_by,OLD.approved_at,OLD.created_at)
  THEN RAISE EXCEPTION 'campaign dispatch approval snapshot is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_email_dispatches_immutable BEFORE UPDATE ON campaign_email_dispatches FOR EACH ROW EXECUTE FUNCTION protect_campaign_dispatch_snapshot();

CREATE FUNCTION protect_campaign_recipient_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.workspace_id,NEW.dispatch_id,NEW.contact_id,NEW.email_address,NEW.address_hash,NEW.personalization_snapshot,NEW.eligibility_snapshot,NEW.delivery_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.workspace_id,OLD.dispatch_id,OLD.contact_id,OLD.email_address,OLD.address_hash,OLD.personalization_snapshot,OLD.eligibility_snapshot,OLD.delivery_id,OLD.created_at)
  THEN RAISE EXCEPTION 'campaign recipient approval snapshot is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER campaign_email_recipients_immutable BEFORE UPDATE ON campaign_email_recipients FOR EACH ROW EXECUTE FUNCTION protect_campaign_recipient_snapshot();

CREATE FUNCTION invalidate_campaign_email_dispatch_on_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.revision IS DISTINCT FROM OLD.revision THEN
    UPDATE campaign_email_jobs j
       SET state='cancelled',lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
      FROM campaign_email_dispatches d,campaign_placements p
     WHERE p.session_id=NEW.session_id AND p.channel='email' AND p.dispatch_id=d.id
       AND j.dispatch_id=d.id AND j.workspace_id=d.workspace_id
       AND d.approved_revision<>NEW.revision AND d.state IN('ready','scheduled','paused','sending')
       AND j.state IN('pending','leased');
    UPDATE campaign_email_recipients r
       SET state='cancelled',completed_at=clock_timestamp(),updated_at=clock_timestamp()
      FROM campaign_email_dispatches d,campaign_placements p
     WHERE p.session_id=NEW.session_id AND p.channel='email' AND p.dispatch_id=d.id
       AND r.dispatch_id=d.id AND r.workspace_id=d.workspace_id
       AND d.approved_revision<>NEW.revision AND d.state IN('ready','scheduled','paused','sending')
       AND r.state IN('pending','admitted');
    UPDATE campaign_email_dispatches d
       SET state='cancelled',state_changed_at=clock_timestamp(),updated_at=clock_timestamp()
      FROM campaign_placements p
     WHERE p.session_id=NEW.session_id AND p.channel='email' AND p.dispatch_id=d.id
       AND d.approved_revision<>NEW.revision AND d.state IN('ready','scheduled','paused','sending');
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER campaign_email_revision_invalidation
  AFTER UPDATE OF revision ON feed_post_working_copies
  FOR EACH ROW EXECUTE FUNCTION invalidate_campaign_email_dispatch_on_revision();

CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER campaign_placements_updated_at BEFORE UPDATE ON campaign_placements FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER campaign_sites_updated_at BEFORE UPDATE ON campaign_sites FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER campaign_links_updated_at BEFORE UPDATE ON campaign_links FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER campaign_conversion_outbox_updated_at BEFORE UPDATE ON campaign_conversion_outbox FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER campaign_email_dispatches_updated_at BEFORE UPDATE ON campaign_email_dispatches FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER campaign_email_recipients_updated_at BEFORE UPDATE ON campaign_email_recipients FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();
CREATE TRIGGER campaign_email_jobs_updated_at BEFORE UPDATE ON campaign_email_jobs FOR EACH ROW EXECUTE FUNCTION trigger_set_updated_at();

ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_site_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_subject_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_conversion_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_email_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_email_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_email_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_unsubscribe_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_email_link_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_command_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY campaigns_member ON campaigns FOR ALL
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_placements_member ON campaign_placements FOR ALL
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_links_member ON campaign_links FOR ALL
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_sites_read ON campaign_sites FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_sites_admin ON campaign_sites FOR ALL
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid AND role IN('owner','admin')))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid AND role IN('owner','admin')));
CREATE POLICY campaign_site_credentials_admin ON campaign_site_credentials FOR ALL
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid AND role IN('owner','admin')))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid AND role IN('owner','admin')));
CREATE POLICY campaign_events_member_read ON campaign_events FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_subject_links_member ON campaign_subject_links FOR ALL
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid))
  WITH CHECK(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_conversions_member_read ON campaign_conversions FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_conversion_outbox_member_read ON campaign_conversion_outbox FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_email_dispatches_member_read ON campaign_email_dispatches FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_email_recipients_member_read ON campaign_email_recipients FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_email_jobs_member_read ON campaign_email_jobs FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_unsubscribe_tokens_member_read ON campaign_unsubscribe_tokens FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_email_link_tokens_member_read ON campaign_email_link_tokens FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_daily_metrics_member_read ON campaign_daily_metrics FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));
CREATE POLICY campaign_command_receipts_member_read ON campaign_command_receipts FOR SELECT
  USING(workspace_id IN(SELECT workspace_id FROM workspace_members WHERE user_id=current_setting('app.current_user_id',true)::uuid));

-- Campaign writes participate in the same workspace privacy admission lock as
-- CRM. This fences collectors and workers while export/erasure holds the
-- exclusive lock and prevents a leased projection from resurrecting a subject.
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_placements
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_links
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_sites
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_site_credentials
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_events
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_subject_links
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_conversions
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_conversion_outbox
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_email_dispatches
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_email_recipients
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_email_jobs
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_unsubscribe_tokens
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_email_link_tokens
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_daily_metrics
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();
CREATE TRIGGER crm_privacy_write_admission BEFORE INSERT OR UPDATE OR DELETE ON campaign_command_receipts
  FOR EACH ROW EXECUTE FUNCTION crm_privacy_guard_write();

COMMIT;
