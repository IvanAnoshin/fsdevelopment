ALTER TABLE comments ADD COLUMN IF NOT EXISTS likes INTEGER NOT NULL DEFAULT 0;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS dislikes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS comment_votes (
  id BIGSERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  comment_id BIGINT NOT NULL,
  value INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_comment_vote ON comment_votes(user_id, comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_votes_comment_id ON comment_votes(comment_id);
CREATE INDEX IF NOT EXISTS idx_comments_post_parent_created_at_desc ON comments(post_id, parent_id, created_at DESC);
