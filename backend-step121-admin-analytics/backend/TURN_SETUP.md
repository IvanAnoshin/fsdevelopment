# TURN / ICE setup for stable Friendscape calls

This project now serves runtime WebRTC configuration from `GET /api/calls/config`.
The frontend requests this endpoint before creating a peer connection, so TURN credentials no longer need to be baked into the frontend build.

## Recommended backend `.env`

```env
# STUN can point at your TURN host as well
WEBRTC_STUN_URLS=stun:turn.example.com:3478

# Ordered by preference: UDP first, then TCP, then TLS/TURNS
WEBRTC_TURN_URLS=turn:turn.example.com:3478?transport=udp,turn:turn.example.com:3478?transport=tcp,turns:turn.example.com:5349?transport=tcp

# Use TURN REST credentials for safer short-lived access
WEBRTC_TURN_SECRET=CHANGE_ME_WITH_THE_SAME_SECRET_AS_COTURN
WEBRTC_TURN_TTL_SECONDS=3600

# Keep direct P2P when possible; switch to relay if you need relay-only debugging
WEBRTC_ICE_TRANSPORT_POLICY=all
WEBRTC_BUNDLE_POLICY=max-bundle
WEBRTC_RTCP_MUX_POLICY=require
WEBRTC_ICE_CANDIDATE_POOL_SIZE=6
```

## What changed

- Backend now returns `ice_servers`, `ice_transport_policy`, `bundle_policy`, `rtcp_mux_policy`, and `ice_candidate_pool_size`.
- TURN credentials can be generated dynamically from `WEBRTC_TURN_SECRET`.
- Frontend prefers runtime config from backend and falls back to local STUN / Vite env only when runtime config is unavailable.

## coTURN notes

Use `deploy/coturn/turnserver.conf.example` as your baseline.
For best real-world reachability:

- run TURN on a public hostname / public IP
- expose UDP/TCP `3478`
- expose TLS `5349`
- open the relay range (`49160-49240` in the example)
- use the same shared secret in coTURN and Friendscape backend

## Relay-only mode

When you need to verify that TURN relaying itself works, temporarily set:

```env
WEBRTC_ICE_TRANSPORT_POLICY=relay
```

Do not leave relay-only enabled unless you intentionally want every call to traverse TURN.
`all` is the better default for lower latency while still keeping TURN available as fallback.
