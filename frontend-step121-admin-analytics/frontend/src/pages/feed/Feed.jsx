import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { addComment, updateComment, deleteComment, createPost, deletePost, getApiErrorMessage, getComments, getFeed, getMe, getPost, likePost, unlikePost, voteComment, requestUserRefresh, subscribe, unsubscribe, acceptFriendRequest, broadcastRelationshipUpdated, confirmAction, showToast, getFeedPreferences, saveFeedPreference, deleteFeedPreference } from '../../services/api';
import { getStoredUser, setStoredUser } from '../../services/authStorage';
import { FEED_TABS, extractFeedTopic, formatDate, getFeedReason, initials, mediaSummary, mergePosts, normalizeComment, normalizePost } from './feedUtils';
import { buildReplyPrefill, getCommentDepthInfo, getLoadedDirectReplyCount, mergeCommentsById, removeCommentSubtree, replaceCommentInList } from '../../utils/comments';
import { FeedBodyBlock, FeedHeaderBlock, FeedRecommendationCenterModal, FeedRecommendationExplainModal } from './FeedBlocks';
import MediaActionModal from '../../components/postauth/MediaActionModal';
import SaveToCollectionModal from '../../components/postauth/SaveToCollectionModal';
import { buildPostCollectionEntry } from '../../services/collections';


