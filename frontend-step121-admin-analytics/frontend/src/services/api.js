import axios from 'axios';
import { clearAuthStorage, getTempToken, getToken, setStoredUser, setToken } from './authStorage.js';
import { getStableE2EEDeviceIDSync } from './e2eeDevice.js';
import { DEFAULT_API_BASE_URL } from './runtimeConfig.js';

const baseURL = DEFAULT_API_BASE_URL.replace(/\/$/, '');

const API = axios.create({
  baseURL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true,
});

const viteEnv = (typeof import.meta !== 'undefined' && import.meta && import.meta.env) ? import.meta.env : {};
const isDev = Boolean(viteEnv.DEV);
const isApiDebugEnabled = String(viteEnv.VITE_DEBUG_API || '').toLowerCase() === 'true';

const REDIRECT_STORAGE_KEY = 'post_login_redirect';

const sanitizeRedirect = (value) => {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return '';
  if (trimmed.startsWith('//')) return '';
  return trimmed;
};

export const storePostLoginRedirect = (value) => {
  if (typeof window === 'undefined') return;
  const next = sanitizeRedirect(value);
  if (!next || next === '/login' || next.startsWith('/register') || next.startsWith('/recovery') || next.startsWith('/reset-password')) return;
  window.sessionStorage.setItem(REDIRECT_STORAGE_KEY, next);
};

export const readPostLoginRedirect = () => {
  if (typeof window === 'undefined') return '';
  return sanitizeRedirect(window.sessionStorage.getItem(REDIRECT_STORAGE_KEY) || '');
};

export const clearPostLoginRedirect = () => {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(REDIRECT_STORAGE_KEY);
};

let refreshPromise = null;

export const applySessionPayload = (payload) => {
  if (payload?.token) setToken(payload.token);
  if (payload?.user) setStoredUser(payload.user);
  return payload;
};

