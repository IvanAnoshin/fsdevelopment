import { updateBehavioralDataBatch } from './api';
import { clearBehaviorAuthOutcome, getBehaviorAuthOutcome, getToken } from './authStorage';

const DEVICE_STORAGE_KEY = 'dfsn:client-device-id:v1';
const SESSION_STORAGE_KEY = 'dfsn:session-id:v1';
const QUEUE_STORAGE_KEY = 'dfsn:pending-samples:v1';
const INTERACTIVE_SELECTOR = 'button,a,input,textarea,select,[role="button"],[data-dfsn-interactive]';
const CARD_SELECTOR = '[data-dfsn-card], .pa-card, .feed-post-card, .person-card, .mini-card, .setting-card, .summary-card, .danger-card, .pa-chat-item-redesign, .pa-chat-item, .section-card';
const POINTER_SAMPLE_INTERVAL_MS = 120;
const SCROLL_SAMPLE_INTERVAL_MS = 90;
const WINDOW_ROTATE_MS = 120000;
const BATCH_FLUSH_MS = 180000;
const MAX_PENDING_SAMPLES = 6;
const FORCE_FLUSH_PENDING_SAMPLES = 3;

function safeLocalStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function safeSessionStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function uuid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `dfsn-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureStoredId(key, storageFactory) {
  const storage = storageFactory();
  if (!storage) return uuid();
  const existing = storage.getItem(key);
  if (existing) return existing;
  const next = uuid();
  storage.setItem(key, next);
  return next;
}

function readJSON(key, storageFactory, fallback) {
  const storage = storageFactory();
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value, storageFactory) {
  const storage = storageFactory();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // noop
  }
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return values.reduce((sum, value) => sum + ((value - avg) ** 2), 0) / values.length;
}

function truncateMap(map, limit = 24) {
  const entries = Object.entries(map || {}).sort((a, b) => b[1] - a[1]).slice(0, limit);
  return Object.fromEntries(entries.map(([key, value]) => [key, Math.round(value)]));
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

class DFSNCollector {
  constructor() {
    this.initialized = false;
    this.flushInFlight = false;
    this.flushTimer = null;
    this.route = '/';
    this.routeEnteredAt = Date.now();
    this.sessionStartedAt = Date.now();
    this.windowStartedAt = Date.now();
    this.navigationPath = [];
    this.screenDwell = {};
    this.cardDwell = {};
    this.cardVisibleSince = new Map();
    this.cardObserver = null;
    this.hoverStartByElement = new WeakMap();
    this.keyDownAt = new Map();
    this.hiddenSince = 0;
    this.hiddenDurationMs = 0;
    this.lastKeyDownAt = 0;
    this.lastPointer = null;
    this.lastPointerSampleAt = 0;
    this.lastScrollAt = 0;
    this.lastScrollSampleAt = 0;
    this.scrollBurst = null;
    this.scrollMaxDepth = 0;
    this.lastIncomingByChat = new Map();
    this.pendingSamples = readJSON(QUEUE_STORAGE_KEY, safeSessionStorage, []);
    this.bound = {};
    this.resetWindowMetrics();
  }

  resetWindowMetrics() {
    this.metrics = {
      dwellSamples: [],
      flightSamples: [],
      pointerSpeeds: [],
      hoverClickSamples: [],
      scrollBurstLengths: [],
      scrollBurstSpeeds: [],
      responseLatencies: [],
      counts: {
        key_down: 0,
        key_up: 0,
        backspace: 0,
        correction: 0,
        pointer_move: 0,
        click: 0,
        hover_click_samples: 0,
        scroll_event: 0,
        route_change: 0,
      },
      qualityFlags: [],
    };
    this.windowStartedAt = Date.now();
    this.hiddenDurationMs = 0;
  }

  get clientDeviceId() {
    return ensureStoredId(DEVICE_STORAGE_KEY, safeLocalStorage);
  }

  get sessionId() {
    return ensureStoredId(SESSION_STORAGE_KEY, safeSessionStorage);
  }

  persistQueue() {
    writeJSON(QUEUE_STORAGE_KEY, this.pendingSamples.slice(-MAX_PENDING_SAMPLES), safeSessionStorage);
  }

  init() {
    if (this.initialized || typeof window === 'undefined' || typeof document === 'undefined') return;
    this.initialized = true;
    this.route = `${window.location.pathname}${window.location.search || ''}`;
    this.routeEnteredAt = Date.now();
    this.sessionStartedAt = Date.now();
    this.navigationPath = [this.route];
    this.bound.keydown = (event) => this.handleKeyDown(event);
    this.bound.keyup = (event) => this.handleKeyUp(event);
    this.bound.mousemove = (event) => this.handlePointerMove(event);
    this.bound.pointerover = (event) => this.handlePointerOver(event);
    this.bound.click = (event) => this.handleClick(event);
    this.bound.scroll = () => this.handleScroll();
    this.bound.visibility = () => this.handleVisibilityChange();
    this.bound.pagehide = () => this.handlePageHide();
    this.bound.focus = () => { if (!document.hidden) this.hiddenSince = 0; };

    document.addEventListener('keydown', this.bound.keydown, true);
    document.addEventListener('keyup', this.bound.keyup, true);
    document.addEventListener('mousemove', this.bound.mousemove, { passive: true, capture: true });
    document.addEventListener('pointerover', this.bound.pointerover, true);
    document.addEventListener('click', this.bound.click, true);
    window.addEventListener('scroll', this.bound.scroll, { passive: true });
    document.addEventListener('visibilitychange', this.bound.visibility);
    window.addEventListener('pagehide', this.bound.pagehide);
    window.addEventListener('focus', this.bound.focus);

    this.cardObserver = new IntersectionObserver((entries) => {
      const now = Date.now();
      entries.forEach((entry) => {
        const el = entry.target;
        const cardKey = el.getAttribute('data-dfsn-card') || el.getAttribute('data-dfsn-card-id');
        if (!cardKey) return;
        if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
          if (!this.cardVisibleSince.has(el)) this.cardVisibleSince.set(el, now);
          return;
        }
        const startedAt = this.cardVisibleSince.get(el);
        if (startedAt) {
          this.cardDwell[cardKey] = (this.cardDwell[cardKey] || 0) + (now - startedAt);
          this.cardVisibleSince.delete(el);
        }
      });
    }, { threshold: [0.6] });

    this.scanCards();
    this.flushTimer = window.setInterval(() => this.tick(), 30000);
    if (this.pendingSamples.length > 0) {
      window.setTimeout(() => this.flushQueue('resume'), 2500);
    }
  }

  destroy() {
    if (!this.initialized || typeof window === 'undefined' || typeof document === 'undefined') return;
    this.enqueueCurrentWindow('destroy');
    this.persistQueue();
    document.removeEventListener('keydown', this.bound.keydown, true);
    document.removeEventListener('keyup', this.bound.keyup, true);
    document.removeEventListener('mousemove', this.bound.mousemove, true);
    document.removeEventListener('pointerover', this.bound.pointerover, true);
    document.removeEventListener('click', this.bound.click, true);
    window.removeEventListener('scroll', this.bound.scroll);
    document.removeEventListener('visibilitychange', this.bound.visibility);
    window.removeEventListener('pagehide', this.bound.pagehide);
    window.removeEventListener('focus', this.bound.focus);
    this.cardObserver?.disconnect();
    this.cardObserver = null;
    if (this.flushTimer) window.clearInterval(this.flushTimer);
    this.flushTimer = null;
    this.initialized = false;
  }

  tick() {
    const now = Date.now();
    if (now - this.windowStartedAt >= WINDOW_ROTATE_MS) {
      this.enqueueCurrentWindow('window_rotate');
    }
    if (this.pendingSamples.length >= FORCE_FLUSH_PENDING_SAMPLES || now - this.windowStartedAt >= BATCH_FLUSH_MS) {
      this.flushQueue('interval');
    }
  }

  onRouteChange(route) {
    if (!route) return;
    const now = Date.now();
    const currentRoute = this.route || route;
    this.screenDwell[currentRoute] = (this.screenDwell[currentRoute] || 0) + (now - this.routeEnteredAt);
    this.route = route;
    this.routeEnteredAt = now;
    this.navigationPath = [...this.navigationPath.slice(-23), route];
    this.metrics.counts.route_change += 1;
    if (now - this.windowStartedAt >= 45000) {
      this.enqueueCurrentWindow('route_change');
    }
    window.setTimeout(() => this.scanCards(), 180);
  }

  scanCards() {
    if (!this.cardObserver || typeof document === 'undefined') return;
    const nodes = Array.from(document.querySelectorAll(CARD_SELECTOR));
    nodes.forEach((node, index) => {
      if (!(node instanceof HTMLElement)) return;
      if (!node.getAttribute('data-dfsn-card') && !node.getAttribute('data-dfsn-card-id')) {
        const base = node.getAttribute('data-testid') || node.className?.toString?.().split(' ').find(Boolean) || 'card';
        node.setAttribute('data-dfsn-card-id', `${this.route}:${base}:${index}`);
      }
      this.cardObserver.observe(node);
    });
  }

  handleKeyDown(event) {
    const now = Date.now();
    this.metrics.counts.key_down += 1;
    if (event.key === 'Backspace') {
      this.metrics.counts.backspace += 1;
      this.metrics.counts.correction += 1;
    }
    if (this.lastKeyDownAt && now - this.lastKeyDownAt < 5000) {
      this.metrics.flightSamples.push(now - this.lastKeyDownAt);
    }
    this.lastKeyDownAt = now;
    if (!event.repeat) {
      this.keyDownAt.set(event.code || event.key || `key-${now}`, now);
    }
  }

  handleKeyUp(event) {
    const now = Date.now();
    this.metrics.counts.key_up += 1;
    const key = event.code || event.key || '';
    const startedAt = this.keyDownAt.get(key);
    if (startedAt) {
      const dwell = now - startedAt;
      if (dwell > 0 && dwell < 3000) this.metrics.dwellSamples.push(dwell);
      this.keyDownAt.delete(key);
    }
  }

  handlePointerMove(event) {
    const now = Date.now();
    if (now - this.lastPointerSampleAt < POINTER_SAMPLE_INTERVAL_MS) return;
    this.lastPointerSampleAt = now;
    this.metrics.counts.pointer_move += 1;
    if (this.lastPointer) {
      const dt = now - this.lastPointer.t;
      if (dt > 0 && dt < 2000) {
        const dx = event.clientX - this.lastPointer.x;
        const dy = event.clientY - this.lastPointer.y;
        const distance = Math.sqrt((dx ** 2) + (dy ** 2));
        const speed = (distance / dt) * 1000;
        if (speed >= 0 && speed < 50000) this.metrics.pointerSpeeds.push(speed);
      }
    }
    this.lastPointer = { x: event.clientX, y: event.clientY, t: now };
  }

  handlePointerOver(event) {
    const target = event.target?.closest?.(INTERACTIVE_SELECTOR);
    if (!target) return;
    this.hoverStartByElement.set(target, Date.now());
  }

  handleClick(event) {
    this.metrics.counts.click += 1;
    const target = event.target?.closest?.(INTERACTIVE_SELECTOR);
    if (!target) return;
    const startedAt = this.hoverStartByElement.get(target);
    if (!startedAt) return;
    const latency = Date.now() - startedAt;
    if (latency >= 0 && latency < 60000) {
      this.metrics.hoverClickSamples.push(latency);
      this.metrics.counts.hover_click_samples += 1;
    }
    this.hoverStartByElement.delete(target);
  }

  finalizeScrollBurst(now = Date.now()) {
    if (!this.scrollBurst) return;
    this.metrics.scrollBurstLengths.push(this.scrollBurst.events);
    if (this.scrollBurst.elapsedMs > 0) {
      this.metrics.scrollBurstSpeeds.push(this.scrollBurst.distance / (this.scrollBurst.elapsedMs / 1000));
    }
    this.scrollBurst = null;
    this.lastScrollAt = now;
  }

  handleScroll() {
    const now = Date.now();
    if (now - this.lastScrollSampleAt < SCROLL_SAMPLE_INTERVAL_MS) return;
    this.lastScrollSampleAt = now;
    this.metrics.counts.scroll_event += 1;
    const scrollTop = window.scrollY || window.pageYOffset || 0;
    const scrollHeight = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
    this.scrollMaxDepth = Math.max(this.scrollMaxDepth, Math.min(1, scrollTop / scrollHeight));

    if (!this.scrollBurst || now - this.lastScrollAt > 220) {
      this.finalizeScrollBurst(now);
      this.scrollBurst = { startedAt: now, lastAt: now, lastY: scrollTop, distance: 0, events: 1, elapsedMs: 0 };
      this.lastScrollAt = now;
      return;
    }

    this.scrollBurst.events += 1;
    this.scrollBurst.elapsedMs = now - this.scrollBurst.startedAt;
    this.scrollBurst.distance += Math.abs(scrollTop - this.scrollBurst.lastY);
    this.scrollBurst.lastY = scrollTop;
    this.scrollBurst.lastAt = now;
    this.lastScrollAt = now;
  }

  handleVisibilityChange() {
    const now = Date.now();
    if (document.hidden) {
      this.hiddenSince = now;
      this.enqueueCurrentWindow('visibility_hidden');
      this.persistQueue();
      return;
    }
    if (this.hiddenSince) {
      this.hiddenDurationMs += now - this.hiddenSince;
      this.hiddenSince = 0;
    }
    if (this.pendingSamples.length > 0) {
      this.flushQueue('visibility_resume');
    }
  }

  handlePageHide() {
    this.enqueueCurrentWindow('pagehide');
    this.persistQueue();
  }

  recordChatIncoming(chatId, timestamp) {
    const value = Number(new Date(timestamp || Date.now()).getTime());
    if (!Number.isFinite(value)) return;
    this.lastIncomingByChat.set(String(chatId), value);
  }

  recordChatReply(chatId) {
    const key = String(chatId || '');
    const lastIncomingAt = this.lastIncomingByChat.get(key);
    if (!lastIncomingAt) return;
    const latency = Date.now() - lastIncomingAt;
    if (latency > 0 && latency < 86_400_000) {
      this.metrics.responseLatencies.push(latency);
    }
    this.lastIncomingByChat.delete(key);
  }

  finalizeVisibleCards() {
    const now = Date.now();
    this.cardVisibleSince.forEach((startedAt, el) => {
      const cardKey = el.getAttribute('data-dfsn-card') || el.getAttribute('data-dfsn-card-id');
      if (!cardKey) return;
      this.cardDwell[cardKey] = (this.cardDwell[cardKey] || 0) + (now - startedAt);
      this.cardVisibleSince.set(el, now);
    });
  }

  buildPayload(reason) {
    const now = Date.now();
    this.finalizeScrollBurst(now);
    this.finalizeVisibleCards();
    this.screenDwell[this.route] = (this.screenDwell[this.route] || 0) + (now - this.routeEnteredAt);
    this.routeEnteredAt = now;

    const windowElapsed = Math.max(1, now - this.windowStartedAt);
    const sessionElapsed = Math.max(1, now - this.sessionStartedAt);
    const authOutcome = getBehaviorAuthOutcome() || 'authenticated_session';
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    const locale = (navigator.languages && navigator.languages[0]) || navigator.language || '';

    const qualityFlags = [...this.metrics.qualityFlags];
    if (document.hidden || (this.hiddenDurationMs / windowElapsed) > 0.45) qualityFlags.push('background_heavy');
    if (this.metrics.counts.key_down < 3) qualityFlags.push('low_keyboard_signal');
    if (this.metrics.counts.pointer_move < 5) qualityFlags.push('low_pointer_signal');
    if (this.metrics.counts.scroll_event < 2) qualityFlags.push('low_scroll_signal');
    if (this.metrics.counts.hover_click_samples < 1) qualityFlags.push('missing_hover_signal');

    return {
      session_id: this.sessionId,
      client_device_id: this.clientDeviceId,
      route_name: this.route,
      screen_name: this.route,
      typing_speed: mean(this.metrics.flightSamples) > 0 ? 60000 / mean(this.metrics.flightSamples) : 0,
      typing_variance: variance(this.metrics.flightSamples),
      typing_dwell_mean: mean(this.metrics.dwellSamples),
      typing_flight_mean: mean(this.metrics.flightSamples),
      backspace_rate: this.metrics.counts.key_down ? this.metrics.counts.backspace / this.metrics.counts.key_down : 0,
      correction_rate: this.metrics.counts.key_down ? this.metrics.counts.correction / this.metrics.counts.key_down : 0,
      mouse_speed: mean(this.metrics.pointerSpeeds),
      mouse_accuracy: this.metrics.counts.click ? Math.max(0, 1 - (this.metrics.counts.correction / Math.max(this.metrics.counts.click, 1))) : 0.85,
      hover_click_latency: mean(this.metrics.hoverClickSamples),
      scroll_depth: this.scrollMaxDepth,
      scroll_burst_length: mean(this.metrics.scrollBurstLengths),
      scroll_burst_speed: mean(this.metrics.scrollBurstSpeeds),
      dwell_per_screen: truncateMap(this.screenDwell),
      dwell_per_card: truncateMap(this.cardDwell),
      response_latency: mean(this.metrics.responseLatencies),
      navigation_path: this.navigationPath.slice(-24),
      session_time: Math.round(sessionElapsed / 1000),
      window_time: Math.round(windowElapsed / 1000),
      session_hour: new Date().getHours(),
      session_weekday: new Date().getDay(),
      timezone,
      locale,
      background_ratio: clamp(this.hiddenDurationMs / windowElapsed, 0, 1),
      data_quality_flags: Array.from(new Set(qualityFlags)),
      auth_outcome_label: authOutcome,
      event_counts: {
        ...this.metrics.counts,
        card_dwell_entries: Object.keys(this.cardDwell).length,
        screen_dwell_entries: Object.keys(this.screenDwell).length,
      },
      pattern: {
        reason,
        route: this.route,
        navigation_depth: this.navigationPath.length,
        sample_sizes: {
          dwell: this.metrics.dwellSamples.length,
          flight: this.metrics.flightSamples.length,
          pointer: this.metrics.pointerSpeeds.length,
          hover_click: this.metrics.hoverClickSamples.length,
          response: this.metrics.responseLatencies.length,
        },
      },
    };
  }

  hasUsefulSignal(payload) {
    const counts = payload?.event_counts || {};
    const score = [counts.key_down, counts.pointer_move, counts.scroll_event, counts.click]
      .map((value) => Number(value) || 0)
      .reduce((sum, value) => sum + value, 0);
    return score >= 8 || (Number(payload?.response_latency) || 0) > 0 || payload?.auth_outcome_label !== 'authenticated_session';
  }

  enqueueCurrentWindow(reason = 'interval') {
    if (!this.initialized || !getToken()) return;
    const payload = this.buildPayload(reason);
    if (!this.hasUsefulSignal(payload)) {
      this.resetWindowMetrics();
      return;
    }
    this.pendingSamples = [...this.pendingSamples.slice(-(MAX_PENDING_SAMPLES - 1)), payload];
    this.persistQueue();
    if (getBehaviorAuthOutcome()) clearBehaviorAuthOutcome();
    this.resetWindowMetrics();
    this.scrollMaxDepth = 0;
    this.screenDwell = {};
    this.cardDwell = {};
  }

  async flushQueue(reason = 'interval') {
    if (!this.initialized || this.flushInFlight || !getToken() || this.pendingSamples.length === 0) return;
    this.flushInFlight = true;
    const samples = this.pendingSamples.slice(0, MAX_PENDING_SAMPLES);
    try {
      await updateBehavioralDataBatch({ reason, samples });
      this.pendingSamples = this.pendingSamples.slice(samples.length);
      this.persistQueue();
    } catch (error) {
      console.error('DFSN batch flush failed', error);
    } finally {
      this.flushInFlight = false;
    }
  }
}

const collector = new DFSNCollector();

export function initDFSNCollector() {
  collector.init();
  return collector;
}

export function destroyDFSNCollector() {
  collector.destroy();
}

export function getDFSNCollector() {
  return collector;
}

export function recordChatIncoming(chatId, timestamp) {
  collector.recordChatIncoming(chatId, timestamp);
}

export function recordChatReply(chatId) {
  collector.recordChatReply(chatId);
}
