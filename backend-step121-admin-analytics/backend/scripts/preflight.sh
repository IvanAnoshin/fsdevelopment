#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f .env.production && ! -f .env ]]; then
  echo "❌ No .env.production or .env file found"
  exit 1
fi

ENV_FILE=".env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE=".env"
fi

set -a
source "$ENV_FILE"
set +a

fail() {
  echo "❌ $1"
  exit 1
}

[[ "${APP_ENV:-}" == "production" ]] || fail "APP_ENV must be production"
[[ "${APP_PUBLIC_URL:-}" == https://* ]] || fail "APP_PUBLIC_URL must start with https://"
[[ -n "${ALLOWED_ORIGINS:-}" ]] || fail "ALLOWED_ORIGINS must not be empty"
[[ "${ALLOWED_ORIGINS:-}" != *"localhost"* ]] || fail "ALLOWED_ORIGINS must not contain localhost in production"
[[ ${#JWT_SECRET:-0} -ge 32 ]] || fail "JWT_SECRET must be at least 32 characters"
[[ "${DB_SSLMODE:-}" != "disable" ]] || fail "DB_SSLMODE must not be disable"
[[ "${TRUSTED_PROXIES:-}" != *"*"* ]] || fail "TRUSTED_PROXIES must not contain *"

if ! grep -q 'github.com/gorilla/websocket' go.mod; then
  fail "github.com/gorilla/websocket is missing from go.mod"
fi

if ! grep -q 'github.com/gorilla/websocket' go.sum; then
  echo "⚠️ go.sum does not yet contain github.com/gorilla/websocket. Run: go mod download github.com/gorilla/websocket@v1.5.3"
fi

if command -v go >/dev/null 2>&1; then
  gofmt -w main.go internal || true
fi

echo "✅ Friendscape backend preflight passed"
