function toTimestamp(value) {
  const date = new Date(value || 0);
  const ts = date.getTime();
  return Number.isFinite(ts) ? ts : 0;
}

function compareChronological(a, b, direction = 'asc') {
  return direction === 'desc'
    ? toTimestamp(b?.created_at) - toTimestamp(a?.created_at)
    : toTimestamp(a?.created_at) - toTimestamp(b?.created_at);
}

function compareDiscussed(a, b) {
  const repliesDiff = Number(b?.reply_count || 0) - Number(a?.reply_count || 0);
  if (repliesDiff !== 0) return repliesDiff;
  const activityDiff = toTimestamp(b?.latest_activity_at) - toTimestamp(a?.latest_activity_at);
  if (activityDiff !== 0) return activityDiff;
  return toTimestamp(b?.created_at) - toTimestamp(a?.created_at);
}

function sortItems(items, sort = 'oldest', depth = 0) {
  const next = [...items];
  if (sort === 'newest') {
    next.sort((a, b) => compareChronological(a, b, 'desc'));
  } else if (sort === 'discussed' && depth === 0) {
    next.sort(compareDiscussed);
  } else {
    next.sort((a, b) => compareChronological(a, b, 'asc'));
  }
  next.forEach((item) => {
    item.replies = sortItems(item.replies || [], sort === 'newest' ? 'newest' : 'oldest', depth + 1);
  });
  return next;
}

function enrichNode(node) {
  const replies = Array.isArray(node.replies) ? node.replies : [];
  let replyCount = Number(node.reply_count || 0);
  let latestActivityAt = node.latest_activity_at || node.updated_at || node.created_at || null;
  node.replies = replies.map((reply) => enrichNode(reply));
  node.replies.forEach((reply) => {
    if (!Number(node.reply_count || 0)) {
      replyCount += 1 + Number(reply.reply_count || 0);
    }
    if (toTimestamp(reply.latest_activity_at) > toTimestamp(latestActivityAt)) {
      latestActivityAt = reply.latest_activity_at;
    }
  });
  return {
    ...node,
    reply_count: replyCount,
    latest_activity_at: latestActivityAt,
  };
}

export function buildCommentTree(comments = [], sort = 'oldest') {
  const map = new Map();
  const roots = [];
  comments.forEach((comment, index) => {
    if (!comment) return;
    map.set(String(comment.id ?? `tmp-${index}`), { ...comment, replies: [] });
  });
  comments.forEach((comment, index) => {
    if (!comment) return;
    const node = map.get(String(comment.id ?? `tmp-${index}`));
    const parentId = comment.parent_id ?? comment.parentId ?? null;
    if (parentId && map.has(String(parentId))) {
      map.get(String(parentId)).replies.push(node);
    } else {
      roots.push(node);
    }
  });
  return sortItems(roots.map((item) => enrichNode(item)), sort);
}

export function buildReplyPrefill(comment) {
  const username = comment?.user?.username || '';
  return username ? `@${username} ` : '';
}

export function isCommentEdited(comment) {
  if (!comment?.updated_at || !comment?.created_at) return false;
  return Math.abs(toTimestamp(comment.updated_at) - toTimestamp(comment.created_at)) > 1000;
}

export function getCommentSubtreeIds(comments = [], rootId) {
  const ids = new Set();
  const queue = [String(rootId)];
  while (queue.length) {
    const current = queue.shift();
    if (!current || ids.has(current)) continue;
    ids.add(current);
    comments.forEach((comment) => {
      const parentId = comment?.parent_id ?? comment?.parentId ?? null;
      if (String(parentId || '') === current) {
        queue.push(String(comment.id));
      }
    });
  }
  return Array.from(ids);
}

export function removeCommentSubtree(comments = [], rootId) {
  const subtreeIds = new Set(getCommentSubtreeIds(comments, rootId));
  return {
    nextComments: comments.filter((comment) => !subtreeIds.has(String(comment?.id))),
    removedCount: subtreeIds.size,
  };
}

export function replaceCommentInList(comments = [], nextComment) {
  if (!nextComment?.id) return comments;
  return comments.map((comment) => String(comment?.id) === String(nextComment.id) ? { ...comment, ...nextComment } : comment);
}

export function mergeCommentsById(comments = [], incoming = []) {
  const map = new Map();
  [...comments, ...incoming].forEach((comment, index) => {
    if (!comment) return;
    const key = String(comment.id ?? `tmp-${index}`);
    const prev = map.get(key) || {};
    map.set(key, { ...prev, ...comment });
  });
  return Array.from(map.values()).sort((a, b) => compareChronological(a, b, 'asc'));
}

export function getLoadedDirectReplyCount(comments = [], parentId) {
  const key = String(parentId || '');
  return comments.reduce((count, comment) => {
    const currentParentId = comment?.parent_id ?? comment?.parentId ?? null;
    return String(currentParentId || '') === key ? count + 1 : count;
  }, 0);
}


export function getCommentDepthInfo(comments = [], targetId) {
  if (!targetId) return { depth: 0, willLimit: false };
  const map = new Map();
  comments.forEach((comment, index) => {
    if (!comment) return;
    const key = String(comment.id ?? `tmp-${index}`);
    map.set(key, comment);
  });
  let depth = 0;
  let current = map.get(String(targetId));
  const visited = new Set();
  while (current) {
    const parentId = current?.parent_id ?? current?.parentId ?? null;
    if (!parentId) break;
    const key = String(parentId);
    if (visited.has(key)) break;
    visited.add(key);
    depth += 1;
    current = map.get(key);
  }
  return { depth, willLimit: depth >= 2 };
}
