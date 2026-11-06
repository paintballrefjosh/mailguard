USE mailguard;

INSERT IGNORE INTO settings (category, key_name, value, value_type, description) VALUES
  -- Greylisting
  ('greylist', 'enabled',          'true',  'boolean', 'Enable Postgrey greylisting'),
  ('greylist', 'delay_seconds',    '300',   'integer', 'Seconds to defer first-time senders'),
  ('greylist', 'max_age_days',     '35',    'integer', 'Days to remember whitelisted triples'),
  ('greylist', 'retry_window',     '2',     'integer', 'Hours sender must retry within'),
  ('greylist', 'whitelist_clients','true',  'boolean', 'Use built-in Postgrey client whitelist'),

  -- Rate limiting
  ('ratelimit', 'enabled',                  'true',  'boolean', 'Enable per-IP rate limiting'),
  ('ratelimit', 'max_connections_per_ip',   '10',    'integer', 'Max simultaneous connections per IP'),
  ('ratelimit', 'max_messages_per_ip',      '100',   'integer', 'Max messages per IP per time window'),
  ('ratelimit', 'max_messages_per_sender',  '50',    'integer', 'Max messages per sender per time window'),
  ('ratelimit', 'max_recipients_per_ip',    '200',   'integer', 'Max recipients per IP per time window'),
  ('ratelimit', 'time_window_seconds',      '3600',  'integer', 'Time window in seconds for rate limits'),
  ('ratelimit', 'action',                   'defer', 'string',  'Action when limit hit: defer or reject');