import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { dispatchAppAction, getMe, logout as apiLogout, getFriendRequests, getUnreadCount, getUnreadNotificationsCount } from '../services/api';
import { getStoredUser, setStoredUser } from '../services/authStorage';
import { canAccessAdminPanel, canReviewRecovery, hasPermission, PERMISSIONS } from '../services/permissions';

const TITLES = [
  { match: (p) => p.startsWith('/feed'), title: 'Лента', subtitle: 'Друзья, подписки и глобальные обсуждения' },
  { match: (p) => p.startsWith('/messages'), title: 'Чаты', subtitle: 'Личные разговоры и быстрые ответы' },
  { match: (p) => p.startsWith('/friends'), title: 'Люди', subtitle: 'Друзья, контакты и новые знакомства' },
  { match: (p) => p.startsWith('/search'), title: 'Поиск', subtitle: 'Люди, посты и быстрые переходы' },
  { match: (p) => p.startsWith('/notifications'), title: 'Уведомления', subtitle: 'Всё важное в одном месте' },
  { match: (p) => p.startsWith('/profile'), title: 'Профиль', subtitle: 'Личная карточка, посты и активность' },
  { match: (p) => p.startsWith('/saved'), title: 'Сохранённое', subtitle: 'Подборки, быстрые сохранения и управление папками' },
  { match: (p) => p.startsWith('/settings/devices'), title: 'Настройки', subtitle: 'Устройства, безопасность и доверие' },
  { match: (p) => p.startsWith('/admin/recovery-requests'), title: 'Админка', subtitle: 'Заявки на восстановление доступа' },
  { match: (p) => p.startsWith('/admin/moderation'), title: 'Модерация', subtitle: 'Жалобы и обращения пользователей' },
  { match: (p) => p.startsWith('/admin/users'), title: 'Админка', subtitle: 'Управление ролями пользователей' },
  { match: (p) => p.startsWith('/admin/analytics'), title: 'Аналитика', subtitle: 'Трафик, рост и состояние продукта' },
];

