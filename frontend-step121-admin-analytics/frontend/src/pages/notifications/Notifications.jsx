import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  PostAuthAvatarStack,
  PostAuthEmptyState,
  PostAuthFilterChips,
  PostAuthHero,
  PostAuthNoticeCard,
  PostAuthNotificationCard,
  PostAuthSectionHead,
  PostAuthSkeletonNotificationCard,
  PostAuthSummaryCard,
} from '../../components/postauth';
import { getRelationshipMeta } from '../../components/postauth/relationship';
import {
  acceptFriendRequest,
  checkFriendship,
  getMe,
  getNotifications,
  getUser,
  markAllAsRead,
  markAsRead,
  getApiErrorMessage,
  requestUnreadRefresh,
  sendFriendRequest,
  showToast,
  subscribe,
  unsubscribe,
  unfriend,
  broadcastRelationshipUpdated,
} from '../../services/api';
import { getStoredUser } from '../../services/authStorage';
import { REALTIME_BROWSER_EVENT } from '../../services/realtime';

function formatDate(value) {
  if (!value) return 'только что';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? 'только что'
    : d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function extractUserId(link) {
  if (typeof link !== 'string') return null;
  const profileMatch = link.match(/^\/profile\/(\d+)/);
  if (profileMatch) return profileMatch[1];
  const messageMatch = link.match(/^\/messages\/(\d+)/);
  if (messageMatch) return messageMatch[1];
  return null;
}

function actionButtonsForStatus(status, hasUserLink) {
  if (status === 'self') return [];
  const buttons = [];
  if (status === 'friends') buttons.push('message', 'unfriend');
  else if (status === 'request_received') buttons.push('accept');
  else if (status === 'subscribed') buttons.push('unsubscribe', 'friend');
  else if (status === 'none') buttons.push('friend', 'subscribe');
  if (hasUserLink) buttons.push('profile');
  return buttons;
}

function resolveLink(notification) {
  const link = notification?.link;
  if (typeof link === 'string' && link.trim()) {
    if (link.startsWith('/post/')) return '/feed';
    if (link.startsWith('/messages/')) return link;
    if (link.startsWith('/profile/')) return link;
    if (link.startsWith('/recovery/')) return link;
    if (link.startsWith('/friends')) return link;
    if (link.startsWith('/')) return link;
  }
  if (notification?.type === 'friend_request') return '/friends?tab=requests';
  if (notification?.type === 'friend_accept') return '/friends';
  if (notification?.type === 'subscription') return notification?.link || '/friends?tab=subscriptions';
  if (notification?.type?.includes('recovery')) return '/recovery';
  if (notification?.type?.includes('message')) return '/messages';
  if (notification?.type?.includes('comment') || notification?.type?.includes('like')) return '/feed';
  return null;
}

function actionLabel(notification) {
  const link = resolveLink(notification) || '';
  if (notification?.type === 'friend_request') return 'Открыть заявки';
  if (notification?.type === 'friend_accept') return 'Открыть друзей';
  if (notification?.type === 'subscription') return 'Открыть профиль';
  if (notification?.type?.includes('message') || link.startsWith('/messages/')) return 'Открыть чат';
  if (notification?.type?.includes('recovery')) return 'Открыть восстановление';
  if (notification?.type === 'mention_comment') return 'Открыть упоминание';
  if (notification?.type === 'comment_reply') return 'Открыть ответ';
  if (notification?.type === 'comment_like' || notification?.type === 'comment_dislike') return 'Открыть комментарий';
  if (notification?.type?.includes('comment') || notification?.type?.includes('like') || link.startsWith('/feed')) return 'Открыть пост';
  if (link.startsWith('/profile/')) return 'Открыть профиль';
  return 'Открыть';
}

function typeMeta(type) {
  if (type === 'friend_request') return { label: 'Заявка', cls: 'blue', short: 'FR' };
  if (type === 'friend_accept') return { label: 'Дружба', cls: 'green', short: 'OK' };
  if (type === 'subscription') return { label: 'Подписка', cls: 'accent', short: 'SU' };
  if (type?.includes('message')) return { label: 'Сообщения', cls: 'purple', short: 'MSG' };
  if (type?.includes('recovery')) return { label: 'Безопасность', cls: 'warning', short: 'SEC' };
  if (type === 'mention_comment') return { label: 'Упоминание', cls: 'accent', short: 'ME' };
  if (type === 'comment_reply') return { label: 'Ответ', cls: 'purple', short: 'RP' };
  if (type === 'comment_like') return { label: 'Лайк на комментарий', cls: 'green', short: 'CL' };
  if (type === 'comment_dislike') return { label: 'Минус на комментарий', cls: 'warning', short: 'CD' };
  if (type?.includes('comment')) return { label: 'Комментарий', cls: 'blue', short: 'CM' };
  if (type?.includes('like')) return { label: 'Лайк', cls: 'green', short: 'LK' };
  return { label: 'Событие', cls: 'neutral', short: 'EV' };
}

function filterMatches(notification, filter) {
  if (filter === 'all') return true;
  if (filter === 'unread') return !notification.is_read;
  if (filter === 'social') return ['friend_request', 'friend_accept', 'subscription', 'like', 'comment', 'comment_reply', 'mention_comment', 'comment_like', 'comment_dislike'].includes(notification.type);
  if (filter === 'mentions') return notification.type === 'mention_comment';
  if (filter === 'replies') return notification.type === 'comment_reply';
  if (filter === 'messages') return notification.type?.includes('message');
  if (filter === 'security') return notification.type?.includes('recovery');
  return true;
}

function emptyStateMeta(filter) {
  if (filter === 'unread') {
    return {
      title: 'Все уведомления прочитаны',
      text: 'Сейчас нет непрочитанных событий. Можно вернуться ко всем уведомлениям или обновить список.',
      primary: 'Все уведомления',
      primaryAction: 'all',
      secondary: 'Обновить',
      secondaryAction: 'refresh',
    };
  }
  if (filter === 'social') {
    return {
      title: 'Нет событий по связям',
      text: 'Заявки в друзья, подписки и реакции на комментарии будут появляться здесь.',
      primary: 'Открыть людей',
      primaryAction: 'friends',
      secondary: 'Все уведомления',
      secondaryAction: 'all',
    };
  }
  if (filter === 'mentions') {
    return {
      title: 'Пока нет упоминаний',
      text: 'Когда вас упомянут в комментарии через @username, это появится здесь.',
      primary: 'Все уведомления',
      primaryAction: 'all',
      secondary: 'Открыть ленту',
      secondaryAction: 'feed',
    };
  }
  if (filter === 'replies') {
    return {
      title: 'Пока нет ответов на комментарии',
      text: 'Ответы на ваши комментарии будут собраны в отдельный фильтр, чтобы не теряться в общем потоке.',
      primary: 'Все уведомления',
      primaryAction: 'all',
      secondary: 'Открыть ленту',
      secondaryAction: 'feed',
    };
  }
  if (filter === 'messages') {
    return {
      title: 'Пока нет событий по сообщениям',
      text: 'Новые ответы и диалоги будут появляться здесь. Можно перейти в чаты или проверить все уведомления.',
      primary: 'Открыть чаты',
      primaryAction: 'messages',
      secondary: 'Все уведомления',
      secondaryAction: 'all',
    };
  }
  if (filter === 'security') {
    return {
      title: 'Пока нет событий по безопасности',
      text: 'Уведомления по восстановлению и настройкам безопасности появятся здесь.',
      primary: 'Открыть восстановление',
      primaryAction: 'recovery',
      secondary: 'Все уведомления',
      secondaryAction: 'all',
    };
  }
  return {
    title: 'Пока пусто',
    text: 'Новые события появятся здесь. Пока можно открыть ленту, людей или просто обновить список.',
    primary: 'Открыть ленту',
    primaryAction: 'feed',
    secondary: 'Обновить',
    secondaryAction: 'refresh',
  };
}

function heroOrbCount(notifications) {
  return notifications.filter((item) => !item.is_read).slice(0, 4);
}

export default function Notifications() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [actingId, setActingId] = useState(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [currentUser, setCurrentUser] = useState(() => getStoredUser() || null);
  const [relationMap, setRelationMap] = useState({});
  const notificationsRequestRef = useRef(0);

  const loadNotifications = useCallback(async () => {
    const requestId = ++notificationsRequestRef.current;
    try {
      setLoading(true);
      setError('');
      const res = await getNotifications();
      if (requestId !== notificationsRequestRef.current) return;
      setNotifications(Array.isArray(res.data?.notifications) ? res.data.notifications : []);
    } catch (err) {
      if (requestId !== notificationsRequestRef.current) return;
      console.error('Ошибка уведомлений:', err);
      setError(getApiErrorMessage(err, 'Не удалось загрузить уведомления'));
    } finally {
      if (requestId === notificationsRequestRef.current) {
        setLoading(false);
      }
    }
  }, []);

  const handleMarkAllRead = useCallback(async () => {
    if (markingAll || unreadCount === 0) return;
    try {
      setMarkingAll(true);
      await markAllAsRead();
      setNotifications((prev) => prev.map((item) => ({ ...item, is_read: true })));
      requestUnreadRefresh();
      showToast('Все уведомления отмечены как прочитанные', { tone: 'success' });
    } catch (err) {
      console.error('Ошибка mark all:', err);
      setError(getApiErrorMessage(err, 'Не удалось отметить уведомления как прочитанные'));
    } finally {
      setMarkingAll(false);
    }
  }, [markingAll, unreadCount]);

  const unreadCount = useMemo(() => notifications.filter((item) => !item.is_read).length, [notifications]);
  const filteredNotifications = useMemo(() => notifications.filter((item) => filterMatches(item, filter)), [notifications, filter]);
  const groupedNotifications = useMemo(() => {
    if (filter !== 'all') {
      return [{ key: filter, title: null, meta: null, items: filteredNotifications }];
    }
    const unread = filteredNotifications.filter((item) => !item.is_read);
    const read = filteredNotifications.filter((item) => item.is_read);
    return [
      unread.length ? { key: 'unread', title: 'Новые', meta: `${unread.length} событий`, items: unread } : null,
      read.length ? { key: 'read', title: 'Ранее', meta: `${read.length} событий`, items: read } : null,
    ].filter(Boolean);
  }, [filter, filteredNotifications]);
  const emptyMeta = useMemo(() => emptyStateMeta(filter), [filter]);

  const socialCount = useMemo(
    () => notifications.filter((item) => ['friend_request', 'friend_accept', 'subscription', 'like', 'comment', 'comment_reply', 'mention_comment', 'comment_like', 'comment_dislike'].includes(item.type)).length,
    [notifications],
  );
  const mentionCount = useMemo(() => notifications.filter((item) => item.type === 'mention_comment').length, [notifications]);
  const replyCount = useMemo(() => notifications.filter((item) => item.type === 'comment_reply').length, [notifications]);
  const messageCount = useMemo(() => notifications.filter((item) => item.type?.includes('message')).length, [notifications]);
  const securityCount = useMemo(() => notifications.filter((item) => item.type?.includes('recovery')).length, [notifications]);
  const readCount = useMemo(() => notifications.filter((item) => item.is_read).length, [notifications]);
  const heroItems = useMemo(() => heroOrbCount(notifications), [notifications]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const nextFilter = search.get('filter');
    if (nextFilter && ['all', 'unread', 'social', 'mentions', 'replies', 'messages', 'security'].includes(nextFilter) && nextFilter !== filter) {
      setFilter(nextFilter);
    }
  }, [filter]);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    const onRealtimeEvent = (event) => {
      const type = event?.detail?.type || '';
      if (type.startsWith('notification:') || type === 'message:new') {
        loadNotifications();
      }
    };
    window.addEventListener(REALTIME_BROWSER_EVENT, onRealtimeEvent);
    return () => window.removeEventListener(REALTIME_BROWSER_EVENT, onRealtimeEvent);
  }, [loadNotifications]);

  useEffect(() => {
    let ignore = false;
    const ensureCurrentUser = async () => {
      if (currentUser?.id) return;
      try {
        const res = await getMe();
        if (ignore) return;
        setCurrentUser(res.data || null);
      } catch (err) {
        console.error('Ошибка текущего пользователя:', err);
      }
    };
    ensureCurrentUser();
    return () => {
      ignore = true;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    const onRelationshipUpdated = (event) => {
      const detail = event?.detail || {};
      const targetId = String(detail.userId || '');
      if (!targetId) return;
      setRelationMap((prev) => ({ ...prev, [targetId]: detail.status || 'none' }));
    };

    window.addEventListener('app:relationship-updated', onRelationshipUpdated);
    return () => window.removeEventListener('app:relationship-updated', onRelationshipUpdated);
  }, []);

  useEffect(() => {
    const userIds = Array.from(new Set(filteredNotifications.map((item) => extractUserId(resolveLink(item))).filter(Boolean)));
    if (!currentUser?.id || userIds.length === 0) return;
    let cancelled = false;

    (async () => {
      try {
        const entries = await Promise.all(
          userIds.map(async (id) => {
            if (String(id) === String(currentUser.id)) return [String(id), 'self'];
            try {
              const res = await checkFriendship(id);
              return [String(id), res.data?.status || 'none'];
            } catch (_) {
              return [String(id), 'none'];
            }
          }),
        );
        if (!cancelled) {
          setRelationMap((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
        }
      } catch (err) {
        console.error('Ошибка загрузки статусов для уведомлений:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filteredNotifications, currentUser?.id]);

  useEffect(() => {
    const onAppAction = async (event) => {
      const action = event?.detail?.action;
      if (action === 'notifications.filterUnread') {
        setFilter('unread');
        navigate('/notifications?filter=unread', { replace: true });
      }
      if (action === 'notifications.refresh') {
        await loadNotifications();
      }
      if (action === 'notifications.markAllRead') {
        if (unreadCount > 0) {
          await handleMarkAllRead();
        }
      }
    };

    window.addEventListener('app:action', onAppAction);
    return () => window.removeEventListener('app:action', onAppAction);
  }, [handleMarkAllRead, loadNotifications, navigate, unreadCount]);

  const markOneRead = async (notificationId) => {
    await markAsRead(notificationId);
    setNotifications((prev) => prev.map((item) => (item.id === notificationId ? { ...item, is_read: true } : item)));
    requestUnreadRefresh();
  };

  const openNotification = async (notification) => {
    if (actingId) return;
    try {
      setActingId(notification.id);
      if (!notification.is_read) {
        await markOneRead(notification.id);
      }
      const link = resolveLink(notification);
      if (link) navigate(link);
    } catch (err) {
      console.error('Ошибка чтения:', err);
      setError(getApiErrorMessage(err, 'Не удалось открыть уведомление'));
    } finally {
      setActingId(null);
    }
  };

  const handleReadOne = async (notificationId) => {
    if (actingId || markingAll) return;
    try {
      setActingId(notificationId);
      await markOneRead(notificationId);
    } catch (err) {
      console.error('Ошибка mark read:', err);
      setError(getApiErrorMessage(err, 'Не удалось отметить уведомление как прочитанное'));
    } finally {
      setActingId(null);
    }
  };

  const updateRelationByUserId = (userId, nextStatus) => {
    setRelationMap((prev) => ({ ...prev, [String(userId)]: nextStatus }));
  };

  const handleEmptyAction = (action) => {
    if (action === 'all') {
      setFilter('all');
      return;
    }
    if (action === 'refresh') {
      loadNotifications();
      return;
    }
    if (action === 'feed') {
      navigate('/feed');
      return;
    }
    if (action === 'friends') {
      navigate('/friends');
      return;
    }
    if (action === 'messages') {
      navigate('/messages');
      return;
    }
    if (action === 'recovery') {
      navigate('/recovery');
    }
  };

  const handleRelationAction = async (notification, action) => {
    const targetUserId = extractUserId(resolveLink(notification));
    if (!targetUserId || actingId || markingAll) return;
    try {
      setActingId(notification.id);
      setError('');
      const previousStatus = relationMap[String(targetUserId)] || 'none';
      let targetUser = null;
      if (['accept', 'friend', 'subscribe', 'unsubscribe', 'unfriend'].includes(action)) {
        targetUser = await getUser(targetUserId)
          .then((res) => res.data || res)
          .catch(() => null);
      }
      if (action === 'accept') {
        await acceptFriendRequest(targetUserId);
        updateRelationByUserId(targetUserId, 'friends');
        broadcastRelationshipUpdated({ userId: targetUserId, status: 'friends', previousStatus, request_sent: false, subscribed: false, user: targetUser });
        requestUnreadRefresh();
        showToast('Заявка принята', { tone: 'success' });
        return;
      }
      if (action === 'friend') {
        await sendFriendRequest(targetUserId);
        updateRelationByUserId(targetUserId, 'request_sent');
        broadcastRelationshipUpdated({ userId: targetUserId, status: 'request_sent', previousStatus, request_sent: true, subscribed: false, user: targetUser });
        requestUnreadRefresh();
        showToast('Заявка отправлена', { tone: 'success' });
        return;
      }
      if (action === 'subscribe') {
        await subscribe(targetUserId);
        updateRelationByUserId(targetUserId, 'subscribed');
        broadcastRelationshipUpdated({ userId: targetUserId, status: 'subscribed', previousStatus, request_sent: false, subscribed: true, user: targetUser });
        showToast('Подписка оформлена', { tone: 'success' });
        return;
      }
      if (action === 'unsubscribe') {
        await unsubscribe(targetUserId);
        updateRelationByUserId(targetUserId, 'none');
        broadcastRelationshipUpdated({ userId: targetUserId, status: 'none', previousStatus, request_sent: false, subscribed: false, user: targetUser });
        showToast('Подписка отключена', { tone: 'success' });
        return;
      }
      if (action === 'unfriend') {
        await unfriend(targetUserId);
        updateRelationByUserId(targetUserId, 'none');
        broadcastRelationshipUpdated({ userId: targetUserId, status: 'none', previousStatus, request_sent: false, subscribed: false, user: targetUser });
        showToast('Пользователь удалён из друзей', { tone: 'success' });
        return;
      }
      if (action === 'message') {
        navigate(`/messages/${targetUserId}`);
        return;
      }
      if (action === 'profile') {
        navigate(`/profile/${targetUserId}`);
      }
    } catch (err) {
      console.error('Ошибка действия по уведомлению:', err);
      setError(getApiErrorMessage(err, 'Не удалось выполнить действие'));
    } finally {
      setActingId(null);
    }
  };

  return (
    <div className="pa-notifications-page">
      <PostAuthHero
        className="pa-notif-hero"
        badge={<span className="pa-pill accent">Центр событий</span>}
        title="Все обновления по чатам, связям, ленте и безопасности в одном месте"
        text="Быстро просматривай новые реакции, заявки, важные ответы и события по восстановлению доступа. Hero-паттерн и общие summary-блоки теперь здесь тоже едут через общий post-auth набор."
        stats={[
          { key: 'unread', value: unreadCount, label: 'новых', tone: 'accent' },
          { key: 'social', value: socialCount, label: 'соц. события', tone: 'green' },
          { key: 'mentions', value: mentionCount, label: 'упоминания', tone: 'accent' },
          { key: 'replies', value: replyCount, label: 'ответы', tone: 'purple' },
          { key: 'read', value: readCount, label: 'прочитано', tone: 'neutral' },
        ]}
        visual={(
          <>
            <PostAuthAvatarStack
              className="pa-feed-avatar-stack"
              avatarClassName="pa-feed-stack-avatar"
              items={heroItems.length ? heroItems : notifications.slice(0, 4)}
              getKey={(item, index) => `${item.id}-${index}`}
              getLabel={(item) => typeMeta(item.type).short}
              emptyLabel="!"
            />
            <div className="pa-notif-hero-orb" />
          </>
        )}
      />

      <section className="pa-postauth-summary-grid pa-notif-summary-grid">
        <PostAuthSummaryCard
          className="pa-notif-summary-card"
          badge={<span className="pa-pill blue">Сейчас</span>}
          value={unreadCount}
          title="Непрочитанные"
          active={filter === 'unread'}
          onClick={() => setFilter('unread')}
        />
        <PostAuthSummaryCard
          className="pa-notif-summary-card"
          badge={<span className="pa-pill accent">Лента</span>}
          value={mentionCount}
          title="Упоминания"
          active={filter === 'mentions'}
          onClick={() => setFilter('mentions')}
        />
        <PostAuthSummaryCard
          className="pa-notif-summary-card"
          badge={<span className="pa-pill purple">Ответы</span>}
          value={replyCount}
          title="Ответы"
          active={filter === 'replies'}
          onClick={() => setFilter('replies')}
        />
        <PostAuthSummaryCard
          className="pa-notif-summary-card"
          badge={<span className="pa-pill green">Связи</span>}
          value={socialCount}
          title="Соц. события"
          active={filter === 'social'}
          onClick={() => setFilter('social')}
        />
        <PostAuthSummaryCard
          className="pa-notif-summary-card"
          badge={<span className="pa-pill warning">Защита</span>}
          value={securityCount}
          title="Безопасность"
          active={filter === 'security'}
          onClick={() => setFilter('security')}
        />
      </section>

      <section className="pa-card pa-notif-toolbar">
        <PostAuthSectionHead
          className="pa-feed-section-head"
          title="Поток уведомлений"
          meta="Фильтруй только то, что важно прямо сейчас"
          actions={<div className="pa-pill accent">{filteredNotifications.length}</div>}
        />

        <PostAuthFilterChips
          className="pa-notif-filter-row"
          items={[
            { key: 'all', label: 'Все', tone: 'stone' },
            { key: 'unread', label: 'Непрочитанные', tone: 'blue', count: unreadCount || undefined },
            { key: 'social', label: 'Соц. связи', tone: 'green', count: socialCount || undefined },
            { key: 'mentions', label: 'Упоминания', tone: 'accent', count: mentionCount || undefined },
            { key: 'replies', label: 'Ответы', tone: 'purple', count: replyCount || undefined },
            { key: 'messages', label: 'Сообщения', tone: 'purple', count: messageCount || undefined },
            { key: 'security', label: 'Безопасность', tone: 'orange', count: securityCount || undefined },
          ]}
          activeKey={filter}
          onChange={setFilter}
        />

        <div className="pa-feed-composer-actions" style={{ marginTop: 12 }}>
          <button className="pa-secondary-btn" type="button" onClick={loadNotifications}>Обновить</button>
          <div className="pa-inline-row-wrap">
            {filter !== 'all' && <button className="pa-secondary-btn" type="button" onClick={() => setFilter('all')}>Сбросить фильтр</button>}
            {unreadCount > 0 && <button className="pa-primary-btn" type="button" onClick={handleMarkAllRead} disabled={markingAll}>{markingAll ? 'Отмечаю…' : 'Прочитать всё'}</button>}
          </div>
        </div>

        {error && (
          <PostAuthNoticeCard
            className="pa-notif-error-card"
            tone="danger"
            icon="🔔"
            title="Не удалось загрузить уведомления"
            text={error}
            actions={[
              filter !== 'all' ? { key: 'reset', label: 'Сбросить фильтр', onClick: () => setFilter('all'), className: 'pa-secondary-btn' } : null,
              { key: 'retry', label: 'Повторить', onClick: loadNotifications, className: 'pa-primary-btn' },
            ]}
          />
        )}
      </section>

      {loading ? (
        <div className="pa-skeleton-grid pa-skeleton-grid-notifications">
          <PostAuthSkeletonNotificationCard />
          <PostAuthSkeletonNotificationCard />
          <PostAuthSkeletonNotificationCard />
        </div>
      ) : filteredNotifications.length === 0 ? (
        <PostAuthEmptyState
          className="pa-notif-empty"
          title={emptyMeta.title}
          text={emptyMeta.text}
          icon={<span className="pa-pill accent">0</span>}
          primaryAction={{ label: emptyMeta.primary, onClick: () => handleEmptyAction(emptyMeta.primaryAction) }}
          secondaryAction={{ label: emptyMeta.secondary, onClick: () => handleEmptyAction(emptyMeta.secondaryAction) }}
          tertiaryAction={filter !== 'all' ? { label: 'Сбросить фильтр', onClick: () => setFilter('all') } : null}
        />
      ) : (
        <div className="pa-list pa-notif-list" style={{ marginTop: 12 }}>
          {groupedNotifications.map((group) => (
            <section key={group.key} className="pa-notif-section">
              {group.title ? (
                <PostAuthSectionHead
                  title={group.title}
                  meta={group.meta}
                  actions={group.key === 'unread' && unreadCount > 0 ? <span className="pa-pill blue">требуют внимания</span> : null}
                />
              ) : null}

              <div className="pa-list">
                {group.items.map((notification) => {
                  const meta = typeMeta(notification.type);
                  const busy = actingId === notification.id;
                  const hasLink = Boolean(resolveLink(notification));
                  const targetUserId = extractUserId(resolveLink(notification));
                  const relationStatus = targetUserId ? relationMap[String(targetUserId)] || 'none' : null;
                  const relation = targetUserId ? getRelationshipMeta(relationStatus, String(targetUserId) === String(currentUser?.id || '')) : null;
                  const relationActions = targetUserId ? actionButtonsForStatus(relationStatus, hasLink) : [];

                  return (
                    <PostAuthNotificationCard
                      key={notification.id}
                      className="pa-notification-item pa-notif-card"
                      isUnread={!notification.is_read}
                      icon={<div className={`pa-notif-icon tone-${meta.cls}`}>{meta.short}</div>}
                      badges={[
                        <span key="type" className={`pa-pill ${meta.cls}`}>{meta.label}</span>,
                        !notification.is_read ? <span key="new" className="pa-pill blue">new</span> : null,
                        relation ? <span key="relation" className={`pa-pill ${relation.cls}`}>{relation.label}</span> : null,
                      ].filter(Boolean)}
                      time={formatDate(notification.created_at)}
                      meta={`#${notification.id}`}
                      content={<div className="pa-notification-text pa-notif-card-text">{notification.content}</div>}
                      actions={[
                        !notification.is_read ? { key: 'read', label: 'Прочитано', busy, onClick: () => handleReadOne(notification.id) } : null,
                        relationActions.includes('accept') ? { key: 'accept', label: 'Принять', busy, onClick: () => handleRelationAction(notification, 'accept') } : null,
                        relationActions.includes('friend') ? { key: 'friend', label: 'В друзья', busy, onClick: () => handleRelationAction(notification, 'friend') } : null,
                        relationActions.includes('subscribe') ? { key: 'subscribe', label: 'Подписаться', busy, onClick: () => handleRelationAction(notification, 'subscribe') } : null,
                        relationActions.includes('unsubscribe') ? { key: 'unsubscribe', label: 'Отписаться', busy, onClick: () => handleRelationAction(notification, 'unsubscribe') } : null,
                        relationActions.includes('unfriend') ? { key: 'unfriend', label: 'Удалить из друзей', busy, onClick: () => handleRelationAction(notification, 'unfriend') } : null,
                        relationActions.includes('message') ? { key: 'message', label: 'Открыть чат', busy, onClick: () => handleRelationAction(notification, 'message') } : null,
                        relationActions.includes('profile') ? { key: 'profile', label: 'Профиль', busy, onClick: () => handleRelationAction(notification, 'profile') } : null,
                        hasLink && !relationActions.includes('profile') && !relationActions.includes('message') ? { key: 'open', label: actionLabel(notification), tone: 'primary', busy, onClick: () => openNotification(notification) } : null,
                      ]}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
