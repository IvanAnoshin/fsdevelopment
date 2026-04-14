import { Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Header from './Header';
import FirstPinPrompt from './postauth/FirstPinPrompt';
import { dispatchAppAction, getFriendRequests, getUnreadCount, showToast } from '../services/api';
import { getStoredUser, getToken } from '../services/authStorage';
import { getRealtimeClient } from '../services/realtime';

function icon(path) {
  switch (path) {
    case '/feed': return <svg viewBox="0 0 24 24"><path d="M3 9L12 3L21 9L21 20H15V14H9V20H3V9Z"></path></svg>;
    case '/friends': return <svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>;
    case '/messages': return <svg viewBox="0 0 24 24"><path d="M21 15C21 15.5304 20.7893 16.0391 20.4142 16.4142C20.0391 16.7893 19.5304 17 19 17H7L3 21V5C3 4.46957 3.21071 3.96086 3.58579 3.58579C3.96086 3.21071 4.46957 3 5 3H19C19.5304 3 20.0391 3.21071 20.4142 3.58579C20.7893 3.96086 21 4.46957 21 5V15Z"></path></svg>;
    case '/profile': return <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>;
    default: return <svg viewBox="0 0 24 24"><path d="M4 7h16"></path><path d="M4 12h16"></path><path d="M4 17h16"></path></svg>;
  }
}


const SCROLL_STORAGE_KEY = 'pa:scroll-positions';
const SCROLL_ELIGIBLE_PREFIXES = ['/feed', '/friends', '/search', '/communities', '/notifications', '/profile', '/saved', '/settings/devices', '/settings/support', '/admin'];

function isScrollRestorableRoute(pathname) {
  return SCROLL_ELIGIBLE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`) || pathname.startsWith(`${prefix}?`));
}

function normalizeScrollKey(pathname, search) {
  return `${pathname}${search || ''}`;
}

function readScrollPositions() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SCROLL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeScrollPosition(key, value) {
  if (typeof window === 'undefined' || !key) return;
  try {
    const next = { ...readScrollPositions(), [key]: Math.max(0, Math.round(value || 0)) };
    window.sessionStorage.setItem(SCROLL_STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

function readScrollPosition(key) {
  if (!key) return null;
  const value = readScrollPositions()[key];
  return Number.isFinite(value) ? value : null;
}

const items = [
  { path: '/feed', label: 'Лента' },
  { path: '/friends', label: 'Люди' },
  { path: '/messages', label: 'Чаты' },
  { path: '/profile', label: 'Профиль' },
  { path: '/settings/devices', label: 'Настройки' },
];

export default function ShellLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [messageUnread, setMessageUnread] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [compactNav, setCompactNav] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 370 : false));
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [scrolled, setScrolled] = useState(false);
  const [routeEntering, setRouteEntering] = useState(false);
  const [pinPrompt, setPinPrompt] = useState({ open: false, deviceId: '', storageKey: '' });
  const toastTimersRef = useRef(new Map());
  const previousLocationRef = useRef(`${location.pathname}${location.search}`);
  const scrollSaveRafRef = useRef(0);

  useEffect(() => {
    document.body.classList.add('post-auth-mode');
    const timers = toastTimersRef.current;
    return () => {
      document.body.classList.remove('post-auth-mode');
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token) navigate('/login', { replace: true });
  }, [navigate, location.pathname]);

  const syncShellCounters = useCallback(async () => {
    try {
      const [messagesRes, requestsRes] = await Promise.all([
        getUnreadCount().catch(() => ({ data: {} })),
        getFriendRequests().catch(() => ({ data: { requests: [] } })),
      ]);
      setMessageUnread(Number(messagesRes.data?.unread ?? messagesRes.data?.count ?? 0));
      setPendingRequests(Array.isArray(requestsRes.data?.requests) ? requestsRes.data.requests.length : 0);
    } catch (_) {}
  }, []);

  useEffect(() => {
    syncShellCounters();

    const intervalId = window.setInterval(() => {
      if (!document.hidden) syncShellCounters();
    }, 15000);

    const onVisibility = () => {
      if (!document.hidden) syncShellCounters();
    };

    const onUnreadRefresh = () => syncShellCounters();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('app:unread-refresh', onUnreadRefresh);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('app:unread-refresh', onUnreadRefresh);
    };
  }, [location.pathname, syncShellCounters]);

  useEffect(() => {
    const client = getRealtimeClient();
    client.configure({ tokenProvider: getToken });
    client.connect();
    const unsubscribe = client.subscribe((event) => {
      if (event?.type?.startsWith('message:') || event?.type?.startsWith('notification:')) {
        syncShellCounters();
      }
    });
    const onShellAction = (event) => {
      if (event?.detail?.action === 'shell.syncCounters') {
        syncShellCounters();
      }
    };
    window.addEventListener('app:action', onShellAction);
    return () => {
      unsubscribe();
      window.removeEventListener('app:action', onShellAction);
    };
  }, [syncShellCounters]);

  useEffect(() => {
    const evaluate = () => {
      const baseHeight = window.innerHeight;
      const viewportHeight = window.visualViewport?.height || baseHeight;
      const width = window.innerWidth;
      setKeyboardOpen(baseHeight - viewportHeight > 180);
      setCompactNav(width <= 370 || baseHeight - viewportHeight > 180);
    };

    const onScroll = () => setScrolled(window.scrollY > 12);

    evaluate();
    onScroll();
    window.addEventListener('resize', evaluate);
    window.visualViewport?.addEventListener('resize', evaluate);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', evaluate);
      window.visualViewport?.removeEventListener('resize', evaluate);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  useEffect(() => {
    const routeKey = isScrollRestorableRoute(location.pathname)
      ? normalizeScrollKey(location.pathname, location.search)
      : '';
    if (!routeKey) return undefined;

    const persistScroll = () => {
      if (scrollSaveRafRef.current) window.cancelAnimationFrame(scrollSaveRafRef.current);
      scrollSaveRafRef.current = window.requestAnimationFrame(() => {
        writeScrollPosition(routeKey, window.scrollY || window.pageYOffset || 0);
      });
    };

    const persistOnUnload = () => writeScrollPosition(routeKey, window.scrollY || window.pageYOffset || 0);

    window.addEventListener('scroll', persistScroll, { passive: true });
    window.addEventListener('beforeunload', persistOnUnload);

    return () => {
      if (scrollSaveRafRef.current) {
        window.cancelAnimationFrame(scrollSaveRafRef.current);
        scrollSaveRafRef.current = 0;
      }
      persistOnUnload();
      window.removeEventListener('scroll', persistScroll);
      window.removeEventListener('beforeunload', persistOnUnload);
    };
  }, [location.pathname, location.search]);


  useEffect(() => {
    const previous = previousLocationRef.current;
    const next = `${location.pathname}${location.search}`;

    if (previous !== next) {
      const [previousPathname = '', previousSearch = ''] = previous.split(/(?=\?)/);
      const prevMessages = previous.startsWith('/messages');
      const nextMessages = location.pathname.startsWith('/messages');

      if (isScrollRestorableRoute(previousPathname)) {
        const previousKey = normalizeScrollKey(previousPathname, previousSearch);
        writeScrollPosition(previousKey, window.scrollY || window.pageYOffset || 0);
      }

      const restoreKey = isScrollRestorableRoute(location.pathname)
        ? normalizeScrollKey(location.pathname, location.search)
        : '';
      const savedScroll = navigationType === 'POP' ? readScrollPosition(restoreKey) : null;

      if (savedScroll != null) {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            window.scrollTo({ top: savedScroll, left: 0, behavior: 'auto' });
          });
        });
      } else if (!(prevMessages && nextMessages)) {
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      }

      setRouteEntering(true);
      const timerId = window.setTimeout(() => setRouteEntering(false), 220);
      previousLocationRef.current = next;
      return () => window.clearTimeout(timerId);
    }
    return undefined;
  }, [location.pathname, location.search, navigationType]);

  useEffect(() => {
    const onOffline = () => showToast('Нет подключения к сети. Некоторые действия могут не сохраниться сразу.', { tone: 'warning', id: 'network-status', duration: 3600 });
    const onOnline = () => showToast('Соединение восстановлено.', { tone: 'success', id: 'network-status', duration: 2200 });
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      const target = event.target;
      const tag = target?.tagName?.toLowerCase?.();
      const isTyping = target?.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select';
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === '/') {
        event.preventDefault();
        if (location.pathname.startsWith('/search')) dispatchAppAction('search.focus');
        else if (location.pathname.startsWith('/friends')) dispatchAppAction('people.focusSearch');
        else if (location.pathname.startsWith('/messages')) dispatchAppAction('messages.focusSearch');
        else {
          navigate('/search');
          window.setTimeout(() => dispatchAppAction('search.focus'), 80);
        }
      }

      if ((event.key === 'n' || event.key === 'N') && !event.shiftKey) {
        if (location.pathname.startsWith('/feed')) {
          event.preventDefault();
          dispatchAppAction('feed.focusComposer');
        } else if (location.pathname === '/profile') {
          event.preventDefault();
          dispatchAppAction('profile.focusComposer');
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [location.pathname, navigate]);

  useEffect(() => {
    const onToast = (event) => {
      const detail = event?.detail || {};
      if (!detail.message) return;
      const id = detail.id || `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const tone = detail.tone || 'neutral';
      const duration = Number(detail.duration ?? 2800);

      setToasts((prev) => [...prev.filter((item) => item.id !== id), { id, message: detail.message, tone }].slice(-3));

      const existingTimer = toastTimersRef.current.get(id);
      if (existingTimer) window.clearTimeout(existingTimer);
      const timerId = window.setTimeout(() => {
        setToasts((prev) => prev.filter((item) => item.id !== id));
        toastTimersRef.current.delete(id);
      }, duration);
      toastTimersRef.current.set(id, timerId);
    };

    const onConfirm = (event) => {
      const detail = event?.detail || {};
      if (!detail.id) return;
      setConfirmState({
        id: detail.id,
        title: detail.title || 'Подтвердите действие',
        message: detail.message || 'Вы уверены, что хотите продолжить?',
        confirmLabel: detail.confirmLabel || 'Подтвердить',
        cancelLabel: detail.cancelLabel || 'Отмена',
        tone: detail.tone || 'neutral',
      });
    };

    window.addEventListener('app:toast', onToast);
    window.addEventListener('app:confirm', onConfirm);
    return () => {
      window.removeEventListener('app:toast', onToast);
      window.removeEventListener('app:confirm', onConfirm);
    };
  }, []);

  const closeToast = useCallback((id) => {
    if (!id) return;
    const timerId = toastTimersRef.current.get(id);
    if (timerId) {
      window.clearTimeout(timerId);
      toastTimersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const resolveConfirm = useCallback((confirmed) => {
    if (!confirmState?.id) return;
    window.dispatchEvent(new CustomEvent(`app:confirm:response:${confirmState.id}`, { detail: { confirmed } }));
    setConfirmState(null);
  }, [confirmState]);

  useEffect(() => {
    if (!confirmState) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') resolveConfirm(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [confirmState, resolveConfirm]);

  const shellClassName = useMemo(() => `pa-shell ${compactNav ? 'compact-nav' : ''} ${keyboardOpen ? 'keyboard-open' : ''} ${scrolled ? 'scrolled' : ''}`.trim(), [compactNav, keyboardOpen, scrolled]);

  const dismissPinPrompt = useCallback((markSeen = true) => {
    if (typeof window !== 'undefined' && markSeen && pinPrompt.storageKey) {
      try {
        window.localStorage.setItem(pinPrompt.storageKey, '1');
      } catch {}
    }
    setPinPrompt({ open: false, deviceId: '', storageKey: '' });
  }, [pinPrompt.storageKey]);

  const handlePinPromptSetup = useCallback(() => {
    const deviceId = pinPrompt.deviceId;
    dismissPinPrompt(true);
    if (deviceId) {
      navigate(`/settings/devices/${deviceId}`);
    }
  }, [dismissPinPrompt, navigate, pinPrompt.deviceId]);

  useEffect(() => {
    const user = getStoredUser();
    if (!user?.id || !user.current_device_id || user.current_device_pin_enabled || location.pathname.startsWith('/settings/devices')) {
      setPinPrompt((prev) => (prev.open ? { open: false, deviceId: '', storageKey: '' } : prev));
      return undefined;
    }

    const storageKey = `pa:pin-prompt-seen:${user.id}:${user.current_device_id}`;
    try {
      if (window.localStorage.getItem(storageKey) === '1') {
        return undefined;
      }
    } catch {
      // ignore storage failures
    }

    const timerId = window.setTimeout(() => {
      setPinPrompt({ open: true, deviceId: user.current_device_id, storageKey });
    }, 900);

    return () => window.clearTimeout(timerId);
  }, [location.pathname]);

  return (
    <div className={shellClassName}>
      <div className="pa-app">
        <div className="pa-screen">
          <a href="#pa-main-content" className="pa-skip-link">Перейти к содержимому</a>
          <Header compact={compactNav || scrolled} />
          <main id="pa-main-content" className={`pa-route-stage ${routeEntering ? 'is-entering' : ''}`.trim()}>
            <Outlet />
          </main>
        </div>
        <nav className="pa-bottom-nav" aria-label="Навигация">
          {items.map((item) => {
            const active = location.pathname === item.path || (item.path === '/messages' && location.pathname.startsWith('/messages/')) || (item.path === '/profile' && location.pathname.startsWith('/profile')) || (item.path === '/settings/devices' && location.pathname.startsWith('/settings/devices'));
            const badge = item.path === '/messages' ? messageUnread : item.path === '/friends' ? pendingRequests : 0;
            return (
              <button key={item.path} type="button" className={`pa-nav-btn ${active ? 'active' : ''}`} onClick={() => navigate(item.path)} aria-label={item.label} aria-current={active ? 'page' : undefined}>
                <span className="pa-nav-icon-wrap">
                  {icon(item.path)}
                  {badge > 0 && <span className="pa-nav-badge">{Math.min(badge, 99)}</span>}
                </span>
                <span className="pa-nav-label">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {toasts.length > 0 && (
        <div className="pa-toast-stack" aria-live="polite" aria-atomic="true">
          {toasts.map((toast) => (
            <div key={toast.id} className={`pa-toast ${toast.tone || 'neutral'}`.trim()}>
              <span>{toast.message}</span>
              <button type="button" className="pa-toast-close" onClick={() => closeToast(toast.id)} aria-label="Закрыть уведомление">×</button>
            </div>
          ))}
        </div>
      )}

      {confirmState && (
        <>
          <div className="pa-confirm-backdrop" onClick={() => resolveConfirm(false)} />
          <div className="pa-confirm-sheet pa-glass" role="dialog" aria-modal="true" aria-labelledby="pa-confirm-title">
            <div className="pa-confirm-handle" />
            <div className="pa-confirm-title" id="pa-confirm-title">{confirmState.title}</div>
            <div className="pa-confirm-text">{confirmState.message}</div>
            <div className="pa-confirm-actions">
              <button type="button" className="pa-secondary-btn" onClick={() => resolveConfirm(false)}>{confirmState.cancelLabel}</button>
              <button type="button" className={confirmState.tone === 'danger' ? 'pa-danger-btn' : 'pa-primary-btn'} onClick={() => resolveConfirm(true)}>{confirmState.confirmLabel}</button>
            </div>
          </div>
        </>
      )}

      <FirstPinPrompt open={pinPrompt.open} onDismiss={() => dismissPinPrompt(true)} onSetup={handlePinPromptSetup} />
    </div>
  );
}
