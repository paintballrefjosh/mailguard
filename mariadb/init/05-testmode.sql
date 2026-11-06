USE mailguard;

INSERT IGNORE INTO settings (category, key_name, value, value_type, description) VALUES
  ('testing', 'test_mode_enabled', 'false', 'boolean', 'Global test mode — log what would happen without blocking'),
  ('testing', 'test_mode_log_only', 'true', 'boolean', 'In test mode, only log matches without taking action');