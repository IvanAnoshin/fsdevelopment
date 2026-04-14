import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { createCommunity, createCommunityPost, getCommunities, getCommunity, getCommunityPosts, joinCommunity, leaveCommunity, showToast } from '../../services/api';
import { PostAuthHero, PostAuthNoticeCard } from '../../components/postauth';
import { useDocumentTitle } from '../../utils/pageTitle';

function safeDate(value) {
  if (!value) return '—';
  try { return new Date(value).toLocaleString('ru-RU'); } catch { return '—'; }
}

function normalizeCommunityQuery(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

export default function Communities() {
  const [searchParams] = useSearchParams();
  const [communities, setCommunities] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selected, setSelected] = useState(null);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [query, setQuery] = useState('');
  const [form, setForm] = useState({ name: '', description: '' });
  const [postDraft, setPostDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const listRequestIdRef = useRef(0);
  const detailRequestIdRef = useRef(0);

  const loadCommunities = useCallback(async ({ withLoader = true, explicitQuery = query } = {}) => {
    const normalizedQuery = normalizeCommunityQuery(explicitQuery);
    const requestId = ++listRequestIdRef.current;
    try {
      if (withLoader) setLoading(true);
      setError('');
      const res = await getCommunities(normalizedQuery ? { q: normalizedQuery } : {});
      if (requestId !== listRequestIdRef.current) return;
      const list = Array.isArray(res.data?.communities) ? res.data.communities : [];
      setCommunities(list);
      setSelectedId((prev) => {
        if (prev && list.some((item) => Number(item.id) === Number(prev))) return prev;
        return list[0]?.id ?? null;
      });
    } catch (err) {
      if (requestId !== listRequestIdRef.current) return;
      setError(err.response?.data?.error || 'Не удалось загрузить сообщества');
    } finally {
      if (requestId === listRequestIdRef.current && withLoader) setLoading(false);
    }
  }, [query]);

  const loadCommunityDetail = useCallback(async (communityId, { withLoader = true } = {}) => {
    if (!communityId) return;
    const requestId = ++detailRequestIdRef.current;
    try {
      if (withLoader) setLoadingDetail(true);
      setError('');
      const [communityRes, postsRes] = await Promise.all([
        getCommunity(communityId),
        getCommunityPosts(communityId),
      ]);
      if (requestId !== detailRequestIdRef.current) return;
      setSelected(communityRes.data?.community || null);
      setPosts(Array.isArray(postsRes.data?.posts) ? postsRes.data.posts : []);
    } catch (err) {
      if (requestId !== detailRequestIdRef.current) return;
      setError(err.response?.data?.error || 'Не удалось загрузить сообщество');
    } finally {
      if (requestId === detailRequestIdRef.current && withLoader) setLoadingDetail(false);
    }
  }, []);

  useEffect(() => { loadCommunities(); }, [loadCommunities]);
  useEffect(() => {
    const openId = Number(searchParams.get('open') || 0);
    if (openId > 0) setSelectedId(openId);
  }, [searchParams]);
  useEffect(() => {
    if (!selectedId) {
      setSelected(null);
      setPosts([]);
      return;
    }
    loadCommunityDetail(selectedId);
  }, [loadCommunityDetail, selectedId]);
  useEffect(() => {
    const normalized = normalizeCommunityQuery(query);
    const timer = window.setTimeout(() => {
      loadCommunities({ withLoader: false, explicitQuery: normalized });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [loadCommunities, query]);

  useDocumentTitle('Сообщества', selected?.name || '');

  const stats = useMemo(() => [
    { key: 'all', value: communities.length, label: 'сообществ' },
    { key: 'joined', value: communities.filter((item) => item.is_member).length, label: 'ваших' },
    { key: 'posts', value: selected?.posts_count || 0, label: 'постов в выбранном' },
  ], [communities, selected]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    try {
      setCreating(true);
      const res = await createCommunity({ name: form.name.trim(), description: form.description.trim() });
      const community = res.data?.community;
      if (community?.id) {
        setShowCreate(false);
        setForm({ name: '', description: '' });
        showToast('Сообщество создано', { tone: 'success' });
        await loadCommunities({ explicitQuery: '' });
        setSelectedId(community.id);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось создать сообщество');
    } finally {
      setCreating(false);
    }
  };

  const handleJoinToggle = async () => {
    if (!selected?.id) return;
    try {
      if (selected.is_member && selected.my_role !== 'owner') {
        await leaveCommunity(selected.id);
        showToast('Вы вышли из сообщества', { tone: 'success' });
      } else if (!selected.is_member) {
        await joinCommunity(selected.id);
        showToast('Вы вступили в сообщество', { tone: 'success' });
      }
      await Promise.all([
        loadCommunities({ withLoader: false }),
        loadCommunityDetail(selected.id, { withLoader: false }),
      ]);
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось обновить участие');
    }
  };

  const handlePublish = async () => {
    if (!selected?.id || !postDraft.trim()) return;
    try {
      setPosting(true);
      const res = await createCommunityPost(selected.id, { content: postDraft.trim(), images: '[]' });
      const newPost = res.data?.post;
      if (newPost) {
        setPosts((prev) => [newPost, ...prev]);
        setPostDraft('');
        setSelected((prev) => prev ? { ...prev, posts_count: (prev.posts_count || 0) + 1 } : prev);
        setCommunities((prev) => prev.map((item) => item.id === selected.id ? { ...item, posts_count: (item.posts_count || 0) + 1 } : item));
        showToast('Пост опубликован в сообществе', { tone: 'success' });
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Не удалось опубликовать пост');
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="pa-list">
      <PostAuthHero
        badge={<div className="pa-discovery-badge">Сообщества</div>}
        title="Простые, но рабочие сообщества"
        text="Создавай пространство по интересам, вступай в небольшие группы и публикуй туда отдельные посты. Это базовая, но уже живая версия community-модуля."
        titleTag="h1"
        stats={stats}
        actions={<><button className="pa-primary-btn" onClick={() => setShowCreate((v) => !v)}>{showCreate ? 'Скрыть форму' : 'Создать сообщество'}</button><button className="pa-secondary-btn" onClick={() => loadCommunities({ explicitQuery: query })}>Обновить</button></>}
      />

      <section className="pa-card">
        <div className="pa-action-row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <label className="pa-search" style={{ marginTop: 0, flex: 1, minWidth: 220 }}>
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск сообществ" onKeyDown={(e) => e.key === 'Enter' && loadCommunities({ explicitQuery: query })} />
          </label>
          <button className="pa-soft-btn" onClick={() => loadCommunities({ explicitQuery: query })}>Искать</button>
        </div>
        {showCreate && (
          <div className="pa-soft-panel" style={{ marginTop: 12 }}>
            <div className="pa-section-title">Новое сообщество</div>
            <input className="pa-input" style={{ marginTop: 10 }} value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Название сообщества" />
            <textarea className="pa-textarea" style={{ marginTop: 10 }} value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Коротко опиши, о чём это сообщество" />
            <div className="pa-action-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="pa-primary-btn" onClick={handleCreate} disabled={creating || !form.name.trim()}>{creating ? 'Создаю…' : 'Создать'}</button>
            </div>
          </div>
        )}
        {error && <div className="pa-error" style={{ marginTop: 12 }}>{error}</div>}
      </section>

      <div className="pa-admin-columns">
        <section className="pa-card">
          <div className="pa-section-head" style={{ marginTop: 0 }}>
            <div className="pa-section-title">Лента сообществ</div>
            <div className="pa-section-meta">{communities.length}</div>
          </div>
          {loading ? <div className="pa-loading">Загружаю сообщества…</div> : communities.length === 0 ? <PostAuthNoticeCard tone="accent" icon="👥" title="Сообществ пока нет" text="Создай первое сообщество или попробуй другой поисковый запрос." /> : (
            <div className="pa-list">
              {communities.map((community) => (
                <button key={community.id} type="button" className="pa-admin-item" style={{ textAlign: 'left', borderColor: selectedId === community.id ? 'rgba(109,94,252,.28)' : undefined }} onClick={() => setSelectedId(community.id)}>
                  <div className="pa-admin-row" style={{ alignItems: 'flex-start' }}>
                    <div className="pa-admin-main">
                      <div className="pa-name">{community.name}</div>
                      <div className="pa-handle">/{community.slug}</div>
                      <div className="pa-bio" style={{ marginTop: 6 }}>{community.description || 'Пока без описания.'}</div>
                      <div className="pa-pill-row" style={{ marginTop: 10 }}>
                        <span className="pa-pill neutral">{community.members_count || 0} участников</span>
                        <span className="pa-pill blue">{community.posts_count || 0} постов</span>
                        {community.is_member ? <span className="pa-pill green">Вы внутри</span> : null}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="pa-card">
          {!selected ? <div className="pa-empty"><h3>Выбери сообщество</h3><p>Справа появятся описание, участники и посты сообщества.</p></div> : loadingDetail ? <div className="pa-loading">Открываю сообщество…</div> : (
            <div className="pa-list">
              <div className="pa-section-head" style={{ marginTop: 0 }}>
                <div>
                  <div className="pa-section-title">{selected.name}</div>
                  <div className="pa-handle">/{selected.slug}</div>
                </div>
                {selected.my_role === 'owner' ? <span className="pa-pill accent">Создатель</span> : <button className={selected.is_member ? 'pa-secondary-btn' : 'pa-primary-btn'} onClick={handleJoinToggle}>{selected.is_member ? 'Выйти' : 'Вступить'}</button>}
              </div>
              <div className="pa-bio">{selected.description || 'Описание ещё не заполнено.'}</div>
              {Array.isArray(selected.recent_members) && selected.recent_members.length > 0 && <div className="pa-pill-row">{selected.recent_members.map((user) => <Link key={user.id} className="pa-pill neutral" to={`/profile/${user.id}`} style={{ textDecoration: 'none' }}>{user.first_name || 'Участник'} {user.last_name || ''}</Link>)}</div>}

              {selected.is_member && (
                <div className="pa-soft-panel">
                  <div className="pa-section-title">Написать в сообщество</div>
                  <textarea className="pa-textarea" style={{ marginTop: 10 }} value={postDraft} onChange={(e) => setPostDraft(e.target.value)} placeholder="Короткий пост для участников сообщества" />
                  <div className="pa-action-row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
                    <button className="pa-primary-btn" onClick={handlePublish} disabled={posting || !postDraft.trim()}>{posting ? 'Публикую…' : 'Опубликовать'}</button>
                  </div>
                </div>
              )}

              <div className="pa-section-head">
                <div className="pa-section-title">Посты сообщества</div>
                <div className="pa-section-meta">{posts.length}</div>
              </div>
              {posts.length === 0 ? <PostAuthNoticeCard tone="neutral" icon="📝" title="Пока пусто" text="Здесь появятся публикации участников сообщества." /> : (
                <div className="pa-list">
                  {posts.map((item) => (
                    <div key={item.id} className="pa-card" style={{ padding: 14 }}>
                      <div className="pa-inline-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                        <div>
                          <div className="pa-name">{item.user?.first_name || 'Автор'} {item.user?.last_name || ''}</div>
                          {item.user?.username ? <div className="pa-handle">@{item.user.username}</div> : null}
                        </div>
                        <span className="pa-pill neutral">{safeDate(item.created_at)}</span>
                      </div>
                      <div className="pa-bio" style={{ marginTop: 10 }}>{item.content}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
