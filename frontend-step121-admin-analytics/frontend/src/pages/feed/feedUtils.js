import { parseMediaItems } from '../../utils/media';

export const FEED_TOPIC_REGEX = /#([a-zа-я0-9_]{2,48})/i;

export const FEED_TABS = [
  { key: 'friends', label: 'Друзья', tone: 'green' },
  { key: 'following', label: 'Подписки', tone: 'purple' },
  { key: 'recommended', label: 'Рекомендации', tone: 'orange' },
];

export function initials(user) {
  return `${user?.first_name?.[0] || ''}${user?.last_name?.[0] || ''}` || 'U';
}

export function normalizePost(post) {
  if (!post) return null;
  return {
    ...post,
    images: parseMediaItems(post.images),
    likes_count: Number(post.likes_count ?? post.likes ?? 0),
    comments_count: Number(post.comments_count ?? post.comments ?? 0),
    views_count: post.views_count ?? post.views ?? null,
    liked: Boolean(post.liked),
  };
}

export function normalizeComment(comment) {
  if (!comment) return null;
  return {
    ...comment,
    parent_id: comment.parent_id ?? comment.parentId ?? null,
    user: comment.user || comment.author || null,
  };
}

export function formatDate(value) {
  if (!value) return 'только что';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return 'только что';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export function mergePosts(existing, incoming, reset = false, scope = 'friends') {
  const map = new Map();
  const source = reset ? incoming : [...existing, ...incoming];
  source.forEach((post) => {
    if (post?.id) map.set(post.id, post);
  });
  const next = Array.from(map.values());
  if (scope === 'recommended') {
    return next.sort((a, b) => {
      const scoreDiff = Number(b.recommended_score || 0) - Number(a.recommended_score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return new Date(b.created_at || 0) - new Date(a.created_at || 0);
    });
  }
  return next.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

export function getFeedReason(scope, post, currentUserId) {
  if (scope === 'friends') return { label: 'Пост от друзей', tone: 'green' };
  if (scope === 'following') return { label: 'Из ваших подписок', tone: 'purple' };
  if (scope === 'recommended') {
    return { label: post?.recommended_reason || 'Рекомендация ленты', tone: 'blue' };
  }

  const author = post?.user || post?.author || null;
  const authorId = String(author?.id || post?.user_id || '');
  const status = author?.friendship_status || 'none';
  if (authorId && authorId === String(currentUserId || '')) return { label: 'Ваш пост', tone: 'green' };
  if (status === 'friends') return { label: 'Пост от друзей', tone: 'green' };
  if (status === 'subscribed') return { label: 'Из ваших подписок', tone: 'purple' };
  return { label: 'Рекомендация ленты', tone: 'blue' };
}

export function mediaSummary(images) {
  if (!images?.length) return '';
  if (images.length === 1) return '1 вложение';
  return `${images.length} вложения`;
}

export function extractFeedTopic(content) {
  const match = String(content || '').match(FEED_TOPIC_REGEX);
  return match?.[1]?.toLowerCase?.() || '';
}
