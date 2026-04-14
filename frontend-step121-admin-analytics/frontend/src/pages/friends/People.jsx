import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PostAuthAvatarStack from '../../components/postauth/PostAuthAvatarStack';
import PostAuthEmptyState from '../../components/postauth/PostAuthEmptyState';
import PostAuthHero from '../../components/postauth/PostAuthHero';
import PostAuthSearchField from '../../components/postauth/PostAuthSearchField';
import PostAuthFilterChips from '../../components/postauth/PostAuthFilterChips';
import PostAuthSectionHead from '../../components/postauth/PostAuthSectionHead';
import PostAuthUserCard from '../../components/postauth/PostAuthUserCard';
import { getRelationshipStatus, normalizeUserBadges } from '../../components/postauth/relationship';
import {
  acceptFriendRequest,
  getFriendRequests,
  getFriends,
  getMe,
  getSubscriptions,
  rejectFriendRequest,
  requestUnreadRefresh,
  searchUsers,
  sendFriendRequest,
  subscribe,
  unfriend,
  unsubscribe,
  broadcastRelationshipUpdated,
  confirmAction,
  showToast,
  getApiErrorMessage,
} from '../../services/api';
import { getStoredUser, setStoredUser } from '../../services/authStorage';

const FILTERS = [
  { id: 'all', label: 'Все', cls: 'stone' },
  { id: 'friends', label: 'Друзья', cls: 'green' },
  { id: 'subscriptions', label: 'Подписки', cls: 'blue' },
  { id: 'requests', label: 'Заявки', cls: 'orange' },
  { id: 'search', label: 'Поиск', cls: 'purple' },
];

function initials(user) {
  return `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}` || 'U';
}

