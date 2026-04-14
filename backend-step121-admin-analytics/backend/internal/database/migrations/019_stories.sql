CREATE TABLE IF NOT EXISTS stories (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    community_id BIGINT NULL REFERENCES communities(id) ON DELETE CASCADE,
    chat_user_id BIGINT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL DEFAULT 'status',
    audience VARCHAR(32) NOT NULL DEFAULT 'all',
    intent VARCHAR(96) NULL,
    content TEXT NOT NULL,
    media_url TEXT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 60,
    extend_count INTEGER NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stories_user_expires ON stories(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_expires_at ON stories(expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_stories_community_id ON stories(community_id);
CREATE INDEX IF NOT EXISTS idx_stories_chat_user_id ON stories(chat_user_id);
CREATE INDEX IF NOT EXISTS idx_stories_audience ON stories(audience);

CREATE TABLE IF NOT EXISTS story_replies (
    id BIGSERIAL PRIMARY KEY,
    story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_story_replies_story_id_created_at ON story_replies(story_id, created_at ASC);

CREATE TABLE IF NOT EXISTS story_views (
    id BIGSERIAL PRIMARY KEY,
    story_id BIGINT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(story_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_story_views_story_id ON story_views(story_id);
CREATE INDEX IF NOT EXISTS idx_story_views_user_id ON story_views(user_id);
