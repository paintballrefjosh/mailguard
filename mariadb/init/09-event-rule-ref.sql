USE mailguard;

-- Which blocklist entry / compound rule produced an event, so the UI can link
-- from the event detail straight to it. rule_source: 'blocklist' -> blocklists.id,
-- 'rule' -> rules.id. NULL for events with no matched rule (and legacy rows).
ALTER TABLE mail_events
  ADD COLUMN rule_id     INT UNSIGNED NULL AFTER reason,
  ADD COLUMN rule_source ENUM('blocklist','rule') NULL AFTER rule_id;
