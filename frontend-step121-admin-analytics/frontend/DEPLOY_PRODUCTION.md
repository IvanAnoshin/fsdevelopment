# Friendscape frontend production deploy

## Build once
1. `npm ci`
2. `npm run lint`
3. `npm run test`
4. `npm run build`

## Runtime configuration without rebuild
Friendscape can read runtime settings from `runtime-config.js`.

1. Copy `deploy/runtime-config.js.example` to your nginx root as `runtime-config.js`.
2. Set `apiBaseUrl` to your public backend API URL, for example `https://api.example.com/api`.
3. If your WebRTC fallback should be configured at deploy time, set the WebRTC fields there too.

That lets you keep one frontend build and change only runtime-config.js between staging and production.

## Nginx
- Use `deploy/nginx.conf` for SPA hosting.
- Keep `index.html`, `sw.js`, and `runtime-config.js` on `no-cache`.
- Cache hashed assets under `/assets/` aggressively.

## Smoke checks
- Open `/login`
- Login succeeds
- Feed loads
- Chat list opens
- Browser devtools show requests going to the configured `apiBaseUrl`
