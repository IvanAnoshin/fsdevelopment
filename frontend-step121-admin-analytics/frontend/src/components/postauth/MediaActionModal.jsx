import { useCallback, useEffect, useMemo, useState } from 'react';
import { commentMedia, getApiErrorMessage, getChats, getMediaInteractions, reportMedia, sendMessage, showToast, voteMedia } from '../../services/api';
import SaveToCollectionModal from './SaveToCollectionModal';
import { buildMediaCollectionEntry } from '../../services/collections';
import { getMediaPoster, isVideoMedia } from '../../utils/media';

function normalizeChat(chat) {
  const peer = chat?.user || chat?.peer || chat?.participant || chat || {};
  return {
    id: String(peer.id || chat?.user_id || chat?.id || ''),
    name: `${peer.first_name || ''} ${peer.last_name || ''}`.trim() || peer.username || chat?.name || 'Чат',
    subtitle: peer.username ? `@${peer.username}` : 'Переслать в этот чат',
  };
}

function buildMediaTarget(item) {
  if (!item) return { mediaKey: '', assetId: undefined, sourcePostId: undefined, fullUrl: '', displayUrl: '' };
  const assetId = Number(item?.asset_id || item?.assetId || 0) || undefined;
  const sourcePostId = Number(item?.source_post_id || item?.sourcePostId || 0) || undefined;
  const fullUrl = item?.full?.url || item?.full_url || item?.full_src || item?.src || item?.display?.url || item?.thumb?.url || '';
  const displayUrl = item?.display?.url || item?.src || fullUrl;
  const mediaKey = assetId ? `asset:${assetId}` : item?.hash ? `hash:${item.hash}` : fullUrl ? `url:${fullUrl}` : '';
  return { mediaKey, assetId, sourcePostId, fullUrl, displayUrl };
}

