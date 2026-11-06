USE mailguard;

-- Spam & virus action settings
INSERT IGNORE INTO settings (category, key_name, value, value_type, description) VALUES
  ('spam', 'virus_action',          'quarantine', 'string',  'Action on virus detection: block, quarantine, flag, allow'),
  ('spam', 'spam_action',           'flag',       'string',  'Action on spam above kill score: block, quarantine, flag, allow'),
  ('spam', 'sa_required_score',     '5.0',        'string',  'SpamAssassin required score'),
  ('spam', 'sa_tag_score',          '2.0',        'string',  'Add spam headers above this score'),
  ('spam', 'score_threshold_flag',  '5.0',        'string',  'Flag messages above this score'),
  ('spam', 'score_threshold_block', '10.0',       'string',  'Block/kill messages above this score'),
  ('spam', 'banned_files_action',   'block',      'string',  'Action on banned file attachments');

-- Header analysis rule settings
INSERT IGNORE INTO settings (category, key_name, value, value_type, description) VALUES
  ('header_rules', 'check_reply_to_mismatch',   'true',  'boolean', 'Flag mismatched Reply-To/From domains'),
  ('header_rules', 'check_display_name_spoof',  'true',  'boolean', 'Flag display name spoofing your domain'),
  ('header_rules', 'check_suspicious_mailer',   'false', 'boolean', 'Flag suspicious X-Mailer headers'),
  ('header_rules', 'check_missing_mid',         'true',  'boolean', 'Flag missing Message-ID header'),
  ('header_rules', 'check_lookalike_domains',   'true',  'boolean', 'Flag lookalike domain names in From');

-- Bayesian training log
CREATE TABLE IF NOT EXISTS bayes_training_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  trained_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  queue_id    VARCHAR(64),
  sender      VARCHAR(512),
  subject     VARCHAR(1024),
  train_type  ENUM('spam','ham') NOT NULL,
  trained_by  VARCHAR(255),
  INDEX idx_trained (trained_at)
);