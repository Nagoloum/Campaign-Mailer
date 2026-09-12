-- The lease a send job takes on a contact before asking Gmail to send.
--
-- One conditional UPDATE is what stops two workers from sending the same
-- message: whoever sets claimed_at first owns the contact, and the other gets
-- no row back and stops. See docs/send-engine.md.
--
-- The column is nullable and has no default, so an unclaimed contact is
-- distinguishable from one claimed at the epoch.

-- Up Migration

ALTER TABLE contacts ADD COLUMN claimed_at timestamptz;

-- The planner asks for pending contacts whose claim is absent or stale. A
-- partial index keeps that query off the rows it will never look at: sent,
-- failed and ignored contacts are the majority once a campaign has run.
CREATE INDEX contacts_claimable_idx
  ON contacts (campaign_id, claimed_at)
  WHERE status = 'pending';

-- Down Migration

DROP INDEX IF EXISTS contacts_claimable_idx;
ALTER TABLE contacts DROP COLUMN IF EXISTS claimed_at;
