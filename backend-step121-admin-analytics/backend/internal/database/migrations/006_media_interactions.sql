CREATE TABLE IF NOT EXISTS media_votes (
    id BIGSERIAL PRIMARY KEY,
    media_key VARCHAR(512) NOT NULL,
    asset_id BIGINT NULL,
    user_id BIGINT NOT NULL,
    value INTEGER NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_vote_user_media
    ON media_votes (user_id, media_key);
CREATE INDEX IF NOT EXISTS idx_media_votes_media_key ON media_votes (media_key);
CREATE INDEX IF NOT EXISTS idx_media_votes_asset_id ON media_votes (asset_id);

CREATE TABLE IF NOT EXISTS media_comments (
    id BIGSERIAL PRIMARY KEY,
    media_key VARCHAR(512) NOT NULL,
    asset_id BIGINT NULL,
    user_id BIGINT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_comments_media_key ON media_comments (media_key);
CREATE INDEX IF NOT EXISTS idx_media_comments_asset_id ON media_comments (asset_id);
CREATE INDEX IF NOT EXISTS idx_media_comments_user_id ON media_comments (user_id);

CREATE TABLE IF NOT EXISTS media_reports (
    id BIGSERIAL PRIMARY KEY,
    media_key VARCHAR(512) NOT NULL,
    asset_id BIGINT NULL,
    reporter_id BIGINT NOT NULL,
    source_post_id BIGINT NULL,
    reason TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_media_report_user_media
    ON media_reports (reporter_id, media_key);
CREATE INDEX IF NOT EXISTS idx_media_reports_media_key ON media_reports (media_key);
CREATE INDEX IF NOT EXISTS idx_media_reports_asset_id ON media_reports (asset_id);
CREATE INDEX IF NOT EXISTS idx_media_reports_status ON media_reports (status);
