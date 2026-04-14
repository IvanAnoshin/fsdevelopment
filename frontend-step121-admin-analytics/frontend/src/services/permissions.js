export const ROLES = Object.freeze({
  MEMBER: 'member',
  MODERATOR: 'moderator',
  SUPPORT: 'support',
  ADMIN: 'admin',
});

export const PERMISSIONS = Object.freeze({
  ADMIN_PANEL: 'admin.panel',
  RECOVERY_REVIEW: 'recovery.review',
  USERS_MODERATE: 'users.moderate',
  SUPPORT_TOOLS: 'support.tools',
  REALTIME_STREAM: 'realtime.stream',
});

const ROLE_PERMISSIONS = {
  [ROLES.MEMBER]: [PERMISSIONS.REALTIME_STREAM],
  [ROLES.MODERATOR]: [PERMISSIONS.REALTIME_STREAM, PERMISSIONS.USERS_MODERATE],
  [ROLES.SUPPORT]: [PERMISSIONS.REALTIME_STREAM, PERMISSIONS.SUPPORT_TOOLS, PERMISSIONS.RECOVERY_REVIEW],
  [ROLES.ADMIN]: [PERMISSIONS.REALTIME_STREAM, PERMISSIONS.SUPPORT_TOOLS, PERMISSIONS.RECOVERY_REVIEW, PERMISSIONS.USERS_MODERATE, PERMISSIONS.ADMIN_PANEL],
};

export function normalizeRole(role, isAdmin = false) {
  if (isAdmin) return ROLES.ADMIN;
  return Object.values(ROLES).includes(role) ? role : ROLES.MEMBER;
}

export function getPermissions(userOrRole, legacyIsAdmin = false) {
  const role = typeof userOrRole === 'string'
    ? normalizeRole(userOrRole, legacyIsAdmin)
    : normalizeRole(userOrRole?.role, Boolean(userOrRole?.is_admin));
  const explicit = Array.isArray(userOrRole?.permissions) ? userOrRole.permissions.filter(Boolean) : null;
  if (explicit?.length) return [...new Set(explicit)].sort();
  return [...(ROLE_PERMISSIONS[role] || ROLE_PERMISSIONS[ROLES.MEMBER])];
}

export function hasPermission(user, permission) {
  return getPermissions(user).includes(permission);
}

export function canAccessAdminPanel(user) {
  return hasPermission(user, PERMISSIONS.ADMIN_PANEL);
}

export function canReviewRecovery(user) {
  return hasPermission(user, PERMISSIONS.RECOVERY_REVIEW);
}
