import { parseMediaItems } from '../../utils/media';

export function normalizePost(post) {
  if (!post) return null;
  return {
    ...post,
    images: parseMediaItems(post.images),
    likes_count: Number(post.likes_count ?? post.likes ?? 0),
    comments_count: Number(post.comments_count ?? post.comments ?? 0),
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

export function flattenMediaItems(posts = [], profileUser = null) {
  return posts.flatMap((post) => (post?.images || []).map((item, index) => ({
    ...item,
    source_post_id: post.id,
    source_post_date: post.created_at,
    source_post_text: post.content,
    owner_id: profileUser?.id || null,
    owner_username: profileUser?.username || '',
    _key: item?.asset_id || item?.hash || `${post.id}-${index}`,
  })));
}

export function pickSpotlightPost(posts = []) {
  return [...posts].sort((a, b) => {
    const scoreA = Number(a?.likes_count || 0) * 3 + Number(a?.comments_count || 0) * 2 + Number(a?.images?.length || 0);
    const scoreB = Number(b?.likes_count || 0) * 3 + Number(b?.comments_count || 0) * 2 + Number(b?.images?.length || 0);
    return scoreB - scoreA;
  })[0] || null;
}

export const CONNECTION_TITLES = {
  friends: 'Друзья',
  subscribers: 'Подписчики',
  subscriptions: 'Подписки',
};
