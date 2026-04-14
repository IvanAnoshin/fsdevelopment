# Friendscape deploy without Docker

## Frontend
1. `npm ci`
2. `npm run lint`
3. `npm run build`
4. Copy `dist/` to `/usr/share/nginx/html`
5. Use `deploy/nginx.conf` as the nginx site config

## Backend
1. Copy `.env.example` to `.env` and fill production values
2. Make sure `APP_ENV=production`
3. Use a strong `JWT_SECRET` and `ADMIN_BOOTSTRAP_TOKEN` if bootstrap is enabled
4. Use `DB_SSLMODE=require` or stricter in production
5. Run the binary under `systemd` or another supervisor

## Quick post-deploy checks
- `GET /healthz` returns 200
- `GET /readyz` returns 200
- login works
- feed loads
- messages open
- notifications load
- admin recovery page opens for admins only
