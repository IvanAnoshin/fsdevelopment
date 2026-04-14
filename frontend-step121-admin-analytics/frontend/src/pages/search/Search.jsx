import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PostAuthEmptyState, PostAuthNoticeCard, PostAuthSkeletonPostCard, PostAuthSkeletonUserCard, PostAuthUserCard } from '../../components/postauth';
import { getRelationshipStatus, normalizeUserBadges } from '../../components/postauth/relationship';
import {
  acceptFriendRequest,
  getMe,
  searchUsers,
  searchPosts,
  searchCommunities,
  reportPost,
  sendFriendRequest,
  subscribe,
  unfriend,
  unsubscribe,
  broadcastRelationshipUpdated,
} from '../../services/api';
import { getStoredUser, setStoredUser } from '../../services/authStorage';
import { useDocumentTitle } from '../../utils/pageTitle';

function highlightMatch(value, query) {
  const source = String(value || '');
  const trimmed = query.trim();
  if (!trimmed) return source;
  const lower = source.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const index = lower.indexOf(lowerQuery);
  if (index === -1) return source;
  return (
    <>
      {source.slice(0, index)}
      <mark style={{ background: 'rgba(109, 94, 252, 0.18)', color: '#4638d4', borderRadius: 6, padding: '0 2px' }}>{source.slice(index, index + trimmed.length)}</mark>
      {source.slice(index + trimmed.length)}
    </>
  );
}

