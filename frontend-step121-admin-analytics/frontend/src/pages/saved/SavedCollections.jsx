import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  confirmAction,
  createCollection,
  deleteCollection,
  getApiErrorMessage,
  getCollectionItems,
  getCollections,
  removeCollectionItem,
  showToast,
  updateCollection,
} from '../../services/api';
import { parseCollectionPayload } from '../../services/collections';
import MediaActionModal from '../../components/postauth/MediaActionModal';
import { getMediaPoster, isVideoMedia, normalizeMediaItem } from '../../utils/media';

const PRESET_COLORS = ['#6d5efc', '#0a84ff', '#22b46a', '#ffb648', '#e15252', '#111111'];
const TYPE_LABELS = { all: 'Все', post: 'Посты', profile: 'Профили', media: 'Медиа' };

function formatDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function normalizeText(value, max = 140) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildSavedMediaItem(item) {
  const payload = parseCollectionPayload(item?.payload) || {};
  return normalizeMediaItem({
    kind: payload.kind || (String(payload.mime || '').toLowerCase().startsWith('video/') ? 'video' : ''),
    mime: payload.mime || '',
    asset_id: payload.asset_id || null,
    assetId: payload.asset_id || null,
    hash: payload.hash || '',
    source_post_id: payload.source_post_id || null,
    owner_id: payload.owner_id || null,
    owner_username: payload.username || '',
    alt: payload.alt || item?.title || 'Медиа',
    src: payload.display_url || payload.full_url || item?.preview_image || '',
    display_url: payload.display_url || payload.full_url || item?.preview_image || '',
    full_url: payload.full_url || payload.display_url || item?.preview_image || '',
    thumb_url: payload.thumb_url || payload.poster_url || item?.preview_image || '',
    poster_url: payload.poster_url || payload.thumb_url || item?.preview_image || '',
  });
}

