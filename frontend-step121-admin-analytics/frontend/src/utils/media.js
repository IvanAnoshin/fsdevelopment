export function parseMediaItems(images) {
  if (Array.isArray(images)) return images.map(normalizeMediaItem).filter(Boolean);
  if (!images) return [];
  if (typeof images === 'string') {
    try {
      const parsed = JSON.parse(images);
      return Array.isArray(parsed) ? parsed.map(normalizeMediaItem).filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

export function normalizeMediaItem(item) {
  if (!item) return null;
  if (typeof item === 'string') {
    const kind = inferMediaKind({ src: item });
    return {
      kind,
      src: item,
      display: { url: item },
      full: { url: item },
      thumb: { url: kind === 'video' ? '' : item },
      poster: { url: '' },
      variants: [],
      mime: kind === 'video' ? guessMimeFromUrl(item) : '',
    };
  }
  if (typeof item !== 'object') return null;
  const kind = inferMediaKind(item);
  const display = item.display || firstVariant(item, kind === 'video' ? ['display', 'full'] : ['display', 'full', 'thumb']) || { url: item.display_url || item.src || item.url || item.full_url || item.thumb_url || '' };
  const full = item.full || firstVariant(item, kind === 'video' ? ['full', 'display'] : ['full', 'display', 'thumb']) || { url: item.full_url || display?.url || item.src || item.url || '' };
  const thumb = item.thumb || firstVariant(item, ['thumb', 'display', 'full']) || { url: item.thumb_url || item.poster_url || '' };
  const poster = item.poster || thumb || { url: item.thumb_url || item.poster_url || '' };
  return {
    ...item,
    kind,
    mime: item.mime || item.original_mime || item.media_mime || guessMimeFromUrl(full?.url || display?.url || item.src || item.url || ''),
    src: item.src || display?.url || full?.url || thumb?.url || '',
    display,
    full,
    thumb,
    poster,
    variants: Array.isArray(item.variants) ? item.variants : [],
  };
}

export function isVideoMedia(item) {
  return inferMediaKind(item) === 'video';
}

export function getMediaPoster(item) {
  return item?.poster?.url || item?.thumb?.url || item?.thumb_url || item?.poster_url || '';
}

export function mediaKindLabel(item, forms = { image: 'Фото', video: 'Видео', generic: 'Медиа' }) {
  const kind = inferMediaKind(item);
  if (kind === 'video') return forms.video || 'Видео';
  if (kind === 'image') return forms.image || 'Фото';
  return forms.generic || 'Медиа';
}

function inferMediaKind(item) {
  const rawKind = String(item?.kind || item?.type || item?.media_kind || '').trim().toLowerCase();
  if (rawKind === 'video' || rawKind === 'video_note' || rawKind === 'videocircle' || rawKind === 'video-circle') return 'video';
  const mime = String(item?.mime || item?.original_mime || item?.media_mime || '').trim().toLowerCase();
  if (mime.startsWith('video/')) return 'video';
  const url = String(item?.full?.url || item?.display?.url || item?.src || item?.url || item?.full_url || '').trim().toLowerCase();
  if (url.match(/\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/)) return 'video';
  return 'image';
}

function guessMimeFromUrl(url) {
  const normalized = String(url || '').trim().toLowerCase();
  if (normalized.match(/\.mp4(\?|#|$)/)) return 'video/mp4';
  if (normalized.match(/\.webm(\?|#|$)/)) return 'video/webm';
  if (normalized.match(/\.mov(\?|#|$)/)) return 'video/quicktime';
  if (normalized.match(/\.ogv(\?|#|$)/)) return 'video/ogg';
  return '';
}

function firstVariant(item, priority) {
  const variants = Array.isArray(item?.variants) ? item.variants : [];
  for (const name of priority) {
    const found = variants.find((variant) => variant?.name === name && variant?.url);
    if (found) return found;
  }
  return null;
}

export function buildSrcSet(item) {
  if (isVideoMedia(item)) return '';
  const variants = Array.isArray(item?.variants) ? item.variants : [];
  const entries = variants
    .filter((variant) => variant?.url && Number(variant?.width) > 0)
    .sort((a, b) => Number(a.width) - Number(b.width))
    .map((variant) => `${variant.url} ${variant.width}w`);
  return entries.join(', ');
}

export function mediaPreviewText(items) {
  if (!items?.length) return '';
  const videos = items.filter((item) => isVideoMedia(item)).length;
  const images = items.length - videos;
  if (videos && images) return `${items.length} вложения · ${videos} видео`;
  if (videos) return videos === 1 ? '1 видео' : `${videos} видео`;
  if (items.length === 1) return '1 вложение';
  return `${items.length} вложения`;
}
