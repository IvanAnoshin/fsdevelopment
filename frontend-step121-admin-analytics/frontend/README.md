# Friendscape Frontend

## Local development
1. Copy `.env.example` to `.env`.
2. Set `VITE_API_URL`, for example `http://localhost:8080/api`.
3. Install dependencies with `npm ci`.
4. Run `npm run dev`.

## Quality checks
- `npm run lint`
- `npm run build`

## Production notes
- Build with `npm run build`.
- Serve the contents of `dist/` with nginx or another static server.
- Keep `index.html` and `sw.js` on `no-cache`, but cache hashed assets aggressively.
- Set `VITE_API_URL` to the public backend API URL, for example `https://api.example.com/api`.
- Keep `VITE_DEBUG_API=false` in production.

## Files for deploy
- `deploy/nginx.conf` — production-ready static config for SPA hosting
- `public/sw.js` — service worker for push notifications
- `DEPLOY_NO_DOCKER.md` — short release checklist without Docker
