ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS idx_messages_edited_at ON messages (edited_at);
