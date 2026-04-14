CREATE TABLE IF NOT EXISTS e2ee_key_backups (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 1,
    algorithm VARCHAR(64) NOT NULL DEFAULT 'pbkdf2-aesgcm-v1',
    kdf VARCHAR(64) NOT NULL DEFAULT 'PBKDF2-SHA256',
    kdf_iterations INTEGER NOT NULL DEFAULT 250000,
    salt TEXT NOT NULL,
    iv TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    source_device_id VARCHAR(128),
    source_fingerprint VARCHAR(255),
    backup_scope VARCHAR(32) NOT NULL DEFAULT 'bundle',
    last_downloaded_at TIMESTAMPTZ NULL,
    last_restored_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_e2ee_key_backups_source_device ON e2ee_key_backups(source_device_id);