export const refreshSession = async () => {
  if (refreshPromise) return refreshPromise;
  refreshPromise = API.post('/auth/refresh', null, { skipAuthRefresh: true })
    .then((response) => {
      applySessionPayload(response.data);
      return response;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
};


const redirectToLogin = () => {
  if (typeof window === 'undefined') return;
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  storePostLoginRedirect(next);
  clearAuthStorage();
  window.location.replace('/login');
};

export const getApiErrorMessage = (error, fallback = 'Произошла ошибка') => {
  if (!error) return fallback;
  if (error.response?.data?.error) return error.response.data.error;
  if (error.response?.data?.message) return error.response.data.message;
  if (error.code === 'ECONNABORTED') return 'Сервер отвечает слишком долго. Попробуйте ещё раз.';
  if (error.message === 'Network Error') return 'Не удалось подключиться к серверу. Проверьте интернет и попробуйте снова.';
  return fallback;
};

API.interceptors.request.use((config) => {
  const token = getToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const e2eeDeviceId = getStableE2EEDeviceIDSync();
  if (e2eeDeviceId) {
    config.headers['X-E2EE-Device-ID'] = e2eeDeviceId;
  }
  if (isDev && isApiDebugEnabled) {
    console.log(`📤 ${(config.method || 'get').toUpperCase()} ${config.url}`, config.data);
  }
  return config;
});

API.interceptors.response.use(
  (response) => {
    if (isDev && isApiDebugEnabled) {
      console.log(`📥 ${response.config.url}`, response.data);
    }
    return response;
  },
  async (error) => {
    if (isDev && isApiDebugEnabled) {
      console.error(`❌ ${error.config?.url}`, error.response?.data || error.message);
    }

    const config = error.config || {};
    const url = String(config.url || '');
    const isAuthFlow =
      url.includes('/auth/login') ||
      url.includes('/auth/register') ||
      url.includes('/auth/login-with-backup-code') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/recovery') ||
      url.includes('/auth/reset-password');

    if (error.response?.status === 401 && !config._retry && !config.skipAuthRefresh && !isAuthFlow) {
      config._retry = true;
      try {
        await refreshSession();
        const token = getToken();
        if (token) {
          config.headers = config.headers || {};
          config.headers.Authorization = `Bearer ${token}`;
        }
        return API.request(config);
      } catch (_) {
        redirectToLogin();
      }
    }

    return Promise.reject(error);
  }
);

export const API_BASE_URL = baseURL;

// ========== АУТЕНТИФИКАЦИЯ ==========
export const register = (data) => API.post('/auth/register', data);
export const login = (data) => API.post('/auth/login', data);
export const loginWithBackupCode = (data) => API.post('/auth/login-with-backup-code', data);
export const verifySecurityAnswer = (data) => API.post('/auth/verify-security', data);
export const getSecurityQuestion = (data) => API.post('/auth/get-security-question', data);
export const setupSecurity = (data) => API.post('/setup-security', data);
export const setupDFSN = (data) => API.post('/setup-dfsn', data);
export const recoveryRequest = (data) => API.post('/auth/recovery', data);
export const getRealtimeTicket = () => API.post('/realtime-ticket');
export const logoutAllSessions = () => API.post('/auth/logout-all');

export const resetPassword = async (data) => {
  const tempToken = getTempToken();
  if (!tempToken) {
    throw new Error('Нет временного токена');
  }
  return API.post('/auth/reset-password', data, {
    headers: {
      Authorization: `Bearer ${tempToken}`,
    },
  });
};

// ========== ПРОФИЛЬ ==========
export const getMe = () => API.get('/me');
export const getUser = (userId) => API.get(`/users/${userId}`);
export const getUserOnlineStatus = (userId) => API.get(`/users/${userId}/online-status`);
export const getUserMedia = (userId, params = {}) => API.get(`/users/${userId}/media`, { params });
export const updateProfile = (data) => API.put('/profile', data);

// ========== ПОСТЫ ==========
export const getFeed = (page = 1, options = {}) => {
  const params = { page, ...(options || {}) };
  return API.get('/feed', { params });
};
export const getFeedPreferences = () => API.get('/feed/preferences');
export const saveFeedPreference = (data) => API.post('/feed/preferences', data);
export const deleteFeedPreference = (preferenceId) => API.delete(`/feed/preferences/${preferenceId}`);
export const getUserPosts = (userId) => API.get(`/users/${userId}/posts`);
export const getPost = (postId) => API.get(`/posts/${postId}`);
export const createPost = (data) => API.post('/posts', data);
export const likePost = (postId) => API.post(`/posts/${postId}/like`);
export const unlikePost = (postId) => API.delete(`/posts/${postId}/like`);
export const addComment = (postId, data) => API.post(`/posts/${postId}/comments`, data);
export const getComments = (postId, params = {}) => API.get(`/posts/${postId}/comments`, { params });
export const voteComment = (commentId, value) => API.post(`/comments/${commentId}/vote`, { value });
export const updateComment = (commentId, data) => API.put(`/comments/${commentId}`, data);
export const deleteComment = (commentId) => API.delete(`/comments/${commentId}`);
export const deletePost = (postId) => API.delete(`/posts/${postId}`);

// ========== ДРУЗЬЯ ==========
export const getFriends = (userId) => API.get(`/users/${userId}/friends`);
export const getFriendsCount = (userId) => API.get(`/users/${userId}/friends/count`);
export const getFriendRequests = () => API.get('/friends/requests');
export const sendFriendRequest = (userId) => API.post(`/friends/${userId}/request`);
export const acceptFriendRequest = (userId) => API.post(`/friends/${userId}/accept`);
export const rejectFriendRequest = (userId) => API.delete(`/friends/${userId}/reject`);
export const unfriend = (userId) => API.delete(`/friends/${userId}`);
export const checkFriendship = (userId) => API.get(`/friendship/${userId}`);

// ========== ПОДПИСКИ ==========
export const subscribe = (userId) => API.post(`/users/${userId}/subscribe`);
export const unsubscribe = (userId) => API.delete(`/users/${userId}/subscribe`);
export const getSubscribers = (userId) => API.get(`/users/${userId}/subscribers`);
export const getSubscribersCount = (userId) => API.get(`/users/${userId}/subscribers/count`);
export const getSubscriptions = (userId) => API.get(`/users/${userId}/subscriptions`);
export const getSubscriptionsCount = (userId) => API.get(`/users/${userId}/subscriptions/count`);

// ========== ПОРУЧИТЕЛЬСТВА ==========
export const vouchForUser = (userId) => API.post(`/vouch/${userId}`);
export const unvouchForUser = (userId) => API.delete(`/vouch/${userId}`);
export const getUserVouches = (userId) => API.get(`/users/${userId}/vouches`);

// ========== СООБЩЕНИЯ ==========
export const getChats = () => API.get('/chats');
export const getMessages = (userId, page = 1, limit = 50) => API.get(`/messages/${userId}?page=${page}&limit=${limit}`);
export const sendMessage = (userId, payload) => {
  const body = typeof payload === 'string' ? { content: payload } : { ...(payload || {}) };
  return API.post(`/messages/${userId}`, body);
};
export const getUnreadCount = () => API.get('/messages/unread/count');
export const markConversationRead = (userId) => API.post(`/messages/${userId}/read`);
export const deleteMessage = (messageId) => API.delete(`/messages/${messageId}`);
export const updateMessage = (messageId, payload) => API.put(`/messages/${messageId}`, payload);
export const getCallConfig = () => API.get('/calls/config', { timeout: 8000 });

// ========== ПОИСК ==========
export const searchUsers = (query, config = {}) => API.get(`/search/users?q=${encodeURIComponent(query)}`, config);
export const searchPosts = (query, config = {}) => API.get(`/search/posts?q=${encodeURIComponent(query)}`, config);
export const searchCommunities = (query, config = {}) => API.get(`/search/communities?q=${encodeURIComponent(query)}`, config);

// ========== СООБЩЕСТВА ==========
export const getCommunities = (params = {}) => API.get('/communities', { params });
export const createCommunity = (data) => API.post('/communities', data);
export const getCommunity = (communityId) => API.get(`/communities/${communityId}`);
export const joinCommunity = (communityId) => API.post(`/communities/${communityId}/join`);
export const leaveCommunity = (communityId) => API.delete(`/communities/${communityId}/leave`);
export const getCommunityPosts = (communityId, params = {}) => API.get(`/communities/${communityId}/posts`, { params });
export const createCommunityPost = (communityId, data) => API.post(`/communities/${communityId}/posts`, data);


// ========== STORIES ==========
export const getStories = () => API.get('/stories');
export const createStory = (data) => API.post('/stories', data);
export const viewStory = (storyId) => API.post(`/stories/${storyId}/view`);
export const getStoryReplies = (storyId) => API.get(`/stories/${storyId}/replies`);
export const replyToStory = (storyId, data) => API.post(`/stories/${storyId}/replies`, data);
export const extendStory = (storyId, data) => API.post(`/stories/${storyId}/extend`, data);
export const deleteStory = (storyId) => API.delete(`/stories/${storyId}`);

// ========== ЖАЛОБЫ И ПОДДЕРЖКА ==========
export const reportPost = (postId, data) => API.post(`/reports/posts/${postId}`, data);
export const createSupportTicket = (data) => API.post('/support/tickets', data);
export const getMySupportTickets = () => API.get('/support/tickets');

// ========== УВЕДОМЛЕНИЯ ==========
export const getNotifications = () => API.get('/notifications');
export const getUnreadNotificationsCount = () => API.get('/notifications/unread/count');
export const markAsRead = (notificationId) => API.put(`/notifications/${notificationId}/read`);
export const markAllAsRead = () => API.put('/notifications/read-all');

// ========== УСТРОЙСТВА ==========
export const getDevices = () => API.get('/devices');
export const getDevice = (deviceId) => API.get(`/devices/${deviceId}`);
export const updateDevicePIN = (deviceId, pin) => API.put(`/devices/${deviceId}/pin`, { pin });
export const removeDevice = (deviceId) => API.delete(`/devices/${deviceId}`);

// ========== ПОДБОРКИ / СОХРАНЁННОЕ ==========
export const getCollections = () => API.get('/collections');
export const createCollection = (data) => API.post('/collections', data);
export const updateCollection = (collectionId, data) => API.put(`/collections/${collectionId}`, data);
export const deleteCollection = (collectionId) => API.delete(`/collections/${collectionId}`);
export const getCollectionItems = (collectionId) => API.get(`/collections/${collectionId}/items`);
export const addCollectionItem = (collectionId, data) => API.post(`/collections/${collectionId}/items`, data);
export const removeCollectionItem = (collectionId, itemId) => API.delete(`/collections/${collectionId}/items/${itemId}`);

// ========== ВОССТАНОВЛЕНИЕ ==========
export const createRecoveryRequest = (data) => API.post('/auth/recovery-request', data);
export const getRecoveryStatus = (code) => API.get(`/auth/recovery-status/${code}`);
export const submitRecoveryAnswers = (data) => API.post('/auth/recovery-submit-answers', data);
export const generateRecoveryQuestions = (code) => API.get(`/auth/recovery-questions/${code}`);
export const completeRecoverySetup = (data) => API.post('/auth/recovery-complete', data);

// ========== АДМИНКА ==========
export const getRecoveryRequests = () => API.get('/admin/recovery-requests');
export const getRecoveryRequestDetails = (id) => API.get(`/admin/recovery-requests/${id}`);
export const approveRecoveryRequest = (id) => API.post(`/admin/recovery-requests/${id}/approve`);
export const rejectRecoveryRequest = (id, data) => API.post(`/admin/recovery-requests/${id}/reject`, data);

export const getAdminUsers = () => API.get('/admin/users');
export const getAdminAnalytics = () => API.get('/admin/analytics/overview');
export const makeAdmin = (userId) => API.post(`/admin/users/${userId}/make-admin`);
export const removeAdmin = (userId) => API.post(`/admin/users/${userId}/remove-admin`);
export const makeModerator = (userId) => API.post(`/admin/users/${userId}/make-moderator`);
export const removeModerator = (userId) => API.post(`/admin/users/${userId}/remove-moderator`);
export const getModerationReports = (params = {}) => API.get('/admin/moderation/reports', { params });
export const updateModerationReport = (id, data) => API.put(`/admin/moderation/reports/${id}`, data);
export const getSupportTicketsAdmin = (params = {}) => API.get('/admin/moderation/tickets', { params });
export const updateSupportTicketAdmin = (id, data) => API.put(`/admin/moderation/tickets/${id}`, data);

export const updateBehavioralData = (data) => API.post('/behavior/update', data);
export const updateBehavioralDataBatch = (data) => API.post('/behavior/batch', data, { timeout: 20000 });


// ========== MEDIA ACTIONS ==========
export const getMediaInteractions = (params) => API.get('/media/interactions', { params });
export const voteMedia = (data) => API.post('/media/interactions/vote', data);
export const commentMedia = (data) => API.post('/media/interactions/comments', data);
export const reportMedia = (data) => API.post('/media/interactions/report', data);

// ========== DFSN ==========

// ========== PUSH-УВЕДОМЛЕНИЯ ==========
export const getVapidPublicKey = () => API.get('/auth/vapid-public-key');
export const savePushSubscription = (data) => API.post('/push-subscribe', data);
export const testPushNotification = () => API.post('/test-push');

// ========== ВЫХОД ==========
export const logout = (options = {}) => {
  const { redirectTo = '/login' } = options || {};
  Promise.resolve(API.post('/auth/logout', null, { skipAuthRefresh: true })).catch(() => null).finally(() => {
    clearAuthStorage();
    if (typeof window !== 'undefined') {
      window.location.replace(redirectTo);
    }
  });
};

export default API;


export const requestUnreadRefresh = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:unread-refresh'));
  }
};


