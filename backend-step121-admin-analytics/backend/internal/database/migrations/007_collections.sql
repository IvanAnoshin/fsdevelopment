CREATE TABLE IF NOT EXISTS collections (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    description VARCHAR(240) DEFAULT '',
    color VARCHAR(24) DEFAULT '#6d5efc',
    is_default BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_default_per_user ON collections(user_id, is_default) WHERE is_default = TRUE;

CREATE TABLE IF NOT EXISTS collection_items (
    id BIGSERIAL PRIMARY KEY,
    collection_id BIGINT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    entity_type VARCHAR(32) NOT NULL,
    entity_key VARCHAR(191) NOT NULL,
    title VARCHAR(180) NOT NULL,
    subtitle VARCHAR(220) DEFAULT '',
    preview_text TEXT DEFAULT '',
    preview_image VARCHAR(512) DEFAULT '',
    link VARCHAR(512) DEFAULT '',
    payload_json TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_collection_items_collection_id ON collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_user_id ON collection_items(user_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_entity_type ON collection_items(entity_type);
CREATE UNIQUE INDEX IF NOT EXISTS idx_collection_items_unique_entry ON collection_items(collection_id, entity_key);