export default function SavedCollections() {
  const navigate = useNavigate();
  const [collections, setCollections] = useState([]);
  const [activeCollectionId, setActiveCollectionId] = useState('');
  const [items, setItems] = useState([]);
  const [loadingCollections, setLoadingCollections] = useState(true);
  const [loadingItems, setLoadingItems] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [creating, setCreating] = useState(false);
  const [savingCollection, setSavingCollection] = useState(false);
  const [deletingCollection, setDeletingCollection] = useState(false);
  const [removingItemId, setRemovingItemId] = useState('');
  const [createForm, setCreateForm] = useState({ name: '', description: '', color: PRESET_COLORS[0] });
  const [editForm, setEditForm] = useState({ name: '', description: '', color: PRESET_COLORS[0] });
  const [mediaViewer, setMediaViewer] = useState({ open: false, items: [], index: 0, title: '' });

  const loadCollections = useCallback(async (preferredId = '') => {
    try {
      setLoadingCollections(true);
      const res = await getCollections();
      const list = Array.isArray(res.data?.collections) ? res.data.collections : [];
      setCollections(list);
      const active = list.find((item) => String(item.id) === String(preferredId)) || list.find((item) => String(item.id) === String(activeCollectionId)) || list.find((item) => item.is_default) || list[0] || null;
      setActiveCollectionId(active ? String(active.id) : '');
      if (active) {
        setEditForm({ name: active.name || '', description: active.description || '', color: active.color || PRESET_COLORS[0] });
      }
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось загрузить подборки'), { tone: 'danger' });
    } finally {
      setLoadingCollections(false);
    }
  }, [activeCollectionId]);

  const loadItems = useCallback(async (collectionId) => {
    if (!collectionId) {
      setItems([]);
      return;
    }
    try {
      setLoadingItems(true);
      const res = await getCollectionItems(collectionId);
      const list = Array.isArray(res.data?.items) ? res.data.items : [];
      setItems(list);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось загрузить элементы подборки'), { tone: 'danger' });
    } finally {
      setLoadingItems(false);
    }
  }, []);

  useEffect(() => {
    loadCollections();
  }, [loadCollections]);

  useEffect(() => {
    loadItems(activeCollectionId);
  }, [activeCollectionId, loadItems]);

  useEffect(() => {
    const onRefresh = (event) => {
      if (event?.detail?.action === 'saved.refresh') {
        loadCollections(activeCollectionId);
        loadItems(activeCollectionId);
      }
    };
    window.addEventListener('app:action', onRefresh);
    return () => window.removeEventListener('app:action', onRefresh);
  }, [activeCollectionId, loadCollections, loadItems]);

  const activeCollection = useMemo(() => collections.find((item) => String(item.id) === String(activeCollectionId)) || null, [collections, activeCollectionId]);

  useEffect(() => {
    if (activeCollection) {
      setEditForm({ name: activeCollection.name || '', description: activeCollection.description || '', color: activeCollection.color || PRESET_COLORS[0] });
    }
  }, [activeCollection]);

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((item) => {
      if (typeFilter !== 'all' && item.entity_type !== typeFilter) return false;
      if (!q) return true;
      return [item.title, item.subtitle, item.preview_text].some((part) => String(part || '').toLowerCase().includes(q));
    });
  }, [items, search, typeFilter]);

  const stats = useMemo(() => {
    const totalItems = collections.reduce((sum, item) => sum + Number(item.items_count || 0), 0);
    const defaultCollection = collections.find((item) => item.is_default);
    return { totalCollections: collections.length, totalItems, defaultCount: Number(defaultCollection?.items_count || 0) };
  }, [collections]);

  const handleCreateCollection = async () => {
    const name = createForm.name.trim();
    if (!name) return;
    try {
      setSavingCollection(true);
      const res = await createCollection({ ...createForm, name });
      const created = res.data?.collection;
      showToast('Подборка создана', { tone: 'success' });
      setCreating(false);
      setCreateForm({ name: '', description: '', color: PRESET_COLORS[0] });
      await loadCollections(created?.id);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось создать подборку'), { tone: 'danger' });
    } finally {
      setSavingCollection(false);
    }
  };

  const handleUpdateCollection = async () => {
    if (!activeCollection) return;
    const name = editForm.name.trim();
    if (!name) return;
    try {
      setSavingCollection(true);
      await updateCollection(activeCollection.id, { ...editForm, name });
      showToast('Подборка обновлена', { tone: 'success' });
      await loadCollections(activeCollection.id);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось обновить подборку'), { tone: 'danger' });
    } finally {
      setSavingCollection(false);
    }
  };

  const handleDeleteCollection = async () => {
    if (!activeCollection || activeCollection.is_default) return;
    const confirmed = await confirmAction({ title: 'Удалить подборку', message: 'Эта папка и список её элементов будут удалены.', confirmLabel: 'Удалить', tone: 'danger' });
    if (!confirmed) return;
    try {
      setDeletingCollection(true);
      await deleteCollection(activeCollection.id);
      showToast('Подборка удалена', { tone: 'success' });
      await loadCollections();
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось удалить подборку'), { tone: 'danger' });
    } finally {
      setDeletingCollection(false);
    }
  };

  const handleRemoveItem = async (item) => {
    if (!activeCollection || !item?.id) return;
    try {
      setRemovingItemId(String(item.id));
      await removeCollectionItem(activeCollection.id, item.id);
      setItems((prev) => prev.filter((entry) => String(entry.id) !== String(item.id)));
      setCollections((prev) => prev.map((collection) => String(collection.id) === String(activeCollection.id) ? { ...collection, items_count: Math.max(Number(collection.items_count || 0) - 1, 0) } : collection));
      showToast('Элемент удалён из подборки', { tone: 'success' });
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось удалить элемент'), { tone: 'danger' });
    } finally {
      setRemovingItemId('');
    }
  };

  const closeMediaViewer = useCallback(() => {
    setMediaViewer({ open: false, items: [], index: 0, title: '' });
  }, []);

  const handleOpenItem = (item) => {
    if (item?.entity_type === 'media') {
      const mediaItem = buildSavedMediaItem(item);
      if (mediaItem?.src || mediaItem?.display?.url || mediaItem?.full?.url) {
        const title = isVideoMedia(mediaItem) ? 'Видео из подборки' : 'Фото из подборки';
        setMediaViewer({ open: true, items: [mediaItem], index: 0, title });
        return;
      }
    }
    const link = item?.link || parseCollectionPayload(item?.payload)?.link || '';
    if (!link) return;
    if (link.startsWith('/')) {
      navigate(link);
      return;
    }
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="pa-saved-layout">
      <aside className="pa-saved-sidebar">
        <section className="pa-card pa-saved-hero">
          <div className="pa-pill accent">Сохранённое</div>
          <h2 className="pa-saved-title">Подборки и быстрые сохранения</h2>
          <p className="pa-bio">Сюда попадают посты, профили, фото и видео, которые вы сохранили из ленты, профиля и медиапросмотра.</p>
          <div className="pa-inline-row pa-saved-stats">
            <span className="pa-pill neutral">Подборок · {stats.totalCollections}</span>
            <span className="pa-pill neutral">Элементов · {stats.totalItems}</span>
            <span className="pa-pill accent">Быстрое сохранение · {stats.defaultCount}</span>
          </div>
        </section>

        <section className="pa-card pa-saved-create-card">
          <div className="pa-section-head" style={{ marginTop: 0 }}>
            <div>
              <div className="pa-section-title">Новая подборка</div>
              <div className="pa-section-meta">Создавайте папки под темы и людей</div>
            </div>
            <button className="pa-link-btn" type="button" onClick={() => setCreating((prev) => !prev)}>{creating ? 'Скрыть' : 'Открыть'}</button>
          </div>
          {creating ? (
            <div className="pa-list" style={{ gap: 10 }}>
              <input className="pa-input" value={createForm.name} onChange={(event) => setCreateForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Название подборки" />
              <textarea className="pa-textarea" value={createForm.description} onChange={(event) => setCreateForm((prev) => ({ ...prev, description: event.target.value }))} placeholder="Описание" />
              <div className="pa-inline-row pa-collection-color-row">
                {PRESET_COLORS.map((color) => (
                  <button key={color} type="button" className={`pa-collection-color-swatch ${createForm.color === color ? 'is-active' : ''}`.trim()} style={{ background: color }} onClick={() => setCreateForm((prev) => ({ ...prev, color }))} />
                ))}
              </div>
              <div className="pa-action-row" style={{ justifyContent: 'flex-end' }}>
                <button className="pa-secondary-btn" type="button" onClick={() => setCreating(false)}>Отмена</button>
                <button className="pa-primary-btn" type="button" disabled={savingCollection || !createForm.name.trim()} onClick={handleCreateCollection}>{savingCollection ? 'Создаю…' : 'Создать'}</button>
              </div>
            </div>
          ) : <div className="pa-meta">Сделайте отдельные папки для людей, полезных постов и важных фото.</div>}
        </section>

        <section className="pa-list pa-saved-collection-list">
          {loadingCollections ? <div className="pa-card pa-loading">Загружаю подборки…</div> : collections.map((collection) => (
            <button key={collection.id} type="button" className={`pa-card pa-saved-collection-card ${String(collection.id) === String(activeCollectionId) ? 'is-active' : ''}`.trim()} onClick={() => setActiveCollectionId(String(collection.id))}>
              <div className="pa-inline-row" style={{ alignItems: 'flex-start' }}>
                <span className="pa-saved-collection-dot" style={{ background: collection.color || PRESET_COLORS[0] }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="pa-name">{collection.name}</div>
                  <div className="pa-meta">{collection.description || (collection.is_default ? 'Системная подборка по умолчанию' : 'Пользовательская папка')}</div>
                </div>
                <div className="pa-pill-row">
                  {collection.is_default ? <span className="pa-pill accent">Default</span> : null}
                  <span className="pa-pill neutral">{collection.items_count || 0}</span>
                </div>
              </div>
            </button>
          ))}
        </section>
      </aside>

      <section className="pa-saved-content">
        <section className="pa-card pa-saved-toolbar">
          <div className="pa-section-head" style={{ marginTop: 0 }}>
            <div>
              <div className="pa-section-title">{activeCollection?.name || 'Подборка не выбрана'}</div>
              <div className="pa-section-meta">{activeCollection?.description || 'Выберите подборку слева, чтобы управлять элементами.'}</div>
            </div>
            <div className="pa-pill-row">
              {activeCollection?.is_default ? <span className="pa-pill accent">Системная</span> : null}
              {activeCollection ? <span className="pa-pill neutral">{activeCollection.items_count || items.length} элементов</span> : null}
            </div>
          </div>

          {activeCollection ? (
            <>
              <div className="pa-saved-toolbar-grid">
                <label className="pa-saved-field">
                  <span className="pa-meta">Название</span>
                  <input className="pa-input" value={editForm.name} onChange={(event) => setEditForm((prev) => ({ ...prev, name: event.target.value }))} />
                </label>
                <label className="pa-saved-field">
                  <span className="pa-meta">Описание</span>
                  <input className="pa-input" value={editForm.description} onChange={(event) => setEditForm((prev) => ({ ...prev, description: event.target.value }))} />
                </label>
              </div>
              <div className="pa-inline-row pa-collection-color-row" style={{ marginTop: 10 }}>
                {PRESET_COLORS.map((color) => (
                  <button key={color} type="button" className={`pa-collection-color-swatch ${editForm.color === color ? 'is-active' : ''}`.trim()} style={{ background: color }} onClick={() => setEditForm((prev) => ({ ...prev, color }))} />
                ))}
              </div>
              <div className="pa-action-row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
                <div className="pa-pill-row">
                  <button className="pa-secondary-btn" type="button" onClick={() => loadCollections(activeCollection.id)} disabled={loadingCollections}>Обновить</button>
                  {!activeCollection.is_default ? <button className="pa-secondary-btn danger" type="button" onClick={handleDeleteCollection} disabled={deletingCollection}>{deletingCollection ? 'Удаляю…' : 'Удалить подборку'}</button> : null}
                </div>
                <button className="pa-primary-btn" type="button" disabled={savingCollection || !editForm.name.trim()} onClick={handleUpdateCollection}>{savingCollection ? 'Сохраняю…' : 'Сохранить изменения'}</button>
              </div>
            </>
          ) : <div className="pa-meta">Подборок пока нет — создайте первую папку слева.</div>}
        </section>

        <section className="pa-card pa-saved-items-card">
          <div className="pa-section-head" style={{ marginTop: 0 }}>
            <div>
              <div className="pa-section-title">Элементы подборки</div>
              <div className="pa-section-meta">Откройте элемент или удалите его из текущей папки</div>
            </div>
            <div className="pa-inline-row" style={{ gap: 8 }}>
              <input className="pa-input pa-saved-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Искать внутри подборки" />
            </div>
          </div>

          <div className="pa-pill-row" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <button key={key} type="button" className={`pa-feed-tab ${typeFilter === key ? 'active' : ''}`.trim()} onClick={() => setTypeFilter(key)}>{label}</button>
            ))}
          </div>

          {loadingItems ? <div className="pa-loading">Загружаю элементы…</div> : filteredItems.length === 0 ? (
            <div className="pa-empty pa-card">
              <h3>Подборка пока пустая</h3>
              <p>Сохраняйте посты, профили, фото и видео из ленты, профиля и медиапросмотра.</p>
              <div className="pa-action-row" style={{ justifyContent: 'center', marginTop: 12 }}>
                <button className="pa-secondary-btn" type="button" onClick={() => navigate('/feed')}>Открыть ленту</button>
                <button className="pa-primary-btn" type="button" onClick={() => navigate('/profile')}>Открыть профиль</button>
              </div>
            </div>
          ) : (
            <div className="pa-list pa-saved-items-list">
              {filteredItems.map((item) => {
                const payload = parseCollectionPayload(item.payload);
                const mediaItem = item.entity_type === 'media' ? buildSavedMediaItem(item) : null;
                const isVideo = mediaItem ? isVideoMedia(mediaItem) : false;
                const preview = item.preview_image || payload?.preview_image || mediaItem?.thumb?.url || '';
                const poster = mediaItem ? getMediaPoster(mediaItem) : '';
                return (
                  <article key={item.id} className="pa-card pa-saved-item-card">
                    <div className="pa-inline-row pa-saved-item-row">
                      {preview ? (isVideo ? (
                        <button type="button" className="pa-saved-item-thumb pa-reset-button is-video" onClick={() => handleOpenItem(item)} aria-label={item.title || 'Открыть видео'}>
                          <video className="pa-saved-item-thumb-video" src={mediaItem?.display?.url || mediaItem?.src || mediaItem?.full?.url || ''} poster={poster || undefined} preload="metadata" playsInline muted />
                          <span className="pa-optimized-media-play">▶</span>
                        </button>
                      ) : <img className="pa-saved-item-thumb" src={preview} alt={item.title} />) : <div className="pa-avatar pa-saved-item-fallback">{(item.entity_type || '?').slice(0, 1).toUpperCase()}</div>}
                      <div className="pa-saved-item-copy">
                        <div className="pa-inline-row" style={{ justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                          <div>
                            <div className="pa-name">{item.title}</div>
                            <div className="pa-meta">{item.subtitle || 'Сохранённый элемент'} · {formatDate(item.created_at)}</div>
                          </div>
                          <span className="pa-pill neutral">{TYPE_LABELS[item.entity_type] || item.entity_type}</span>
                        </div>
                        {item.preview_text ? <div className="pa-bio">{normalizeText(item.preview_text, 180)}</div> : null}
                        <div className="pa-action-row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
                          <button className="pa-secondary-btn" type="button" onClick={() => handleOpenItem(item)}>Открыть</button>
                          <button className="pa-secondary-btn danger" type="button" disabled={removingItemId === String(item.id)} onClick={() => handleRemoveItem(item)}>{removingItemId === String(item.id) ? 'Удаляю…' : 'Убрать'}</button>
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </section>
      <MediaActionModal
        open={mediaViewer.open}
        items={mediaViewer.items}
        index={mediaViewer.index}
        title={mediaViewer.title}
        onClose={closeMediaViewer}
        onPrev={() => {}}
        onNext={() => {}}
      />
    </div>
  );
}
