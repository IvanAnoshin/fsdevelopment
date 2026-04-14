export function getRelationshipStatus(user, currentUserId = null) {
  if (!user) return 'none';
  if (user.is_self || String(user.id) === String(currentUserId || '')) return 'self';
  return user.friendship_status || (user.request_sent ? 'request_sent' : user.subscribed ? 'subscribed' : 'none');
}

export function getRelationshipMeta(status, isSelf = false) {
  if (isSelf || status === 'self') return { label: 'Это вы', cls: 'neutral' };
  if (status === 'friends') return { label: 'Друзья', cls: 'green' };
  if (status === 'request_sent') return { label: 'Заявка отправлена', cls: 'warning' };
  if (status === 'request_received') return { label: 'Ждёт подтверждения', cls: 'blue' };
  if (status === 'subscribed') return { label: 'Подписка', cls: 'accent' };
  return { label: 'Новый контакт', cls: 'neutral' };
}

export function normalizeUserBadges({ user, currentUserId = null, includeCity = false, extra = [] } = {}) {
  const status = getRelationshipStatus(user, currentUserId);
  const isSelf = status === 'self';
  const items = [];
  if (includeCity && user?.city) items.push({ label: user.city, cls: 'neutral' });
  if (user?.is_private) items.push({ label: 'Приватный профиль', cls: 'neutral' });
  items.push(getRelationshipMeta(status, isSelf));
  return [...items, ...extra.filter(Boolean)];
}
