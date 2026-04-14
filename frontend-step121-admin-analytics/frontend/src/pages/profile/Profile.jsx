import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ProfileAboutTab, ProfileConnectionsModal, ProfileEditModal, ProfileMediaTab, ProfileOverviewBlock, ProfilePostsBlock } from './ProfileBlocks';
import MediaActionModal from '../../components/postauth/MediaActionModal';
import SaveToCollectionModal from '../../components/postauth/SaveToCollectionModal';
import {
  acceptFriendRequest,
  addComment,
  updateComment,
  deleteComment,
  checkFriendship,
  createPost,
  deletePost,
  getComments,
  getFriends,
  getFriendsCount,
  getMe,
  getSubscribers,
  getSubscribersCount,
  getSubscriptions,
  getSubscriptionsCount,
  getUser,
  getUserOnlineStatus,
  getUserPosts,
  getUserVouches,
  likePost,
  voteComment,
  sendFriendRequest,
  subscribe,
  unlikePost,
  unfriend,
  unsubscribe,
  unvouchForUser,
  vouchForUser,
  updateProfile,
  broadcastUserUpdated,
  requestUserRefresh,
  broadcastRelationshipUpdated,
  confirmAction,
  showToast,
  getApiErrorMessage,
} from '../../services/api';
import { getStoredUser, setStoredUser } from '../../services/authStorage';
import { CONNECTION_TITLES, flattenMediaItems, normalizeComment, normalizePost, pickSpotlightPost } from './profileUtils';
import { buildReplyPrefill, getCommentDepthInfo, getLoadedDirectReplyCount, mergeCommentsById, removeCommentSubtree, replaceCommentInList } from '../../utils/comments';
import { buildPostCollectionEntry, buildProfileCollectionEntry } from '../../services/collections';
import { formatDisplayName, useDocumentTitle } from '../../utils/pageTitle';




