USE mailguard;

-- Alert log
CREATE TABLE IF NOT EXISTS alert_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  alert_type  VARCHAR(64) NOT NULL,
  message     TEXT NOT NULL,
  severity    ENUM('info','warning','critical') DEFAULT 'warning',
  acknowledged BOOLEAN DEFAULT FALSE,
  INDEX idx_created (created_at),
  INDEX idx_type (alert_type)
);

-- Reports cache (latest daily/weekly stored for dashboard display)
CREATE TABLE IF NOT EXISTS reports (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  period       ENUM('daily','weekly') NOT NULL,
  data         LONGTEXT NOT NULL,
  generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_period (period)
);

-- Alert settings defaults
INSERT IGNORE INTO settings (category, key_name, value, value_type, description) VALUES
  ('alerts', 'virus_enabled',       'true',  'boolean', 'Alert on virus detection'),
  ('alerts', 'spam_spike_enabled',  'true',  'boolean', 'Alert on spam score spike'),
  ('alerts', 'spam_spike_score',    '8.0',   'string',  'Spam score threshold for spike alert'),
  ('alerts', 'spam_spike_count',    '5',     'integer', 'Number of high-score messages to trigger spike alert'),
  ('alerts', 'ip_block_enabled',    'true',  'boolean', 'Alert on high block rate from single IP'),
  ('alerts', 'ip_block_count',      '20',    'integer', 'Block count threshold per window'),
  ('alerts', 'ip_block_window_min', '10',    'integer', 'Block rate window in minutes'),
  ('alerts', 'auth_fail_enabled',   'true',  'boolean', 'Alert on SPF/DKIM/DMARC failure spike'),
  ('alerts', 'auth_fail_count',     '10',    'integer', 'Auth failure count threshold'),
  ('alerts', 'queue_enabled',       'true',  'boolean', 'Alert on queue backlog'),
  ('alerts', 'queue_depth',         '100',   'integer', 'Queue depth threshold'),
  ('alerts', 'alert_email',         '',      'string',  'Email address for alert notifications');

-- Add geo columns to mail_events if not present
ALTER TABLE mail_events
  ADD COLUMN IF NOT EXISTS country_code VARCHAR(2)   NULL AFTER dmarc_result,
  ADD COLUMN IF NOT EXISTS country_name VARCHAR(100) NULL AFTER country_code,
  ADD COLUMN IF NOT EXISTS city         VARCHAR(100) NULL AFTER country_name,
  ADD COLUMN IF NOT EXISTS latitude     DECIMAL(9,6) NULL AFTER city,
  ADD COLUMN IF NOT EXISTS longitude    DECIMAL(9,6) NULL AFTER latitude;