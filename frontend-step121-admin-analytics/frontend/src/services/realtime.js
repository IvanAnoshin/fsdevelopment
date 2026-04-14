import { getToken } from './authStorage.js';
import { getRealtimeTicket } from './api.js';
import { DEFAULT_API_BASE_URL } from './runtimeConfig.js';

export const REALTIME_BROWSER_EVENT = 'app:realtime-event';

export function buildRealtimeURL(apiBaseURL = DEFAULT_API_BASE_URL, ticket = '') {
  const cleanBase = String(apiBaseURL || '').replace(/\/$/, '');
  const root = cleanBase.endsWith('/api') ? cleanBase.slice(0, -4) : cleanBase;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = new URL('/api/events/stream', root || origin);
  if (ticket) url.searchParams.set('ticket', ticket);
  return url.toString();
}

export function parseRealtimePayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'object') return payload;
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

function broadcastShellSync() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('app:action', { detail: { action: 'shell.syncCounters' } }));
}

class RealtimeClient {
  constructor() {
    this.source = null;
    this.listeners = new Set();
    this.reconnectTimer = null;
    this.ticketPromise = null;
    this.tokenProvider = () => getToken();
  }

  configure(options = {}) {
    if (typeof options.tokenProvider === 'function') this.tokenProvider = options.tokenProvider;
  }

  async connect() {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined' || this.source || this.ticketPromise) return;
    const token = this.tokenProvider?.() || '';
    if (!token) return;

    this.ticketPromise = getRealtimeTicket()
      .then((res) => {
        const ticket = String(res?.data?.ticket || '').trim();
        if (!ticket) return;

        this.source = new window.EventSource(buildRealtimeURL(DEFAULT_API_BASE_URL, ticket), { withCredentials: true });
        const handleMessage = (event) => {
          const payload = parseRealtimePayload(event?.data);
          const detail = payload ? { ...payload, type: payload.type || event.type } : { type: event.type };
          this.listeners.forEach((listener) => listener(detail));
          window.dispatchEvent(new CustomEvent(REALTIME_BROWSER_EVENT, { detail }));
          if (detail.type?.startsWith('message:') || detail.type?.startsWith('notification:')) {
            broadcastShellSync();
          }
        };

        ['ready', 'message:new', 'message:read', 'notification:new', 'notification:read', 'notification:read_all'].forEach((name) => {
          this.source?.addEventListener(name, handleMessage);
        });

        this.source.onerror = () => {
          const current = this.source;
          this.source = null;
          current?.close?.();
          if (typeof window !== 'undefined') {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = window.setTimeout(() => this.connect(), 2500);
          }
        };
      })
      .finally(() => {
        this.ticketPromise = null;
      });
  }

  disconnect() {
    if (typeof window !== 'undefined' && this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.source) {
      this.source.close();
      this.source = null;
    }
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

let singleton = null;
export function getRealtimeClient() {
  if (!singleton) singleton = new RealtimeClient();
  return singleton;
}
