import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { getStoredUser } from '../services/authStorage';
import { buildDocumentTitle, formatDisplayName } from '../utils/pageTitle';

function titleForPath(pathname, currentUser) {
  const path = String(pathname || '');
  const currentUserId = String(currentUser?.id || '').trim();
  const currentUserName = formatDisplayName(currentUser);

  if (path === '/' || path === '/login') return buildDocumentTitle('Вход');
  if (path === '/register') return buildDocumentTitle('Регистрация');
  if (path === '/recovery') return buildDocumentTitle('Восстановление доступа');
  if (path === '/recovery-request') return buildDocumentTitle('Заявка на восстановление');
  if (path.startsWith('/recovery/status/')) return buildDocumentTitle('Статус восстановления');
  if (path.startsWith('/recovery/setup/')) return buildDocumentTitle('Новая защита аккаунта');
  if (path === '/reset-password') return buildDocumentTitle('Сброс пароля');
  if (path === '/setup-security') return buildDocumentTitle('Настройка безопасности');
  if (path === '/setup-dfsn') return buildDocumentTitle('Настройка DFSN');

  if (path === '/feed') return buildDocumentTitle('Лента');
  if (path.startsWith('/messages')) return buildDocumentTitle('Чаты');
  if (path === '/friends') return buildDocumentTitle('Люди');
  if (path === '/search') return buildDocumentTitle('Поиск');
  if (path === '/communities') return buildDocumentTitle('Сообщества');
  if (path === '/notifications') return buildDocumentTitle('Уведомления');
  if (path === '/saved') return buildDocumentTitle('Сохранённое');
  if (path === '/settings/support') return buildDocumentTitle('Поддержка');
  if (path === '/settings/devices') return buildDocumentTitle('Устройства');
  if (path.startsWith('/settings/devices/')) return buildDocumentTitle('Устройство');
  if (path === '/admin/recovery-requests') return buildDocumentTitle('Заявки на восстановление');
  if (path === '/admin/moderation') return buildDocumentTitle('Модерация');
  if (path === '/admin/users') return buildDocumentTitle('Роли и доступы');
  if (path === '/admin/analytics') return buildDocumentTitle('Аналитика');

  if (path === '/profile') return buildDocumentTitle('Профиль', currentUserName);
  if (path.startsWith('/profile/')) {
    const pathId = path.split('/')[2] || '';
    if (currentUserId && pathId === currentUserId) {
      return buildDocumentTitle('Профиль', currentUserName);
    }
    return buildDocumentTitle('Профиль');
  }

  return buildDocumentTitle('Friendscape');
}

export default function DocumentTitleManager() {
  const location = useLocation();
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());

  useEffect(() => {
    const syncUser = () => setCurrentUser(getStoredUser());
    window.addEventListener('app:auth-changed', syncUser);
    return () => window.removeEventListener('app:auth-changed', syncUser);
  }, []);

  const title = useMemo(() => titleForPath(location.pathname, currentUser), [location.pathname, currentUser]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = title;
  }, [title]);

  return null;
}