export default function Feed() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [posts, setPosts] = useState([]);
  const [newPost, setNewPost] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [commentInputs, setCommentInputs] = useState({});
  const [commentsOpen, setCommentsOpen] = useState({});
  const [commentsByPost, setCommentsByPost] = useState({});
  const [commentsLoading, setCommentsLoading] = useState({});
  const [commentSubmitting, setCommentSubmitting] = useState({});
  const [commentSorts, setCommentSorts] = useState({});
  const [replyTargets, setReplyTargets] = useState({});
  const [editingTargets, setEditingTargets] = useState({});
  const [commentActionState, setCommentActionState] = useState({});
  const [replyUiState, setReplyUiState] = useState({});
  const [likingPostId, setLikingPostId] = useState(null);
  const [deletingPostId, setDeletingPostId] = useState(null);
  const [currentUser, setCurrentUser] = useState(() => getStoredUser() || null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [authorActionId, setAuthorActionId] = useState(null);
  const [focusedPostId, setFocusedPostId] = useState(null);
  const [targetPostLoading, setTargetPostLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('friends');
  const [feedCounts, setFeedCounts] = useState({ friends: 0, following: 0, recommended: 0 });
  const [feedSignalState, setFeedSignalState] = useState({});
  const [recentFeedPreferences, setRecentFeedPreferences] = useState([]);
  const [undoingFeedPreference, setUndoingFeedPreference] = useState(false);
  const [feedPreferencesModalOpen, setFeedPreferencesModalOpen] = useState(false);
  const [feedPreferencesLoading, setFeedPreferencesLoading] = useState(false);
  const [feedPreferencesItems, setFeedPreferencesItems] = useState([]);
  const [restoringFeedPreferenceId, setRestoringFeedPreferenceId] = useState(null);
  const [explainPost, setExplainPost] = useState(null);
  const [mediaViewer, setMediaViewer] = useState({ open: false, items: [], index: 0, title: '' });
  const [saveModal, setSaveModal] = useState({ open: false, entry: null });
  const postRefs = useRef({});
  const targetRequestRef = useRef(null);
  const targetFetchIdRef = useRef(0);
  const composerInputRef = useRef(null);

  const currentUserId = useMemo(() => String(currentUser?.id || ''), [currentUser]);
  const targetPostId = searchParams.get('post');
  const shouldOpenTargetComments = searchParams.get('comments') === '1';


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


  const openSavePost = useCallback((post) => {
    const entry = buildPostCollectionEntry(post);
    if (!entry) return;
    setSaveModal({ open: true, entry });
  }, []);

  const closeSaveModal = useCallback(() => {
    setSaveModal({ open: false, entry: null });
  }, []);

  const focusComposer = () => {
    const node = composerInputRef.current;
    if (!node) return;
    window.requestAnimationFrame(() => {
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
      node.focus();
    });
  };

  const clearFocusedPost = () => {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('post');
    nextParams.delete('comments');
    setSearchParams(nextParams, { replace: true });
    setFocusedPostId(null);
  };

  const visiblePosts = useMemo(() => posts, [posts]);

  const heroPeople = useMemo(() => {
    const map = new Map();
    posts.forEach((post) => {
      const author = post.user || post.author;
      if (author?.id && !map.has(author.id)) map.set(author.id, author);
    });
    return Array.from(map.values()).slice(0, 4);
  }, [posts]);

  const visibleCountLabel = useMemo(() => {
    if (targetPostId) return 'точечный просмотр';
    const current = FEED_TABS.find((tab) => tab.key === activeTab);
    return current?.label || 'Лента';
  }, [activeTab, targetPostId]);

  const loadFeed = useCallback(async (targetPage = 1, reset = false, scope = activeTab) => {
    try {
      setError('');
      if (reset) {
        setLoading(true);
        setRefreshing(true);
      } else {
        setLoadingMore(true);
      }
      const res = await getFeed(targetPage, { scope });
      const incoming = (res.data?.posts || []).map(normalizePost).filter(Boolean);
      setPosts((prev) => mergePosts(prev, incoming, reset, scope));
      setFeedCounts({
        friends: Number(res.data?.counts?.friends || 0),
        following: Number(res.data?.counts?.following || 0),
        recommended: Number(res.data?.counts?.recommended || 0),
      });
      setHasMore(Boolean(res.data?.has_more ?? (incoming.length === 20)));
      setPage(targetPage);
    } catch (err) {
      console.error('Ошибка загрузки ленты:', err);
      setError(err.response?.data?.error || 'Не удалось загрузить ленту');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, [activeTab]);

  const loadFeedPreferences = useCallback(async () => {
    try {
      setFeedPreferencesLoading(true);
      const res = await getFeedPreferences();
      setFeedPreferencesItems(Array.isArray(res.data?.items) ? res.data.items : []);
    } catch (err) {
      const message = getApiErrorMessage(err, 'Не удалось загрузить настройки рекомендаций');
      setError(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setFeedPreferencesLoading(false);
    }
  }, []);

  const openFeedPreferencesCenter = useCallback(() => {
    setFeedPreferencesModalOpen(true);
    loadFeedPreferences();
  }, [loadFeedPreferences]);

  const closeFeedPreferencesCenter = useCallback(() => {
    setFeedPreferencesModalOpen(false);
  }, []);

  const restoreFeedPreference = useCallback(async (item) => {
    if (!item?.id || restoringFeedPreferenceId === item.id) return;
    try {
      setRestoringFeedPreferenceId(item.id);
      await deleteFeedPreference(item.id);
      setFeedPreferencesItems((prev) => prev.filter((entry) => entry.id !== item.id));
      setRecentFeedPreferences((prev) => prev.filter((entry) => entry.id !== item.id));
      showToast('Настройка рекомендации удалена', { tone: 'success' });
      if (activeTab === 'recommended') {
        loadFeed(1, true, 'recommended');
      }
    } catch (err) {
      const message = getApiErrorMessage(err, 'Не удалось вернуть рекомендацию');
      setError(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setRestoringFeedPreferenceId(null);
    }
  }, [activeTab, loadFeed, restoringFeedPreferenceId]);

  const openExplainPost = useCallback((post) => {
    if (!post) return;
    setExplainPost(post);
  }, []);

  const closeExplainPost = useCallback(() => setExplainPost(null), []);

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

  const loadComments = useCallback(async (postId, force = false) => {
    if (!force && commentsByPost[postId]) return;
    try {
      setCommentsLoading((prev) => ({ ...prev, [postId]: true }));
      const res = await getComments(postId, { limit: 20 });
      const comments = (res.data?.comments || []).map(normalizeComment).filter(Boolean);
      setCommentsByPost((prev) => ({ ...prev, [postId]: comments }));
    } catch (err) {
      console.error('Ошибка загрузки комментариев:', err);
      setError(err.response?.data?.error || 'Не удалось загрузить комментарии');
    } finally {
      setCommentsLoading((prev) => ({ ...prev, [postId]: false }));
    }
  }, [commentsByPost]);

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
      console.error('Ошибка загрузки ответов:', err);
      updateReplyUiState(postId, commentId, { loading: false });
      setError(getApiErrorMessage(err, 'Не удалось загрузить ответы'));
    }
  }, [commentsByPost, replyUiState, updateReplyUiState]);

  const bootstrap = useCallback(async () => {
    try {
      const cachedUser = getStoredUser();
      if (cachedUser?.id) {
        setCurrentUser(cachedUser);
      } else {
        const meRes = await getMe();
        const me = meRes.data || null;
        setCurrentUser(me);
        if (me) {
          setStoredUser(me);
          requestUserRefresh();
        }
      }
    } catch (err) {
      console.error('Ошибка загрузки текущего пользователя:', err);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    loadFeed(1, true, activeTab);
  }, [activeTab, loadFeed]);

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
    const onRelationshipUpdated = (event) => {
      const detail = event?.detail || {};
      const targetId = String(detail.userId || '');
      if (!targetId) return;
      setPosts((prev) => prev.map((item) => {
        const author = item.user || item.author;
        if (String(author?.id || item.user_id || '') !== targetId) return item;
        return {
          ...item,
          user: author ? {
            ...author,
            ...(detail.user || {}),
            friendship_status: detail.status || author.friendship_status || 'none',
            request_sent: detail.request_sent ?? (detail.status === 'request_sent' ? true : author.request_sent),
            subscribed: detail.subscribed ?? (detail.status === 'subscribed' ? true : detail.status === 'none' ? false : author.subscribed),
          } : item.user,
        };
      }));
    };

    window.addEventListener('app:relationship-updated', onRelationshipUpdated);
    return () => window.removeEventListener('app:relationship-updated', onRelationshipUpdated);
  }, []);

  useEffect(() => {
    const onAppAction = (event) => {
      const action = event?.detail?.action;
      if (action === 'feed.focusComposer') {
        focusComposer();
      }
      if (action === 'feed.refresh') {
        loadFeed(1, true);
      }
    };

    window.addEventListener('app:action', onAppAction);
    return () => window.removeEventListener('app:action', onAppAction);
  }, [loadFeed]);

  useEffect(() => {
    if (!focusedPostId) return undefined;
    const timer = window.setTimeout(() => setFocusedPostId(null), 4500);
    return () => window.clearTimeout(timer);
  }, [focusedPostId]);

  useEffect(() => {
    if (!targetPostId) {
      targetRequestRef.current = null;
      return;
    }

    const existing = posts.find((item) => String(item.id) === String(targetPostId));
    if (existing) {
      setFocusedPostId(String(existing.id));
      const node = postRefs.current[String(existing.id)];
      if (node) {
        window.requestAnimationFrame(() => {
          node.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
      if (shouldOpenTargetComments && !commentsOpen[existing.id]) {
        setCommentsOpen((prev) => ({ ...prev, [existing.id]: true }));
        loadComments(existing.id);
      }
      return;
    }

    if (targetRequestRef.current === String(targetPostId)) return;
    targetRequestRef.current = String(targetPostId);
    const fetchId = ++targetFetchIdRef.current;

    (async () => {
      try {
        setTargetPostLoading(true);
        const res = await getPost(targetPostId);
        if (fetchId !== targetFetchIdRef.current) return;
        const post = normalizePost(res.data?.post || res.data);
        if (post) {
          setPosts((prev) => mergePosts(prev, [post], false, activeTab));
          setError('');
        }
      } catch (err) {
        if (fetchId !== targetFetchIdRef.current) return;
        console.error('Ошибка загрузки выбранного поста:', err);
        setError(getApiErrorMessage(err, 'Не удалось открыть выбранный пост'));
      } finally {
        if (fetchId === targetFetchIdRef.current) {
          setTargetPostLoading(false);
        }
      }
    })();
  }, [activeTab, targetPostId, shouldOpenTargetComments, posts, commentsOpen, loadComments]);


  const handleCreatePost = async () => {
    if (!newPost.trim() || posting) return;
    try {
      setPosting(true);
      const res = await createPost({ content: newPost.trim() });
      const post = normalizePost(res.data?.post || res.data);
      if (post) {
        setPosts((prev) => mergePosts(prev, [{ ...post, user: post.user || currentUser }], false));
        setNewPost('');
        setActiveTab('friends');
        showToast('Пост опубликован', { tone: 'success' });
      }
    } catch (err) {
      console.error('Ошибка создания поста:', err);
      const message = getApiErrorMessage(err, 'Не удалось опубликовать пост');
      setError(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setPosting(false);
    }
  };

  const toggleLike = async (post) => {
    if (likingPostId === post.id) return;
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
      console.error('Ошибка лайка:', err);
      const message = getApiErrorMessage(err, 'Не удалось обновить лайк');
      setError(message);
    } finally {
      setLikingPostId(null);
    }
  };

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
          setCommentsByPost((prev) => ({
            ...prev,
            [postId]: replaceCommentInList(prev[postId] || [], comment),
          }));
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
        setCommentsByPost((prev) => ({
          ...prev,
          [postId]: mergeCommentsById(prev[postId] || [], [comment]),
        }));
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
      console.error('Ошибка комментария:', err);
      const fallback = editingTargets[postId]?.id ? 'Не удалось обновить комментарий' : 'Не удалось отправить комментарий';
      const message = getApiErrorMessage(err, fallback);
      setError(message);
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
      setError(message);
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
    const isExpanded = Boolean(currentState.expanded);
    if (isExpanded) {
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
        setCommentsByPost((prev) => ({
          ...prev,
          [postId]: replaceCommentInList(prev[postId] || [], nextComment),
        }));
      }
    } catch (err) {
      const message = getApiErrorMessage(err, 'Не удалось обновить реакцию на комментарий');
      setError(message);
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

  const updateAuthorRelationship = (authorId, nextStatus) => {
    setPosts((prev) => prev.map((item) => {
      const author = item.user || item.author;
      if (String(author?.id || item.user_id || '') !== String(authorId)) return item;
      return {
        ...item,
        user: author ? { ...author, friendship_status: nextStatus } : item.user,
      };
    }));
  };

  const handleAuthorAction = async (author) => {
    if (!author?.id || authorActionId === author.id) return;
    const status = author.friendship_status || 'none';
    try {
      setAuthorActionId(author.id);
      if (status === 'request_received') {
        await acceptFriendRequest(author.id);
        showToast('Заявка принята', { tone: 'success' });
        updateAuthorRelationship(author.id, 'friends');
        broadcastRelationshipUpdated({ userId: author.id, status: 'friends', previousStatus: status, request_sent: false, subscribed: false, user: author });
        return;
      }
      if (status === 'subscribed') {
        await unsubscribe(author.id);
        showToast('Подписка отменена', { tone: 'success' });
        updateAuthorRelationship(author.id, 'none');
        broadcastRelationshipUpdated({ userId: author.id, status: 'none', previousStatus: status, request_sent: false, subscribed: false, user: author });
        return;
      }
      if (status === 'none') {
        await subscribe(author.id);
        showToast('Подписка оформлена', { tone: 'success' });
        updateAuthorRelationship(author.id, 'subscribed');
        broadcastRelationshipUpdated({ userId: author.id, status: 'subscribed', previousStatus: status, request_sent: false, subscribed: true, user: author });
      }
    } catch (err) {
      console.error('Ошибка действия с автором:', err);
      setError(err.response?.data?.error || 'Не удалось обновить связь с пользователем');
    } finally {
      setAuthorActionId(null);
    }
  };

  const authorActionLabel = (author) => {
    const status = author?.friendship_status || 'none';
    if (status === 'friends') return 'Написать';
    if (status === 'request_received') return 'Принять';
    if (status === 'request_sent') return 'Заявка';
    if (status === 'subscribed') return 'Отписаться';
    return 'Подписаться';
  };

  const handleFeedPreference = useCallback(async (post, type) => {
    if (!post?.id || activeTab !== 'recommended') return;
    const author = post.user || post.author || null;
    const topic = extractFeedTopic(post.content);
    const busyKey = `${type}:${post.id}`;
    if (feedSignalState[busyKey]) return;

    const payload = { type, post_id: post.id };
    let successMessage = 'Настройки рекомендаций обновлены';
    if (type === 'hide_author') {
      if (!author?.id) {
        showToast('Не удалось определить автора', { tone: 'danger' });
        return;
      }
      payload.author_id = author.id;
      successMessage = `Скрыли автора @${author.username || 'user'}`;
    } else if (type === 'hide_topic') {
      if (!topic) {
        showToast('У этого поста нет темы для скрытия', { tone: 'neutral' });
        return;
      }
      payload.topic = topic;
      successMessage = `Скрыли тему #${topic}`;
    } else if (type === 'less_like_this') {
      if (author?.id) payload.author_id = author.id;
      if (topic) payload.topic = topic;
      successMessage = 'Будем показывать меньше похожего';
    } else {
      successMessage = 'Пост убран из рекомендаций';
    }

    try {
      setFeedSignalState((prev) => ({ ...prev, [busyKey]: true }));
      const res = await saveFeedPreference(payload);
      const preference = res?.data?.preference || null;
      if (preference) {
        const enrichedPreference = { ...preference, type, message: successMessage, topic: payload.topic || preference.topic || '', author_id: payload.author_id || preference.author_id || null, post_id: payload.post_id || preference.post_id || null };
        setRecentFeedPreferences((prev) => [enrichedPreference, ...prev.filter((entry) => entry.id !== enrichedPreference.id)].slice(0, 3));
      }
      setPosts((prev) => prev.filter((item) => {
        if (type === 'not_interested' || type === 'less_like_this') return String(item.id) !== String(post.id);
        if (type === 'hide_author') {
          const itemAuthor = item.user || item.author || null;
          return String(itemAuthor?.id || item.user_id || '') !== String(author?.id || post.user_id || '');
        }
        return extractFeedTopic(item.content) !== topic;
      }));
      showToast(successMessage, { tone: 'success' });
      loadFeed(1, true, 'recommended');
    } catch (err) {
      const message = getApiErrorMessage(err, 'Не удалось обновить рекомендации');
      setError(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setFeedSignalState((prev) => {
        const next = { ...prev };
        delete next[busyKey];
        return next;
      });
    }
  }, [activeTab, feedSignalState, loadFeed]);

  const handleUndoLastFeedPreference = useCallback(async () => {
    const latestPreference = recentFeedPreferences[0] || null;
    if (!latestPreference?.id || undoingFeedPreference) return;
    try {
      setUndoingFeedPreference(true);
      await deleteFeedPreference(latestPreference.id);
      showToast('Последнее скрытие отменено', { tone: 'success' });
      setRecentFeedPreferences((prev) => prev.filter((entry) => entry.id !== latestPreference.id));
      loadFeed(1, true, 'recommended');
    } catch (err) {
      const message = getApiErrorMessage(err, 'Не удалось отменить последнее скрытие');
      setError(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setUndoingFeedPreference(false);
    }
  }, [recentFeedPreferences, undoingFeedPreference, loadFeed]);

  const recommendationNotice = useMemo(() => {
    const latestPreference = recentFeedPreferences[0] || null;
    if (activeTab !== 'recommended' || !latestPreference) return null;
    const type = latestPreference.type || latestPreference?.preference?.type;
    let title = 'Последнее действие сохранено';
    if (type === 'less_like_this') title = 'Будем показывать меньше похожего';
    if (type === 'not_interested') title = 'Пост скрыт из рекомендаций';
    if (type === 'hide_author') title = 'Автор скрыт из рекомендаций';
    if (type === 'hide_topic') title = `Тема #${latestPreference.topic || ''} скрыта`.trim();
    return {
      title,
      text: 'Можно отменить последнее действие, если скрытие было случайным.',
    };
  }, [activeTab, recentFeedPreferences]);

  const handleDeletePost = async (postId) => {
    const confirmed = await confirmAction({ title: 'Удалить пост', message: 'Этот пост будет удалён из ленты и профиля.', confirmLabel: 'Удалить', tone: 'danger' });
    if (!confirmed) return;
    try {
      setDeletingPostId(postId);
      await deletePost(postId);
      setPosts((prev) => prev.filter((item) => item.id !== postId));
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
      showToast('Пост удалён', { tone: 'success' });
    } catch (err) {
      console.error('Ошибка удаления поста:', err);
      const message = getApiErrorMessage(err, 'Не удалось удалить пост');
      setError(message);
      showToast(message, { tone: 'danger' });
    } finally {
      setDeletingPostId(null);
    }
  };

  return (
    <div className="pa-feed-page">
      <FeedHeaderBlock
        bucketStats={feedCounts}
        heroPeople={heroPeople}
        targetPostId={targetPostId}
        visibleCountLabel={visibleCountLabel}
        targetPostLoading={targetPostLoading}
        focusedPostId={focusedPostId}
        clearFocusedPost={clearFocusedPost}
        refreshing={refreshing}
        loadFeed={loadFeed}
        error={error}
        visiblePosts={visiblePosts}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        feedTabs={FEED_TABS}
        composerInputRef={composerInputRef}
        newPost={newPost}
        setNewPost={setNewPost}
        handleCreatePost={handleCreatePost}
        posting={posting}
        focusComposer={focusComposer}
        recommendationNotice={recommendationNotice}
        onUndoLastFeedPreference={handleUndoLastFeedPreference}
        onDismissRecommendationNotice={() => setRecentFeedPreferences((prev) => prev.slice(1))}
        onOpenRecommendationCenter={openFeedPreferencesCenter}
        undoingFeedPreference={undoingFeedPreference}
      />

      <FeedBodyBlock
        navigate={navigate}
        loading={loading}
        error={error}
        visiblePosts={visiblePosts}
        targetPostId={targetPostId}
        focusedPostId={focusedPostId}
        clearFocusedPost={clearFocusedPost}
        focusComposer={focusComposer}
        loadFeed={loadFeed}
        refreshing={refreshing}
        currentUserId={currentUserId}
        currentUser={currentUser}
        commentsByPost={commentsByPost}
        commentsOpen={commentsOpen}
        commentsLoading={commentsLoading}
        commentInputs={commentInputs}
        commentSubmitting={commentSubmitting}
        commentSorts={commentSorts}
        editingTargets={editingTargets}
        commentActionState={commentActionState}
        replyUiState={replyUiState}
        postRefs={postRefs}
        getFeedReason={getFeedReason}
        targetPostLoading={targetPostLoading}
        toggleLike={toggleLike}
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
        handleAuthorAction={handleAuthorAction}
        authorActionId={authorActionId}
        authorActionLabel={authorActionLabel}
        handleDeletePost={handleDeletePost}
        deletingPostId={deletingPostId}
        likingPostId={likingPostId}
        activeTab={activeTab}
        onFeedPreference={handleFeedPreference}
        feedSignalState={feedSignalState}
        getFeedTopic={extractFeedTopic}
        page={page}
        hasMore={hasMore}
        loadingMore={loadingMore}
        onOpenMedia={openMediaViewer}
        openSavePost={openSavePost}
        onOpenExplainPost={openExplainPost}
      />

      <FeedRecommendationCenterModal
        open={feedPreferencesModalOpen}
        loading={feedPreferencesLoading}
        items={feedPreferencesItems}
        restoringId={restoringFeedPreferenceId}
        onClose={closeFeedPreferencesCenter}
        onRefresh={loadFeedPreferences}
        onRestore={restoreFeedPreference}
      />

      <FeedRecommendationExplainModal
        open={Boolean(explainPost)}
        post={explainPost}
        onClose={closeExplainPost}
      />

      <SaveToCollectionModal
        open={saveModal.open}
        entry={saveModal.entry}
        onClose={closeSaveModal}
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
    </div>
  );
}
