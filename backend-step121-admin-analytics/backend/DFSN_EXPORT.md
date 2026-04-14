# DFSN compact export

Backend exposes an admin-only compact export endpoint for future ML training.

## Endpoint

`GET /api/admin/behavior/export`

Defaults:
- compact CSV
- gzip enabled by default
- schema header: `X-DFSN-Export-Schema: dfsn-compact-v1`

## Query params

- `from=2026-04-01` or RFC3339 datetime
- `to=2026-04-12`
- `user_id=123`
- `trust_label=trusted|uncertain|suspicious`
- `auth_outcome=login_success_password_only`
- `route=/messages/42`
- `limit=50000`
- `gzip=true|false`

## Compact fields

The export keeps training-relevant signals while flattening noisy JSON blobs into compact tabular columns:
- behavioral metrics: typing, correction, pointer, hover, scroll, response latency
- session context: hour, weekday, timezone, locale, route, screen
- trust context: new device/network/geo flags
- labels: auth outcome, session trust, quality flags
- derived summaries:
  - screen dwell total / top key
  - card dwell total / top key
  - navigation length / signature
  - event totals / key event counts

## Row cap

Use `DFSN_EXPORT_MAX_ROWS` to cap large exports.