function normalizeSearchKey(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

const PEOPLE_SEARCH_CACHE_TTL_MS = 30 * 1000;

export default function People() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [friends, setFriends] = useState([]);
  const [requests, setRequests] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [results, setResults] = useState([]);
  const [activeFilter, setActiveFilter] = useState(() => {
    const requestedTab = searchParams.get('tab');
    return FILTERS.some((item) => item.id === requestedTab) ? requestedTab : 'all';
  });
  const [actionError, setActionError] = useState('');
  const [actingUserId, setActingUserId] = useState(null);
  const searchRequestIdRef = useRef(0);
  const searchAbortRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const searchInputRef = useRef(null);

  const loadPeopleData = useCallback(async (userOverride = null) => {
    const seededUser = userOverride?.id ? userOverride : null;
    const storedUser = !seededUser ? getStoredUser() : null;
    const me = seededUser || storedUser || currentUser || (await getMe()).data;
    if (!me?.id) {
      throw new Error('Не удалось определить текущего пользователя');
    }
    setCurrentUser(me);
    setStoredUser(me);
    const [friendsRes, requestsRes, subscriptionsRes] = await Promise.all([
      getFriends(me.id),
      getFriendRequests().catch(() => ({ data: { requests: [] } })),
      getSubscriptions(me.id).catch(() => ({ data: { subscriptions: [] } })),
    ]);
    setFriends(friendsRes.data?.friends || []);
    setRequests(requestsRes.data?.requests || []);
    setSubscriptions(subscriptionsRes.data?.subscriptions || []);
    return me;
  }, [currentUser]);

  const bootstrap = useCallback(async () => {
    try {
      setLoading(true);
      await loadPeopleData();
    } catch (err) {
      console.error('Ошибка друзей:', err);
      setActionError(getApiErrorMessage(err, 'Не удалось загрузить список людей'));
    } finally {
      setLoading(false);
    }
  }, [loadPeopleData]);

  const performSearch = useCallback(async (searchValue = query.trim()) => {
    const normalized = normalizeSearchKey(searchValue);
    if (!normalized) return;

    const cached = searchCacheRef.current.get(normalized);
    if (cached && (Date.now() - cached.timestamp) < PEOPLE_SEARCH_CACHE_TTL_MS) {
      setResults(cached.results);
      setActiveFilter('search');
      setActionError('');
      setSearching(false);
      return;
    }

    const requestId = ++searchRequestIdRef.current;
    searchAbortRef.current?.abort?.();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      setSearching(true);
      const res = await searchUsers(searchValue, { signal: controller.signal });
      if (requestId !== searchRequestIdRef.current) return;
      const nextResults = res.data?.users || [];
      setResults(nextResults);
      searchCacheRef.current.set(normalized, { timestamp: Date.now(), results: nextResults });
      setActiveFilter('search');
      setActionError('');
    } catch (err) {
      if (requestId !== searchRequestIdRef.current) return;
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      console.error('Ошибка поиска:', err);
      setActionError(getApiErrorMessage(err, 'Не удалось выполнить поиск'));
    } finally {
      if (requestId === searchRequestIdRef.current) setSearching(false);
    }
  }, [query]);

  const focusSearchInput = useCallback(() => {
    window.requestAnimationFrame(() => {
      searchInputRef.current?.focus();
      searchInputRef.current?.select?.();
    });
  }, []);

  const applyFilter = useCallback((filterId) => {
    setActiveFilter(filterId);
    const next = new URLSearchParams(searchParams);
    if (filterId === 'all') next.delete('tab');
    else next.set('tab', filterId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const handleRefresh = useCallback(() => {
    setActionError('');
    if (query.trim().length > 1) {
      performSearch(query.trim());
      focusSearchInput();
      return;
    }
    bootstrap();
  }, [bootstrap, focusSearchInput, performSearch, query]);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    const value = query.trim();
    if (value.length <= 1) {
      searchAbortRef.current?.abort?.();
      setResults([]);
      setActiveFilter((prev) => (prev === 'search' ? 'all' : prev));
      return undefined;
    }

    const timer = window.setTimeout(() => performSearch(value), 320);
    return () => window.clearTimeout(timer);
  }, [performSearch, query]);

  useEffect(() => () => {
    searchAbortRef.current?.abort?.();
  }, []);





  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (requestedTab && FILTERS.some((item) => item.id === requestedTab) && requestedTab !== activeFilter) {
      setActiveFilter(requestedTab);
    }
  }, [searchParams, activeFilter]);

  const updateEverywhere = (userId, patch) => {
    const apply = (list) => list.map((item) => (String(item.id) === String(userId) ? { ...item, ...patch } : item));
    setFriends((prev) => apply(prev));
    setRequests((prev) => apply(prev));
    setSubscriptions((prev) => apply(prev));
    setResults((prev) => apply(prev));
  };

  const removeEverywhere = (userId, options = {}) => {
    const { keepFriends = false, keepRequests = false, keepSubscriptions = false } = options;
    if (!keepFriends) setFriends((prev) => prev.filter((item) => String(item.id) !== String(userId)));
    if (!keepRequests) setRequests((prev) => prev.filter((item) => String(item.id) !== String(userId)));
    if (!keepSubscriptions) setSubscriptions((prev) => prev.filter((item) => String(item.id) !== String(userId)));
  };

  useEffect(() => {
    const onRelationshipUpdated = (event) => {
      const detail = event?.detail || {};
      const targetId = String(detail.userId || '');
      if (!targetId) return;
      const patch = {
        ...(detail.user || {}),
        friendship_status: detail.status || 'none',
        request_sent: detail.request_sent ?? (detail.status === 'request_sent'),
        subscribed: detail.subscribed ?? (detail.status === 'subscribed'),
      };

      updateEverywhere(targetId, patch);

      if (detail.status === 'friends') {
        setRequests((prev) => prev.filter((item) => String(item.id) !== targetId));
        if (detail.user) {
          setFriends((prev) => prev.some((item) => String(item.id) === targetId)
            ? prev.map((item) => (String(item.id) === targetId ? { ...item, ...patch } : item))
            : [{ ...detail.user, ...patch }, ...prev]);
        }
      }

      if (detail.status !== 'friends') {
        setFriends((prev) => prev.filter((item) => String(item.id) !== targetId));
      }

      if (detail.status === 'request_sent') {
        setRequests((prev) => prev.filter((item) => String(item.id) !== targetId));
      }

      if (detail.status === 'subscribed') {
        if (detail.user) {
          setSubscriptions((prev) => prev.some((item) => String(item.id) === targetId)
            ? prev.map((item) => (String(item.id) === targetId ? { ...item, ...patch } : item))
            : [{ ...detail.user, ...patch }, ...prev]);
        }
      } else {
        setSubscriptions((prev) => prev.filter((item) => String(item.id) !== targetId));
      }
    };

    window.addEventListener('app:relationship-updated', onRelationshipUpdated);
    return () => window.removeEventListener('app:relationship-updated', onRelationshipUpdated);
  }, []);


  const handleAcceptRequest = async (user) => {
    if (actingUserId) return;
    try {
      setActionError('');
      setActingUserId(user.id);
      await acceptFriendRequest(user.id);
      showToast('Заявка принята', { tone: 'success' });
      removeEverywhere(user.id, { keepFriends: true });
      setFriends((prev) => prev.some((item) => String(item.id) === String(user.id)) ? prev.map((item) => String(item.id) === String(user.id) ? { ...item, friendship_status: 'friends' } : item) : [{ ...user, friendship_status: 'friends' }, ...prev]);
      updateEverywhere(user.id, { friendship_status: 'friends', request_sent: false });
      broadcastRelationshipUpdated({ userId: user.id, status: 'friends', previousStatus: getRelationshipStatus(user, currentUser?.id), request_sent: false, subscribed: false, user });
      requestUnreadRefresh();
    } catch (err) {
      console.error('Ошибка подтверждения дружбы:', err);
      setActionError(getApiErrorMessage(err, 'Не удалось подтвердить заявку'));
    } finally {
      setActingUserId(null);
    }
  };

  const handleRejectRequest = async (userId) => {
    if (actingUserId) return;
    try {
      setActionError('');
      setActingUserId(userId);
      await rejectFriendRequest(userId);
      showToast('Заявка отклонена', { tone: 'success' });
      removeEverywhere(userId, { keepFriends: true, keepSubscriptions: true });
      updateEverywhere(userId, { friendship_status: 'none', request_sent: false });
      broadcastRelationshipUpdated({ userId, status: 'none', previousStatus: 'request_received', request_sent: false, subscribed: false });
      requestUnreadRefresh();
    } catch (err) {
      console.error('Ошибка отклонения заявки:', err);
      setActionError(getApiErrorMessage(err, 'Не удалось отклонить заявку'));
    } finally {
      setActingUserId(null);
    }
  };

  const handlePrimaryAction = async (user) => {
    if (actingUserId) return;
    const status = getRelationshipStatus(user, currentUser?.id);
    if (status === 'self') return;
    if (status === 'friends') {
      navigate(`/messages/${user.id}`);
      return;
    }
    if (status === 'request_sent') return;
    try {
      setActionError('');
      setActingUserId(user.id);
      if (status === 'request_received') {
        await handleAcceptRequest(user);
        return;
      }
      await sendFriendRequest(user.id);
      showToast('Заявка отправлена', { tone: 'success' });
      updateEverywhere(user.id, { friendship_status: 'request_sent', request_sent: true });
      broadcastRelationshipUpdated({ userId: user.id, status: 'request_sent', previousStatus: status, request_sent: true, subscribed: false, user });
      requestUnreadRefresh();
    } catch (err) {
      console.error('Ошибка заявки:', err);
      setActionError(getApiErrorMessage(err, 'Не удалось отправить заявку в друзья'));
    } finally {
      setActingUserId(null);
    }
  };

  const handleSecondaryAction = async (user) => {
    if (actingUserId) return;
    const status = getRelationshipStatus(user, currentUser?.id);
    if (status === 'self' || status === 'request_sent') return;
    try {
      setActionError('');
      setActingUserId(user.id);
      if (status === 'friends') {
        const confirmed = await confirmAction({ title: 'Удалить из друзей', message: 'Пользователь будет удалён из вашего списка друзей.', confirmLabel: 'Удалить', tone: 'danger' });
        if (!confirmed) return;
        await unfriend(user.id);
        showToast('Пользователь удалён из друзей', { tone: 'success' });
        removeEverywhere(user.id, { keepRequests: true, keepSubscriptions: false, keepFriends: false });
        updateEverywhere(user.id, { friendship_status: 'none' });
        broadcastRelationshipUpdated({ userId: user.id, status: 'none', previousStatus: status, request_sent: false, subscribed: false, user });
        return;
      }
      if (status === 'request_received') {
        await rejectFriendRequest(user.id);
        showToast('Заявка отклонена', { tone: 'success' });
        removeEverywhere(user.id, { keepFriends: true, keepSubscriptions: true });
        updateEverywhere(user.id, { friendship_status: 'none', request_sent: false });
        broadcastRelationshipUpdated({ userId: user.id, status: 'none', previousStatus: status, request_sent: false, subscribed: false, user });
        requestUnreadRefresh();
        return;
      }
      if (status === 'subscribed') {
        await unsubscribe(user.id);
        showToast('Подписка отключена', { tone: 'success' });
        removeEverywhere(user.id, { keepFriends: true, keepRequests: true, keepSubscriptions: false });
        updateEverywhere(user.id, { friendship_status: 'none', subscribed: false });
        broadcastRelationshipUpdated({ userId: user.id, status: 'none', previousStatus: status, request_sent: false, subscribed: false, user });
        return;
      }
      await subscribe(user.id);
      showToast('Подписка оформлена', { tone: 'success' });
      setSubscriptions((prev) => prev.some((item) => String(item.id) === String(user.id)) ? prev.map((item) => String(item.id) === String(user.id) ? { ...item, friendship_status: 'subscribed' } : item) : [{ ...user, friendship_status: 'subscribed', subscribed: true }, ...prev]);
      updateEverywhere(user.id, { friendship_status: 'subscribed', subscribed: true });
      broadcastRelationshipUpdated({ userId: user.id, status: 'subscribed', previousStatus: status, request_sent: false, subscribed: true, user });
    } catch (err) {
      console.error('Ошибка действия:', err);
      setActionError(getApiErrorMessage(err, 'Не удалось выполнить действие'));
    } finally {
      setActingUserId(null);
    }
  };

  const primaryLabel = (user) => {
    const status = getRelationshipStatus(user, currentUser?.id);
    if (status === 'self') return '';
    if (status === 'friends') return 'Написать';
    if (status === 'request_received') return 'Принять';
    if (status === 'request_sent') return 'Заявка';
    return 'В друзья';
  };

  const secondaryLabel = (user) => {
    const status = getRelationshipStatus(user, currentUser?.id);
    if (status === 'self' || status === 'request_sent') return '';
    if (status === 'friends') return 'Удалить';
    if (status === 'request_received') return 'Отклонить';
    if (status === 'subscribed') return 'Отписаться';
    return 'Подписаться';
  };

  const friendIds = useMemo(() => new Set(friends.map((item) => item.id)), [friends]);
  const subscriptionIds = useMemo(() => new Set(subscriptions.map((item) => item.id)), [subscriptions]);
  const visiblePeople = activeFilter === 'requests'
    ? requests
    : activeFilter === 'friends'
      ? friends
      : activeFilter === 'subscriptions'
        ? subscriptions
        : activeFilter === 'search'
          ? results
          : query.trim().length > 1
            ? results
            : friends;

  const featuredPeople = useMemo(() => {
    const map = new Map();
    [...requests, ...friends, ...subscriptions, ...results].forEach((user) => {
      if (user?.id && !map.has(user.id)) map.set(user.id, user);
    });
    return Array.from(map.values()).slice(0, 4);
  }, [friends, requests, subscriptions, results]);

  const activeFilterLabel = useMemo(() => FILTERS.find((item) => item.id === activeFilter)?.label || 'Все', [activeFilter]);


  useEffect(() => {
    const onAppAction = (event) => {
      const action = event?.detail?.action;
      if (action === 'people.focusSearch') {
        applyFilter('search');
        focusSearchInput();
      }
      if (action === 'people.showRequests') {
        applyFilter('requests');
      }
      if (action === 'people.refresh') {
        handleRefresh();
      }
    };

    window.addEventListener('app:action', onAppAction);
    return () => window.removeEventListener('app:action', onAppAction);
  }, [applyFilter, focusSearchInput, handleRefresh]);

  const emptyState = (() => {
    if (activeFilter === 'requests') {
      return {
        title: 'Новых заявок нет',
        text: 'Когда кто-то отправит вам заявку, она появится здесь.',
        primary: { label: 'Открыть друзей', onClick: () => applyFilter('friends') },
        secondary: { label: 'Обновить', onClick: handleRefresh },
      };
    }
    if (activeFilter === 'subscriptions') {
      return {
        title: 'Подписок пока нет',
        text: 'Подпишитесь на интересных людей, чтобы они появились в этом разделе.',
        primary: { label: 'Найти людей', onClick: () => { applyFilter('search'); focusSearchInput(); } },
        secondary: { label: 'Обновить', onClick: handleRefresh },
      };
    }
    if (activeFilter === 'friends') {
      return {
        title: 'Друзей пока нет',
        text: 'Добавьте первых друзей через поиск или профиль пользователя.',
        primary: { label: 'Искать людей', onClick: () => { applyFilter('search'); focusSearchInput(); } },
        secondary: { label: 'Обновить', onClick: handleRefresh },
      };
    }
    if (query.trim().length > 1 || activeFilter === 'search') {
      return {
        title: 'Ничего не найдено',
        text: 'Попробуйте другой запрос или переключитесь на другую вкладку.',
        primary: { label: 'Очистить поиск', onClick: () => { setQuery(''); setResults([]); setActionError(''); applyFilter('all'); focusSearchInput(); } },
        secondary: { label: 'Обновить', onClick: handleRefresh },
      };
    }
    return {
      title: 'Пока пусто',
      text: 'Попробуйте поискать людей по имени, фамилии или username.',
      primary: { label: 'Начать поиск', onClick: () => { applyFilter('search'); focusSearchInput(); } },
      secondary: { label: 'Обновить', onClick: handleRefresh },
    };
  })();


  return (
    <div className="pa-people-page">
      <PostAuthHero
        className="pa-people-hero"
        badge={<div className="pa-accent-badge">Соц. связи</div>}
        title="Люди"
        text="Находите новых знакомых, принимайте заявки и управляйте подписками в одном живом экране. Общий hero-компонент теперь связывает этот экран с остальной post-auth дизайн-системой."
        stats={[
          { key: 'friends', value: friends.length, label: 'друзей', tone: 'green', onClick: () => applyFilter('friends') },
          { key: 'subscriptions', value: subscriptions.length, label: 'подписок', tone: 'accent', onClick: () => applyFilter('subscriptions') },
          { key: 'requests', value: requests.length, label: 'заявок', tone: 'warning', onClick: () => applyFilter('requests') },
        ]}
        visual={(
          <>
            <PostAuthAvatarStack
              className="pa-people-avatar-stack"
              avatarClassName="pa-people-stack-avatar"
              items={featuredPeople}
              getKey={(user) => user.id}
              getLabel={(user) => initials(user)}
              emptyLabel="+"
            />
            <div className="pa-people-side-note">{activeFilterLabel}</div>
            <div className="pa-people-side-caption">{visiblePeople.length} карточек в текущем представлении</div>
          </>
        )}
      />

      <section className="pa-card pa-people-toolbar">
        <div className="pa-search-row pa-people-toolbar-row">
          <PostAuthSearchField
            className="pa-people-search"
            inputRef={searchInputRef}
            value={query}
            onChange={(value) => setQuery(value)}
            placeholder="Имя, фамилия или @username"
            onClear={() => {
              setQuery('');
              setResults([]);
              setActionError('');
              if (activeFilter === 'search') applyFilter('all');
            }}
          />
          <button className="pa-link-btn" type="button" onClick={handleRefresh} disabled={loading || searching}>Обновить</button>
        </div>
        <PostAuthFilterChips
          className="pa-people-filter-row"
          items={FILTERS.map((filter) => ({
            ...filter,
            key: filter.id,
            tone: filter.cls,
            count: filter.id === 'requests' && requests.length > 0 ? requests.length : undefined,
            onClick: () => {
              applyFilter(filter.id);
              if (filter.id === 'search') focusSearchInput();
            },
          }))}
          activeKey={activeFilter}
        />
      </section>

      <PostAuthSectionHead
        className="pa-people-section-head"
        title="Контакты и рекомендации"
        meta={`${activeFilterLabel} · ${visiblePeople.length} профилей ${query.trim() ? `· запрос: ${query.trim()}` : ''}`}
        actions={<div className="pa-action-row" style={{ gap: 8 }}><button className="pa-link-btn" type="button" onClick={() => { applyFilter('search'); focusSearchInput(); }}>Искать</button><button className="pa-link-btn" type="button" onClick={() => navigate('/communities')}>Сообщества</button></div>}
      />

      {actionError && <div className="pa-error" style={{ marginBottom: 12 }}>{actionError}</div>}

      {loading || searching ? (
        <div className="pa-loading">Загружаю список…</div>
      ) : visiblePeople.length === 0 ? (
        <PostAuthEmptyState
          className="pa-people-empty"
          title={emptyState.title}
          text={emptyState.text}
          icon={activeFilter === 'requests' ? '📨' : activeFilter === 'subscriptions' ? '⭐' : query.trim() ? '🔎' : '👥'}
          primaryAction={emptyState.primary ? { label: emptyState.primary.label, onClick: emptyState.primary.onClick } : null}
          secondaryAction={emptyState.secondary ? { label: emptyState.secondary.label, onClick: emptyState.secondary.onClick } : null}
        />
      ) : (
        <div className="pa-people-list-redesign">
          {visiblePeople.map((user) => {
            const status = getRelationshipStatus(user, currentUser?.id);
            const busy = actingUserId === user.id;
            const isFriend = status === 'friends' || friendIds.has(user.id);
            const isSubscribed = status === 'subscribed' || subscriptionIds.has(user.id);
            const primary = primaryLabel(user);
            const secondary = secondaryLabel(user);
            const badges = normalizeUserBadges({
              user,
              currentUserId: currentUser?.id,
              includeCity: Boolean(user.city),
              extra: [
                isFriend ? { label: 'Уже в друзьях', cls: 'green' } : null,
                isSubscribed && !isFriend ? { label: 'Подписка активна', cls: 'blue' } : null,
                status === 'request_received' ? { label: 'Нужно решение', cls: 'blue' } : null,
              ],
            });
            const actions = status !== 'self' ? [
              {
                key: 'open-profile',
                label: 'Профиль',
                onClick: () => navigate(`/profile/${user.id}`),
              },
              primary ? {
                key: 'primary',
                label: primary,
                tone: status === 'friends' ? 'primary' : 'secondary',
                busy,
                disabled: status === 'request_sent',
                onClick: () => handlePrimaryAction(user),
              } : null,
              secondary ? {
                key: 'secondary',
                label: secondary,
                busy,
                onClick: () => handleSecondaryAction(user),
              } : null,
            ] : [];
            return (
              <PostAuthUserCard
                key={user.id}
                className="pa-people-card-redesign"
                user={user}
                avatarLabel={initials(user)}
                title={`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Пользователь'}
                subtitle={`@${user.username || 'user'}`}
                description={user.bio || user.city || 'Профиль ещё короткий, но контакт уже можно добавить.'}
                badges={badges}
                trailing={status !== 'self' ? <div className="pa-people-card-score">{isFriend ? 'FR' : isSubscribed ? 'SUB' : status === 'request_received' ? 'REQ' : 'NEW'}</div> : null}
                actions={actions}
                onOpenProfile={() => navigate(`/profile/${user.id}`)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
