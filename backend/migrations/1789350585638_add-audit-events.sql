-- Audit log of sensitive actions (roadmap #84).
--
-- Who did what, to which campaign, and when — nothing more. No foreign key to
-- users on purpose: the record that an account was deleted has to outlive the
-- account. And no email and no IP address: once the account is gone, the actor
-- id no longer points at anyone, which is what keeps this table from becoming
-- the personal data a deletion was meant to remove.
--
-- Kept twelve months, then purged with the send logs (roadmap #86).

-- Up Migration

CREATE TABLE audit_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id   uuid        NOT NULL,
  action     text        NOT NULL CHECK (action IN (
               'campaign.started',
               'campaign.paused',
               'campaign.resumed',
               'account.exported',
               'account.deleted'
             )),
  target_id  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One user's history, newest first.
CREATE INDEX audit_events_actor_created_idx ON audit_events (actor_id, created_at DESC);

-- The retention purge scans by age.
CREATE INDEX audit_events_created_idx ON audit_events (created_at);

-- Down Migration

DROP TABLE IF EXISTS audit_events;
