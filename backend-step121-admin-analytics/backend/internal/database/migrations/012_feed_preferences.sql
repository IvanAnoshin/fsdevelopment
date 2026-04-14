CREATE TABLE IF NOT EXISTS feed_preferences (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(32) NOT NULL,
    post_id BIGINT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author_id BIGINT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic VARCHAR(96) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feed_preferences_user_type ON feed_preferences(user_id, type);
CREATE INDEX IF NOT EXISTS idx_feed_preferences_user_post ON feed_preferences(user_id, post_id);
CREATE INDEX IF NOT EXISTS idx_feed_preferences_user_author ON feed_preferences(user_id, author_id);
CREATE INDEX IF NOT EXISTS idx_feed_preferences_user_topic ON feed_preferences(user_id, topic);

CREATE UNIQUE INDEX IF NOT EXISTS uq_feed_preferences_user_post_type
    ON feed_preferences(user_id, type, post_id)
    WHERE post_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_feed_preferences_user_author_type
    ON feed_preferences(user_id, type, author_id)
    WHERE author_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_feed_preferences_user_topic_type
    ON feed_preferences(user_id, type, topic)
    WHERE topic IS NOT NULL;
