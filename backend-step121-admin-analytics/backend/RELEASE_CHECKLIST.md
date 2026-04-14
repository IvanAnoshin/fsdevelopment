# Friendscape backend release checklist

## Required before production
- `APP_ENV=production`
- `APP_PUBLIC_URL` uses `https://`
- `ALLOWED_ORIGINS` lists only real frontend origins
- `JWT_SECRET` is at least 32 random characters
- `DB_SSLMODE` is `require` or stricter
- `TRUSTED_PROXIES` does not contain `*`
- `ENABLE_DEV_ADMIN_ROUTE=false` unless you explicitly need bootstrap
- if bootstrap is enabled, `ADMIN_BOOTSTRAP_TOKEN` is at least 32 random characters

## Verify after deploy
- `/healthz` returns 200
- `/readyz` returns 200
- login works
- feed loads
- admin pages require admin rights
- recovery approve/reject still work
- push public key endpoint returns a value

- go.sum contains github.com/gorilla/websocket or `go mod download` has been run on the build host
- `./scripts/preflight.sh` passes
- the backend binary builds with `go build -o friendscape-backend .`
- systemd unit and nginx reverse proxy config from `deploy/` have been applied
- `./scripts/bootstrap-go.sh` has been run on the build host
