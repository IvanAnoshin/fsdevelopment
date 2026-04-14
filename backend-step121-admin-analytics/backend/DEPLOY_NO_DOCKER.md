# Friendscape backend deploy without Docker

## 1. Prepare the machine

- Install Go 1.23+
- Install PostgreSQL
- Install nginx
- Create user `friendscape`
- Create `/opt/friendscape/backend` and `/opt/friendscape/backend/media`

## 2. Prepare config

1. Copy `.env.example` to `.env`
2. Set real secrets and URLs
3. Run `./scripts/preflight.sh`

## 3. Build and place binary

1. `./scripts/bootstrap-go.sh`
2. `go build -o friendscape-backend .`
3. Copy the binary, `.env`, and `media/` to `/opt/friendscape/backend`

## 4. systemd

- Copy `deploy/systemd/friendscape-backend.service` to `/etc/systemd/system/`
- `sudo systemctl daemon-reload`
- `sudo systemctl enable --now friendscape-backend`

## 5. nginx

- Copy the frontend nginx config to the server
- Enable the site and reload nginx
- Put TLS in front of it and terminate HTTPS there

## 6. Verify

- `curl http://127.0.0.1:8080/healthz`
- `curl http://127.0.0.1:8080/readyz`
- open login from the frontend
- login, feed, chats, and admin routes work