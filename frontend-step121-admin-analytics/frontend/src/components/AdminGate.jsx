import { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { getMe } from '../services/api';
import { setStoredUser } from '../services/authStorage';
import { canAccessAdminPanel, hasPermission, PERMISSIONS } from '../services/permissions';

function GateSplash() {
  return (
    <div className="auth-gate-screen">
      <div className="auth-gate-card">
        <div className="auth-gate-spinner" aria-hidden="true" />
        <div className="auth-gate-title">Проверяем доступ</div>
        <div className="auth-gate-text">Убеждаемся, что у вас есть права администратора…</div>
      </div>
    </div>
  );
}

export default function AdminGate({ permission = PERMISSIONS.ADMIN_PANEL }) {
  const location = useLocation();
  const [status, setStatus] = useState('checking');

  useEffect(() => {
    let alive = true;
    getMe()
      .then((res) => {
        if (!alive) return;
        if (res?.data) {
          setStoredUser(res.data);
        }
        setStatus((permission === PERMISSIONS.ADMIN_PANEL ? canAccessAdminPanel(res?.data) : hasPermission(res?.data, permission)) ? 'allowed' : 'forbidden');
      })
      .catch(() => {
        if (!alive) return;
        setStatus('forbidden');
      });

    return () => {
      alive = false;
    };
  }, [permission]);

  if (status === 'checking') return <GateSplash />;
  if (status === 'forbidden') {
    return <Navigate to="/feed" replace state={{ deniedFrom: location.pathname }} />;
  }
  return <Outlet />;
}