function IconSearch() { return <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>; }
function IconBell() { return <svg viewBox="0 0 24 24"><path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5"></path><path d="M10 17a2 2 0 0 0 4 0"></path></svg>; }
function IconUser() { return <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M22 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>; }

function QuickAction({ onClick, tone = 'neutral', active = false, children, count }) {
  return (
    <button type="button" className={`pa-quick-chip ${tone} ${active ? 'is-active' : ''}`.trim()} onClick={onClick}>
      <span>{children}</span>
      {typeof count === 'number' && count > 0 && <strong>{Math.min(count, 99)}</strong>}
    </button>
  );
}

function StatusChip({ label, tone = 'neutral', count = 0, active = false, onClick }) {
  return (
    <button
      type="button"
      className={`pa-status-chip ${tone} ${active ? 'is-active' : ''}`.trim()}
      onClick={onClick}
    >
      <span>{label}</span>
      {typeof count === 'number' && count > 0 && <strong>{Math.min(count, 99)}</strong>}
    </button>
  );
}

export default function Header({ compact = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [unread, setUnread] = useState(0);
  const [messageUnread, setMessageUnread] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);

  const meta = useMemo(() => TITLES.find((item) => item.match(location.pathname)) || { title: 'Friendscape', subtitle: 'Социальная сеть доверия' }, [location.pathname]);

  const syncHeaderState = useCallback(async () => {
    try {
      const cached = getStoredUser();
      if (cached?.id) setUser(cached);
    } catch (_) {}

    try {
      const res = await getMe();
      setUser(res.data);
      setStoredUser(res.data);
    } catch (_) {}

    try {
      const [notificationsRes, messagesRes, requestsRes] = await Promise.all([
        getUnreadNotificationsCount().catch(() => ({ data: {} })),
        getUnreadCount().catch(() => ({ data: {} })),
        getFriendRequests().catch(() => ({ data: { requests: [] } })),
      ]);
      setUnread(Number(notificationsRes.data?.count ?? notificationsRes.data?.unread ?? 0));
      setMessageUnread(Number(messagesRes.data?.unread ?? messagesRes.data?.count ?? 0));
      setPendingRequests(Array.isArray(requestsRes.data?.requests) ? requestsRes.data.requests.length : 0);
    } catch (_) {}
  }, []);

  useEffect(() => {
    syncHeaderState();

    const intervalId = window.setInterval(() => {
      if (!document.hidden) syncHeaderState();
    }, 15000);

    const onVisibility = () => {
      if (!document.hidden) syncHeaderState();
    };

    const onUnreadRefresh = () => {
      syncHeaderState();
    };

    const onUserUpdated = (event) => {
      const nextUser = event?.detail;
      if (nextUser?.id) {
        setUser(nextUser);
        setStoredUser(nextUser);
      } else {
        syncHeaderState();
      }
    };

    const onUserRefresh = () => {
      syncHeaderState();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('app:unread-refresh', onUnreadRefresh);
    window.addEventListener('app:user-updated', onUserUpdated);
    window.addEventListener('app:user-refresh', onUserRefresh);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('app:unread-refresh', onUnreadRefresh);
      window.removeEventListener('app:user-updated', onUserUpdated);
      window.removeEventListener('app:user-refresh', onUserRefresh);
    };
  }, [location.pathname, syncHeaderState]);

  useEffect(() => {
    const handler = () => setMenuOpen(false);
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('click', handler);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('click', handler);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.search]);

  const isFeed = location.pathname.startsWith('/feed');
  const isMessages = location.pathname.startsWith('/messages');
  const isFriends = location.pathname.startsWith('/friends');
  const isNotifications = location.pathname.startsWith('/notifications');
  const isSearch = location.pathname.startsWith('/search');
  const isProfileRoot = location.pathname === '/profile';
  const isSaved = location.pathname.startsWith('/saved');

  const statusChips = useMemo(() => {
    const chips = [];
    if (messageUnread > 0 || isMessages) {
      chips.push({
        key: 'messages',
        label: isMessages ? 'Чаты' : 'Непрочитанные чаты',
        tone: 'accent',
        count: messageUnread,
        active: isMessages,
        onClick: () => (isMessages ? dispatchAppAction('messages.refresh') : navigate('/messages')),
      });
    }
    if (pendingRequests > 0 || location.search.includes('tab=requests')) {
      chips.push({
        key: 'requests',
        label: location.search.includes('tab=requests') ? 'Заявки' : 'Входящие заявки',
        tone: 'blue',
        count: pendingRequests,
        active: location.search.includes('tab=requests'),
        onClick: () => (isFriends ? dispatchAppAction('people.showRequests') : navigate('/friends?tab=requests')),
      });
    }
    if (unread > 0 || isNotifications) {
      chips.push({
        key: 'notifications',
        label: isNotifications ? 'Уведомления' : 'Новые события',
        tone: 'warning',
        count: unread,
        active: isNotifications,
        onClick: () => (isNotifications ? dispatchAppAction(unread > 0 ? 'notifications.filterUnread' : 'notifications.refresh') : navigate('/notifications')),
      });
    }
    if (!chips.length && isSearch) {
      chips.push({
        key: 'search-hint',
        label: 'Быстрый поиск',
        tone: 'neutral',
        count: 0,
        active: true,
        onClick: () => dispatchAppAction('search.focus'),
      });
    }
    return chips.slice(0, compact ? 2 : 3);
  }, [compact, isFriends, isMessages, isNotifications, isSearch, location.search, messageUnread, navigate, pendingRequests, unread]);

  const quickActions = useMemo(() => {
    const list = [];
    const pushNavigate = (key, label, to, tone = 'neutral', count = 0, active = false) => {
      list.push({ key, label, tone, count, active, onClick: () => navigate(to) });
    };
    const pushAction = (key, label, action, tone = 'neutral', count = 0, active = false) => {
      list.push({ key, label, tone, count, active, onClick: () => dispatchAppAction(action) });
    };

    if (isFeed) {
      pushAction('new-post', 'Новый пост', 'feed.focusComposer', 'accent');
      pushAction('refresh-feed', 'Обновить', 'feed.refresh');
      if (messageUnread > 0) pushNavigate('messages', 'Чаты', '/messages', 'accent', messageUnread);
      if (pendingRequests > 0) pushNavigate('requests', 'Заявки', '/friends?tab=requests', 'blue', pendingRequests);
      pushNavigate('search', 'Поиск', '/search');
    } else if (isMessages) {
      pushAction('refresh-messages', 'Обновить чат', 'messages.refresh', 'accent');
      pushNavigate('friends', 'Люди', '/friends');
      if (pendingRequests > 0) pushNavigate('requests', 'Заявки', '/friends?tab=requests', 'blue', pendingRequests);
      if (unread > 0) pushNavigate('notifications', 'Уведомления', '/notifications', 'warning', unread);
    } else if (isFriends) {
      pushAction('focus-search', 'Искать', 'people.focusSearch', 'accent');
      pushAction('refresh-people', 'Обновить', 'people.refresh');
      if (pendingRequests > 0) pushAction('requests', 'Заявки', 'people.showRequests', 'blue', pendingRequests, location.search.includes('tab=requests'));
      pushNavigate('feed', 'Лента', '/feed');
    } else if (isNotifications) {
      if (unread > 0) pushAction('only-unread', 'Непрочитанные', 'notifications.filterUnread', 'warning', unread, location.search.includes('filter=unread'));
      pushAction('mark-all', 'Прочитать всё', 'notifications.markAllRead', 'accent', 0, false);
      pushAction('refresh-notifications', 'Обновить', 'notifications.refresh');
      if (messageUnread > 0) pushNavigate('messages', 'Чаты', '/messages', 'accent', messageUnread);
    } else if (isSearch) {
      pushNavigate('feed', 'Лента', '/feed');
      pushNavigate('friends', 'Люди', '/friends');
      if (messageUnread > 0) pushNavigate('messages', 'Чаты', '/messages', 'accent', messageUnread);
      if (unread > 0) pushNavigate('notifications', 'Уведомления', '/notifications', 'warning', unread);
    } else if (isProfileRoot) {
      pushAction('edit-profile', 'Редактировать', 'profile.edit', 'accent');
      pushAction('profile-post', 'Новый пост', 'profile.focusComposer');
      pushNavigate('saved', 'Подборки', '/saved', 'accent');
      pushNavigate('feed', 'Лента', '/feed');
      pushNavigate('friends', 'Люди', '/friends');
    } else if (isSaved) {
      pushAction('saved-refresh', 'Обновить', 'saved.refresh', 'accent');
      pushNavigate('feed', 'Лента', '/feed');
      pushNavigate('profile', 'Профиль', '/profile');
      if (messageUnread > 0) pushNavigate('messages', 'Чаты', '/messages', 'accent', messageUnread);
    } else {
      if (!isFeed) pushNavigate('feed', 'Лента', '/feed');
      if (!isSearch) pushNavigate('search', 'Поиск', '/search');
      if (messageUnread > 0 && !isMessages) pushNavigate('messages', 'Чаты', '/messages', 'accent', messageUnread);
      if (pendingRequests > 0 && !isFriends) pushNavigate('requests', 'Заявки', '/friends?tab=requests', 'blue', pendingRequests);
      if (unread > 0 && !isNotifications) pushNavigate('notifications', 'Уведомления', '/notifications', 'warning', unread);
    }

    const seen = new Set();
    return list.filter((item) => {
      if (seen.has(item.key)) return false;
      seen.add(item.key);
      return true;
    }).slice(0, compact ? 4 : 5);
  }, [compact, isFeed, isFriends, isMessages, isNotifications, isProfileRoot, isSaved, isSearch, location.search, messageUnread, navigate, pendingRequests, unread]);

  return (
    <header className={`pa-topbar pa-glass ${compact ? 'compact' : ''}`.trim()}>
      <div className="pa-topbar-row">
        <div className="pa-title-block">
          <div className="pa-title-main">{meta.title}</div>
          <div className="pa-title-sub">{meta.subtitle}</div>
        </div>
        <div className="pa-topbar-actions">
          <button
            type="button"
            className={`pa-icon-btn ${isSearch ? 'is-active' : ''}`.trim()}
            onClick={() => (isSearch ? dispatchAppAction('search.focus') : navigate('/search'))}
            aria-label="Поиск"
            title="Поиск (/)"
          ><IconSearch /></button>
          <button
            type="button"
            className={`pa-icon-btn ${isNotifications ? 'is-active' : ''}`.trim()}
            onClick={() => (isNotifications ? dispatchAppAction(unread > 0 ? 'notifications.filterUnread' : 'notifications.refresh') : navigate('/notifications'))}
            aria-label="Уведомления"
            title="Уведомления"
          >
            <IconBell />
            {unread > 0 && <span className="pa-notification-badge">{Math.min(unread, 99)}</span>}
          </button>
          <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
            <button type="button" className="pa-icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Профиль" title="Меню профиля"><IconUser /></button>
            {menuOpen && (
              <div className="pa-dropdown">
                {user && (
                  <div className="pa-list-item" style={{ borderRadius: 16, padding: 10, marginBottom: 6 }}>
                    <div className="pa-name">{user.first_name || ''} {user.last_name || ''}</div>
                    <div className="pa-handle">@{user.username || 'user'}</div>
                  </div>
                )}
                <div className="pa-pill-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
                  {messageUnread > 0 && <span className="pa-pill accent">Чаты: {Math.min(messageUnread, 99)}</span>}
                  {pendingRequests > 0 && <span className="pa-pill blue">Заявки: {pendingRequests}</span>}
                  {unread > 0 && <span className="pa-pill warning">Уведомления: {Math.min(unread, 99)}</span>}
                </div>
                <div className="pa-dropdown-note">Быстрые клавиши: <strong>/</strong> — поиск, <strong>N</strong> — новый пост.</div>
                <button className="pa-dropdown-item" onClick={() => { navigate('/profile'); setMenuOpen(false); }}>Мой профиль</button>
                {messageUnread > 0 && <button className="pa-dropdown-item" onClick={() => { navigate('/messages'); setMenuOpen(false); }}>Непрочитанные чаты ({Math.min(messageUnread, 99)})</button>}
                {pendingRequests > 0 && <button className="pa-dropdown-item" onClick={() => { navigate('/friends?tab=requests'); setMenuOpen(false); }}>Заявки в друзья ({pendingRequests})</button>}
                {unread > 0 && <button className="pa-dropdown-item" onClick={() => { navigate('/notifications'); setMenuOpen(false); }}>Новые уведомления ({Math.min(unread, 99)})</button>}
                <button className="pa-dropdown-item" onClick={() => { navigate('/feed'); setMenuOpen(false); }}>Открыть ленту</button>
                <button className="pa-dropdown-item" onClick={() => { navigate('/saved'); setMenuOpen(false); }}>Сохранённое и подборки</button>
                <button className="pa-dropdown-item" onClick={() => { navigate('/search'); setMenuOpen(false); }}>Поиск людей и постов</button>
                <button className="pa-dropdown-item" onClick={() => { navigate('/settings/devices'); setMenuOpen(false); }}>Устройства и безопасность</button>
                {hasPermission(user, PERMISSIONS.USERS_MODERATE) && (
                  <button className="pa-dropdown-item" onClick={() => { navigate('/admin/moderation'); setMenuOpen(false); }}>Модерация: жалобы</button>
                )}
                {canReviewRecovery(user) && (
                  <button className="pa-dropdown-item" onClick={() => { navigate('/admin/recovery-requests'); setMenuOpen(false); }}>Админка: заявки</button>
                )}
                {canAccessAdminPanel(user) && (
                  <>
                    <button className="pa-dropdown-item" onClick={() => { navigate('/admin/users'); setMenuOpen(false); }}>Админка: роли</button>
                    <button className="pa-dropdown-item" onClick={() => { navigate('/admin/analytics'); setMenuOpen(false); }}>Админка: аналитика</button>
                  </>
                )}
                <button className="pa-dropdown-item danger" onClick={() => { setMenuOpen(false); apiLogout(); }}>Выйти</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {statusChips.length > 0 && (
        <div className="pa-header-status-row">
          {statusChips.map((item) => (
            <StatusChip key={item.key} label={item.label} tone={item.tone} count={item.count} active={item.active} onClick={item.onClick} />
          ))}
        </div>
      )}
      {quickActions.length > 0 && (
        <div className="pa-header-quick-row">
          {quickActions.map((item) => (
            <QuickAction key={item.key} tone={item.tone} count={item.count} active={item.active} onClick={item.onClick}>{item.label}</QuickAction>
          ))}
        </div>
      )}
    </header>
  );
}