export const broadcastUserUpdated = (user) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:user-updated', { detail: user || null }));
  }
};

export const requestUserRefresh = () => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:user-refresh'));
  }
};


export const broadcastRelationshipUpdated = (detail) => {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('app:relationship-updated', { detail: detail || null }));
    window.dispatchEvent(new CustomEvent('app:unread-refresh'));
  }
};


export const dispatchAppAction = (action, detail = {}) => {
  if (typeof window !== 'undefined' && action) {
    window.dispatchEvent(new CustomEvent('app:action', { detail: { action, ...(detail || {}) } }));
  }
};


export const showToast = (message, options = {}) => {
  if (typeof window !== 'undefined' && message) {
    const detail = typeof options === 'string'
      ? { message, tone: options }
      : { message, ...(options || {}) };
    window.dispatchEvent(new CustomEvent('app:toast', { detail }));
  }
};

export const confirmAction = (options = {}) => {
  if (typeof window === 'undefined') return Promise.resolve(true);

  const detail = typeof options === 'string' ? { message: options } : { ...(options || {}) };
  const id = detail.id || `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  return new Promise((resolve) => {
    const responseEvent = `app:confirm:response:${id}`;
    const handler = (event) => {
      window.removeEventListener(responseEvent, handler);
      resolve(Boolean(event?.detail?.confirmed));
    };

    window.addEventListener(responseEvent, handler);
    window.dispatchEvent(new CustomEvent('app:confirm', {
      detail: {
        id,
        title: detail.title || 'Подтвердите действие',
        message: detail.message || 'Вы уверены, что хотите продолжить?',
        confirmLabel: detail.confirmLabel || 'Подтвердить',
        cancelLabel: detail.cancelLabel || 'Отмена',
        tone: detail.tone || 'neutral',
      },
    }));
  });
};
