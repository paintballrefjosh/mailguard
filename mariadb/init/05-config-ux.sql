USE mailguard;

INSERT IGNORE INTO settings (category, key_name, value, value_type, description) VALUES
  ('general', 'test_mode_enabled', 'false', 'boolean', 'Global test mode — log what would happen without blocking'),
  ('general', 'test_mode_notify',  'true',  'boolean', 'Add X-MailGuard-TestMode header to messages in test mode');