CREATE TABLE IF NOT EXISTS vouches (
  id BIGSERIAL PRIMARY KEY,
  voucher_id BIGINT NOT NULL,
  vouchee_id BIGINT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vouch_pair ON vouches (voucher_id, vouchee_id);
CREATE INDEX IF NOT EXISTS idx_vouches_vouchee_created ON vouches (vouchee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vouches_voucher_created ON vouches (voucher_id, created_at DESC);
