ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(32) NOT NULL DEFAULT 'member';
UPDATE users SET role = 'admin' WHERE is_admin = TRUE;
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
