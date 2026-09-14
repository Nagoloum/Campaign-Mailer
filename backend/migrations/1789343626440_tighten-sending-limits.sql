-- Sending limits decided on 14 September 2026.
--
--   * mails_per_day at most 450. Google allows a personal Gmail account 500
--     messages over a rolling 24 hours (support.google.com/mail/answer/22839);
--     450 leaves room for what the user sends by hand. The previous ceiling,
--     1500, was Workspace's, and Workspace support is a post-MVP item.
--   * pause_ms at least 10 seconds, 30 by default. A burst is what gets an
--     account flagged.
--
-- Existing rows are brought inside the new bounds before the constraints are
-- tightened, or the ALTER would fail on them. A campaign paced faster than ten
-- seconds takes the new default, not the floor: the floor is a limit, not a
-- recommendation.

-- Up Migration

UPDATE campaigns SET pause_ms = 30000 WHERE pause_ms < 10000;
UPDATE campaigns SET mails_per_day = 450 WHERE mails_per_day > 450;

ALTER TABLE campaigns DROP CONSTRAINT campaigns_mails_per_day_check;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_mails_per_day_check CHECK (mails_per_day BETWEEN 1 AND 450);

ALTER TABLE campaigns DROP CONSTRAINT campaigns_pause_ms_check;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_pause_ms_check CHECK (pause_ms BETWEEN 10000 AND 600000);

ALTER TABLE campaigns ALTER COLUMN pause_ms SET DEFAULT 30000;

-- Down Migration

-- The constraints and the default go back. The values rewritten above do not:
-- the migration cannot know what they were, and every old value is still valid
-- under the old, wider bounds.
ALTER TABLE campaigns ALTER COLUMN pause_ms SET DEFAULT 3000;

ALTER TABLE campaigns DROP CONSTRAINT campaigns_pause_ms_check;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_pause_ms_check CHECK (pause_ms BETWEEN 1000 AND 600000);

ALTER TABLE campaigns DROP CONSTRAINT campaigns_mails_per_day_check;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_mails_per_day_check CHECK (mails_per_day BETWEEN 1 AND 1500);
