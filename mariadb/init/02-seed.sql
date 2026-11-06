USE mailguard;

-- Default SURBL lists
INSERT INTO surbl_lists (name, zone, enabled, weight) VALUES
  ('SURBL Multi',   'multi.surbl.org',    TRUE, 2.0),
  ('URIBL Black',   'black.uribl.com',    TRUE, 3.0),
  ('URIBL Grey',    'grey.uribl.com',     TRUE, 1.0),
  ('URIBL Red',     'red.uribl.com',      TRUE, 1.5),
  ('DBL Spamhaus',  'dbl.spamhaus.org',   TRUE, 2.5),
  ('IVMURI',        'uribl.swinog.ch',    FALSE, 1.0);

-- Default auth settings
INSERT INTO auth_settings (setting_key, value) VALUES
  ('spf_enabled',        'true'),
  ('spf_reject_fail',    'true'),
  ('spf_reject_softfail','false'),
  ('dkim_enabled',       'true'),
  ('dkim_reject_fail',   'false'),
  ('dmarc_enabled',      'true'),
  ('dmarc_reject_fail',  'false'),
  ('rdns_check',         'true'),
  ('rdns_reject',        'false'),
  ('helo_check',         'true'),
  ('helo_reject',        'false');

-- Default settings
INSERT INTO settings (category, key_name, value, value_type, description) VALUES
  ('spam', 'score_threshold_flag',       '5.0',  'string',  'Spam score to flag message'),
  ('spam', 'score_threshold_block',      '10.0', 'string',  'Spam score to block message'),
  ('spam', 'score_threshold_quarantine', '7.5',  'string',  'Spam score to quarantine'),
  ('spam', 'sa_required_score',          '5.0',  'string',  'SpamAssassin required score'),
  ('spam', 'sa_rewrite_header',          'true', 'boolean', 'Rewrite subject with spam flag'),
  ('virus','clamav_enabled',             'true', 'boolean', 'Enable ClamAV scanning'),
  ('virus','block_on_virus',             'true', 'boolean', 'Block messages with viruses'),
  ('virus','block_encrypted_archives',   'false','boolean', 'Block password-protected archives'),
  ('smtp', 'max_message_size_mb',        '25',   'integer', 'Max message size in MB'),
  ('smtp', 'rate_limit_per_ip',          '100',  'integer', 'Max messages/hour per IP'),
  ('smtp', 'greylist_enabled',           'true', 'boolean', 'Enable greylisting'),
  ('smtp', 'greylist_delay_seconds',     '300',  'integer', 'Greylist hold time in seconds'),
  ('ui',   'rows_per_page',              '50',   'integer', 'Dashboard rows per page'),
  ('ui',   'theme',                      'dark', 'string',  'UI theme');

-- Default rules
INSERT INTO rules (name, description, priority, conditions, action, enabled) VALUES
  ('Block Executable Attachments', 'Block emails with dangerous attachment types',
   10,
   '{"attachment_ext": [".exe",".bat",".cmd",".ps1",".vbs",".js",".jar",".msi"]}',
   'block', TRUE),
  ('Flag High Spam Score', 'Flag messages with elevated spam scores',
   20,
   '{"spam_score_gte": 5.0}',
   'flag', TRUE),
  ('Block Very High Spam', 'Block messages with very high spam scores',
   15,
   '{"spam_score_gte": 10.0}',
   'block', TRUE),
  ('Quarantine Virus', 'Quarantine any message with a detected virus',
   5,
   '{"virus_detected": true}',
   'quarantine', TRUE),
  ('Allow Internal IPs', 'Allow all messages from internal network',
   1,
   '{"sender_ip_cidr": ["10.0.0.0/8","172.16.0.0/12","192.168.0.0/16"]}',
   'allow', TRUE);

-- No blocklist entries are seeded: a fresh install starts with empty blocklists.
