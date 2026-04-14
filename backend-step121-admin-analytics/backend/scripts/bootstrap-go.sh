#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "→ downloading Go modules"
go mod download

echo "→ ensuring gorilla/websocket checksum is present"
go mod download github.com/gorilla/websocket@v1.5.3

echo "→ normalizing module graph"
go mod tidy

echo "✅ Go module bootstrap finished"
