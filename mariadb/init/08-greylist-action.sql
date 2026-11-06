USE mailguard;

-- Add greylist as a valid action in mail_events
ALTER TABLE mail_events
  MODIFY COLUMN action ENUM('allow','block','flag','quarantine','greylist') NOT NULL;