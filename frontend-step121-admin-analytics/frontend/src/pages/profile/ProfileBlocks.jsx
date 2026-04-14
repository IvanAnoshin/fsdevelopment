import { useEffect, useMemo, useState } from 'react';
import PostAuthEmptyState from '../../components/postauth/PostAuthEmptyState';
import PostAuthFilterChips from '../../components/postauth/PostAuthFilterChips';
import PostAuthMetaGrid from '../../components/postauth/PostAuthMetaGrid';
import PostAuthPostCard from '../../components/postauth/PostAuthPostCard';
import PostAuthStatCard from '../../components/postauth/PostAuthStatCard';
import PostAuthSummaryCard from '../../components/postauth/PostAuthSummaryCard';
import PostAuthUserCard from '../../components/postauth/PostAuthUserCard';
import { normalizeUserBadges } from '../../components/postauth/relationship';
import { buildSrcSet, getMediaPoster, isVideoMedia, mediaPreviewText } from '../../utils/media';
import { buildCommentTree, isCommentEdited } from '../../utils/comments';
import { getApiErrorMessage, getUserMedia } from '../../services/api';

function initials(user) {
  return `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}` || 'U';
}

function shouldSubmitOnEnter(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229;
}

function formatDate(value) {
  if (!value) return 'только что';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'только что' : d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function lastSeenLabel(status) {
  if (status?.online) return 'В сети';
  if (!status?.lastSeen) return 'Не в сети';
  return `Был(а) ${formatDate(status.lastSeen)}`;
}

function buildProfileInterestChips(profileUser, posts = []) {
  const chips = [];
  if (profileUser?.city) chips.push({ key: 'city', label: profileUser.city, tone: 'blue' });
  if (profileUser?.relationship) chips.push({ key: 'relationship', label: profileUser.relationship, tone: 'orange' });
  if (profileUser?.is_pioneer) chips.push({ key: 'pioneer', label: 'Первопроходец', tone: 'purple' });
  if (profileUser?.is_private) chips.push({ key: 'private', label: 'Приватный профиль', tone: 'stone' });
  const words = String(profileUser?.bio || '')
    .split(/(?:,|\.|•|\n)/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3)
    .map((part, index) => ({ key: `bio-${index}`, label: part.length > 24 ? `${part.slice(0, 24)}…` : part, tone: 'green' }));
  chips.push(...words);
  if (!chips.length && posts.length > 0) chips.push({ key: 'active', label: 'Активный профиль', tone: 'purple' });
  return chips.slice(0, 6);
}

function buildProfileCompleteness(profileUser, posts = []) {
  const checks = [
    { key: 'bio', label: 'Описание профиля', done: Boolean(profileUser?.bio?.trim()) },
    { key: 'city', label: 'Город', done: Boolean(profileUser?.city?.trim()) },
    { key: 'relationship', label: 'Статус', done: Boolean(profileUser?.relationship?.trim()) },
    { key: 'posts', label: 'Первый пост', done: posts.length > 0 },
  ];
  const completed = checks.filter((item) => item.done).length;
  return {
    completed,
    total: checks.length,
    progress: Math.round((completed / checks.length) * 100),
    checks,
  };
}

function buildProfileContext(profileUser, currentUser, friendshipStatus, onlineStatus, posts = []) {
  const context = [];
  if (currentUser?.city && profileUser?.city && String(currentUser.city).trim().toLowerCase() === String(profileUser.city).trim().toLowerCase()) {
    context.push('Вы из одного города');
  }
  if (friendshipStatus === 'friends') context.push('У вас уже есть прямая связь');
  else if (friendshipStatus === 'subscribed') context.push('Вы уже следите за этим профилем');
  else if (friendshipStatus === 'request_sent') context.push('Вы уже отправили заявку в друзья');
  if (onlineStatus?.online) context.push('Пользователь сейчас в сети');
  if (posts.length >= 3) context.push('Профиль выглядит активным');
  if (!profileUser?.is_private) context.push('Профиль открыт для знакомства');
  return context.slice(0, 4);
}

function flattenProfileMedia(posts = []) {
  return posts.flatMap((post) => (post?.images || []).map((item, index) => ({
    ...item,
    source_post_id: post.id,
    source_post_date: post.created_at,
    source_post_text: post.content,
    source_post_likes: Number(post?.likes_count || 0),
    source_post_comments: Number(post?.comments_count || 0),
    source_post_has_comments: Number(post?.comments_count || 0) > 0,
    source_post_score: Number(post?.likes_count || 0) * 3 + Number(post?.comments_count || 0) * 2 + Number(post?.images?.length || 0),
    _key: item?.asset_id || item?.hash || `${post.id}-${index}`,
  })));
}

function buildAlbumStats(mediaItems = []) {
  const uniquePostIds = new Set(mediaItems.map((item) => item?.source_post_id).filter(Boolean));
  const captioned = mediaItems.filter((item) => Boolean(String(item?.source_post_text || '').trim())).length;
  const discussed = mediaItems.filter((item) => item?.source_post_has_comments).length;
  return {
    total: mediaItems.length,
    posts: uniquePostIds.size,
    captioned,
    discussed,
  };
}

function pickSpotlightPost(posts = []) {
  return [...posts].sort((a, b) => {
    const scoreA = Number(a?.likes_count || 0) * 3 + Number(a?.comments_count || 0) * 2 + Number(a?.images?.length || 0);
    const scoreB = Number(b?.likes_count || 0) * 3 + Number(b?.comments_count || 0) * 2 + Number(b?.images?.length || 0);
    return scoreB - scoreA;
  })[0] || null;
}

function renderMediaGrid(items, onOpenMedia, title = '') {
  return (
    <div className="pa-optimized-media-grid">
      {items.map((item, index) => {
        const src = item?.display?.url || item?.src || item?.full?.url || item?.thumb?.url;
        if (!src) return null;
        const isVideo = isVideoMedia(item);
        const srcSet = isVideo ? '' : buildSrcSet(item);
        const poster = getMediaPoster(item);
        const handleClick = (event) => {
          event.preventDefault();
          onOpenMedia?.(items, index, title || item?.alt || 'Медиа профиля');
        };
        return (
          <button key={item?.asset_id || item?.hash || `${src}-${index}`} type="button" className={`pa-optimized-media-item pa-reset-button ${isVideo ? 'is-video' : ''}`.trim()} onClick={handleClick}>
            {isVideo ? (
              <>
                <video
                  className="pa-optimized-media-img"
                  src={src}
                  poster={poster || undefined}
                  preload="metadata"
                  playsInline
                  muted
                  aria-label={item?.alt || 'Видео профиля'}
                />
                <span className="pa-optimized-media-play">▶</span>
              </>
            ) : (
              <img
                className="pa-optimized-media-img"
                src={src}
                srcSet={srcSet || undefined}
                sizes="(max-width: 768px) 100vw, 720px"
                loading="lazy"
                decoding="async"
                alt={item?.alt || 'Вложение профиля'}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function ProfileOverviewBlock({
  isCurrentUser,
  profileUser,
  currentUser,
  onlineStatus,
  posts,
  friendshipStatus,
  navigate,
  handleFriendAction,
  handleUnfriend,
  handleSubscribeToggle,
  handleVouchToggle,
  contactActionLoading,
  vouchActionLoading,
  saveMessage,
  connectionCountItems,
  openConnections,
  openEditProfile,
  composerInputRef,
  newPost,
  setNewPost,
  handleCreatePost,
  posting,
  activeTab,
  onChangeTab,
  onOpenSpotlightPost,
  onOpenSpotlightMedia,
  onSaveProfile,
  children,
}) {
  const tabItems = [
    { key: 'posts', label: 'Посты', count: posts.length, tone: 'stone' },
    { key: 'media', label: 'Фотоальбом', count: flattenProfileMedia(posts).length, tone: 'purple' },
    { key: 'about', label: 'О профиле', tone: 'blue' },
  ];
  const interestChips = buildProfileInterestChips(profileUser, posts);
  const completeness = buildProfileCompleteness(profileUser, posts);
  const contextNotes = buildProfileContext(profileUser, currentUser, friendshipStatus, onlineStatus, posts);
  const spotlightPost = pickSpotlightPost(posts);

  return (
    <>
      <section className="pa-card pa-glass pa-profile-hero">
        <div className="pa-profile-hero-main">
          <div className="pa-profile-badge-row">
            <span className="pa-profile-badge">Профиль</span>
            <span className={`pa-pill ${onlineStatus.online ? 'green' : 'neutral'}`}>{lastSeenLabel(onlineStatus)}</span>
            {profileUser.is_pioneer && <span className="pa-pill warning">Первопроходец</span>}
            {profileUser.is_private && <span className="pa-pill neutral">Приватный профиль</span>}
          </div>
          <div className="pa-profile-hero-title-row">
            <div className="pa-avatar pa-profile-avatar-lg">{initials(profileUser)}</div>
            <div className="pa-profile-hero-copy">
              <div className="pa-profile-name-lg">{profileUser.first_name} {profileUser.last_name}</div>
              <div className="pa-handle pa-profile-handle-lg">@{profileUser.username}</div>
              <div className="pa-profile-summary">{profileUser.bio || (isCurrentUser ? 'Расскажите о себе, чтобы профиль выглядел живее.' : 'Пользователь пока не добавил описание профиля.')}</div>
            </div>
          </div>
          {!!interestChips.length && (
            <div className="pa-profile-interest-row">
              {interestChips.map((chip) => <span key={chip.key} className={`pa-chip ${chip.tone || 'stone'} pa-profile-interest-chip`}>{chip.label}</span>)}
            </div>
          )}
          <div className="pa-profile-hero-meta">
            {profileUser.city && <span className="pa-pill neutral">Город: {profileUser.city}</span>}
            {profileUser.relationship && <span className="pa-pill neutral">Статус: {profileUser.relationship}</span>}
            <span className="pa-pill accent">Постов: {posts.length}</span>
            <span className={`pa-pill ${profileUser.vouches_count ? 'warning' : 'neutral'}`}>Поручились: {profileUser.vouches_count || 0}</span>
          </div>
          <div className="pa-action-row pa-profile-hero-actions">
            {isCurrentUser ? (
              <>
                <button className="pa-primary-btn" type="button" onClick={() => composerInputRef.current?.focus()}>Новый пост</button>
                <button className="pa-secondary-btn" type="button" onClick={openEditProfile}>Редактировать</button>
              </>
            ) : friendshipStatus === 'friends' ? (
              <>
                <button className="pa-primary-btn" type="button" onClick={() => navigate(`/messages/${profileUser.id}`)}>Написать</button>
                <button className="pa-secondary-btn" type="button" onClick={handleUnfriend} disabled={contactActionLoading}>{contactActionLoading ? '...' : 'Удалить из друзей'}</button>
                <button className="pa-secondary-btn" type="button" onClick={handleVouchToggle} disabled={vouchActionLoading}>{vouchActionLoading ? '...' : (profileUser.vouched_by_me ? 'Отозвать поручительство' : 'Поручиться')}</button>
                {onSaveProfile ? <button className="pa-secondary-btn" type="button" onClick={onSaveProfile}>Сохранить</button> : null}
              </>
            ) : (
              <>
                <button className="pa-primary-btn" type="button" onClick={handleFriendAction} disabled={contactActionLoading || friendshipStatus === 'request_sent'}>
                  {friendshipStatus === 'request_received' ? 'Принять заявку' : friendshipStatus === 'request_sent' ? 'Заявка отправлена' : 'Добавить в друзья'}
                </button>
                <button className="pa-secondary-btn" type="button" onClick={handleSubscribeToggle} disabled={contactActionLoading || friendshipStatus === 'friends'}>
                  {friendshipStatus === 'subscribed' ? 'Отписаться' : 'Подписаться'}
                </button>
                <button className="pa-secondary-btn" type="button" onClick={handleVouchToggle} disabled={vouchActionLoading}>{vouchActionLoading ? '...' : (profileUser.vouched_by_me ? 'Отозвать поручительство' : 'Поручиться')}</button>
                {onSaveProfile ? <button className="pa-secondary-btn" type="button" onClick={onSaveProfile}>Сохранить</button> : null}
              </>
            )}
          </div>
          {saveMessage && <div className="pa-meta pa-profile-save-note">{saveMessage}</div>}
        </div>

        <div className="pa-profile-hero-side">
          <div className="pa-profile-stat-stack">
            <PostAuthStatCard value={posts.length} label="Постов" tone="accent" className="pa-profile-stat-card" />
            {connectionCountItems.map((item) => (
              <PostAuthStatCard
                key={item.key}
                value={item.value}
                label={item.label}
                onClick={() => openConnections(item.key)}
                className="pa-profile-stat-card"
              />
            ))}
          </div>
        </div>
      </section>

      <div className="pa-profile-layout">
        <aside className="pa-profile-sidebar pa-list">
          <section className="pa-card pa-profile-about-card">
            <div className="pa-section-head pa-profile-section-head" style={{ marginTop: 0 }}>
              <div className="pa-section-title">О пользователе</div>
              {isCurrentUser && <button className="pa-secondary-btn" type="button" onClick={openEditProfile}>Редактировать</button>}
            </div>
            <div className="pa-profile-about-copy">{profileUser.bio || 'Пока ничего не рассказал о себе'}</div>
            {!!interestChips.length && (
              <div className="pa-profile-interest-row compact">
                {interestChips.map((chip) => <span key={`sidebar-${chip.key}`} className={`pa-chip ${chip.tone || 'stone'} pa-profile-interest-chip`}>{chip.label}</span>)}
              </div>
            )}
            <PostAuthMetaGrid
              className="pa-profile-meta-grid"
              itemClassName="pa-profile-meta-item"
              labelClassName="pa-profile-meta-label"
              valueClassName="pa-profile-meta-value"
              items={[
                { key: 'city', label: 'Город', value: profileUser.city || 'Не указан' },
                { key: 'status', label: 'Статус', value: profileUser.relationship || 'Не указан' },
                { key: 'privacy', label: 'Приватность', value: profileUser.is_private ? 'Приватный' : 'Открытый' },
                { key: 'relation', label: 'Связь', value: isCurrentUser ? 'Это вы' : friendshipStatus === 'friends' ? 'Друзья' : friendshipStatus === 'request_sent' ? 'Заявка отправлена' : friendshipStatus === 'request_received' ? 'Ждёт решения' : friendshipStatus === 'subscribed' ? 'Подписка' : 'Нет связи' },
              ]}
            />
          </section>

          {spotlightPost && (
            <section className="pa-card pa-profile-spotlight-card">
              <div className="pa-section-head pa-profile-section-head" style={{ marginTop: 0 }}>
                <div>
                  <div className="pa-section-title">В центре внимания</div>
                  <div className="pa-section-meta">Самый заметный материал профиля прямо сейчас.</div>
                </div>
                <span className="pa-pill accent">Spotlight</span>
              </div>
              <div className="pa-profile-spotlight-copy">{spotlightPost.content || 'Пост с наибольшим откликом.'}</div>
              <div className="pa-profile-spotlight-meta">
                <span className="pa-pill neutral">❤ {spotlightPost.likes_count || 0}</span>
                <span className="pa-pill neutral">💬 {spotlightPost.comments_count || 0}</span>
                {spotlightPost.images?.length > 0 && <span className="pa-pill neutral">🖼 {spotlightPost.images.length}</span>}
              </div>
              <div className="pa-action-row pa-profile-spotlight-actions">
                <button className="pa-primary-btn" type="button" onClick={onOpenSpotlightPost}>Открыть пост</button>
                {spotlightPost.images?.length > 0 ? <button className="pa-secondary-btn" type="button" onClick={onOpenSpotlightMedia}>Смотреть медиа</button> : null}
              </div>
            </section>
          )}

          <section className="pa-card pa-profile-context-card">
            <div className="pa-section-head pa-profile-section-head" style={{ marginTop: 0 }}>
              <div className="pa-section-title">{isCurrentUser ? 'Профиль выглядит на' : 'Почему профиль интересен'}</div>
              <span className={`pa-pill ${isCurrentUser ? 'warning' : 'accent'}`}>{isCurrentUser ? `${completeness.progress}%` : `${contextNotes.length || 1} факта`}</span>
            </div>
            {isCurrentUser ? (
              <>
                <div className="pa-profile-completeness-bar"><span style={{ width: `${completeness.progress}%` }} /></div>
                <div className="pa-list pa-profile-check-list">
                  {completeness.checks.map((check) => (
                    <div key={check.key} className={`pa-profile-check-item ${check.done ? 'done' : ''}`}>
                      <span>{check.done ? '✓' : '○'}</span>
                      <span>{check.label}</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="pa-list pa-profile-context-list">
                {(contextNotes.length ? contextNotes : ['Профиль уже выглядит живым и заполненным.']).map((note, index) => (
                  <div key={`${note}-${index}`} className="pa-profile-context-item">{note}</div>
                ))}
              </div>
            )}
          </section>

          <section className="pa-card pa-profile-connections-card">
            <div className="pa-section-head pa-profile-section-head" style={{ marginTop: 0 }}>
              <div className="pa-section-title">Связи</div>
              <span className="pa-section-meta">Живое состояние</span>
            </div>
            <div className="pa-postauth-summary-grid pa-profile-connection-grid">
              {connectionCountItems.map((item) => (
                <PostAuthSummaryCard
                  key={item.key}
                  className="pa-profile-connection-tile"
                  value={item.value}
                  title={item.label}
                  onClick={() => openConnections(item.key)}
                  badge={<span className="pa-pill accent">Связи</span>}
                />
              ))}
            </div>
          </section>
        </aside>

        <main className="pa-profile-content pa-list">
          <section className="pa-card pa-profile-tabs-card">
            <div className="pa-section-head pa-profile-section-head" style={{ marginTop: 0, marginBottom: 12 }}>
              <div>
                <div className="pa-section-title">Пространство профиля</div>
                <div className="pa-section-meta">Переключайтесь между публикациями, медиа и подробностями.</div>
              </div>
            </div>
            <PostAuthFilterChips className="pa-profile-tab-row" compact items={tabItems} activeKey={activeTab} onChange={onChangeTab} />
          </section>
          {isCurrentUser && activeTab === 'posts' && (
            <section className="pa-card pa-profile-composer-card">
              <div className="pa-profile-composer-top">
                <div className="pa-inline-row">
                  <div className="pa-avatar-sm">{initials(profileUser)}</div>
                  <div>
                    <div className="pa-name">Поделиться новостью</div>
                    <div className="pa-meta">Лента и профиль обновятся сразу</div>
                  </div>
                </div>
                <span className="pa-pill accent">Новый пост</span>
              </div>
              <div className="pa-profile-composer-row">
                <div className="pa-message-input-wrap pa-profile-composer-input-wrap">
                  <input ref={composerInputRef} className="pa-input" value={newPost} onChange={(e) => setNewPost(e.target.value)} placeholder="Что нового хотите рассказать?" onKeyDown={(e) => { if (shouldSubmitOnEnter(e)) { e.preventDefault(); handleCreatePost(); } }} />
                </div>
                <button className="pa-primary-btn" type="button" onClick={handleCreatePost} disabled={!newPost.trim() || posting}>{posting ? '...' : 'Опубликовать'}</button>
              </div>
            </section>
          )}
          {children}
        </main>
      </div>
    </>
  );
}

export function ProfileAboutTab({ profileUser, posts, isCurrentUser, friendshipStatus, navigate, openEditProfile, handleVouchToggle, vouchActionLoading, onSaveProfile }) {
  const interestChips = buildProfileInterestChips(profileUser, posts);
  const completeness = buildProfileCompleteness(profileUser, posts);
  return (
    <section className="pa-profile-posts-section" data-profile-posts-anchor>
      <div className="pa-section-head pa-profile-section-head">
        <div>
          <div className="pa-section-title">О профиле</div>
          <div className="pa-section-meta">Быстрый обзор личности, контекста и заполненности профиля.</div>
        </div>
        {isCurrentUser ? <button className="pa-secondary-btn" type="button" onClick={openEditProfile}>Редактировать</button> : null}
      </div>
      <div className="pa-profile-about-grid">
        <section className="pa-card pa-profile-about-panel">
          <div className="pa-section-title">Коротко о себе</div>
          <div className="pa-profile-about-copy">{profileUser.bio || (isCurrentUser ? 'Добавьте пару фраз о себе, чтобы профиль выглядел содержательнее.' : 'Пользователь пока не добавил описание.')}</div>
          {!!interestChips.length && (
            <div className="pa-profile-interest-row">{interestChips.map((chip) => <span key={`about-${chip.key}`} className={`pa-chip ${chip.tone || 'stone'} pa-profile-interest-chip`}>{chip.label}</span>)}</div>
          )}
        </section>
        <section className="pa-card pa-profile-about-panel">
          <div className="pa-section-title">Главные факты</div>
          <PostAuthMetaGrid
            className="pa-profile-meta-grid single"
            itemClassName="pa-profile-meta-item"
            labelClassName="pa-profile-meta-label"
            valueClassName="pa-profile-meta-value"
            items={[
              { key: 'city', label: 'Город', value: profileUser.city || 'Не указан' },
              { key: 'status', label: 'Статус', value: profileUser.relationship || 'Не указан' },
              { key: 'posts', label: 'Публикации', value: `${posts.length}` },
              { key: 'access', label: 'Доступ', value: profileUser.is_private ? 'Частично закрыт' : 'Открыт' },
              { key: 'vouches', label: 'Поручились', value: `${profileUser.vouches_count || 0}` },
              { key: 'relation', label: 'Ваша связь', value: isCurrentUser ? 'Это ваш профиль' : friendshipStatus === 'friends' ? 'Друзья' : friendshipStatus === 'subscribed' ? 'Подписка' : 'Можно познакомиться' },
            ]}
          />
        </section>
        <section className="pa-card pa-profile-about-panel">
          <div className="pa-section-title">Следующий шаг</div>
          {isCurrentUser ? (
            <>
              <div className="pa-profile-about-copy">Заполненность профиля — {completeness.progress}%. Ещё немного, и он будет выглядеть по-настоящему живым.</div>
              <div className="pa-list pa-profile-check-list">
                {completeness.checks.map((check) => <div key={`about-check-${check.key}`} className={`pa-profile-check-item ${check.done ? 'done' : ''}`}><span>{check.done ? '✓' : '○'}</span><span>{check.label}</span></div>)}
              </div>
            </>
          ) : (
            <>
              <div className="pa-profile-about-copy">Доверительный слой сервиса строится на поручительствах. Сейчас за пользователя поручились {profileUser.vouches_count || 0} чел.</div>
              <div className="pa-action-row pa-profile-about-actions">
                <button className="pa-primary-btn" type="button" onClick={() => navigate(`/messages/${profileUser.id}`)}>Написать</button>
                <button className="pa-secondary-btn" type="button" onClick={handleVouchToggle} disabled={vouchActionLoading}>{vouchActionLoading ? '...' : (profileUser.vouched_by_me ? 'Отозвать поручительство' : 'Поручиться')}</button>
                {onSaveProfile ? <button className="pa-secondary-btn" type="button" onClick={onSaveProfile}>Сохранить</button> : null}
                <button className="pa-secondary-btn" type="button" onClick={() => navigate('/friends')}>Ещё люди</button>
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

export function ProfileMediaTab({ mediaItems, profileUser, onOpenMedia }) {
  const [activeFilter, setActiveFilter] = useState('recent');
  const [gridMode, setGridMode] = useState('balanced');
  const [kindFilter, setKindFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [remoteItems, setRemoteItems] = useState([]);
  const [remoteStats, setRemoteStats] = useState(() => buildAlbumStats(mediaItems));
  const [highlights, setHighlights] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [pageInfo, setPageInfo] = useState({ page: 1, limit: 24, total: mediaItems.length, hasMore: false, nextPage: 0 });

  const albumStats = useMemo(() => ({
    ...buildAlbumStats(mediaItems),
    ...(remoteStats || {}),
  }), [mediaItems, remoteStats]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!profileUser?.id) {
        setRemoteItems([]);
        setHighlights([]);
        setRemoteStats(buildAlbumStats(mediaItems));
        setPageInfo({ page: 1, limit: 24, total: mediaItems.length, hasMore: false, nextPage: 0 });
        return;
      }
      try {
        setLoading(true);
        setError('');
        const res = await getUserMedia(profileUser.id, {
          page: 1,
          limit: 24,
          sort: activeFilter,
          kind: kindFilter,
          q: searchQuery.trim(),
        });
        if (!active) return;
        const data = res.data || {};
        setRemoteItems(Array.isArray(data.items) ? data.items : []);
        setHighlights(Array.isArray(data.highlights) ? data.highlights : []);
        setRemoteStats(data.stats || buildAlbumStats(mediaItems));
        setPageInfo({
          page: Number(data.page || 1),
          limit: Number(data.limit || 24),
          total: Number(data.total || 0),
          hasMore: Boolean(data.has_more),
          nextPage: Number(data.next_page || 0),
        });
      } catch (fetchError) {
        if (!active) return;
        setError(getApiErrorMessage(fetchError, 'Не удалось загрузить альбом профиля.'));
        setRemoteItems([]);
        setHighlights([]);
        setRemoteStats(buildAlbumStats(mediaItems));
        setPageInfo({ page: 1, limit: 24, total: mediaItems.length, hasMore: false, nextPage: 0 });
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => {
      active = false;
    };
  }, [activeFilter, kindFilter, mediaItems, profileUser?.id, searchQuery]);

  const handleLoadMore = async () => {
    if (!profileUser?.id || !pageInfo.hasMore || loadingMore) return;
    try {
      setLoadingMore(true);
      const res = await getUserMedia(profileUser.id, {
        page: pageInfo.nextPage || pageInfo.page + 1,
        limit: pageInfo.limit || 24,
        sort: activeFilter,
        kind: kindFilter,
        q: searchQuery.trim(),
      });
      const data = res.data || {};
      setRemoteItems((prev) => [...prev, ...(Array.isArray(data.items) ? data.items : [])]);
      setPageInfo({
        page: Number(data.page || pageInfo.page + 1),
        limit: Number(data.limit || pageInfo.limit || 24),
        total: Number(data.total || pageInfo.total || 0),
        hasMore: Boolean(data.has_more),
        nextPage: Number(data.next_page || 0),
      });
    } catch (fetchError) {
      setError(getApiErrorMessage(fetchError, 'Не удалось догрузить альбом.'));
    } finally {
      setLoadingMore(false);
    }
  };

  const filteredItems = useMemo(() => remoteItems, [remoteItems]);

  const filterButtons = [
    { key: 'recent', label: 'Новые' },
    { key: 'popular', label: 'Популярные' },
    { key: 'commented', label: 'С комментариями' },
    { key: 'captions', label: 'С подписями' },
  ];

  const kindButtons = [
    { key: 'all', label: 'Всё' },
    { key: 'photo', label: 'Фото' },
    { key: 'video', label: 'Видео' },
  ];

  const gridButtons = [
    { key: 'large', label: 'Крупно' },
    { key: 'balanced', label: 'Сетка' },
    { key: 'dense', label: 'Плотно' },
  ];

  const viewerTitle = `Медиатека @${profileUser?.username || ''}`;

  return (
    <section className="pa-profile-posts-section">
      <div className="pa-section-head pa-profile-section-head">
        <div>
          <div className="pa-section-title">Медиатека</div>
          <div className="pa-section-meta">Отдельный серверный альбом профиля: фото, видео, быстрый поиск и догрузка без перегруза всего профиля.</div>
        </div>
        <span className="pa-pill neutral">{pageInfo.total || filteredItems.length}</span>
      </div>
      {mediaItems.length === 0 && !loading ? (
        <PostAuthEmptyState className="pa-profile-empty-card" title="Фотоальбом пока пуст" text="Когда пользователь добавит изображения в посты, они соберутся здесь автоматически." icon="🖼" />
      ) : (
        <section className="pa-card pa-profile-media-gallery-card pa-profile-album-card">
          <div className="pa-profile-album-summary">
            <div className="pa-profile-album-summary-copy">
              <div className="pa-section-title">Альбом @{profileUser?.username || ''}</div>
              <div className="pa-section-meta">Выделенная медиатека профиля с серверной выборкой, фильтрами и быстрыми действиями.</div>
            </div>
            <div className="pa-profile-album-stats">
              <span className="pa-pill neutral">Всего: {albumStats.total || 0}</span>
              <span className="pa-pill neutral">Фото: {albumStats.photos || 0}</span>
              <span className="pa-pill neutral">Видео: {albumStats.videos || 0}</span>
              <span className="pa-pill neutral">Постов: {albumStats.posts || 0}</span>
            </div>
          </div>

          {highlights.length > 0 ? (
            <div className="pa-profile-media-highlights">
              {highlights.map((item, index) => {
                const src = item?.display?.url || item?.src || item?.full?.url || item?.thumb?.url;
                const isVideo = isVideoMedia(item);
                const poster = getMediaPoster(item);
                return (
                  <button key={item?._key || item?.asset_id || `${src}-${index}`} type="button" className="pa-profile-media-highlight pa-reset-button" onClick={() => onOpenMedia?.(highlights, index, viewerTitle)}>
                    {isVideo ? <video className="pa-profile-media-highlight-img" src={src} poster={poster || undefined} preload="metadata" muted playsInline /> : <img className="pa-profile-media-highlight-img" src={src} alt={item?.alt || 'Медиа'} loading="lazy" decoding="async" />}
                    <span className="pa-profile-media-highlight-copy">{item?.source_post_text ? String(item.source_post_text).slice(0, 48) || 'Из популярного поста' : 'Из популярного поста'}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          <div className="pa-profile-album-toolbar">
            <div className="pa-profile-album-filter-row">
              {filterButtons.map((button) => (
                <button
                  key={button.key}
                  type="button"
                  className={`pa-profile-album-filter ${activeFilter === button.key ? 'is-active' : ''}`.trim()}
                  onClick={() => setActiveFilter(button.key)}
                >
                  {button.label}
                </button>
              ))}
            </div>
            <div className="pa-profile-album-grid-row">
              {gridButtons.map((button) => (
                <button
                  key={button.key}
                  type="button"
                  className={`pa-profile-album-grid-btn ${gridMode === button.key ? 'is-active' : ''}`.trim()}
                  onClick={() => setGridMode(button.key)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pa-profile-media-command-row">
            <div className="pa-profile-media-kind-row">
              {kindButtons.map((button) => (
                <button key={button.key} type="button" className={`pa-profile-album-filter ${kindFilter === button.key ? 'is-active' : ''}`.trim()} onClick={() => setKindFilter(button.key)}>{button.label}</button>
              ))}
            </div>
            <label className="pa-profile-media-search">
              <span>🔎</span>
              <input type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Поиск по подписи и описанию" />
            </label>
          </div>

          {loading ? <div className="pa-meta">Загружаю медиатеку…</div> : null}
          {error ? <div className="pa-profile-media-error">{error}</div> : null}

          {!loading && filteredItems.length === 0 ? (
            <PostAuthEmptyState className="pa-profile-empty-card pa-profile-album-empty" title="По этому фильтру пока пусто" text="Попробуйте другой режим, тип медиа или поисковый запрос." icon="🧭" />
          ) : filteredItems.length > 0 ? (
            <>
              <div className={`pa-profile-media-gallery pa-profile-media-gallery-${gridMode}`.trim()}>
                {filteredItems.map((item, index) => {
                  const src = item?.display?.url || item?.src || item?.full?.url || item?.thumb?.url;
                  const isVideo = isVideoMedia(item);
                  const srcSet = isVideo ? '' : buildSrcSet(item);
                  const poster = getMediaPoster(item);
                  const caption = item?.source_post_text ? (item.source_post_text.length > 54 ? `${item.source_post_text.slice(0, 54)}…` : item.source_post_text) : (isVideo ? 'Открыть видео' : 'Открыть фото');
                  return (
                    <button key={item._key || `${src}-${index}`} type="button" className={`pa-profile-media-tile pa-reset-button ${isVideo ? 'is-video' : ''}`.trim()} onClick={() => onOpenMedia?.(filteredItems, index, viewerTitle)}>
                      {isVideo ? (
                        <>
                          <video className="pa-profile-media-img" src={src} poster={poster || undefined} preload="metadata" playsInline muted />
                          <span className="pa-optimized-media-play">▶</span>
                        </>
                      ) : (
                        <img className="pa-profile-media-img" src={src} srcSet={srcSet || undefined} sizes={gridMode === 'dense' ? '(max-width: 640px) 33vw, 200px' : gridMode === 'large' ? '(max-width: 640px) 100vw, 520px' : '(max-width: 640px) 50vw, 280px'} loading="lazy" decoding="async" alt={item?.alt || `Фото ${profileUser?.username || ''}`} />
                      )}
                      <span className="pa-profile-media-caption">{caption}</span>
                      <span className="pa-profile-media-meta">❤ {item?.source_post_likes || 0} · 💬 {item?.source_post_comments || 0}</span>
                    </button>
                  );
                })}
              </div>
              {pageInfo.hasMore ? (
                <div className="pa-profile-media-load-more-row">
                  <button className="pa-secondary-btn" type="button" onClick={handleLoadMore} disabled={loadingMore}>{loadingMore ? 'Загружаю…' : 'Показать ещё'}</button>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      )}
    </section>
  );
}


function ProfileCommentThread({ comment, postId, postAuthorId, currentUserId, onReplyComment, onEditComment, onDeleteComment, onVoteComment, onToggleCommentReplies, onLoadMoreReplies, commentActionState, replyUiState, depth = 0 }) {
  const commentAuthor = comment.user || {};
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const totalReplies = Number(comment.reply_count || replies.length || 0);
  const canEdit = String(commentAuthor.id || comment.user_id || '') === String(currentUserId || '');
  const canDelete = canEdit || String(postAuthorId || '') === String(currentUserId || '');
  const actionState = commentActionState?.[comment.id] || '';
  const isBusy = actionState === 'deleting';
  const isVoteBusy = String(actionState).startsWith('vote:');
  const threadState = replyUiState?.[comment.id] || {};
  const isExpanded = Boolean(threadState.expanded);
  const isLoadingReplies = Boolean(threadState.loading);
  const hasMoreReplies = Boolean(threadState.hasMore);
  const currentVote = Number(comment.current_user_vote || 0);
  const replyLabel = totalReplies > 0 ? `${isExpanded ? 'Скрыть ответы' : 'Показать ответы'} (${totalReplies})` : null;

  return (
    <div className="pa-list" style={{ gap: 8, marginLeft: depth > 0 ? 18 : 0 }}>
      <div className="pa-feed-comment-card">
        <div className="pa-inline-row" style={{ marginBottom: 6, alignItems: 'center' }}>
          <div className="pa-avatar-xs">{initials(commentAuthor)}</div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="pa-name" style={{ fontSize: 13 }}>{commentAuthor.first_name || 'Пользователь'} {commentAuthor.last_name || ''}</div>
            <div className="pa-meta">{formatDate(comment.created_at)}{isCommentEdited(comment) ? ' · изменено' : ''}</div>
          </div>
        </div>
        <div className="pa-bio">{comment.content}</div>
        <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 10, marginTop: 8, flexWrap: 'wrap' }}>
          <div className="pa-inline-row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className={`pa-comment-vote-btn ${currentVote === 1 ? 'active' : ''}`.trim()} type="button" disabled={isVoteBusy} onClick={() => onVoteComment?.(postId, comment, 1)}>
              <span>＋</span>
              <strong>{Number(comment.likes || 0)}</strong>
            </button>
            <button className={`pa-comment-vote-btn is-negative ${currentVote === -1 ? 'active' : ''}`.trim()} type="button" disabled={isVoteBusy} onClick={() => onVoteComment?.(postId, comment, -1)}>
              <span>－</span>
              <strong>{Number(comment.dislikes || 0)}</strong>
            </button>
            <button className="pa-link-btn" type="button" onClick={() => onReplyComment?.(postId, comment)}>Ответить</button>
            {replyLabel ? <button className="pa-link-btn" type="button" onClick={() => onToggleCommentReplies?.(postId, comment)}>{replyLabel}</button> : null}
            {canEdit ? <button className="pa-link-btn" type="button" onClick={() => onEditComment?.(postId, comment)}>Редактировать</button> : null}
            {canDelete ? <button className="pa-link-btn" type="button" onClick={() => onDeleteComment?.(postId, comment)} disabled={isBusy}>{isBusy ? 'Удаляю…' : 'Удалить'}</button> : null}
          </div>
        </div>
      </div>
      {isExpanded ? (
        <>
          {isLoadingReplies && replies.length === 0 ? <div className="pa-meta" style={{ marginLeft: 4 }}>Загружаю ответы…</div> : null}
          {replies.length > 0 ? replies.map((reply) => (
            <ProfileCommentThread key={reply.id || `${postId}-${reply.created_at}-${reply.content}`} comment={reply} postId={postId} postAuthorId={postAuthorId} currentUserId={currentUserId} onReplyComment={onReplyComment} onEditComment={onEditComment} onDeleteComment={onDeleteComment} onVoteComment={onVoteComment} onToggleCommentReplies={onToggleCommentReplies} onLoadMoreReplies={onLoadMoreReplies} commentActionState={commentActionState} replyUiState={replyUiState} depth={depth + 1} />
          )) : null}
          {hasMoreReplies ? <button className="pa-link-btn" type="button" onClick={() => onLoadMoreReplies?.(postId, comment)} disabled={isLoadingReplies}>{isLoadingReplies ? 'Загружаю…' : 'Показать ещё ответы'}</button> : null}
        </>
      ) : null}
    </div>
  );
}

export function ProfilePostsBlock({
  isCurrentUser,
  posts,
  profilePostsEmptyState,
  profileUser,
  currentUser,
  currentUserId,
  commentsByPost,
  commentsOpen,
  commentsLoading,
  commentInputs,
  commentSubmitting,
  commentSorts,
  editingTargets,
  commentActionState,
  replyUiState,
  toggleLike,
  likingPostId,
  toggleComments,
  submitComment,
  replyTargets,
  onReplyComment,
  onEditComment,
  onDeleteComment,
  onVoteComment,
  onToggleCommentReplies,
  onLoadMoreReplies,
  clearReplyTarget,
  clearEditTarget,
  setCommentSort,
  setCommentInputs,
  handleDeletePost,
  deletingPostId,
  onOpenMedia,
  onSavePost,
}) {
  return (
    <section className="pa-profile-posts-section">
      <div className="pa-section-head pa-profile-section-head">
        <div>
          <div className="pa-section-title">Посты</div>
          <div className="pa-section-meta">{isCurrentUser ? 'Ваши публикации и активность профиля' : 'Публикации этого профиля'}</div>
        </div>
        <span className="pa-pill neutral">{posts.length}</span>
      </div>
      {posts.length === 0 ? (
        <PostAuthEmptyState className="pa-profile-empty-card" title={profilePostsEmptyState.title} text={profilePostsEmptyState.text} icon={isCurrentUser ? '📝' : '👤'} primaryAction={profilePostsEmptyState.primary ? { label: profilePostsEmptyState.primary.label, onClick: profilePostsEmptyState.primary.onClick } : null} secondaryAction={profilePostsEmptyState.secondary ? { label: profilePostsEmptyState.secondary.label, onClick: profilePostsEmptyState.secondary.onClick } : null} />
      ) : (
        <div className="pa-list">
          {posts.map((post) => {
            const comments = commentsByPost[post.id] || [];
            const commentTree = buildCommentTree(comments, commentSorts?.[post.id] || 'oldest');
            const replyTarget = replyTargets?.[post.id] || null;
            const editingTarget = editingTargets?.[post.id] || null;
            const canDelete = String(post.user?.id || post.user_id || profileUser.id || '') === currentUserId;
            const author = post.user || profileUser;
            return (
              <PostAuthPostCard
                key={post.id}
                className="pa-profile-post-card"
                badge={<span className="pa-profile-post-badge">Пост профиля</span>}
                badgeMeta={formatDate(post.created_at)}
                author={author}
                avatarLabel={initials(author)}
                title={`${author.first_name || 'Пользователь'} ${author.last_name || ''}`.trim()}
                subtitle={`@${author.username || 'user'}`}
                content={post.content}
                trailing={canDelete ? <button className="pa-secondary-btn" type="button" disabled={deletingPostId === post.id} onClick={() => handleDeletePost(post.id)}>{deletingPostId === post.id ? 'Удаляю…' : 'Удалить'}</button> : null}
                media={post.images.length > 0 ? (
                  <div className="pa-profile-post-media">
                    <div className="pa-profile-post-media-title">Оптимизированные вложения</div>
                    <div className="pa-profile-post-media-text">{mediaPreviewText(post.images)} · для ленты берётся облегчённый вариант</div>
                    {renderMediaGrid(post.images.map((item) => ({ ...item, source_post_id: post.id, owner_id: profileUser?.id || null, owner_username: profileUser?.username || '' })), onOpenMedia, `Медиа @${profileUser?.username || ""}`)}
                  </div>
                ) : null}
                actions={[
                  { key: 'like', label: post.liked ? 'Убрать лайк' : 'Лайк', value: post.likes_count, onClick: () => toggleLike(post), tone: 'soft', active: post.liked, busy: likingPostId === post.id, busyLabel: '...' },
                  { key: 'comments', label: commentsOpen[post.id] ? 'Скрыть комментарии' : 'Комментарии', value: post.comments_count, onClick: () => toggleComments(post.id), tone: 'soft' },
                  { key: 'save', label: 'В подборку', onClick: () => onSavePost?.(post), tone: 'soft' },
                ]}
              >
                {commentsOpen[post.id] && (
                  <div className="pa-profile-comments-panel">
                    {commentsLoading[post.id] ? (
                      <div className="pa-meta">Загружаю комментарии…</div>
                    ) : comments.length === 0 ? (
                      <div className="pa-meta">Комментариев пока нет.</div>
                    ) : (
                      <>
                        <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                          <div className="pa-pill-row" style={{ gap: 6 }}>
                            {[
                              { key: 'oldest', label: 'Сначала старые' },
                              { key: 'newest', label: 'Сначала новые' },
                              { key: 'discussed', label: 'Обсуждаемые' },
                            ].map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                className={`pa-feed-tab ${(commentSorts?.[post.id] || 'oldest') === option.key ? 'active' : ''}`.trim()}
                                onClick={() => setCommentSort?.(post.id, option.key)}
                                style={{ padding: '8px 10px', minHeight: 0, fontSize: 12 }}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                          <div className="pa-meta">{Number(post.comments_count || comments.length)} комментариев</div>
                        </div>
                        <div className="pa-list pa-profile-comments-list">
                          {commentTree.map((comment) => (
                            <ProfileCommentThread key={comment.id || `${post.id}-${comment.created_at}-${comment.content}`} comment={comment} postId={post.id} postAuthorId={author?.id || post?.user_id} currentUserId={currentUserId} onReplyComment={onReplyComment} onEditComment={onEditComment} onDeleteComment={onDeleteComment} onVoteComment={onVoteComment} onToggleCommentReplies={onToggleCommentReplies} onLoadMoreReplies={onLoadMoreReplies} commentActionState={commentActionState} replyUiState={replyUiState?.[post.id] || {}} />
                          ))}
                        </div>
                      </>
                    )}
                    {editingTarget ? (
                      <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div className="pa-meta">Редактирование комментария</div>
                        <button className="pa-link-btn" type="button" onClick={() => clearEditTarget?.(post.id)}>Отменить</button>
                      </div>
                    ) : replyTarget ? (
                      <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                        <div className="pa-meta">Ответ @{replyTarget?.user?.username || 'user'}{replyTarget?._depthLimited ? ' · без нового уровня' : ''}</div>
                        <button className="pa-link-btn" type="button" onClick={() => clearReplyTarget?.(post.id)}>Отменить</button>
                      </div>
                    ) : null}
                    <div className="pa-profile-comment-composer">
                      <div className="pa-avatar-xs">{initials(currentUser)}</div>
                      <div className="pa-message-input-wrap">
                        <input className="pa-input" value={commentInputs[post.id] || ''} onChange={(e) => setCommentInputs((prev) => ({ ...prev, [post.id]: e.target.value }))} placeholder={editingTarget ? 'Изменить комментарий' : replyTarget ? 'Написать ответ' : 'Написать комментарий'} onKeyDown={(e) => { if (shouldSubmitOnEnter(e)) { e.preventDefault(); submitComment(post.id); } }} />
                      </div>
                      <button className="pa-secondary-btn" type="button" onClick={() => submitComment(post.id)} disabled={commentSubmitting[post.id] || !(commentInputs[post.id] || '').trim()}>{commentSubmitting[post.id] ? 'Сохраняю…' : (editingTarget ? 'Сохранить' : replyTarget ? 'Ответить' : 'Отправить')}</button>
                    </div>
                  </div>
                )}
              </PostAuthPostCard>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function ProfileMediaViewerModal({ open, items = [], index = 0, title = '', onClose, onPrev, onNext }) {
  const item = items[index] || null;
  const src = item?.full?.url || item?.display?.url || item?.src || item?.thumb?.url || '';
  const caption = item?.source_post_text || item?.alt || '';
  const isVideo = isVideoMedia(item);
  const poster = getMediaPoster(item);

  if (!open || !item || !src) return null;

  return (
    <div className="pa-overlay pa-profile-media-viewer-overlay" onClick={onClose}>
      <div className="pa-modal-wrap pa-profile-media-viewer-wrap" onClick={(event) => event.stopPropagation()}>
        <div className="pa-modal pa-profile-media-viewer-modal">
          <div className="pa-profile-media-viewer-top">
            <div>
              <div className="pa-section-title">{title || (isVideo ? 'Просмотр видео' : 'Просмотр медиа')}</div>
              <div className="pa-section-meta">{items.length > 1 ? `${index + 1} из ${items.length}` : (isVideo ? 'Одно видео' : 'Одно вложение')}</div>
            </div>
            <button className="pa-secondary-btn" type="button" onClick={onClose}>Закрыть</button>
          </div>
          <div className="pa-profile-media-viewer-stage">
            {items.length > 1 ? <button className="pa-profile-media-viewer-nav prev" type="button" onClick={onPrev} aria-label="Предыдущее медиа">‹</button> : null}
            {isVideo ? (
              <video className="pa-profile-media-viewer-img" src={src} poster={poster || undefined} controls playsInline preload="metadata" />
            ) : (
              <img className="pa-profile-media-viewer-img" src={src} alt={item?.alt || 'Медиа'} />
            )}
            {items.length > 1 ? <button className="pa-profile-media-viewer-nav next" type="button" onClick={onNext} aria-label="Следующее медиа">›</button> : null}
          </div>
          <div className="pa-profile-media-viewer-bottom">
            <div className="pa-profile-media-viewer-caption">{caption || 'Полноразмерный просмотр вложения.'}</div>
            <div className="pa-action-row pa-profile-media-viewer-actions">
              <a className="pa-secondary-btn" href={src} target="_blank" rel="noreferrer">{isVideo ? 'Открыть видео' : 'Открыть оригинал'}</a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function ProfileEditModal({ showEdit, setShowEdit, editForm, setEditForm, saving, handleUpdateProfile }) {
  if (!showEdit) return null;

  return (
    <div className="pa-overlay" onClick={() => setShowEdit(false)}>
      <div className="pa-modal-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="pa-modal">
          <div className="pa-section-head" style={{ marginTop: 0 }}><div className="pa-section-title">Редактирование профиля</div></div>
          <div className="pa-list">
            <label className="pa-card" style={{ padding: 12 }}><div className="pa-meta">Имя</div><input className="pa-input" value={editForm.first_name} onChange={(e) => setEditForm((prev) => ({ ...prev, first_name: e.target.value }))} /></label>
            <label className="pa-card" style={{ padding: 12 }}><div className="pa-meta">Фамилия</div><input className="pa-input" value={editForm.last_name} onChange={(e) => setEditForm((prev) => ({ ...prev, last_name: e.target.value }))} /></label>
            <label className="pa-card" style={{ padding: 12 }}><div className="pa-meta">О себе</div><textarea className="pa-textarea" value={editForm.bio} onChange={(e) => setEditForm((prev) => ({ ...prev, bio: e.target.value }))} /></label>
            <label className="pa-card" style={{ padding: 12 }}><div className="pa-meta">Город</div><input className="pa-input" value={editForm.city} onChange={(e) => setEditForm((prev) => ({ ...prev, city: e.target.value }))} /></label>
            <label className="pa-card" style={{ padding: 12 }}><div className="pa-meta">Статус отношений</div><input className="pa-input" value={editForm.relationship} onChange={(e) => setEditForm((prev) => ({ ...prev, relationship: e.target.value }))} /></label>
            <label className="pa-card" style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><div><div className="pa-meta">Приватный профиль</div><div className="pa-bio" style={{ marginTop: 6 }}>Скрывает часть профиля от других пользователей.</div></div><input type="checkbox" checked={Boolean(editForm.is_private)} onChange={(e) => setEditForm((prev) => ({ ...prev, is_private: e.target.checked }))} /></label>
          </div>
          <div className="pa-action-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}><button className="pa-secondary-btn" onClick={() => setShowEdit(false)} disabled={saving}>Отмена</button><button className="pa-primary-btn" onClick={handleUpdateProfile} disabled={saving}>{saving ? 'Сохраняю…' : 'Сохранить'}</button></div>
        </div>
      </div>
    </div>
  );
}

export function ProfileConnectionsModal({
  connectionsModal,
  setConnectionsModal,
  connectionsEmptyState,
  openConnections,
  currentUserId,
  actingConnectionId,
  connectionPrimaryActionLabel,
  connectionSecondaryActionLabel,
  handleConnectionFriendAction,
  handleConnectionSubscribeToggle,
  navigate,
}) {
  if (!connectionsModal.open) return null;

  return (
    <div className="pa-overlay" onClick={() => setConnectionsModal((prev) => ({ ...prev, open: false }))}>
      <div className="pa-modal-wrap" onClick={(e) => e.stopPropagation()}>
        <div className="pa-modal">
          <div className="pa-section-head" style={{ marginTop: 0 }}>
            <div className="pa-section-title">{connectionsModal.type === 'friends' ? 'Друзья' : connectionsModal.type === 'subscriptions' ? 'Подписки' : connectionsModal.type === 'vouches' ? 'Поручились' : 'Подписчики'}</div>
            <button className="pa-secondary-btn" onClick={() => setConnectionsModal((prev) => ({ ...prev, open: false }))}>Закрыть</button>
          </div>
          {connectionsModal.loading ? (
            <div className="pa-loading">Загружаю список…</div>
          ) : connectionsModal.error ? (
            <div className="pa-error">{connectionsModal.error}<div className="pa-action-row" style={{ marginTop: 10, justifyContent: 'flex-end' }}><button className="pa-secondary-btn" type="button" onClick={() => openConnections(connectionsModal.type)}>Повторить</button></div></div>
          ) : connectionsModal.users.length === 0 ? (
            <div className="pa-empty pa-card"><h3>{connectionsEmptyState.title}</h3><p>{connectionsEmptyState.text}</p><div className="pa-action-row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="pa-secondary-btn" type="button" onClick={connectionsEmptyState.secondary.onClick}>{connectionsEmptyState.secondary.label}</button><button className="pa-primary-btn" type="button" onClick={connectionsEmptyState.primary.onClick}>{connectionsEmptyState.primary.label}</button></div></div>
          ) : (
            <div className="pa-list">
              {connectionsModal.users.map((user) => {
                const status = user.id === currentUserId ? 'self' : (user.friendship_status || 'none');
                const isSelf = status === 'self';
                const busy = actingConnectionId === user.id;
                const secondaryLabel = connectionSecondaryActionLabel(user);
                const actions = !isSelf ? [
                  {
                    key: 'primary',
                    label: connectionPrimaryActionLabel(user),
                    busy,
                    disabled: status === 'request_sent',
                    onClick: () => status === 'friends' ? navigate(`/messages/${user.id}`) : handleConnectionFriendAction(user),
                  },
                  secondaryLabel && status !== 'request_sent' ? {
                    key: 'secondary',
                    label: secondaryLabel,
                    busy,
                    onClick: () => status === 'friends' ? handleConnectionFriendAction(user) : handleConnectionSubscribeToggle(user),
                  } : null,
                ] : [];
                return (
                  <PostAuthUserCard
                    key={user.id}
                    className="pa-profile-connection-user-card"
                    avatarLabel={initials(user)}
                    title={`${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Пользователь'}
                    subtitle={`@${user.username || 'user'}`}
                    description={user.bio || user.city || 'Профиль без подробностей'}
                    badges={normalizeUserBadges({ user, currentUserId, includeCity: Boolean(user.city) })}
                    actions={actions}
                    onOpenProfile={() => { setConnectionsModal((prev) => ({ ...prev, open: false })); navigate(`/profile/${user.id}`); }}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
