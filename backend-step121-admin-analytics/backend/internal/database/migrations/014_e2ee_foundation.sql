ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encryption_scheme VARCHAR(64);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_device_id VARCHAR(128);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS recipient_device_id VARCHAR(128);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS ciphertext TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS cipher_header TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS cipher_aad TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_hint VARCHAR(255);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS client_message_id VARCHAR(128);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS key_envelope TEXT;
ALTER TABLE messages ALTER COLUMN content DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_is_encrypted ON messages(is_encrypted);
CREATE INDEX IF NOT EXISTS idx_messages_sender_device_id ON messages(sender_device_id);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_device_id ON messages(recipient_device_id);
CREATE INDEX IF NOT EXISTS idx_messages_client_message_id ON messages(client_message_id);

CREATE TABLE IF NOT EXISTS e2ee_devices (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    label VARCHAR(160) DEFAULT '',
    algorithm VARCHAR(64) NOT NULL DEFAULT 'p256-e2ee-v1',
    identity_signing_key TEXT NOT NULL,
    identity_exchange_key TEXT NOT NULL,
    signed_pre_key TEXT NOT NULL,
    signed_pre_key_signature TEXT NOT NULL,
    signed_pre_key_id VARCHAR(128) DEFAULT '',
    last_prekey_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_e2ee_user_device ON e2ee_devices(device_id);
CREATE INDEX IF NOT EXISTS idx_e2ee_devices_user_id ON e2ee_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_e2ee_devices_revoked_at ON e2ee_devices(revoked_at);

CREATE TABLE IF NOT EXISTS e2ee_one_time_pre_keys (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL,
    device_id VARCHAR(128) NOT NULL,
    key_id VARCHAR(128) NOT NULL,
    public_key TEXT NOT NULL,
    claimed_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_e2ee_one_time_pre_keys_user_id ON e2ee_one_time_pre_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_e2ee_one_time_pre_keys_device_id ON e2ee_one_time_pre_keys(device_id);
CREATE INDEX IF NOT EXISTS idx_e2ee_one_time_pre_keys_key_id ON e2ee_one_time_pre_keys(key_id);
CREATE INDEX IF NOT EXISTS idx_e2ee_one_time_pre_keys_claimed_at ON e2ee_one_time_pre_keys(claimed_at);
