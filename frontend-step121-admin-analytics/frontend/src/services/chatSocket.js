import { getToken } from './authStorage.js';
import { getRealtimeTicket } from './api.js';
import { DEFAULT_API_BASE_URL } from './runtimeConfig.js';

export function buildChatWebSocketURL(apiBaseURL = DEFAULT_API_BASE_URL, ticket = '') {
  const cleanBase = String(apiBaseURL || '').replace(/\/$/, '');
  const root = cleanBase.endsWith('/api') ? cleanBase.slice(0, -4) : cleanBase;
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
  const url = new URL('/api/ws/chat', root || origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (ticket) url.searchParams.set('ticket', ticket);
  return url.toString();
}

function parsePayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

class ChatSocketClient {
  constructor() {
    this.socket = null;
    this.listeners = new Set();
    this.statusListeners = new Set();
    this.reconnectTimer = null;
    this.ticketPromise = null;
    this.tokenProvider = () => getToken();
    this.manuallyClosed = false;
    this.connected = false;
  }

  configure(options = {}) {
    if (typeof options.tokenProvider === 'function') this.tokenProvider = options.tokenProvider;
  }

  notifyStatus(connected) {
    this.connected = connected;
    this.statusListeners.forEach((listener) => listener(connected));
  }

  connect() {
    if (typeof window === 'undefined' || typeof window.WebSocket === 'undefined' || this.socket || this.ticketPromise) return;
    const token = this.tokenProvider?.() || '';
    if (!token) return;
    this.manuallyClosed = false;

    this.ticketPromise = getRealtimeTicket()
      .then((res) => {
        const ticket = String(res?.data?.ticket || '').trim();
        if (!ticket) return;

        const socket = new window.WebSocket(buildChatWebSocketURL(DEFAULT_API_BASE_URL, ticket));
        this.socket = socket;

        socket.onopen = () => {
          this.notifyStatus(true);
        };

        socket.onmessage = (event) => {
          const detail = parsePayload(event?.data);
          if (!detail) return;
          this.listeners.forEach((listener) => listener(detail));
        };

        socket.onclose = () => {
          const shouldReconnect = !this.manuallyClosed;
          this.socket = null;
          this.notifyStatus(false);
          if (shouldReconnect && typeof window !== 'undefined') {
            window.clearTimeout(this.reconnectTimer);
            this.reconnectTimer = window.setTimeout(() => this.connect(), 2500);
          }
        };

        socket.onerror = () => {
          try { socket.close(); } catch {}
        };
      })
      .finally(() => {
        this.ticketPromise = null;
      });
  }

  disconnect() {
    this.manuallyClosed = true;
    if (typeof window !== 'undefined' && this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try { this.socket.close(); } catch {}
      this.socket = null;
    }
    this.notifyStatus(false);
  }

  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeStatus(listener) {
    if (typeof listener !== 'function') return () => {};
    this.statusListeners.add(listener);
    listener(this.connected);
    return () => this.statusListeners.delete(listener);
  }

  send(type, data = {}, clientId = '') {
    if (!this.socket || this.socket.readyState !== 1) return false;
    this.socket.send(JSON.stringify({ type, data, client_id: clientId || undefined }));
    return true;
  }

  isConnected() {
    return this.connected;
  }
}

let singleton = null;
export function getChatSocketClient() {
  if (!singleton) singleton = new ChatSocketClient();
  return singleton;
}