export default function Profile() {
  const composerInputRef = useRef(null);
  const bootstrapRequestIdRef = useRef(0);
  const { userId } = useParams();
  const navigate = useNavigate();
  const [currentUser, setCurrentUser] = useState(null);
  const [profileUser, setProfileUser] = useState(null);
  const [posts, setPosts] = useState([]);
  const [onlineStatus, setOnlineStatus] = useState({ online: false, lastSeen: null });
  const [friendshipStatus, setFriendshipStatus] = useState('none');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [newPost, setNewPost] = useState('');
  const [posting, setPosting] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ first_name: '', last_name: '', bio: '', city: '', relationship: '', is_private: false });
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [commentInputs, setCommentInputs] = useState({});
  const [commentsOpen, setCommentsOpen] = useState({});
  const [commentsByPost, setCommentsByPost] = useState({});
  const [commentSubmitting, setCommentSubmitting] = useState({});
  const [commentsLoading, setCommentsLoading] = useState({});
  const [commentSorts, setCommentSorts] = useState({});
  const [replyTargets, setReplyTargets] = useState({});
  const [editingTargets, setEditingTargets] = useState({});
  const [commentActionState, setCommentActionState] = useState({});
  const [replyUiState, setReplyUiState] = useState({});
  const [deletingPostId, setDeletingPostId] = useState(null);
  const [likingPostId, setLikingPostId] = useState(null);
  const [contactActionLoading, setContactActionLoading] = useState(false);
  const [vouchActionLoading, setVouchActionLoading] = useState(false);
  const [connectionsModal, setConnectionsModal] = useState({ open: false, type: 'friends', loading: false, users: [], error: '' });
  const [actingConnectionId, setActingConnectionId] = useState(null);
  const [composerFocusTick, setComposerFocusTick] = useState(0);
  const [activeTab, setActiveTab] = useState('posts');
  const [mediaViewer, setMediaViewer] = useState({ open: false, items: [], index: 0, title: '' });
  const [collectionModal, setCollectionModal] = useState({ open: false, entry: null });

  const isCurrentUser = useMemo(() => currentUser && (!userId || String(currentUser.id) === String(userId)), [currentUser, userId]);
  const currentUserId = useMemo(() => String(currentUser?.id || ''), [currentUser]);
  useDocumentTitle('Профиль', formatDisplayName(profileUser) || (isCurrentUser ? formatDisplayName(currentUser) : ''));

  const mediaItems = useMemo(() => flattenMediaItems(posts, profileUser), [posts, profileUser]);
  const spotlightPost = useMemo(() => pickSpotlightPost(posts), [posts]);


  const openCollectionModal = useCallback((entry) => {
    if (!entry) return;
    setCollectionModal({ open: true, entry });
  }, []);

  const closeCollectionModal = useCallback(() => {
    setCollectionModal({ open: false, entry: null });
  }, []);

  const handleSaveProfile = useCallback(() => {
    if (!profileUser) return;
    openCollectionModal(buildProfileCollectionEntry(profileUser));
  }, [openCollectionModal, profileUser]);

  const handleSavePost = useCallback((post) => {
    openCollectionModal(buildPostCollectionEntry(post));
  }, [openCollectionModal]);

  const openMediaViewer = useCallback((items, index = 0, title = '') => {
    if (!Array.isArray(items) || !items.length) return;
    const safeIndex = Math.max(0, Math.min(index, items.length - 1));
    setMediaViewer({ open: true, items, index: safeIndex, title });
  }, []);

  const closeMediaViewer = useCallback(() => {
    setMediaViewer((prev) => ({ ...prev, open: false }));
  }, []);

  const shiftMediaViewer = useCallback((direction) => {
    setMediaViewer((prev) => {
      if (!prev.items?.length) return prev;
      const nextIndex = (prev.index + direction + prev.items.length) % prev.items.length;
      return { ...prev, index: nextIndex };
    });
  }, []);

  const openSpotlightPost = useCallback(() => {
    setActiveTab('posts');
    window.requestAnimationFrame(() => {
      document.querySelector('[data-profile-posts-anchor]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  useEffect(() => {
    if (!composerFocusTick) return;
    window.requestAnimationFrame(() => {
      composerInputRef.current?.focus();
      composerInputRef.current?.select?.();
    });
  }, [composerFocusTick]);

  useEffect(() => {
    if (!mediaViewer.open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') closeMediaViewer();
      if (event.key === 'ArrowLeft') shiftMediaViewer(-1);
      if (event.key === 'ArrowRight') shiftMediaViewer(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [mediaViewer.open, closeMediaViewer, shiftMediaViewer]);


  useEffect(() => {
    const onAppAction = (event) => {
      const action = event?.detail?.action;
      if (action === 'profile.edit' && isCurrentUser) {
        setShowEdit(true);
      }
      if (action === 'profile.focusComposer' && isCurrentUser) {
        setComposerFocusTick((prev) => prev + 1);
      }
    };

    window.addEventListener('app:action', onAppAction);
    return () => window.removeEventListener('app:action', onAppAction);
  }, [isCurrentUser]);

  useEffect(() => {
    const onRelationshipUpdated = (event) => {
      const detail = event?.detail || {};
      const targetId = String(detail.userId || '');
      if (!targetId) return;

      const currentLoggedId = String(currentUser?.id || getStoredUser()?.id || '');
      const modalUser = connectionsModal?.users?.find((item) => String(item.id) === targetId);
      const previousStatus = detail.previousStatus || modalUser?.friendship_status || (profileUser && String(profileUser.id) === targetId ? friendshipStatus : 'none');
      const nextStatus = detail.status || 'none';

      setConnectionsModal((prev) => {
        if (!prev.open) return prev;
        const existing = prev.users.find((item) => String(item.id) === targetId);
        let users = prev.users.map((item) => String(item.id) === targetId ? {
          ...item,
          ...(detail.user || {}),
          friendship_status: nextStatus || item.friendship_status || 'none',
          request_sent: detail.request_sent ?? (nextStatus === 'request_sent' ? true : item.request_sent),
          subscribed: detail.subscribed ?? (nextStatus === 'subscribed' ? true : nextStatus === 'none' ? false : item.subscribed),
        } : item);

        const isOwnProfileView = currentLoggedId && profileUser && String(profileUser.id) === currentLoggedId;
        if (isOwnProfileView && detail.user && !existing && prev.type === 'friends' && nextStatus === 'friends') {
          users = [{ ...detail.user, friendship_status: 'friends', request_sent: false, subscribed: false }, ...users];
        }
        if (isOwnProfileView && detail.user && !existing && prev.type === 'subscriptions' && nextStatus === 'subscribed') {
          users = [{ ...detail.user, friendship_status: 'subscribed', request_sent: false, subscribed: true }, ...users];
        }
        if (isOwnProfileView && prev.type === 'friends' && nextStatus !== 'friends') {
          users = users.filter((item) => String(item.id) !== targetId);
        }
        if (isOwnProfileView && prev.type === 'subscriptions' && nextStatus !== 'subscribed') {
          users = users.filter((item) => String(item.id) !== targetId);
        }

        return { ...prev, users };
      });

      setProfileUser((prev) => {
        if (!prev) return prev;
        const isOwnProfile = currentLoggedId && String(prev.id) === currentLoggedId;
        const isTargetProfile = String(prev.id) === targetId;
        let next = isTargetProfile ? { ...prev, ...(detail.user || {}) } : { ...prev };

        if (nextStatus === 'friends' && previousStatus !== 'friends' && (isOwnProfile || isTargetProfile)) {
          next.friends_count = Number(next.friends_count || 0) + 1;
        }
        if (nextStatus !== 'friends' && previousStatus === 'friends' && (isOwnProfile || isTargetProfile)) {
          next.friends_count = Math.max(Number(next.friends_count || 0) - 1, 0);
        }

        if (nextStatus === 'subscribed' && previousStatus !== 'subscribed') {
          if (isOwnProfile) next.subscriptions_count = Number(next.subscriptions_count || 0) + 1;
          if (isTargetProfile) next.subscribers_count = Number(next.subscribers_count || 0) + 1;
        }
        if (nextStatus !== 'subscribed' && previousStatus === 'subscribed') {
          if (isOwnProfile) next.subscriptions_count = Math.max(Number(next.subscriptions_count || 0) - 1, 0);
          if (isTargetProfile) next.subscribers_count = Math.max(Number(next.subscribers_count || 0) - 1, 0);
        }

        return next;
      });

      if (profileUser && String(profileUser.id) === targetId) {
        setFriendshipStatus(nextStatus);
      }
    };

    window.addEventListener('app:relationship-updated', onRelationshipUpdated);
    return () => window.removeEventListener('app:relationship-updated', onRelationshipUpdated);
  }, [profileUser, friendshipStatus, currentUser?.id, connectionsModal]);

  const bootstrap = useCallback(async () => {
    const requestId = ++bootstrapRequestIdRef.current;
    try {
      setLoading(true);
      setLoadError('');
      setCommentsOpen({});
      setCommentsByPost({});
      setCommentInputs({});
      setSaveMessage('');
      setActiveTab('posts');
      setMediaViewer({ open: false, items: [], index: 0, title: '' });
      const cached = getStoredUser();
      const me = cached?.id ? cached : (await getMe()).data;
      if (requestId !== bootstrapRequestIdRef.current) return;
      setCurrentUser(me);
      setStoredUser(me);
      broadcastUserUpdated(me);
      const targetId = userId || me.id;
      const profileRes = String(targetId) === String(me.id) ? { data: me } : await getUser(targetId);
      if (requestId !== bootstrapRequestIdRef.current) return;
      const baseProfile = profileRes.data || profileRes;

      const [postsRes, friendsCountRes, subscribersCountRes, subscriptionsCountRes] = await Promise.all([
        getUserPosts(targetId),
        getFriendsCount(targetId).catch(() => ({ data: { count: baseProfile.friends_count || 0 } })),
        getSubscribersCount(targetId).catch(() => ({ data: { count: baseProfile.subscribers_count || 0 } })),
        getSubscriptionsCount(targetId).catch(() => ({ data: { count: baseProfile.subscriptions_count || 0 } })),
      ]);
      if (requestId !== bootstrapRequestIdRef.current) return;

      setProfileUser({
        ...baseProfile,
        friends_count: friendsCountRes.data?.count ?? baseProfile.friends_count ?? 0,
        subscribers_count: subscribersCountRes.data?.count ?? baseProfile.subscribers_count ?? 0,
        subscriptions_count: subscriptionsCountRes.data?.count ?? baseProfile.subscriptions_count ?? 0,
        vouches_count: baseProfile.vouches_count ?? 0,
        vouched_by_me: Boolean(baseProfile.vouched_by_me),
      });
      setPosts((postsRes.data?.posts || []).map(normalizePost).filter(Boolean));

      try {
        const onlineRes = await getUserOnlineStatus(targetId);
        if (requestId === bootstrapRequestIdRef.current) {
          setOnlineStatus(onlineRes.data || { online: false, lastSeen: null });
        }
      } catch (_) {}
      if (String(targetId) !== String(me.id)) {
        try {
          const friendshipRes = await checkFriendship(targetId);
          if (requestId === bootstrapRequestIdRef.current) {
            setFriendshipStatus(friendshipRes.data?.status || 'none');
          }
        } catch (_) {}
      } else if (requestId === bootstrapRequestIdRef.current) {
        setFriendshipStatus('self');
      }
    } catch (err) {
      console.error('Ошибка профиля:', err);
      if (requestId !== bootstrapRequestIdRef.current) return;
      const status = err?.response?.status;
      if (status === 401) {
        navigate('/login');
        return;
      }
      setProfileUser(null);
      setPosts([]);
      setLoadError(getApiErrorMessage(err, 'Не удалось открыть профиль'));
    } finally {
      if (requestId === bootstrapRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [navigate, userId]);

  useEffect(() => { bootstrap(); }, [bootstrap]);

  const handleUpdateProfile = async () => {
    try {
      setSaving(true);
      setSaveMessage('');
      const res = await updateProfile(editForm);
      const updatedUser = res.data?.user || res.data;

      if (updatedUser) {
        setProfileUser((prev) => ({
          ...prev,
          ...updatedUser,
          friends_count: prev?.friends_count ?? updatedUser.friends_count ?? 0,
          subscribers_count: prev?.subscribers_count ?? updatedUser.subscribers_count ?? 0,
          subscriptions_count: prev?.subscriptions_count ?? updatedUser.subscriptions_count ?? 0,
        }));
        const updatedMe = { ...currentUser, ...updatedUser };
        setCurrentUser(updatedMe);
        setStoredUser(updatedMe);
        broadcastUserUpdated(updatedMe);
        requestUserRefresh();
      }

      setSaveMessage('Профиль сохранён');
      setShowEdit(false);
    } catch (err) {
      console.error('Ошибка обновления профиля:', err);
      setSaveMessage(err.response?.data?.error || 'Не удалось сохранить профиль');
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePost = async () => {
    if (!newPost.trim() || posting) return;
    try {
      setPosting(true);
      const res = await createPost({ content: newPost.trim() });
      const post = normalizePost(res.data?.post || res.data);
      if (post) setPosts((prev) => [{ ...post, user: profileUser }, ...prev]);
      setNewPost('');
      showToast('Пост опубликован', { tone: 'success' });
    } catch (err) {
      console.error('Ошибка публикации:', err);
      const message = getApiErrorMessage(err, 'Не удалось опубликовать пост');
      setSaveMessage(message);
      showToast(message, { tone: 'danger' });
    } finally { setPosting(false); }
  };

  const refreshProfileCounters = (patch = {}) => {
    setProfileUser((prev) => prev ? ({
      ...prev,
      friends_count: Math.max((patch.friends_count ?? prev.friends_count ?? 0), 0),
      subscribers_count: Math.max((patch.subscribers_count ?? prev.subscribers_count ?? 0), 0),
      subscriptions_count: Math.max((patch.subscriptions_count ?? prev.subscriptions_count ?? 0), 0),
      vouches_count: Math.max((patch.vouches_count ?? prev.vouches_count ?? 0), 0),
      vouched_by_me: patch.vouched_by_me ?? prev.vouched_by_me ?? false,
    }) : prev);
  };

  const patchConnectionsUser = (userId, patch) => {
    setConnectionsModal((prev) => prev.open ? ({
      ...prev,
      users: prev.users.map((item) => String(item.id) === String(userId) ? { ...item, ...patch } : item),
    }) : prev);
  };

  const removeConnectionsUser = (userId) => {
    setConnectionsModal((prev) => prev.open ? ({
      ...prev,
      users: prev.users.filter((item) => String(item.id) !== String(userId)),
    }) : prev);
  };

  const isOwnConnectionsList = isCurrentUser && connectionsModal.open;

  const handleConnectionFriendAction = async (user) => {
    if (!user?.id || actingConnectionId === user.id) return;
    const status = user.friendship_status || 'none';
    try {
      setActingConnectionId(user.id);
      if (status === 'request_received') {
        await acceptFriendRequest(user.id);
        showToast('Заявка принята', { tone: 'success' });
        patchConnectionsUser(user.id, { friendship_status: 'friends' });
        broadcastRelationshipUpdated({ userId: user.id, status: 'friends', previousStatus: status, request_sent: false, subscribed: false, user });
        return;
      }
      if (status === 'friends') {
        const confirmed = await confirmAction({ title: 'Удалить из друзей', message: 'Пользователь будет удалён из вашего списка друзей.', confirmLabel: 'Удалить', tone: 'danger' });
        if (!confirmed) return;
        await unfriend(user.id);
        showToast('Пользователь удалён из друзей', { tone: 'success' });
        if (isOwnConnectionsList && connectionsModal.type === 'friends') {
          removeConnectionsUser(user.id);
          refreshProfileCounters({ friends_count: (profileUser?.friends_count || 1) - 1 });
        } else {
          patchConnectionsUser(user.id, { friendship_status: 'none' });
        }
        broadcastRelationshipUpdated({ userId: user.id, status: 'none', previousStatus: status, request_sent: false, subscribed: false, user });
        return;
      }
      if (status === 'none' || status === 'subscribed') {
        await sendFriendRequest(user.id);
        showToast('Заявка отправлена', { tone: 'success' });
        patchConnectionsUser(user.id, { friendship_status: 'request_sent', request_sent: true });
        broadcastRelationshipUpdated({ userId: user.id, status: 'request_sent', previousStatus: status, request_sent: true, subscribed: false, user });
      }
    } catch (err) {
      console.error('Ошибка действия со связью:', err);
      setSaveMessage(err.response?.data?.error || 'Не удалось выполнить действие');
    } finally {
      setActingConnectionId(null);
    }
  };

  const handleConnectionSubscribeToggle = async (user) => {
    if (!user?.id || actingConnectionId === user.id) return;
    const status = user.friendship_status || 'none';
    if (status === 'friends' || status === 'request_received' || status === 'request_sent') return;
    try {
      setActingConnectionId(user.id);
      if (status === 'subscribed') {
        await unsubscribe(user.id);
        showToast('Подписка отменена', { tone: 'success' });
        if (isOwnConnectionsList && connectionsModal.type === 'subscriptions') {
          removeConnectionsUser(user.id);
          refreshProfileCounters({ subscriptions_count: (profileUser?.subscriptions_count || 1) - 1 });
        } else {
          patchConnectionsUser(user.id, { friendship_status: 'none' });
        }
        broadcastRelationshipUpdated({ userId: user.id, status: 'none', previousStatus: status, request_sent: false, subscribed: false, user });
      } else {
        await subscribe(user.id);
        showToast('Подписка оформлена', { tone: 'success' });
        patchConnectionsUser(user.id, { friendship_status: 'subscribed' });
        broadcastRelationshipUpdated({ userId: user.id, status: 'subscribed', previousStatus: status, request_sent: false, subscribed: true, user });
      }
    } catch (err) {
      console.error('Ошибка подписки в списке:', err);
      setSaveMessage(err.response?.data?.error || 'Не удалось изменить подписку');
    } finally {
      setActingConnectionId(null);
    }
  };

  const connectionPrimaryActionLabel = (user) => {
    const status = user?.friendship_status || 'none';
    if (status === 'friends') return 'Написать';
    if (status === 'request_received') return 'Принять';
    if (status === 'request_sent') return 'Заявка';
    return 'В друзья';
  };

  const connectionSecondaryActionLabel = (user) => {
    const status = user?.friendship_status || 'none';
    if (status === 'friends') return 'Удалить';
    if (status === 'subscribed') return 'Отписаться';
    if (status === 'none') return 'Подписаться';
    return '';
  };

  const handleFriendAction = async () => {
    if (!profileUser || contactActionLoading) return;
    try {
      setContactActionLoading(true);
      if (friendshipStatus === 'request_received') {
        await acceptFriendRequest(profileUser.id);
        showToast('Заявка принята', { tone: 'success' });
        setFriendshipStatus('friends');
        broadcastRelationshipUpdated({ userId: profileUser.id, status: 'friends', previousStatus: friendshipStatus, request_sent: false, subscribed: false, user: profileUser });
        refreshProfileCounters({ friends_count: (profileUser.friends_count || 0) + 1 });
      } else if (friendshipStatus === 'none' || friendshipStatus === 'subscribed') {
        await sendFriendRequest(profileUser.id);
        showToast('Заявка отправлена', { tone: 'success' });
        setFriendshipStatus('request_sent');
        broadcastRelationshipUpdated({ userId: profileUser.id, status: 'request_sent', previousStatus: friendshipStatus, request_sent: true, subscribed: false, user: profileUser });
      }
    } catch (err) {
      console.error('Ошибка friendship action:', err);
      setSaveMessage(err.response?.data?.error || 'Не удалось выполнить действие');
    } finally {
      setContactActionLoading(false);
    }
  };

  const handleSubscribeToggle = async () => {
    if (!profileUser || contactActionLoading) return;
    try {
      setContactActionLoading(true);
      if (friendshipStatus === 'subscribed') {
        await unsubscribe(profileUser.id);
        showToast('Подписка отменена', { tone: 'success' });
        setFriendshipStatus('none');
        broadcastRelationshipUpdated({ userId: profileUser.id, status: 'none', previousStatus: friendshipStatus, request_sent: false, subscribed: false, user: profileUser });
        refreshProfileCounters({ subscribers_count: (profileUser.subscribers_count || 1) - 1 });
      } else {
        await subscribe(profileUser.id);
        showToast('Подписка оформлена', { tone: 'success' });
        setFriendshipStatus((prev) => (prev === 'friends' ? prev : 'subscribed'));
        broadcastRelationshipUpdated({ userId: profileUser.id, status: 'subscribed', previousStatus: friendshipStatus, request_sent: false, subscribed: true, user: profileUser });
        refreshProfileCounters({ subscribers_count: (profileUser.subscribers_count || 0) + 1 });
      }
    } catch (err) {
      console.error('Ошибка подписки:', err);
      setSaveMessage(err.response?.data?.error || 'Не удалось изменить подписку');
    } finally {
      setContactActionLoading(false);
    }
  };

  const handleUnfriend = async () => {
    if (!profileUser || contactActionLoading) return;
    const confirmed = await confirmAction({ title: 'Удалить из друзей', message: 'Пользователь будет удалён из вашего списка друзей.', confirmLabel: 'Удалить', tone: 'danger' });
    if (!confirmed) return;
    try {
      setContactActionLoading(true);
      await unfriend(profileUser.id);
      showToast('Пользователь удалён из друзей', { tone: 'success' });
      setFriendshipStatus('none');
      refreshProfileCounters({ friends_count: (profileUser.friends_count || 1) - 1 });
    } catch (err) {
      console.error('Ошибка удаления из друзей:', err);
      setSaveMessage(err.response?.data?.error || 'Не удалось удалить из друзей');
    } finally {
      setContactActionLoading(false);
    }
  };

  const handleVouchToggle = async () => {
    if (!profileUser?.id || isCurrentUser || vouchActionLoading) return;
    try {
      setVouchActionLoading(true);
      setSaveMessage('');
      const res = profileUser.vouched_by_me ? await unvouchForUser(profileUser.id) : await vouchForUser(profileUser.id);
      const nextCount = Number(res.data?.vouches_count ?? (profileUser.vouched_by_me ? (profileUser.vouches_count || 1) - 1 : (profileUser.vouches_count || 0) + 1));
      const nextVouchedByMe = Boolean(res.data?.vouched_by_me ?? !profileUser.vouched_by_me);
      refreshProfileCounters({ vouches_count: nextCount, vouched_by_me: nextVouchedByMe });

      if (connectionsModal.open && connectionsModal.type === 'vouches' && currentUser) {
        setConnectionsModal((prev) => {
          if (!prev.open || prev.type !== 'vouches') return prev;
          const exists = prev.users.some((item) => String(item.id) === String(currentUser.id));
          if (nextVouchedByMe && !exists) {
            const nextUser = { ...currentUser, friendship_status: 'self' };
            return { ...prev, users: [nextUser, ...prev.users] };
          }
          if (!nextVouchedByMe && exists) {
            return { ...prev, users: prev.users.filter((item) => String(item.id) !== String(currentUser.id)) };
          }
          return prev;
        });
      }

      showToast(nextVouchedByMe ? 'Вы поручились за пользователя' : 'Поручительство отозвано', { tone: 'success' });
    } catch (err) {
      console.error('Ошибка поручительства:', err);
      const message = getApiErrorMessage(err, 'Не удалось обновить поручительство');
      setSaveMessage(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setVouchActionLoading(false);
    }
  };

  const openConnections = async (type) => {
    if (!profileUser) return;
    const id = profileUser.id;
    setConnectionsModal({ open: true, type, loading: true, users: [], error: '' });
    try {
      const res = await (
        type === 'friends' ? getFriends(id) :
        type === 'subscribers' ? getSubscribers(id) :
        type === 'vouches' ? getUserVouches(id) :
        getSubscriptions(id)
      );
      const users = res.data?.[type] || [];
      if (type === 'vouches') {
        refreshProfileCounters({
          vouches_count: Number(res.data?.vouches_count ?? profileUser?.vouches_count ?? users.length),
          vouched_by_me: Boolean(res.data?.vouched_by_me ?? profileUser?.vouched_by_me),
        });
      }
      setConnectionsModal({ open: true, type, loading: false, users, error: '' });
    } catch (err) {
      console.error('Ошибка списка связей:', err);
      setConnectionsModal({ open: true, type, loading: false, users: [], error: err.response?.data?.error || 'Не удалось загрузить список' });
    }
  };

  const toggleLike = async (post) => {
    if (!post?.id || likingPostId === post.id) return;
    try {
      setLikingPostId(post.id);
      if (post.liked) {
        await unlikePost(post.id);
        setPosts((prev) => prev.map((item) => item.id === post.id ? { ...item, liked: false, likes_count: Math.max((item.likes_count || 1) - 1, 0) } : item));
      } else {
        await likePost(post.id);
        setPosts((prev) => prev.map((item) => item.id === post.id ? { ...item, liked: true, likes_count: (item.likes_count || 0) + 1 } : item));
      }
    } catch (err) {
      console.error('Ошибка лайка поста:', err);
      showToast(getApiErrorMessage(err, 'Не удалось изменить лайк'), { tone: 'danger' });
    } finally {
      setLikingPostId(null);
    }
  };

  const updateReplyUiState = useCallback((postId, commentId, patch) => {
    if (!postId || !commentId) return;
    setReplyUiState((prev) => ({
      ...prev,
      [postId]: {
        ...(prev[postId] || {}),
        [commentId]: {
          ...((prev[postId] || {})[commentId] || {}),
          ...patch,
        },
      },
    }));
  }, []);

  const loadComments = async (postId, force = false) => {
    if (!force && commentsByPost[postId]) return;
    try {
      setCommentsLoading((prev) => ({ ...prev, [postId]: true }));
      const res = await getComments(postId, { limit: 20 });
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: (res.data?.comments || []).map(normalizeComment).filter(Boolean),
      }));
    } catch (err) {
      console.error('Ошибка загрузки комментариев профиля:', err);
    } finally {
      setCommentsLoading((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const loadReplies = useCallback(async (postId, commentId, options = {}) => {
    if (!postId || !commentId) return;
    const currentState = replyUiState[postId]?.[commentId] || {};
    if (currentState.loading) return;
    const loadedCount = getLoadedDirectReplyCount(commentsByPost[postId] || [], commentId);
    const offset = options.reset ? 0 : Number(currentState.offset ?? loadedCount ?? 0);
    try {
      updateReplyUiState(postId, commentId, { loading: true, expanded: true });
      const res = await getComments(postId, { parent_id: commentId, limit: 8, offset });
      const incoming = (res.data?.comments || []).map(normalizeComment).filter(Boolean);
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: mergeCommentsById(prev[postId] || [], incoming),
      }));
      updateReplyUiState(postId, commentId, {
        loading: false,
        expanded: true,
        loaded: true,
        hasMore: Boolean(res.data?.has_more),
        offset: Number(res.data?.next_offset ?? (offset + incoming.length)),
      });
    } catch (err) {
      updateReplyUiState(postId, commentId, { loading: false });
      console.error('Ошибка загрузки ответов профиля:', err);
    }
  }, [commentsByPost, replyUiState, updateReplyUiState]);

  const toggleComments = async (postId) => {
    const nextOpen = !commentsOpen[postId];
    setCommentsOpen((prev) => ({ ...prev, [postId]: nextOpen }));
    if (nextOpen) {
      await loadComments(postId);
    }
  };

  const submitComment = async (postId) => {
    const content = commentInputs[postId]?.trim();
    const replyTarget = replyTargets[postId] || null;
    const editingTarget = editingTargets[postId] || null;
    if (!content || commentSubmitting[postId]) return;
    try {
      setCommentSubmitting((prev) => ({ ...prev, [postId]: true }));
      if (editingTarget?.id) {
        const res = await updateComment(editingTarget.id, { content });
        const comment = normalizeComment(res.data?.comment || res.data);
        setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
        setEditingTargets((prev) => ({ ...prev, [postId]: null }));
        if (comment) {
          setCommentsByPost((prev) => ({ ...prev, [postId]: replaceCommentInList(prev[postId] || [], comment) }));
          showToast('Комментарий обновлён', { tone: 'success' });
        } else {
          await loadComments(postId, true);
        }
        return;
      }
      const res = await addComment(postId, { content, parent_id: replyTarget?.id || undefined });
      const comment = normalizeComment(res.data?.comment || res.data);
      const depthLimited = Boolean(res.data?.depth_limited);
      setPosts((prev) => prev.map((item) => item.id === postId ? { ...item, comments_count: (item.comments_count || 0) + 1 } : item));
      setCommentInputs((prev) => ({ ...prev, [postId]: '' }));
      setReplyTargets((prev) => ({ ...prev, [postId]: null }));
      setCommentsOpen((prev) => ({ ...prev, [postId]: true }));
      if (comment) {
        setCommentsByPost((prev) => ({ ...prev, [postId]: mergeCommentsById(prev[postId] || [], [comment]) }));
        if (replyTarget?.id) {
          updateReplyUiState(postId, replyTarget.id, { expanded: true, loaded: true });
        }
        if (depthLimited) {
          showToast('Ответ добавлен без углубления ветки, чтобы обсуждение оставалось удобным', { tone: 'neutral' });
        }
      } else {
        await loadComments(postId, true);
      }
    } catch (err) {
      console.error('Ошибка комментария профиля:', err);
      const fallback = editingTargets[postId]?.id ? 'Не удалось обновить комментарий' : 'Не удалось отправить комментарий';
      const message = getApiErrorMessage(err, fallback);
      setSaveMessage(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setCommentSubmitting((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const handleReplyToComment = useCallback((postId, comment) => {
    if (!postId || !comment) return;
    const depthInfo = getCommentDepthInfo(commentsByPost[postId] || [], comment.id);
    setEditingTargets((prev) => ({ ...prev, [postId]: null }));
    setReplyTargets((prev) => ({ ...prev, [postId]: { ...comment, _depth: depthInfo.depth, _depthLimited: depthInfo.willLimit } }));
    setCommentInputs((prev) => {
      const current = prev[postId] || '';
      return current.trim() ? prev : { ...prev, [postId]: buildReplyPrefill(comment) };
    });
  }, [commentsByPost]);

  const handleEditComment = useCallback((postId, comment) => {
    if (!postId || !comment) return;
    setReplyTargets((prev) => ({ ...prev, [postId]: null }));
    setEditingTargets((prev) => ({ ...prev, [postId]: comment }));
    setCommentInputs((prev) => ({ ...prev, [postId]: comment.content || '' }));
    setCommentsOpen((prev) => ({ ...prev, [postId]: true }));
  }, []);

  const clearReplyTarget = useCallback((postId) => {
    setReplyTargets((prev) => ({ ...prev, [postId]: null }));
  }, []);

  const clearEditTarget = useCallback((postId) => {
    setEditingTargets((prev) => ({ ...prev, [postId]: null }));
  }, []);

  const handleDeleteComment = useCallback(async (postId, comment) => {
    if (!postId || !comment?.id) return;
    const confirmed = await confirmAction({
      title: 'Удалить комментарий?',
      message: 'Будет удалён сам комментарий и все ответы внутри ветки.',
      confirmLabel: 'Удалить',
      cancelLabel: 'Отмена',
      tone: 'danger',
    });
    if (!confirmed) return;
    try {
      setCommentActionState((prev) => ({ ...prev, [comment.id]: 'deleting' }));
      const res = await deleteComment(comment.id);
      let removedCount = Number(res.data?.deleted_count || 0);
      setCommentsByPost((prev) => {
        const current = prev[postId] || [];
        const result = removeCommentSubtree(current, comment.id);
        if (!removedCount) removedCount = result.removedCount;
        return { ...prev, [postId]: result.nextComments };
      });
      setPosts((prev) => prev.map((item) => item.id === postId ? { ...item, comments_count: Math.max(0, Number(item.comments_count || 0) - Math.max(removedCount, 1)) } : item));
      setReplyTargets((prev) => ({ ...prev, [postId]: prev[postId]?.id === comment.id ? null : prev[postId] }));
      setEditingTargets((prev) => ({ ...prev, [postId]: prev[postId]?.id === comment.id ? null : prev[postId] }));
      showToast('Комментарий удалён', { tone: 'success' });
    } catch (err) {
      const message = getApiErrorMessage(err, 'Не удалось удалить комментарий');
      setSaveMessage(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setCommentActionState((prev) => {
        const next = { ...prev };
        delete next[comment.id];
        return next;
      });
    }
  }, []);

  const setCommentSort = useCallback((postId, sort) => {
    setCommentSorts((prev) => ({ ...prev, [postId]: sort }));
  }, []);

  const toggleCommentReplies = useCallback(async (postId, comment) => {
    if (!postId || !comment?.id) return;
    const currentState = replyUiState[postId]?.[comment.id] || {};
    if (currentState.expanded) {
      updateReplyUiState(postId, comment.id, { expanded: false });
      return;
    }
    updateReplyUiState(postId, comment.id, { expanded: true });
    const loadedCount = getLoadedDirectReplyCount(commentsByPost[postId] || [], comment.id);
    if (loadedCount === 0 && Number(comment.reply_count || 0) > 0) {
      await loadReplies(postId, comment.id, { reset: true });
    }
  }, [commentsByPost, loadReplies, replyUiState, updateReplyUiState]);

  const loadMoreReplies = useCallback(async (postId, comment) => {
    if (!postId || !comment?.id) return;
    await loadReplies(postId, comment.id);
  }, [loadReplies]);

  const handleVoteComment = useCallback(async (postId, comment, nextValue) => {
    if (!postId || !comment?.id) return;
    const currentValue = Number(comment.current_user_vote || 0);
    const targetValue = currentValue === nextValue ? 0 : nextValue;
    const likeDelta = (targetValue === 1 ? 1 : 0) - (currentValue === 1 ? 1 : 0);
    const dislikeDelta = (targetValue === -1 ? 1 : 0) - (currentValue === -1 ? 1 : 0);
    setCommentActionState((prev) => ({ ...prev, [comment.id]: `vote:${targetValue}` }));
    setCommentsByPost((prev) => ({
      ...prev,
      [postId]: (prev[postId] || []).map((item) => String(item?.id) === String(comment.id)
        ? {
            ...item,
            current_user_vote: targetValue,
            likes: Math.max(0, Number(item.likes || 0) + likeDelta),
            dislikes: Math.max(0, Number(item.dislikes || 0) + dislikeDelta),
          }
        : item),
    }));
    try {
      const res = await voteComment(comment.id, targetValue);
      const nextComment = normalizeComment(res.data?.comment || res.data);
      if (nextComment) {
        setCommentsByPost((prev) => ({ ...prev, [postId]: replaceCommentInList(prev[postId] || [], nextComment) }));
      }
    } catch (err) {
      const message = getApiErrorMessage(err, 'Не удалось обновить реакцию на комментарий');
      setSaveMessage(message);
      showToast(message, { tone: 'danger' });
      setCommentsByPost((prev) => ({
        ...prev,
        [postId]: (prev[postId] || []).map((item) => String(item?.id) === String(comment.id)
          ? {
              ...item,
              current_user_vote: currentValue,
              likes: Math.max(0, Number(item.likes || 0) - likeDelta),
              dislikes: Math.max(0, Number(item.dislikes || 0) - dislikeDelta),
            }
          : item),
      }));
    } finally {
      setCommentActionState((prev) => {
        const next = { ...prev };
        delete next[comment.id];
        return next;
      });
    }
  }, []);

  const handleDeletePost = async (postId) => {
    const confirmed = await confirmAction({ title: 'Удалить пост', message: 'Этот пост исчезнет из профиля и ленты.', confirmLabel: 'Удалить', tone: 'danger' });
    if (!confirmed) return;
    try {
      setDeletingPostId(postId);
      await deletePost(postId);
      setPosts((prev) => prev.filter((item) => item.id !== postId));
      showToast('Пост удалён', { tone: 'success' });
      setCommentsByPost((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
      setCommentsOpen((prev) => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    } catch (err) {
      console.error('Ошибка удаления поста профиля:', err);
      const message = getApiErrorMessage(err, 'Не удалось удалить пост');
      setSaveMessage(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setDeletingPostId(null);
    }
  };

  const openEditProfile = () => {
    setEditForm({
      first_name: profileUser?.first_name || '',
      last_name: profileUser?.last_name || '',
      bio: profileUser?.bio || '',
      city: profileUser?.city || '',
      relationship: profileUser?.relationship || '',
      is_private: Boolean(profileUser?.is_private),
    });
    setShowEdit(true);
  };

  if (loading) return <div className="pa-loading">Загружаю профиль…</div>;
  if (loadError) return <div className="pa-empty pa-card"><h3>Не удалось открыть профиль</h3><p>{loadError}</p><div className="pa-action-row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="pa-secondary-btn" type="button" onClick={bootstrap}>Повторить</button><button className="pa-primary-btn" type="button" onClick={() => navigate('/friends')}>Открыть людей</button></div></div>;
  if (!profileUser) return <div className="pa-empty pa-card"><h3>Профиль не найден</h3><p>Проверьте ссылку и попробуйте снова.</p><div className="pa-action-row" style={{ justifyContent: 'center', marginTop: 12 }}><button className="pa-secondary-btn" type="button" onClick={bootstrap}>Повторить</button><button className="pa-primary-btn" type="button" onClick={() => navigate('/friends')}>Открыть людей</button></div></div>;


  const profilePostsEmptyState = (() => {
    if (isCurrentUser) {
      return {
        title: 'Постов пока нет',
        text: 'Опубликуйте первый пост в своём профиле и начните активность.',
        primary: { label: 'Создать пост', onClick: () => setComposerFocusTick((v) => v + 1) },
        secondary: { label: 'Редактировать профиль', onClick: () => { setEditForm({ first_name: profileUser.first_name || '', last_name: profileUser.last_name || '', bio: profileUser.bio || '', city: profileUser.city || '', relationship: profileUser.relationship || '', is_private: Boolean(profileUser.is_private) }); setShowEdit(true); } },
      };
    }
    if (friendshipStatus === 'friends') {
      return {
        title: 'Публикаций пока нет',
        text: 'Когда у пользователя появятся посты, они будут показаны здесь.',
        primary: { label: 'Написать', onClick: () => navigate(`/messages/${profileUser.id}`) },
        secondary: { label: 'Открыть людей', onClick: () => navigate('/friends') },
      };
    }
    return {
      title: 'Публикаций пока нет',
      text: 'Вы можете подписаться на пользователя или найти другие профили.',
      primary: { label: 'Открыть людей', onClick: () => navigate('/friends') },
      secondary: { label: 'Обновить', onClick: bootstrap },
    };
  })();

  const connectionsEmptyState = (() => {
    if (connectionsModal.type === 'friends') {
      return {
        title: 'Друзей пока нет',
        text: isCurrentUser ? 'Добавьте первых друзей через поиск или заявки.' : 'У этого пользователя пока нет друзей в открытом списке.',
        primary: { label: 'Открыть людей', onClick: () => { setConnectionsModal((prev) => ({ ...prev, open: false })); navigate('/friends'); } },
        secondary: { label: 'Закрыть', onClick: () => setConnectionsModal((prev) => ({ ...prev, open: false })) },
      };
    }
    if (connectionsModal.type === 'vouches') {
      return {
        title: 'Поручительств пока нет',
        text: isCurrentUser ? 'Когда за вас поручатся другие пользователи, они появятся здесь.' : 'За этого пользователя пока никто публично не поручился.',
        primary: { label: isCurrentUser ? 'Открыть людей' : 'Закрыть', onClick: () => { setConnectionsModal((prev) => ({ ...prev, open: false })); if (isCurrentUser) navigate('/friends'); } },
        secondary: { label: 'Закрыть', onClick: () => setConnectionsModal((prev) => ({ ...prev, open: false })) },
      };
    }
    if (connectionsModal.type === 'subscriptions') {
      return {
        title: 'Подписок пока нет',
        text: isCurrentUser ? 'Найдите интересных людей и подпишитесь на них.' : 'У этого пользователя пока нет видимых подписок.',
        primary: { label: 'Найти людей', onClick: () => { setConnectionsModal((prev) => ({ ...prev, open: false })); navigate('/friends?tab=search'); } },
        secondary: { label: 'Закрыть', onClick: () => setConnectionsModal((prev) => ({ ...prev, open: false })) },
      };
    }
    return {
      title: 'Подписчиков пока нет',
      text: isCurrentUser ? 'Когда на вас подпишутся, они появятся здесь.' : 'У этого пользователя пока нет подписчиков в открытом списке.',
      primary: { label: 'Открыть людей', onClick: () => { setConnectionsModal((prev) => ({ ...prev, open: false })); navigate('/friends'); } },
      secondary: { label: 'Закрыть', onClick: () => setConnectionsModal((prev) => ({ ...prev, open: false })) },
    };
  })();

  const connectionCountItems = [
    { key: 'friends', value: profileUser.friends_count || 0, label: 'Друзей' },
    { key: 'subscribers', value: profileUser.subscribers_count || 0, label: 'Подписчиков' },
    { key: 'subscriptions', value: profileUser.subscriptions_count || 0, label: 'Подписок' },
    { key: 'vouches', value: profileUser.vouches_count || 0, label: 'Поручились' },
  ];

  return (
    <div className="pa-profile-shell">
      <ProfileOverviewBlock
        isCurrentUser={isCurrentUser}
        profileUser={profileUser}
        currentUser={currentUser}
        onlineStatus={onlineStatus}
        posts={posts}
        friendshipStatus={friendshipStatus}
        navigate={navigate}
        handleFriendAction={handleFriendAction}
        handleUnfriend={handleUnfriend}
        handleSubscribeToggle={handleSubscribeToggle}
        handleVouchToggle={handleVouchToggle}
        contactActionLoading={contactActionLoading}
        vouchActionLoading={vouchActionLoading}
        saveMessage={saveMessage}
        connectionCountItems={connectionCountItems}
        openConnections={openConnections}
        openEditProfile={openEditProfile}
        composerInputRef={composerInputRef}
        newPost={newPost}
        setNewPost={setNewPost}
        handleCreatePost={handleCreatePost}
        posting={posting}
        activeTab={activeTab}
        onChangeTab={setActiveTab}
        onOpenSpotlightPost={openSpotlightPost}
        onOpenSpotlightMedia={spotlightPost?.images?.length ? (() => openMediaViewer(spotlightPost.images.map((item) => ({ ...item, source_post_id: spotlightPost.id, owner_id: profileUser?.id || null, owner_username: profileUser?.username || '' })), 0, `Медиа @${profileUser?.username || ''}`)) : null}
        onSaveProfile={!isCurrentUser ? handleSaveProfile : null}
      >
        {activeTab === 'media' ? (
          <ProfileMediaTab mediaItems={mediaItems} profileUser={profileUser} onOpenMedia={openMediaViewer} />
        ) : activeTab === 'about' ? (
          <ProfileAboutTab
            profileUser={profileUser}
            posts={posts}
            isCurrentUser={isCurrentUser}
            friendshipStatus={friendshipStatus}
            navigate={navigate}
            openEditProfile={openEditProfile}
            handleVouchToggle={handleVouchToggle}
            vouchActionLoading={vouchActionLoading}
            onSaveProfile={!isCurrentUser ? handleSaveProfile : null}
          />
        ) : (
          <ProfilePostsBlock
            isCurrentUser={isCurrentUser}
            posts={posts}
            profilePostsEmptyState={profilePostsEmptyState}
            profileUser={profileUser}
            currentUser={currentUser}
            currentUserId={currentUserId}
            commentsByPost={commentsByPost}
            commentsOpen={commentsOpen}
            commentsLoading={commentsLoading}
            commentInputs={commentInputs}
            commentSubmitting={commentSubmitting}
            commentSorts={commentSorts}
            editingTargets={editingTargets}
            commentActionState={commentActionState}
            replyUiState={replyUiState}
            toggleLike={toggleLike}
            likingPostId={likingPostId}
            toggleComments={toggleComments}
            submitComment={submitComment}
            replyTargets={replyTargets}
            onReplyComment={handleReplyToComment}
            onEditComment={handleEditComment}
            onDeleteComment={handleDeleteComment}
            onVoteComment={handleVoteComment}
            onToggleCommentReplies={toggleCommentReplies}
            onLoadMoreReplies={loadMoreReplies}
            clearReplyTarget={clearReplyTarget}
            clearEditTarget={clearEditTarget}
            setCommentSort={setCommentSort}
            setCommentInputs={setCommentInputs}
            handleDeletePost={handleDeletePost}
            deletingPostId={deletingPostId}
            onOpenMedia={openMediaViewer}
            onSavePost={handleSavePost}
          />
        )}
      </ProfileOverviewBlock>

      <SaveToCollectionModal
        open={collectionModal.open}
        entry={collectionModal.entry}
        onClose={closeCollectionModal}
      />

      <MediaActionModal
        open={mediaViewer.open}
        items={mediaViewer.items}
        index={mediaViewer.index}
        title={mediaViewer.title}
        onClose={closeMediaViewer}
        onPrev={() => shiftMediaViewer(-1)}
        onNext={() => shiftMediaViewer(1)}
      />

      <ProfileEditModal
        showEdit={showEdit}
        setShowEdit={setShowEdit}
        editForm={editForm}
        setEditForm={setEditForm}
        saving={saving}
        handleUpdateProfile={handleUpdateProfile}
      />

      <ProfileConnectionsModal
        connectionsModal={connectionsModal}
        setConnectionsModal={setConnectionsModal}
        connectionsEmptyState={connectionsEmptyState}
        openConnections={openConnections}
        currentUserId={currentUserId}
        actingConnectionId={actingConnectionId}
        connectionPrimaryActionLabel={connectionPrimaryActionLabel}
        connectionSecondaryActionLabel={connectionSecondaryActionLabel}
        handleConnectionFriendAction={handleConnectionFriendAction}
        handleConnectionSubscribeToggle={handleConnectionSubscribeToggle}
        navigate={navigate}
      />
    </div>
  );
}
