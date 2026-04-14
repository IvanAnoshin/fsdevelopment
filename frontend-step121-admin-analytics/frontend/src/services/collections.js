import { getMediaPoster, isVideoMedia, mediaKindLabel } from '../utils/media';

export function parseCollectionPayload(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  if (typeof raw !== 'string') return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function normalizeText(value, max = 220) {
  const text = String(value || '').trim();
  if (!text) return '';
  const runes = Array.from(text);
  return runes.length > max ? `${runes.slice(0, max).join('')}…` : text;
}

export function buildPostCollectionEntry(post) {
  const author = post?.user || post?.author || {};
  const authorName = `${author?.first_name || ''} ${author?.last_name || ''}`.trim() || author?.username || 'Автор';
  const previewImage = post?.images?.[0]?.display?.url || post?.images?.[0]?.src || post?.images?.[0]?.full?.url || '';
  return {
    entity_type: 'post',
    entity_key: `post:${post?.id}`,
    title: normalizeText(post?.content || 'Пост из ленты', 96),
    subtitle: authorName ? `Пост · ${authorName}` : 'Пост',
    preview_text: normalizeText(post?.content || '', 220),
    preview_image: previewImage,
    link: `/feed?post=${post?.id}`,
    payload: {
      link: `/feed?post=${post?.id}`,
      post_id: post?.id,
      author_id: author?.id || post?.user_id || null,
      author_name: authorName,
      author_username: author?.username || '',
      images_count: Array.isArray(post?.images) ? post.images.length : 0,
      likes_count: Number(post?.likes_count || 0),
      comments_count: Number(post?.comments_count || 0),
    },
  };
}

export function buildProfileCollectionEntry(profileUser) {
  const fullName = `${profileUser?.first_name || ''} ${profileUser?.last_name || ''}`.trim() || profileUser?.username || 'Профиль';
  return {
    entity_type: 'profile',
    entity_key: `profile:${profileUser?.id}`,
    title: fullName,
    subtitle: profileUser?.username ? `Профиль · @${profileUser.username}` : 'Профиль',
    preview_text: normalizeText(profileUser?.bio || 'Профиль пользователя Friendscape', 220),
    preview_image: profileUser?.avatar || '',
    link: `/profile/${profileUser?.id || ''}`,
    payload: {
      link: `/profile/${profileUser?.id || ''}`,
      user_id: profileUser?.id,
      username: profileUser?.username || '',
      city: profileUser?.city || '',
      friends_count: Number(profileUser?.friends_count || 0),
      subscribers_count: Number(profileUser?.subscribers_count || 0),
    },
  };
}

export function buildMediaCollectionEntry(item, options = {}) {
  const isVideo = isVideoMedia(item);
  const previewImage = isVideo ? (getMediaPoster(item) || item?.thumb?.url || item?.thumb_url || '') : (item?.display?.url || item?.src || item?.full?.url || item?.thumb?.url || '');
  const asset = item?.asset_id || item?.assetId || item?.hash || `media-${previewImage}`;
  const profileId = options?.profileId || item?.owner_id || item?.user_id || item?.profile_id || '';
  const username = options?.username || item?.owner_username || '';
  const link = profileId ? `/profile/${profileId}?tab=media&asset=${encodeURIComponent(asset)}` : previewImage;
  const kindLabel = mediaKindLabel(item);
  return {
    entity_type: 'media',
    entity_key: `media:${asset}`,
    title: normalizeText(options?.title || item?.alt || (isVideo ? 'Видео профиля' : 'Фото профиля'), 96),
    subtitle: username ? `${kindLabel} · @${username}` : kindLabel,
    preview_text: normalizeText(options?.caption || item?.source_post_text || (isVideo ? 'Видео из альбома профиля' : 'Фото из альбома профиля'), 220),
    preview_image: previewImage,
    link,
    payload: {
      link,
      kind: isVideo ? 'video' : 'image',
      mime: item?.mime || item?.original_mime || item?.media_mime || '',
      asset_id: item?.asset_id || item?.assetId || null,
      hash: item?.hash || '',
      source_post_id: item?.source_post_id || null,
      owner_id: profileId || null,
      username,
      display_url: item?.display?.url || item?.src || item?.full?.url || '',
      full_url: item?.full?.url || item?.display?.url || item?.src || '',
      thumb_url: item?.thumb?.url || item?.thumb_url || '',
      poster_url: getMediaPoster(item) || '',
      alt: item?.alt || '',
    },
  };
}
