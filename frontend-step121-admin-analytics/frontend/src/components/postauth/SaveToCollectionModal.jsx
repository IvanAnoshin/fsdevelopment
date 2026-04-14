import { useEffect, useMemo, useState } from 'react';
import { addCollectionItem, createCollection, getApiErrorMessage, getCollections, showToast } from '../../services/api';

const PRESET_COLORS = ['#6d5efc', '#0a84ff', '#22b46a', '#ffb648', '#e15252', '#111111'];

export default function SaveToCollectionModal({ open, entry = null, onClose, onSaved }) {
  const [collections, setCollections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selectedId, setSelectedId] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newCollection, setNewCollection] = useState({ name: '', description: '', color: PRESET_COLORS[0] });
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    setShowCreate(false);
    setNewCollection({ name: '', description: '', color: PRESET_COLORS[0] });
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res = await getCollections();
        if (cancelled) return;
        const list = Array.isArray(res.data?.collections) ? res.data.collections : [];
        setCollections(list);
        const preferred = list.find((item) => item.is_default) || list[0];
        setSelectedId(preferred ? String(preferred.id) : '');
      } catch (error) {
        if (!cancelled) showToast(getApiErrorMessage(error, 'Не удалось загрузить подборки'), { tone: 'danger' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const selected = useMemo(() => collections.find((item) => String(item.id) === String(selectedId)) || null, [collections, selectedId]);

  const handleCreateCollection = async () => {
    const name = newCollection.name.trim();
    if (!name) return;
    try {
      setCreating(true);
      const res = await createCollection({ ...newCollection, name });
      const created = res.data?.collection;
      if (!created) return;
      setCollections((prev) => [created, ...prev]);
      setSelectedId(String(created.id));
      setShowCreate(false);
      setNewCollection({ name: '', description: '', color: PRESET_COLORS[0] });
      showToast('Подборка создана', { tone: 'success' });
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось создать подборку'), { tone: 'danger' });
    } finally {
      setCreating(false);
    }
  };

  const handleSave = async () => {
    if (!entry || !selectedId) return;
    try {
      setSaving(true);
      const res = await addCollectionItem(selectedId, entry);
      const duplicate = Boolean(res.data?.duplicate);
      showToast(duplicate ? 'Элемент уже был в подборке — данные обновлены' : 'Элемент сохранён в подборку', { tone: 'success' });
      onSaved?.(res.data?.item, selected);
      onClose?.();
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось сохранить в подборку'), { tone: 'danger' });
    } finally {
      setSaving(false);
    }
  };

  if (!open || !entry) return null;

  return (
    <div className="pa-overlay" onClick={onClose}>
      <div className="pa-modal-wrap" onClick={(event) => event.stopPropagation()}>
        <div className="pa-modal pa-collection-modal">
          <div className="pa-section-head" style={{ marginTop: 0 }}>
            <div>
              <div className="pa-section-title">Сохранить в подборку</div>
              <div className="pa-section-meta">Выберите папку для {entry.entity_type === 'profile' ? 'профиля' : entry.entity_type === 'media' ? 'фото' : 'поста'}</div>
            </div>
            <button className="pa-secondary-btn" type="button" onClick={onClose}>Закрыть</button>
          </div>

          <div className="pa-card pa-collection-preview-card">
            <div className="pa-inline-row" style={{ alignItems: 'flex-start' }}>
              {entry.preview_image ? <img src={entry.preview_image} alt={entry.title} className="pa-collection-preview-thumb" /> : <div className="pa-avatar-sm pa-collection-preview-fallback">★</div>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="pa-name">{entry.title}</div>
                <div className="pa-meta">{entry.subtitle}</div>
                {entry.preview_text ? <div className="pa-bio" style={{ marginTop: 6 }}>{entry.preview_text}</div> : null}
              </div>
            </div>
          </div>

          <div className="pa-section-head" style={{ marginBottom: 10 }}>
            <div className="pa-section-title">Мои подборки</div>
            <button className="pa-link-btn" type="button" onClick={() => setShowCreate((prev) => !prev)}>{showCreate ? 'Скрыть' : 'Новая подборка'}</button>
          </div>

          {showCreate && (
            <div className="pa-card pa-collection-create-card">
              <div className="pa-list" style={{ gap: 10 }}>
                <input className="pa-input" value={newCollection.name} onChange={(event) => setNewCollection((prev) => ({ ...prev, name: event.target.value }))} placeholder="Название подборки" />
                <textarea className="pa-textarea" value={newCollection.description} onChange={(event) => setNewCollection((prev) => ({ ...prev, description: event.target.value }))} placeholder="Краткое описание (необязательно)" />
                <div className="pa-inline-row pa-collection-color-row">
                  {PRESET_COLORS.map((color) => (
                    <button key={color} type="button" className={`pa-collection-color-swatch ${newCollection.color === color ? 'is-active' : ''}`.trim()} style={{ background: color }} onClick={() => setNewCollection((prev) => ({ ...prev, color }))} aria-label={`Цвет ${color}`} />
                  ))}
                </div>
                <div className="pa-action-row" style={{ justifyContent: 'flex-end' }}>
                  <button className="pa-secondary-btn" type="button" onClick={() => setShowCreate(false)}>Отмена</button>
                  <button className="pa-primary-btn" type="button" disabled={creating || !newCollection.name.trim()} onClick={handleCreateCollection}>{creating ? 'Создаю…' : 'Создать'}</button>
                </div>
              </div>
            </div>
          )}

          {loading ? <div className="pa-loading" style={{ marginTop: 10 }}>Загружаю подборки…</div> : (
            <div className="pa-list pa-collection-select-list">
              {collections.map((collection) => (
                <button key={collection.id} type="button" className={`pa-collection-select-item ${String(collection.id) === String(selectedId) ? 'is-active' : ''}`.trim()} onClick={() => setSelectedId(String(collection.id))}>
                  <span className="pa-collection-select-dot" style={{ background: collection.color || '#6d5efc' }} />
                  <div className="pa-collection-select-copy">
                    <div className="pa-name">{collection.name}</div>
                    <div className="pa-meta">{collection.description || (collection.is_default ? 'Системная подборка для быстрых сохранений' : 'Пользовательская подборка')}</div>
                  </div>
                  <div className="pa-pill-row">
                    {collection.is_default ? <span className="pa-pill accent">По умолчанию</span> : null}
                    <span className="pa-pill neutral">{collection.items_count || 0}</span>
                  </div>
                </button>
              ))}
              {!collections.length && <div className="pa-meta">Сначала создайте первую подборку.</div>}
            </div>
          )}

          <div className="pa-action-row" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="pa-secondary-btn" type="button" onClick={onClose}>Позже</button>
            <button className="pa-primary-btn" type="button" disabled={saving || !selectedId} onClick={handleSave}>{saving ? 'Сохраняю…' : `Сохранить${selected ? ` · ${selected.name}` : ''}`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
