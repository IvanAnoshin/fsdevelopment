ALTER TABLE users ADD COLUMN IF NOT EXISTS security_question VARCHAR(255);
UPDATE users SET security_question = 'Мой секрет, который я не выдам никому' WHERE security_answer_hash IS NOT NULL AND security_answer_hash <> '' AND (security_question IS NULL OR security_question = '');

CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_last_used ON trusted_devices(user_id, last_used DESC);
CREATE INDEX IF NOT EXISTS idx_trusted_devices_user_device ON trusted_devices(user_id, device_id);
