-- An index on the time of each log row (roadmap #94).
--
-- Two readers filter logs by time across every campaign: the send error rate
-- alert, every fifteen minutes over the last hour, and the daily retention
-- purge, over everything past twelve months. The existing index leads with the
-- campaign, so neither could use it, and both would scan a table that keeps a
-- year of sends.

-- Up Migration

CREATE INDEX logs_created_at_idx ON logs (created_at);

-- Down Migration

DROP INDEX logs_created_at_idx;
