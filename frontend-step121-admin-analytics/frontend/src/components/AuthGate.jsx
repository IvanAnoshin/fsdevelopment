import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getMe, refreshSession, storePostLoginRedirect } from '../services/api';
import { clearAuthStorage, getToken, setStoredUser } from '../services/authStorage';
import { ensureE2EEReady } from '../services/e2ee';

function clearSession() {
  clearAuthStorage();
}

function SessionSplash({ title = 'Проверяем сессию', text = 'Подключаем ваш аккаунт…' }) {
  return (
    <div className="auth-gate-screen">
      <div className="auth-gate-card">
        <div className="auth-gate-spinner" aria-hidden="true" />
        <div className="auth-gate-title">{title}</div>
        <div className="auth-gate-text">{text}</div>
      </div>
    </div>
  );
}

export function AuthGate() {
  const location = useLocation();
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let alive = true;

    const restore = async () => {
      try {
        const token = getToken();
        if (!token) {
          const refreshed = await refreshSession();
          if (!alive) return;
          if (refreshed?.data?.user) {
            setStoredUser(refreshed.data.user);
            void ensureE2EEReady(refreshed.data.user).catch(() => null);
          }
          setStatus('authorized');
          return;
        }

        const res = await getMe();
        if (!alive) return;
        if (res?.data) {
          setStoredUser(res.data);
          void ensureE2EEReady(res.data).catch(() => null);
        }
        setStatus('authorized');
      } catch (_) {
        if (!alive) return;
        clearSession();
        setStatus('unauthorized');
      }
    };

    restore();

    return () => {
      alive = false;
    };
  }, []);

  if (status === 'checking') {
    return <SessionSplash />;
  }

  if (status === 'unauthorized') {
    const next = `${location.pathname}${location.search}${location.hash}`;
    storePostLoginRedirect(next);
    return <Navigate to="/login" replace state={{ from: next }} />;
  }

  return <Outlet />;
}

export function GuestGate() {
  const location = useLocation();
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let alive = true;

    const restore = async () => {
      try {
        const token = getToken();
        if (!token) {
          const refreshed = await refreshSession();
          if (!alive) return;
          if (refreshed?.data?.user) {
            setStoredUser(refreshed.data.user);
            void ensureE2EEReady(refreshed.data.user).catch(() => null);
          }
          setStatus('authorized');
          return;
        }

        const res = await getMe();
        if (!alive) return;
        if (res?.data) {
          setStoredUser(res.data);
          void ensureE2EEReady(res.data).catch(() => null);
        }
        setStatus('authorized');
      } catch (_) {
        if (!alive) return;
        clearSession();
        setStatus('guest');
      }
    };

    restore();

    return () => {
      alive = false;
    };
  }, []);

  if (status === 'checking') {
    return <SessionSplash title="Загружаем" text="Проверяем, нужно ли снова входить в аккаунт…" />;
  }

  if (status === 'authorized') {
    const target = typeof location.state?.from === 'string' ? location.state.from : '/feed';
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
