-- Initial schema. Follows section 5 of the specification, with the
-- corrections noted against each object.
--
-- Conventions that differ from the specification, and why:
--   * timestamptz everywhere, never timestamp. A send is scheduled for an hour
--     of the user's day and executed by a worker in another region; a naive
--     timestamp loses the offset and the send drifts.
--   * ON DELETE CASCADE on every foreign key. Phase 6 has to purge an account
--     completely on request, and a cascade is the only version of that which
--     cannot forget a row.
--   * CHECK constraints on the cadence columns. The API validates them too,
--     but the database is the boundary that a future script or a manual UPDATE
--     cannot walk around.

-- Up Migration

CREATE TYPE campaign_status AS ENUM (
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed'
);

CREATE TYPE contact_status AS ENUM (
  'pending',
  'sent',
  'failed',
  'ignored'
);

CREATE TYPE log_event_type AS ENUM (
  'sent',
  'bounce',
  'error',
  'open',
  'click'
);

-- Keeps updated_at honest without the application having to remember.
CREATE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;


CREATE TABLE users (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lowercased by the application; the unique index below is what
  -- actually prevents two accounts differing only in case.
  email                       text        NOT NULL,
  google_id                   text        NOT NULL,
  -- Ciphertext, AES-256-GCM. Never a readable token. See CLAUDE.md.
  google_access_token         text,
  google_refresh_token        text,
  -- Lets the token service refresh before a call fails rather than after.
  google_token_expires_at     timestamptz,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX users_email_key ON users (lower(email));
CREATE UNIQUE INDEX users_google_id_key ON users (google_id);

CREATE TRIGGER users_set_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid            NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name            text            NOT NULL,
  subject         text,
  body_html       text,
  body_text       text,
  -- Object key in the attachment bucket, not a URL. The bucket is private and
  -- the backend reads the file when it builds the message.
  attachment_key  text,
  attachment_name text,
  status          campaign_status NOT NULL DEFAULT 'draft',
  total_contacts  integer         NOT NULL DEFAULT 0 CHECK (total_contacts >= 0),
  sent_count      integer         NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  error_count     integer         NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  -- Below Gmail's own ceiling. The application caps this again at runtime.
  mails_per_day   integer         NOT NULL DEFAULT 46 CHECK (mails_per_day BETWEEN 1 AND 1500),
  start_hour      integer         NOT NULL DEFAULT 9 CHECK (start_hour BETWEEN 0 AND 23),
  -- Sending in a burst is what gets an account flagged, so a floor, not just a
  -- non-negative check.
  pause_ms        integer         NOT NULL DEFAULT 3000 CHECK (pause_ms BETWEEN 1000 AND 600000),
  -- IANA name. The user picks the hour; the worker needs the zone to resolve it.
  timezone        text            NOT NULL DEFAULT 'Europe/Paris',
  created_at      timestamptz     NOT NULL DEFAULT now(),
  updated_at      timestamptz     NOT NULL DEFAULT now(),
  scheduled_at    timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz
);

-- Serves both the dashboard listing and the daily planner, which scans for
-- campaigns in the running state.
CREATE INDEX campaigns_user_id_status_idx ON campaigns (user_id, status);
CREATE INDEX campaigns_status_idx ON campaigns (status) WHERE status IN ('scheduled', 'running');

CREATE TRIGGER campaigns_set_updated_at
  BEFORE UPDATE ON campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   uuid           NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  email         text           NOT NULL,
  company_name  text,
  contact_name  text,
  salutation    text,
  status        contact_status NOT NULL DEFAULT 'pending',
  error_message text,
  -- Survives a retry, so the number of attempts is visible when a send keeps
  -- failing for one address.
  attempts      integer        NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at    timestamptz    NOT NULL DEFAULT now(),
  sent_at       timestamptz,
  opened_at     timestamptz,
  clicked_at    timestamptz
);

-- The same address must not appear twice in one campaign, whatever the case
-- the CSV used. This is the first line of defence against a duplicate send.
CREATE UNIQUE INDEX contacts_campaign_email_key ON contacts (campaign_id, lower(email));

-- The planner's query: the pending contacts of one campaign.
CREATE INDEX contacts_campaign_id_status_idx ON contacts (campaign_id, status);


CREATE TABLE logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid           NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  contact_id  uuid           REFERENCES contacts (id) ON DELETE CASCADE,
  event_type  log_event_type NOT NULL,
  message     text,
  created_at  timestamptz    NOT NULL DEFAULT now()
);

CREATE INDEX logs_campaign_id_created_at_idx ON logs (campaign_id, created_at DESC);
CREATE INDEX logs_contact_id_idx ON logs (contact_id);

-- The send engine's hard guarantee, and the reason this index exists rather
-- than living in application code: at most one 'sent' event per contact, ever.
-- A worker killed mid-campaign and restarted cannot produce a second delivery,
-- because the second insert fails on this constraint before an email is sent.
CREATE UNIQUE INDEX logs_one_sent_per_contact_idx
  ON logs (contact_id)
  WHERE event_type = 'sent';


-- Down Migration

DROP TABLE IF EXISTS logs;
DROP TABLE IF EXISTS contacts;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS users;

DROP FUNCTION IF EXISTS set_updated_at();

DROP TYPE IF EXISTS log_event_type;
DROP TYPE IF EXISTS contact_status;
DROP TYPE IF EXISTS campaign_status;
