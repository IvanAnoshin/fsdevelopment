CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages (from_user_id, to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_read_created_at ON messages (to_user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created_at ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_user_created_at ON posts (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_post_created_at ON comments (post_id, created_at DESC);