function initials(name) {
  if (!name) return 'U';
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}`.toUpperCase() || 'U';
}

const EMPTY_CONTEXT = {
  pluses_count: 0,
  minuses_count: 0,
  comments_count: 0,
  my_vote: 0,
  comments: [],
};

export default function MediaActionModal({ open, items = [], index = 0, title = '', onClose, onPrev, onNext }) {
  const item = items[index] || null;
  const target = useMemo(() => buildMediaTarget(item), [item]);
  const isVideo = useMemo(() => isVideoMedia(item), [item]);
  const posterUrl = useMemo(() => getMediaPoster(item), [item]);
  const [context, setContext] = useState(EMPTY_CONTEXT);
  const [loading, setLoading] = useState(false);
  const [commentInput, setCommentInput] = useState('');
  const [commentSending, setCommentSending] = useState(false);
  const [voteSending, setVoteSending] = useState(false);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [forwardLoading, setForwardLoading] = useState(false);
  const [forwardingChatId, setForwardingChatId] = useState('');
  const [chatItems, setChatItems] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [reportSending, setReportSending] = useState(false);

  const refreshContext = useCallback(async () => {
    if (!target.mediaKey) {
      setContext(EMPTY_CONTEXT);
      return;
    }
    try {
      setLoading(true);
      const res = await getMediaInteractions({ media_key: target.mediaKey, asset_id: target.assetId });
      setContext({ ...EMPTY_CONTEXT, ...(res.data || {}) });
    } catch (error) {
      showToast(getApiErrorMessage(error, `Не удалось загрузить действия для ${isVideo ? 'видео' : 'фото'}`), { tone: 'danger' });
    } finally {
      setLoading(false);
    }
  }, [isVideo, target.assetId, target.mediaKey]);

  useEffect(() => {
    if (!open) return;
    setCommentInput('');
    setForwardOpen(false);
    setReportOpen(false);
    setReportReason('');
    refreshContext();
  }, [open, index, refreshContext]);

  const handleVote = useCallback(async (value) => {
    if (!target.mediaKey || voteSending) return;
    try {
      setVoteSending(true);
      const res = await voteMedia({ media_key: target.mediaKey, asset_id: target.assetId, source_post_id: target.sourcePostId, value });
      setContext({ ...EMPTY_CONTEXT, ...(res.data || {}) });
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось поставить оценку'), { tone: 'danger' });
    } finally {
      setVoteSending(false);
    }
  }, [target, voteSending]);

  const handleCommentSubmit = useCallback(async () => {
    const content = commentInput.trim();
    if (!content || commentSending || !target.mediaKey) return;
    try {
      setCommentSending(true);
      const res = await commentMedia({ media_key: target.mediaKey, asset_id: target.assetId, source_post_id: target.sourcePostId, content });
      setContext({ ...EMPTY_CONTEXT, ...(res.data || {}) });
      setCommentInput('');
      showToast('Комментарий добавлен', { tone: 'success' });
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось отправить комментарий'), { tone: 'danger' });
    } finally {
      setCommentSending(false);
    }
  }, [commentInput, commentSending, target]);

  const saveEntry = useMemo(() => {
    if (!item) return null;
    return buildMediaCollectionEntry(item, {
      profileId: item?.owner_id || item?.user_id || item?.profile_id || null,
      username: item?.owner_username || '',
      title: title || item?.alt || (isVideoMedia(item) ? 'Видео' : 'Фото'),
      caption: item?.source_post_text || '',
    });
  }, [item, title]);

  const handleCopy = useCallback(async () => {
    if (!target.fullUrl) return;
    try {
      await navigator.clipboard.writeText(target.fullUrl);
      showToast(`Ссылка на ${isVideo ? 'видео' : 'фото'} скопирована`, { tone: 'success' });
    } catch (_) {
      showToast('Не удалось скопировать ссылку', { tone: 'danger' });
    }
  }, [isVideo, target.fullUrl]);

  const handleDownload = useCallback(async () => {
    const downloadUrl = target.fullUrl || target.displayUrl;
    if (!downloadUrl) return;
    try {
      const response = await fetch(downloadUrl);
      if (!response.ok) throw new Error('download failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${isVideo ? 'video' : 'photo'}-${target.assetId || Date.now()}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      showToast(`${isVideo ? 'Видео' : 'Фото'} скачано`, { tone: 'success' });
    } catch (_) {
      window.open(downloadUrl, '_blank', 'noopener,noreferrer');
    }
  }, [isVideo, target.assetId, target.displayUrl, target.fullUrl]);

  const handleOpenSourcePost = useCallback(() => {
    if (!target.sourcePostId) return;
    if (typeof window !== 'undefined') {
      window.location.assign(`/feed?post=${target.sourcePostId}`);
    }
  }, [target.sourcePostId]);

  const handleToggleForward = useCallback(async () => {
    const nextOpen = !forwardOpen;
    setForwardOpen(nextOpen);
    setReportOpen(false);
    if (!nextOpen || chatItems.length > 0) return;
    try {
      setForwardLoading(true);
      const res = await getChats();
      const chats = Array.isArray(res.data?.chats) ? res.data.chats.map(normalizeChat).filter((chat) => chat.id) : [];
      setChatItems(chats);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось загрузить чаты для пересылки'), { tone: 'danger' });
    } finally {
      setForwardLoading(false);
    }
  }, [chatItems.length, forwardOpen]);

  const handleForward = useCallback(async (chat) => {
    if (!chat?.id || !target.fullUrl) return;
    try {
      setForwardingChatId(String(chat.id));
      await sendMessage(chat.id, `${isVideo ? '🎬 Видео' : '📷 Фото'}\n${target.fullUrl}`);
      showToast(`${isVideo ? 'Видео' : 'Фото'} отправлено в чат «${chat.name}»`, { tone: 'success' });
      setForwardOpen(false);
    } catch (error) {
      showToast(getApiErrorMessage(error, `Не удалось переслать ${isVideo ? 'видео' : 'фото'}`), { tone: 'danger' });
    } finally {
      setForwardingChatId('');
    }
  }, [isVideo, target.fullUrl]);

  const handleReportSubmit = useCallback(async () => {
    const reason = reportReason.trim();
    if (!reason || reportSending || !target.mediaKey) return;
    try {
      setReportSending(true);
      await reportMedia({ media_key: target.mediaKey, asset_id: target.assetId, source_post_id: target.sourcePostId, reason });
      showToast('Жалоба отправлена', { tone: 'success' });
      setReportReason('');
      setReportOpen(false);
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось отправить жалобу'), { tone: 'danger' });
    } finally {
      setReportSending(false);
    }
  }, [reportReason, reportSending, target]);

  if (!open || !item || !target.displayUrl) return null;

  return (
    <div className="pa-overlay pa-media-action-overlay" onClick={onClose}>
      <div className="pa-modal-wrap pa-media-action-wrap" onClick={(event) => event.stopPropagation()}>
        <div className="pa-modal pa-media-action-modal">
          <div className="pa-media-action-top">
            <div>
              <div className="pa-section-title">{title || (isVideo ? 'Видео' : 'Фото')}</div>
              <div className="pa-section-meta">{items.length > 1 ? `${index + 1} из ${items.length}` : (isVideo ? 'Одно видео' : 'Одно фото')}</div>
            </div>
            <button className="pa-secondary-btn" type="button" onClick={onClose}>Закрыть</button>
          </div>

          <div className="pa-media-action-stage">
            {items.length > 1 ? <button className="pa-media-action-nav prev" type="button" onClick={onPrev} aria-label={isVideo ? 'Предыдущее видео' : 'Предыдущее фото'}>‹</button> : null}
            {isVideo ? (
              <video className="pa-media-action-img" src={target.displayUrl} poster={posterUrl || undefined} controls playsInline preload="metadata" />
            ) : (
              <img className="pa-media-action-img" src={target.displayUrl} alt={item?.alt || 'Фото'} />
            )}
            {items.length > 1 ? <button className="pa-media-action-nav next" type="button" onClick={onNext} aria-label={isVideo ? 'Следующее видео' : 'Следующее фото'}>›</button> : null}
          </div>

          <div className="pa-media-action-toolbar">
            <button className={`pa-media-action-btn ${context.my_vote === 1 ? 'is-active-positive' : ''}`.trim()} type="button" disabled={voteSending} onClick={() => handleVote(1)}>
              <span>＋</span>
              <strong>{context.pluses_count || 0}</strong>
            </button>
            <button className={`pa-media-action-btn ${context.my_vote === -1 ? 'is-active-negative' : ''}`.trim()} type="button" disabled={voteSending} onClick={() => handleVote(-1)}>
              <span>－</span>
              <strong>{context.minuses_count || 0}</strong>
            </button>
            <button className="pa-media-action-btn" type="button" onClick={() => { setForwardOpen(false); setReportOpen(false); document.querySelector('.pa-media-comment-input')?.focus(); }}>
              <span>💬</span>
              <strong>{context.comments_count || 0}</strong>
            </button>
            <button className="pa-media-action-btn" type="button" onClick={handleCopy}><span>⧉</span><strong>Копировать</strong></button>
            <button className="pa-media-action-btn" type="button" onClick={handleDownload}><span>⇩</span><strong>Скачать</strong></button>
            {target.sourcePostId ? <button className="pa-media-action-btn" type="button" onClick={handleOpenSourcePost}><span>↳</span><strong>К посту</strong></button> : null}
            <button className={`pa-media-action-btn ${saveOpen ? 'is-open' : ''}`.trim()} type="button" onClick={() => { setSaveOpen(true); setForwardOpen(false); setReportOpen(false); }}><span>★</span><strong>В подборку</strong></button>
            <button className={`pa-media-action-btn ${forwardOpen ? 'is-open' : ''}`.trim()} type="button" onClick={handleToggleForward}><span>↗</span><strong>Репост</strong></button>
            <button className={`pa-media-action-btn ${reportOpen ? 'is-open is-danger' : 'is-danger'}`.trim()} type="button" onClick={() => { setReportOpen((prev) => !prev); setForwardOpen(false); }}><span>⚑</span><strong>Пожаловаться</strong></button>
          </div>

          {forwardOpen && (
            <div className="pa-card pa-media-panel">
              <div className="pa-section-head pa-media-panel-head" style={{ marginTop: 0 }}>
                <div className="pa-section-title">Репост {isVideo ? 'видео' : 'фото'}</div>
                <div className="pa-section-meta">Выберите чат</div>
              </div>
              {forwardLoading ? <div className="pa-meta">Загружаю чаты…</div> : chatItems.length === 0 ? <div className="pa-meta">Чатов пока нет.</div> : (
                <div className="pa-list pa-media-forward-list">
                  {chatItems.map((chat) => (
                    <button key={chat.id} type="button" className="pa-media-forward-item" disabled={forwardingChatId === String(chat.id)} onClick={() => handleForward(chat)}>
                      <div className="pa-avatar-xs">{initials(chat.name)}</div>
                      <div className="pa-media-forward-copy">
                        <div className="pa-name">{chat.name}</div>
                        <div className="pa-meta">{chat.subtitle}</div>
                      </div>
                      <span className="pa-pill neutral">{forwardingChatId === String(chat.id) ? '...' : 'Отправить'}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="pa-card pa-media-panel pa-media-meta-panel">
            <div className="pa-section-head pa-media-panel-head" style={{ marginTop: 0 }}>
              <div className="pa-section-title">О медиа</div>
              <div className="pa-section-meta">Быстрые метаданные</div>
            </div>
            <div className="pa-media-meta-grid">
              <span className="pa-pill neutral">Тип: {isVideo ? 'Видео' : 'Фото'}</span>
              {item?.source_post_date ? <span className="pa-pill neutral">{new Date(item.source_post_date).toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })}</span> : null}
              {item?.source_post_likes != null ? <span className="pa-pill neutral">❤ {item.source_post_likes}</span> : null}
              {item?.source_post_comments != null ? <span className="pa-pill neutral">💬 {item.source_post_comments}</span> : null}
              {item?.width && item?.height ? <span className="pa-pill neutral">{item.width}×{item.height}</span> : null}
              {item?.original_mime || item?.mime ? <span className="pa-pill neutral">{item.original_mime || item.mime}</span> : null}
            </div>
            {item?.source_post_text ? <div className="pa-bio">{item.source_post_text}</div> : null}
          </div>

          {reportOpen && (
            <div className="pa-card pa-media-panel">
              <div className="pa-section-head pa-media-panel-head" style={{ marginTop: 0 }}>
                <div className="pa-section-title">Жалоба на {isVideo ? 'видео' : 'фото'}</div>
                <div className="pa-section-meta">Опишите проблему</div>
              </div>
              <textarea className="pa-textarea pa-media-report-input" value={reportReason} onChange={(event) => setReportReason(event.target.value)} placeholder="Например: спам, оскорбительный контент, нарушение правил" />
              <div className="pa-action-row" style={{ justifyContent: 'flex-end' }}>
                <button className="pa-secondary-btn" type="button" onClick={() => setReportOpen(false)}>Отмена</button>
                <button className="pa-primary-btn" type="button" disabled={reportSending || !reportReason.trim()} onClick={handleReportSubmit}>{reportSending ? 'Отправляю…' : 'Отправить жалобу'}</button>
              </div>
            </div>
          )}

          <div className="pa-card pa-media-panel">
            <div className="pa-section-head pa-media-panel-head" style={{ marginTop: 0 }}>
              <div className="pa-section-title">Комментарии к {isVideo ? 'видео' : 'фото'}</div>
              <div className="pa-section-meta">{loading ? 'Обновляю…' : `${context.comments_count || 0} шт.`}</div>
            </div>
            <div className="pa-list pa-media-comments-list">
              {context.comments?.length ? context.comments.map((comment) => {
                const name = `${comment?.user?.first_name || ''} ${comment?.user?.last_name || ''}`.trim() || comment?.user?.username || 'Пользователь';
                return (
                  <div key={comment.id} className="pa-media-comment-item">
                    <div className="pa-avatar-xs">{initials(name)}</div>
                    <div className="pa-media-comment-copy">
                      <div className="pa-inline-row pa-media-comment-head">
                        <span className="pa-name">{name}</span>
                        <span className="pa-meta">{new Date(comment.created_at).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <div className="pa-bio">{comment.content}</div>
                    </div>
                  </div>
                );
              }) : <div className="pa-meta">Пока никто не прокомментировал это {isVideo ? 'видео' : 'фото'}.</div>}
            </div>
            <div className="pa-composer pa-media-comment-composer">
              <div className="pa-message-input-wrap">
                <input className="pa-input pa-media-comment-input" value={commentInput} onChange={(event) => setCommentInput(event.target.value)} placeholder={isVideo ? "Написать комментарий к видео" : "Написать комментарий к фото"} onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    handleCommentSubmit();
                  }
                }} />
              </div>
              <button className="pa-primary-btn" type="button" disabled={commentSending || !commentInput.trim()} onClick={handleCommentSubmit}>{commentSending ? '...' : 'Отправить'}</button>
            </div>
          </div>
        </div>
      </div>
      <div onClick={(event) => event.stopPropagation()}>
        <SaveToCollectionModal
          open={saveOpen}
          entry={saveEntry}
          onClose={() => setSaveOpen(false)}
          onSaved={() => setSaveOpen(false)}
        />
      </div>
    </div>
  );
}
