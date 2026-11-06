SET NAMES utf8mb4;
SET time_zone = '+00:00';

USE mailguard;

-- Users & Sessions
CREATE TABLE users (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email      VARCHAR(255) NOT NULL UNIQUE,
  password   VARCHAR(255) NOT NULL,
  role       ENUM('admin','viewer') DEFAULT 'viewer',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id         VARCHAR(128) PRIMARY KEY,
  user_id    INT UNSIGNED NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Mail Events Log
CREATE TABLE mail_events (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  received_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  queue_id      VARCHAR(64),
  sender        VARCHAR(512),
  recipient     VARCHAR(512),
  subject       VARCHAR(1024),
  sender_ip     VARCHAR(45),
  sender_domain VARCHAR(255),
  size_bytes    INT UNSIGNED,
  action        ENUM('allow','block','flag','quarantine') NOT NULL,
  reason        VARCHAR(512),
  spam_score    DECIMAL(6,2),
  virus_found   VARCHAR(255),
  spf_result    ENUM('pass','fail','softfail','neutral','none','permerror','temperror'),
  dkim_result   ENUM('pass','fail','none'),
  dmarc_result  ENUM('pass','fail','none'),
  headers       JSON,
  INDEX idx_received (received_at),
  INDEX idx_action (action),
  INDEX idx_sender_ip (sender_ip),
  INDEX idx_sender_domain (sender_domain)
) ENGINE=InnoDB;

-- Blocklists
CREATE TABLE blocklists (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  list_type   ENUM('ip','cidr','domain','email','regex_subject','regex_body','uri') NOT NULL,
  value       VARCHAR(1024) NOT NULL,
  action      ENUM('block','flag','quarantine','allow') DEFAULT 'block',
  comment     VARCHAR(512),
  enabled     BOOLEAN DEFAULT TRUE,
  hits        BIGINT UNSIGNED DEFAULT 0,
  last_hit    TIMESTAMP NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_type_value (list_type, value(128)),
  INDEX idx_enabled (enabled)
);

-- Rules Engine
CREATE TABLE rules (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  description TEXT,
  priority    INT DEFAULT 100,
  conditions  JSON NOT NULL,
  action      ENUM('block','flag','quarantine','allow','tag') NOT NULL,
  tag_value   VARCHAR(255),
  enabled     BOOLEAN DEFAULT TRUE,
  hits        BIGINT UNSIGNED DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_priority (priority),
  INDEX idx_enabled (enabled)
);

-- SURBL / URIBL Configuration
CREATE TABLE surbl_lists (
  id       INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name     VARCHAR(100) NOT NULL,
  zone     VARCHAR(255) NOT NULL,
  enabled  BOOLEAN DEFAULT TRUE,
  weight   DECIMAL(4,1) DEFAULT 1.0
);

-- SPF / DKIM / DMARC Settings
CREATE TABLE auth_settings (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  value       TEXT,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- General Settings
CREATE TABLE settings (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category    VARCHAR(100) NOT NULL,
  key_name    VARCHAR(100) NOT NULL,
  value       TEXT,
  value_type  ENUM('string','integer','boolean','json') DEFAULT 'string',
  description VARCHAR(512),
  UNIQUE KEY uq_cat_key (category, key_name)
);

-- Stats Aggregation (hourly rollups)
CREATE TABLE stats_hourly (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  hour          TIMESTAMP NOT NULL,
  total_msgs    INT UNSIGNED DEFAULT 0,
  allowed       INT UNSIGNED DEFAULT 0,
  blocked       INT UNSIGNED DEFAULT 0,
  flagged       INT UNSIGNED DEFAULT 0,
  quarantined   INT UNSIGNED DEFAULT 0,
  spam_detected INT UNSIGNED DEFAULT 0,
  virus_detected INT UNSIGNED DEFAULT 0,
  spf_fail      INT UNSIGNED DEFAULT 0,
  dkim_fail     INT UNSIGNED DEFAULT 0,
  avg_spam_score DECIMAL(6,2),
  UNIQUE KEY uq_hour (hour)
);

-- Audit Log
CREATE TABLE audit_log (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ts         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  user_id    INT UNSIGNED,
  action     VARCHAR(255) NOT NULL,
  target     VARCHAR(512),
  old_value  JSON,
  new_value  JSON,
  ip_address VARCHAR(45),
  INDEX idx_ts (ts)
);
