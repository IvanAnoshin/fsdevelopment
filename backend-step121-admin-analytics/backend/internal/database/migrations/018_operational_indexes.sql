CREATE INDEX IF NOT EXISTS idx_posts_user_created_at ON posts(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_created_at ON messages(from_user_id, to_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_reverse_conversation_created_at ON messages(to_user_id, from_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_read_created_at ON messages(to_user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created_at ON notifications(user_id, is_read, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status_updated_at ON support_tickets(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_moderation_reports_status_updated_at ON moderation_reports(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_members_community_joined_at ON community_members(community_id, joined_at DESC);