function normalizeRecentTerm(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

const SEARCH_CACHE_TTL_MS = 45 * 1000;

export default function Search() {
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(() => getStoredUser());
  const [query, setQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [communities, setCommunities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('all');
  const [recent, setRecent] = useState([]);
  const [actingUserId, setActingUserId] = useState(null);
  const searchRequestId = useRef(0);
  const searchAbortRef = useRef(null);
  const searchCacheRef = useRef(new Map());
  const inputRef = useRef(null);

  useDocumentTitle('Поиск', query.trim() ? `«${query.trim()}»` : '');

  const performSearch = useCallback(async (value) => {
    const normalized = normalizeRecentTerm(value).toLowerCase();
    if (!normalized) return;

    const cached = searchCacheRef.current.get(normalized);
    if (cached && (Date.now() - cached.timestamp) < SEARCH_CACHE_TTL_MS) {
      setUsers(cached.users);
      setPosts(cached.posts);
      setCommunities(cached.communities);
      setError('');
      setLoading(false);
      setRecent((prev) => {
        const next = [value, ...prev.filter((item) => normalizeRecentTerm(item).toLowerCase() !== normalized)].slice(0, 5);
        localStorage.setItem('recent_searches', JSON.stringify(next));
        return next;
      });
      return;
    }

    const requestId = ++searchRequestId.current;
    searchAbortRef.current?.abort?.();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      setLoading(true);
      setError('');
      const config = { signal: controller.signal };
      const [usersRes, postsRes, communitiesRes] = await Promise.all([
        searchUsers(value, config),
        searchPosts(value, config),
        searchCommunities(value, config),
      ]);
      if (requestId !== searchRequestId.current) return;
      const nextUsers = Array.isArray(usersRes.data?.users) ? usersRes.data.users : [];
      const nextPosts = Array.isArray(postsRes.data?.posts) ? postsRes.data.posts : [];
      const nextCommunities = Array.isArray(communitiesRes.data?.communities) ? communitiesRes.data.communities : [];
      setUsers(nextUsers);
      setPosts(nextPosts);
      setCommunities(nextCommunities);
      searchCacheRef.current.set(normalized, {
        timestamp: Date.now(),
        users: nextUsers,
        posts: nextPosts,
        communities: nextCommunities,
      });
      setRecent((prev) => {
        const next = [value, ...prev.filter((item) => normalizeRecentTerm(item).toLowerCase() !== normalized)].slice(0, 5);
        localStorage.setItem('recent_searches', JSON.stringify(next));
        return next;
      });
    } catch (err) {
      if (requestId !== searchRequestId.current) return;
      if (err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
      console.error('Ошибка поиска:', err);
      setError(err.response?.data?.error || 'Не удалось выполнить поиск');
    } finally {
      if (requestId === searchRequestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    try { setRecent(JSON.parse(localStorage.getItem('recent_searches') || '[]')); } catch (_) {}
    let ignore = false;
    const bootstrap = async () => {
      if (currentUser?.id) return;
      try {
        const res = await getMe();
        if (!ignore) {
          setCurrentUser(res.data);
          setStoredUser(res.data);
        }
      } catch (_) {}
    };
    bootstrap();
    return () => { ignore = true; };
  }, [currentUser?.id]);

  useEffect(() => {
    const onAppAction = (event) => {
      if (event?.detail?.action !== 'search.focus') return;
      inputRef.current?.focus();
      inputRef.current?.select?.();
    };

    const onRelationshipUpdated = (event) => {
      const detail = event?.detail || {};
      const targetId = String(detail.userId || '');
      if (!targetId) return;
      setUsers((prev) => prev.map((item) => String(item.id) === targetId ? {
        ...item,
        ...(detail.user || {}),
        friendship_status: detail.status || item.friendship_status || 'none',
        request_sent: detail.request_sent ?? (detail.status === 'request_sent' ? true : item.request_sent),
        subscribed: detail.subscribed ?? (detail.status === 'subscribed' ? true : detail.status === 'none' ? false : item.subscribed),
      } : item));
    };

    window.addEventListener('app:action', onAppAction);
    window.addEventListener('app:relationship-updated', onRelationshipUpdated);
    return () => {
      window.removeEventListener('app:action', onAppAction);
      window.removeEventListener('app:relationship-updated', onRelationshipUpdated);
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length <= 1) {
      searchAbortRef.current?.abort?.();
      setUsers([]);
      setPosts([]);
      setCommunities([]);
      setLoading(false);
      setError('');
      return undefined;
    }

    const timeoutId = setTimeout(() => {
      performSearch(trimmed);
    }, 250);

    return () => clearTimeout(timeoutId);
  }, [performSearch, query]);

  useEffect(() => () => {
    searchAbortRef.current?.abort?.();
  }, []);

  const updateUserState = (userId, patch) => {
    setUsers((prev) => prev.map((item) => item.id === userId ? { ...item, ...patch } : item));
  };

  const handleFriendAction = async (user) => {
    const status = user.friendship_status || (user.request_sent ? 'request_sent' : 'none');
    try {
      setActingUserId(user.id);
      if (status === 'request_received') {
        await acceptFriendRequest(user.id);
        updateUserState(user.id, { friendship_status: 'friends' });
        broadcastRelationshipUpdated({ userId: user.id, status: 'friends', previousStatus: status, request_sent: false, subscribed: false, user });
        return;
      }
      if (status === 'friends') {
        await unfriend(user.id);
        updateUserState(user.id, { friendship_status: 'none' });
        broadcastRelationshipUpdated({ userId: user.id, status: 'none', previousStatus: status, request_sent: false, subscribed: false, user });
        return;
      }
      if (status === 'none' || status === 'subscribed') {
        await sendFriendRequest(user.id);
        updateUserState(user.id, { friendship_status: 'request_sent', request_sent: true });
        broadcastRelationshipUpdated({ userId: user.id, status: 'request_sent', previousStatus: status, request_sent: true, subscribed: false, user });
      }
    } catch (err) {
      console.error('Ошибка friendship action:', err);
      setError(err.response?.data?.error || 'Не удалось выполнить действие');
    } finally {
      setActingUserId(null);
    }
  };

  const handleSubscribeToggle = async (user) => {
    const status = user.friendship_status || 'none';
    if (status === 'request_sent' || status === 'request_received' || status === 'friends' || user.id === currentUser?.id) return;
    try {
      setActingUserId(user.id);
      if (status === 'subscribed') {
        await unsubscribe(user.id);
        updateUserState(user.id, { friendship_status: 'none' });
        broadcastRelationshipUpdated({ userId: user.id, status: 'none', previousStatus: status, request_sent: false, subscribed: false, user });
      } else {
        await subscribe(user.id);
        updateUserState(user.id, { friendship_status: 'subscribed' });
        broadcastRelationshipUpdated({ userId: user.id, status: 'subscribed', previousStatus: status, request_sent: false, subscribed: true, user });
      }
    } catch (err) {
      console.error('Ошибка подписки:', err);
      setError(err.response?.data?.error || 'Не удалось изменить подписку');
    } finally {
      setActingUserId(null);
    }
  };

  const showUsers = tab === 'all' || tab === 'users';
  const showPosts = tab === 'all' || tab === 'posts';
  const showCommunities = tab === 'all' || tab === 'communities';
  const hasResults = useMemo(() => users.length > 0 || posts.length > 0 || communities.length > 0, [users, posts, communities]);
  const trimmedQuery = query.trim();


  const handleReportPost = async (postId) => {
    try {
      await reportPost(postId, { reason: 'Нежелательный контент', details: `Поисковая выдача: ${trimmedQuery}` });
      setError('');
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось отправить жалобу');
    }
  };

  return (
    <div>
      <div className="pa-card">
        <PostAuthSearchField
          inputRef={inputRef}
          value={query}
          onChange={(value) => setQuery(value)}
          placeholder="Люди, посты, username"
          autoFocus
          onClear={() => { setQuery(''); setUsers([]); setPosts([]); setCommunities([]); setError(''); }}
        />
        <PostAuthFilterChips
          className="pa-chip-row"
          items={[
            { key: 'all', label: 'Все', tone: 'stone' },
            { key: 'users', label: 'Люди', tone: 'purple', count: users.length || undefined },
            { key: 'posts', label: 'Посты', tone: 'orange', count: posts.length || undefined },
            { key: 'communities', label: 'Сообщества', tone: 'blue', count: communities.length || undefined },
          ]}
          activeKey={tab}
          onChange={setTab}
        />
        {error && <div className="pa-error" style={{ marginTop: 12 }}>{error}</div>}
      </div>

      {!query && recent.length > 0 && (
        <div className="pa-card" style={{ marginTop: 12 }}>
          <div className="pa-section-head" style={{ marginTop: 0 }}>
            <div className="pa-section-title">Недавние запросы</div>
            <button className="pa-link-btn" type="button" onClick={() => { setRecent([]); localStorage.removeItem('recent_searches'); }}>Очистить</button>
          </div>
          <div className="pa-chip-row">
            {recent.map((item) => <button key={item} type="button" className="pa-chip" onClick={() => setQuery(item)}>{item}</button>)}
          </div>
        </div>
      )}

      {loading ? (
        <div className="pa-list" style={{ marginTop: 12 }}>
          <PostAuthNoticeCard
            tone="accent"
            icon="🔎"
            title="Ищу совпадения"
            text="Показываю людей и посты по текущему запросу. Обычно результаты появляются почти сразу."
          />
          {showUsers ? (
            <div className="pa-skeleton-grid pa-skeleton-grid-users">
              <PostAuthSkeletonUserCard />
              <PostAuthSkeletonUserCard />
            </div>
          ) : null}
          {showPosts ? (
            <div className="pa-skeleton-grid pa-skeleton-grid-posts">
              <PostAuthSkeletonPostCard compact />
              <PostAuthSkeletonPostCard compact />
            </div>
          ) : null}
          {showCommunities ? (
            <div className="pa-skeleton-grid pa-skeleton-grid-posts">
              <PostAuthSkeletonPostCard compact />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="pa-list" style={{ marginTop: 12 }}>
          {showUsers && users.length > 0 && (
            <section className="pa-card">
              <div className="pa-section-head" style={{ marginTop: 0 }}>
                <div className="pa-section-title">Люди</div>
                <div className="pa-section-meta">{users.length}</div>
              </div>
              <div className="pa-list">
                {users.map((user) => {
                  const status = getRelationshipStatus(user, currentUser?.id);
                  const isSelf = status === 'self';
                  const busy = actingUserId === user.id;
                  const badges = normalizeUserBadges({ user, currentUserId: currentUser?.id });
                  const actions = isSelf ? [] : [
                    (status === 'none' || status === 'subscribed' || status === 'request_received' || status === 'friends') ? {
                      key: 'friend',
                      label: status === 'friends' ? 'Удалить' : status === 'request_received' ? 'Принять' : 'В друзья',
                      busy,
                      onClick: () => handleFriendAction(user),
                    } : null,
                    (status === 'none' || status === 'subscribed') ? {
                      key: 'subscribe',
                      label: status === 'subscribed' ? 'Отписаться' : 'Подписаться',
                      busy,
                      onClick: () => handleSubscribeToggle(user),
                    } : null,
                  ];
                  return (
                    <PostAuthUserCard
                      key={user.id}
                      className="pa-search-user-card"
                      avatarLabel={`${user.first_name?.[0] || ''}${user.last_name?.[0] || ''}` || 'U'}
                      title={highlightMatch(`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Пользователь', query)}
                      subtitle={<>{'@'}{highlightMatch(user.username || 'user', query)}</>}
                      description={highlightMatch(user.bio || user.city || 'Откройте профиль, чтобы узнать больше.', query)}
                      badges={badges}
                      trailing={!isSelf ? <span className="pa-pill neutral">Профиль</span> : null}
                      actions={actions}
                      onOpenProfile={() => navigate(`/profile/${user.id}`)}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {showPosts && posts.length > 0 && (
            <section className="pa-card">
              <div className="pa-section-head" style={{ marginTop: 0 }}>
                <div className="pa-section-title">Посты</div>
                <div className="pa-section-meta">{posts.length}</div>
              </div>
              <div className="pa-list">
                {posts.map((post) => (
                  <button
                    key={post.id}
                    type="button"
                    className="pa-result-card"
                    onClick={() => navigate(`/feed?post=${post.id}`)}
                    style={{ textAlign: 'left' }}
                  >
                    <div className="pa-inline-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div className="pa-result-title">{highlightMatch(`${post.user?.first_name || 'Пост'} ${post.user?.last_name || ''}`.trim(), query)}</div>
                        {post.user?.username && <div className="pa-handle">@{highlightMatch(post.user.username, query)}</div>}
                      </div>
                      <span className="pa-pill neutral">Открыть пост</span>
                    </div>
                    <div className="pa-result-text" style={{ marginTop: 8 }}>{highlightMatch(post.content || '', query)}</div>
                    <div className="pa-action-row" style={{ marginTop: 10, justifyContent: 'space-between' }}>
                      <span className="pa-meta">Поиск нечувствителен к регистру и учитывает мелкие опечатки</span>
                      <button
                        type="button"
                        className="pa-secondary-btn"
                        onClick={(event) => { event.stopPropagation(); handleReportPost(post.id); }}
                      >
                        Пожаловаться
                      </button>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          )}



          {showCommunities && communities.length > 0 && (
            <section className="pa-card">
              <div className="pa-section-head" style={{ marginTop: 0 }}>
                <div className="pa-section-title">Сообщества</div>
                <div className="pa-section-meta">{communities.length}</div>
              </div>
              <div className="pa-list">
                {communities.map((community) => (
                  <button
                    key={community.id}
                    type="button"
                    className="pa-result-card"
                    onClick={() => navigate(`/communities?open=${community.id}`)}
                    style={{ textAlign: 'left' }}
                  >
                    <div className="pa-inline-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div className="pa-result-title">{highlightMatch(community.name || 'Сообщество', query)}</div>
                        <div className="pa-handle">/{highlightMatch(community.slug || 'community', query)}</div>
                      </div>
                      <span className={`pa-pill ${community.is_member ? 'green' : 'neutral'}`}>{community.is_member ? 'Участник' : 'Открыть'}</span>
                    </div>
                    <div className="pa-result-text" style={{ marginTop: 8 }}>{highlightMatch(community.description || 'Сообщество без описания.', query)}</div>
                  </button>
                ))}
              </div>
            </section>
          )}
          {trimmedQuery.length > 1 && !loading && !hasResults && (
            <PostAuthEmptyState
              title="Ничего не найдено"
              text="Попробуйте сократить формулировку, проверить username или открыть людей и ленту из быстрых действий ниже."
              icon="🔎"
              primaryAction={{ label: 'Открыть людей', onClick: () => navigate('/friends') }}
              secondaryAction={{ label: 'Открыть ленту', onClick: () => navigate('/feed') }}
              tertiaryAction={recent[0] ? { label: `Повторить «${recent[0]}»`, onClick: () => setQuery(recent[0]) } : null}
            />
          )}
        </div>
      )}
    </div>
  );
}
