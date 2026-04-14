import {
  VOICE_MAX_DURATION_SEC,
  VIDEO_NOTE_MAX_DURATION_SEC,
} from '../../services/media';

export const CHAT_FILTERS = [
  { key: 'all', label: 'Все' },
  { key: 'unread', label: 'Непрочитанные' },
  { key: 'online', label: 'Онлайн' },
];

export const MESSAGE_DRAFTS_STORAGE_KEY = 'messages:drafts-by-chat';
export const MESSAGES_PAGE_LIMIT = 40;

export function readStoredDrafts() {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(MESSAGE_DRAFTS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function initials(name = '') {
  const parts = name.split(' ').filter(Boolean);
  return `${parts[0]?.[0] || ''}${parts[1]?.[0] || ''}` || 'C';
}

export function formatTime(value) {
  if (!value) return 'сейчас';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'сейчас' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

export function formatDayLabel(value) {
  if (!value) return 'Сегодня';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'Сегодня';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((today - target) / 86400000);
  if (diffDays === 0) return 'Сегодня';
  if (diffDays === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' });
}

export function normalizeMessageType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'voice' || normalized === 'audio' || normalized === 'voice_note') return 'voice';
  if (normalized === 'video_note' || normalized === 'video' || normalized === 'videocircle' || normalized === 'video-circle') return 'video_note';
  return 'text';
}

export function messagePreviewText(message) {
  if (!message) return '';
  const type = normalizeMessageType(message.type);
  const content = String(message.content || message.text || '').trim();
  if (type === 'voice') return content ? `🎤 ${content}` : '🎤 Голосовое сообщение';
  if (type === 'video_note') return content ? `🎬 ${content}` : '🎬 Видеокружок';
  return content;
}

export function messageSearchText(message) {
  if (!message) return '';
  const parts = [message.content, message.text, message.preview_text, message.media?.kind === 'voice' ? 'Голосовое сообщение' : '', message.media?.kind === 'video_note' ? 'Видеокружок' : ''];
  return parts.filter(Boolean).join(' ').trim();
}

export function normalizeMessageMedia(message) {
  const media = message?.media || {};
  const url = media.url || message?.media_url || '';
  if (!url) return null;
  return {
    kind: String(media.kind || message?.media_kind || '').trim().toLowerCase() || normalizeMessageType(message?.type),
    url,
    thumb_url: media.thumb_url || message?.media_thumb_url || '',
    mime: media.original_mime || media.mime || message?.media_mime || '',
    original_mime: media.original_mime || '',
    encrypted_blob: Boolean(media.encrypted_blob),
    key: media.key || '',
    iv: media.iv || '',
    thumb_iv: media.thumb_iv || '',
    duration_sec: Number(media.duration_sec ?? message?.media_duration_sec ?? 0) || 0,
    width: Number(media.width ?? message?.media_width ?? 0) || 0,
    height: Number(media.height ?? message?.media_height ?? 0) || 0,
    bytes: Number(media.bytes ?? message?.media_bytes ?? 0) || 0,
  };
}

export function pickSupportedRecorderMime(kind) {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') return '';
  const variants = kind === 'video_note'
    ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
  return variants.find((value) => window.MediaRecorder.isTypeSupported?.(value)) || '';
}

export function extensionFromMime(mime, kind) {
  const normalized = String(mime || '').toLowerCase();
  if (normalized.includes('ogg')) return 'ogg';
  if (normalized.includes('mp4')) return kind === 'voice' ? 'm4a' : 'mp4';
  if (normalized.includes('mpeg')) return 'mp3';
  return 'webm';
}

export async function getBlobVideoMetadata(blob) {
  if (typeof document === 'undefined') return { width: 0, height: 0 };
  const objectUrl = URL.createObjectURL(blob);
  try {
    const meta = await new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = () => resolve({ width: video.videoWidth || 0, height: video.videoHeight || 0 });
      video.onerror = () => resolve({ width: 0, height: 0 });
      video.src = objectUrl;
    });
    return meta;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function generateVideoPosterBlob(blob) {
  if (typeof document === 'undefined') return null;
  const objectUrl = URL.createObjectURL(blob);
  try {
    return await new Promise((resolve) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;
      video.onloadeddata = () => {
        try {
          const width = Math.max(1, Math.min(video.videoWidth || 0, 320));
          const height = Math.max(1, Math.round(width * ((video.videoHeight || 1) / Math.max(video.videoWidth || 1, 1))));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(null);
          ctx.drawImage(video, 0, 0, width, height);
          canvas.toBlob((result) => resolve(result || null), 'image/jpeg', 0.72);
        } catch {
          resolve(null);
        }
      };
      video.onerror = () => resolve(null);
      video.src = objectUrl;
      video.load();
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function normalizeLevels(values, target = 24) {
  const safe = Array.isArray(values) ? values : [];
  if (!safe.length) return Array.from({ length: target }, () => 0.18);
  const slice = safe.slice(-target);
  while (slice.length < target) slice.unshift(0.18);
  return slice.map((value) => Math.max(0.08, Math.min(1, Number(value) || 0.18)));
}

export function maxDurationForKind(kind) {
  return kind === 'video_note' ? VIDEO_NOTE_MAX_DURATION_SEC : VOICE_MAX_DURATION_SEC;
}

export function normalizeMessage(message, currentUserId) {
  if (!message) return null;
  const fromUserId = message.from_user_id || message.fromUserId || message.sender_id;
  const mine = String(fromUserId) === String(currentUserId);
  const type = normalizeMessageType(message.type);
  const media = normalizeMessageMedia(message);
  return {
    ...message,
    id: message.id,
    type,
    content: message.content || message.text || '',
    media,
    preview_text: messagePreviewText({ ...message, type, media }),
    created_at: message.created_at || message.createdAt || new Date().toISOString(),
    edited_at: message.edited_at || message.editedAt || null,
    pending: Boolean(message.pending),
    client_id: message.client_id || message.clientId || '',
    mine,
  };
}

export function buildFailedMediaMessageFromDraft(draft, currentUserId, objectUrl, posterUrl) {
  const kind = normalizeMessageType(draft?.kind);
  const retryKey = String(draft?.retryKey || draft?.retry_key || '');
  return normalizeMessage({
    id: `failed-${retryKey}`,
    type: kind,
    content: '',
    media: {
      kind,
      url: objectUrl,
      thumb_url: kind === 'video_note' ? (posterUrl || objectUrl) : '',
      mime: draft?.mime || '',
      duration_sec: Number(draft?.durationSec || draft?.duration_sec || 0),
      width: Number(draft?.width || 0),
      height: Number(draft?.height || 0),
      bytes: Number(draft?.blob?.size || draft?.bytes || 0),
    },
    created_at: draft?.createdAt ? new Date(draft.createdAt).toISOString() : new Date().toISOString(),
    from_user_id: currentUserId,
    to_user_id: draft?.chatId || draft?.to_user_id,
    retry_key: retryKey,
    failed: true,
  }, currentUserId);
}

export function isOnline(peer) {
  if (typeof peer?.online === 'boolean') return peer.online;
  if (!peer?.last_seen) return false;
  const lastSeen = new Date(peer.last_seen).getTime();
  return Number.isFinite(lastSeen) && Date.now() - lastSeen < 5 * 60 * 1000;
}

export function normalizeChat(chat) {
  const peer = chat.user || chat.peer || chat.participant || chat;
  return {
    id: String(peer.id || chat.user_id || chat.id),
    name: `${peer.first_name || ''} ${peer.last_name || ''}`.trim() || peer.username || 'Чат',
    username: peer.username || '',
    avatar: peer.avatar || initials(`${peer.first_name || ''} ${peer.last_name || ''}`.trim() || peer.username || 'Чат'),
    online: isOnline(peer),
    lastSeen: peer.last_seen || peer.lastSeen || null,
    lastMessage: messagePreviewText(chat.last_message || chat) || chat.last_message || chat.content || '',
    unread: Number(chat.unread_count ?? chat.unread ?? 0),
    friendship_status: peer.friendship_status || 'none',
    isSelf: Boolean(peer.is_self),
    isPlaceholder: false,
  };
}

export function buildForwardPayloadFromMessage(message) {
  if (!message) return null;
  const type = normalizeMessageType(message.type);
  if (type === 'voice' || type === 'video_note') return { type, content: String(message.content || ''), media: message.media ? { ...message.media } : null };
  return { type: 'text', content: String(message.content || message.text || '').trim() };
}

export function buildTimeline(messages) {
  const items = [];
  let currentDay = null;
  messages.forEach((message) => {
    const dayLabel = formatDayLabel(message.created_at);
    if (dayLabel !== currentDay) {
      currentDay = dayLabel;
      items.push({ type: 'divider', id: `divider-${message.id}-${dayLabel}`, label: dayLabel });
    }
    items.push({ type: 'message', id: message.id, message });
  });
  return items;
}

export function mergeServerMessages(serverMessages, currentMessages) {
  const next = new Map();
  serverMessages.forEach((message) => {
    if (message?.id) next.set(String(message.id), message);
  });
  currentMessages
    .filter((message) => message?.pending)
    .forEach((message) => {
      if (message?.id && !next.has(String(message.id))) {
        next.set(String(message.id), message);
      }
    });
  return Array.from(next.values()).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
}
