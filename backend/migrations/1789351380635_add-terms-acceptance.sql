-- Acceptance of the terms and privacy policy (roadmap #83).
--
-- The version a user accepted, and when. A version rather than a boolean, so
-- publishing new terms asks everyone to accept again without touching a row:
-- the stored version simply stops matching the current one.
--
-- The acceptance is also recorded in the audit log, which keeps the proof of
-- when it happened after the column has moved on to a later version.

-- Up Migration

ALTER TABLE users
  ADD COLUMN terms_version     text,
  ADD COLUMN terms_accepted_at timestamptz;

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'campaign.started',
  'campaign.paused',
  'campaign.resumed',
  'account.exported',
  'account.deleted',
  'terms.accepted'
));

-- Down Migration

-- Rows the narrower constraint would refuse go first.
DELETE FROM audit_events WHERE action = 'terms.accepted';

ALTER TABLE audit_events DROP CONSTRAINT audit_events_action_check;
ALTER TABLE audit_events ADD CONSTRAINT audit_events_action_check CHECK (action IN (
  'campaign.started',
  'campaign.paused',
  'campaign.resumed',
  'account.exported',
  'account.deleted'
));

ALTER TABLE users
  DROP COLUMN terms_accepted_at,
  DROP COLUMN terms_version;
