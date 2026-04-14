export const loadProfile = () => import('./pages/profile/Profile');
export const loadFeed = () => import('./pages/feed/Feed');
export const loadMessages = () => import('./pages/messages/Messages');
export const loadPeople = () => import('./pages/friends/People');
export const loadSearch = () => import('./pages/search/Search');
export const loadCommunities = () => import('./pages/communities/Communities');
export const loadNotifications = () => import('./pages/notifications/Notifications');
export const loadSaved = () => import('./pages/saved/SavedCollections');
export const loadDevices = () => import('./pages/settings/Devices');
export const loadSupport = () => import('./pages/settings/Support');
export const loadDeviceSettings = () => import('./pages/settings/DeviceSettings');
export const loadRecoveryRequests = () => import('./pages/admin/RecoveryRequests');
export const loadModerationDesk = () => import('./pages/admin/ModerationDesk');
export const loadAdminUsers = () => import('./pages/admin/AdminUsers');
export const loadAdminAnalytics = () => import('./pages/admin/AdminAnalytics');

export const coreAuthedRouteLoaders = [
  loadFeed,
  loadMessages,
  loadProfile,
  loadSearch,
  loadPeople,
  loadCommunities,
  loadNotifications,
  loadSaved,
  loadDevices,
];
