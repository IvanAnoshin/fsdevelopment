CREATE TABLE IF NOT EXISTS media_assets (
  id BIGSERIAL PRIMARY KEY,
  owner_id BIGINT NOT NULL,
  kind VARCHAR(32) NOT NULL,
  content_hash VARCHAR(128) NOT NULL UNIQUE,
  original_filename TEXT,
  original_mime TEXT,
  stored_format VARCHAR(16),
  width INTEGER NOT NULL DEFAULT 0,
  height INTEGER NOT NULL DEFAULT 0,
  original_bytes BIGINT NOT NULL DEFAULT 0,
  stored_bytes BIGINT NOT NULL DEFAULT 0,
  variants_json TEXT NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner_id ON media_assets(owner_id);
CREATE INDEX IF NOT EXISTS idx_media_assets_kind_created_at ON media_assets(kind, created_at DESC);
