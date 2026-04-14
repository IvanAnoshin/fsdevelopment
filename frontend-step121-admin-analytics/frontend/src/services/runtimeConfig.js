function trimTrailingSlash(value) {
  return String(value || '').replace(/\/$/, '');
}

function safeImportMetaEnv() {
  try {
    return (typeof import.meta !== 'undefined' && import.meta && import.meta.env) ? import.meta.env : {};
  } catch {
    return {};
  }
}

function readWindowRuntimeConfig() {
  if (typeof window === 'undefined') return {};
  const payload = window.__FRIENDSCAPE_CONFIG__;
  return payload && typeof payload === 'object' ? payload : {};
}

function readWindowRuntimeValue(...keys) {
  const config = readWindowRuntimeConfig();
  for (const key of keys) {
    const value = config?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return value;
    }
  }
  return '';
}

function resolveEnvApiBaseUrl() {
  const env = safeImportMetaEnv();
  return trimTrailingSlash(env?.VITE_API_URL || '');
}

function resolveWindowApiBaseUrl() {
  const configured = trimTrailingSlash(readWindowRuntimeValue('apiBaseUrl', 'api_base_url', 'apiURL'));
  if (configured) return configured;
  if (typeof window === 'undefined') return '';
  const origin = trimTrailingSlash(window.location?.origin || '');
  if (!origin) return '';
  return `${origin}/api`;
}

function resolveRuntimeValue(windowKeys, envKey, fallback = '') {
  const configured = String(readWindowRuntimeValue(...windowKeys)).trim();
  if (configured) return configured;
  const env = safeImportMetaEnv();
  const envValue = String(env?.[envKey] || '').trim();
  if (envValue) return envValue;
  return fallback;
}

export function resolveDefaultApiBaseUrl() {
  const envUrl = resolveEnvApiBaseUrl();
  if (envUrl) return envUrl;
  const windowUrl = resolveWindowApiBaseUrl();
  if (windowUrl) return windowUrl;
  return '/api';
}

export function getRuntimeConfigSnapshot() {
  return { ...readWindowRuntimeConfig() };
}

export const DEFAULT_API_BASE_URL = resolveDefaultApiBaseUrl();
export const RUNTIME_WEBRTC_ICE_SERVERS_JSON = resolveRuntimeValue(
  ['webrtcIceServersJSON', 'webrtc_ice_servers_json'],
  'VITE_WEBRTC_ICE_SERVERS_JSON',
  ''
);
export const RUNTIME_WEBRTC_ICE_TRANSPORT_POLICY = resolveRuntimeValue(
  ['webrtcIceTransportPolicy', 'webrtc_ice_transport_policy'],
  'VITE_WEBRTC_ICE_TRANSPORT_POLICY',
  'all'
);
export const RUNTIME_WEBRTC_BUNDLE_POLICY = resolveRuntimeValue(
  ['webrtcBundlePolicy', 'webrtc_bundle_policy'],
  'VITE_WEBRTC_BUNDLE_POLICY',
  'max-bundle'
);
export const RUNTIME_WEBRTC_RTCP_MUX_POLICY = resolveRuntimeValue(
  ['webrtcRtcpMuxPolicy', 'webrtc_rtcp_mux_policy'],
  'VITE_WEBRTC_RTCP_MUX_POLICY',
  'require'
);
export const RUNTIME_WEBRTC_ICE_CANDIDATE_POOL_SIZE = resolveRuntimeValue(
  ['webrtcIceCandidatePoolSize', 'webrtc_ice_candidate_pool_size'],
  'VITE_WEBRTC_ICE_CANDIDATE_POOL_SIZE',
  '6'
);
