ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id BIGINT NULL;
CREATE INDEX IF NOT EXISTS idx_comments_parent_id ON comments(parent_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_parent_created_at ON comments(post_id, parent_id, created_at ASC);
