import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { MessagesConversationBlock, MessagesSidebarBlock, MessagesStoriesComposerModal, MessagesStoriesViewerModal } from './MessagesBlocks';
import API, {
  acceptFriendRequest,
  checkFriendship,
  deleteMessage,
  getChats,
  getMe,
  getMessages,
  getUser,
  getUserOnlineStatus,
  markConversationRead,
  sendFriendRequest,
  sendMessage,
  updateMessage,
  subscribe,
  unsubscribe,
  unfriend,
  requestUnreadRefresh,
  broadcastRelationshipUpdated,
  confirmAction,
  showToast,
  getApiErrorMessage,
  getStories,
  createStory,
  viewStory,
  getStoryReplies,
  replyToStory,
  extendStory,
  deleteStory,
  getCommunities,
} from '../../services/api';
import { getStoredUser, setStoredUser } from '../../services/authStorage';
import { acceptRemoteE2EEDeviceChange, canEncryptDirectMessages, encryptDirectMessagePayload, getConversationE2EESecurity, hydrateChatListForDisplay, hydrateMessagesForDisplay, unverifyRemoteE2EEDevice, uploadEncryptedMessageMedia, verifyRemoteE2EEDevice } from '../../services/e2ee';
import { REALTIME_BROWSER_EVENT } from '../../services/realtime';
import { getChatSocketClient } from '../../services/chatSocket';
import { recordChatIncoming, recordChatReply } from '../../services/dfsnCollector';
import { useDirectCallController } from './useDirectCallController';
import {
  CHAT_FILTERS,
  MESSAGE_DRAFTS_STORAGE_KEY,
  MESSAGES_PAGE_LIMIT,
  buildFailedMediaMessageFromDraft,
  buildForwardPayloadFromMessage,
  buildTimeline,
  extensionFromMime,
  formatTime,
  generateVideoPosterBlob,
  getBlobVideoMetadata,
  initials,
  maxDurationForKind,
  mergeServerMessages,
  messagePreviewText,
  messageSearchText,
  normalizeChat,
  normalizeLevels,
  normalizeMessage,
  normalizeMessageType,
  pickSupportedRecorderMime,
  readStoredDrafts,
} from './messagesUtils';
import { useDocumentTitle } from '../../utils/pageTitle';
import {
  VOICE_MAX_DURATION_SEC,
  VIDEO_NOTE_MAX_DURATION_SEC,
  getFailedMessageMediaDraft,
  listFailedMessageMediaDraftsForChat,
  pruneFailedMessageMediaDrafts,
  removeFailedMessageMediaDraft,
  saveFailedMessageMediaDraft,
  uploadMessageMedia,
} from '../../services/media';


export default function Messages() {
  const navigate = useNavigate();
  const { userId } = useParams();
  const messageStackRef = useRef(null);
  const pollingRef = useRef(null);
  const messageInputRef = useRef(null);
  const searchInputRef = useRef(null);
  const shouldAutoScrollRef = useRef(true);
  const previousChatIdRef = useRef(null);
  const chatsRequestIdRef = useRef(0);
  const messagesRequestIdRef = useRef(0);
  const hydrateRequestIdRef = useRef(0);
  const chatSocketClientRef = useRef(null);
  const recorderRef = useRef(null);
  const recorderChunksRef = useRef([]);
  const recorderStreamRef = useRef(null);
  const recorderShouldSendRef = useRef(false);
  const recordingTimerRef = useRef(null);
  const recordingMetaRef = useRef({ kind: '', durationSec: 0 });
  const recordingPreviewRef = useRef(null);
  const failedMediaPayloadsRef = useRef(new Map());
  const failedMediaPreviewURLsRef = useRef(new Map());
  const waveformFrameRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const feedbackAudioContextRef = useRef(null);
  const feedbackToneAtRef = useRef({ send: 0, receive: 0 });
  const messageFxTimersRef = useRef(new Map());

  const [currentUser, setCurrentUser] = useState(() => getStoredUser() || {});
  const [chats, setChats] = useState([]);
  const [selectedChatId, setSelectedChatId] = useState(userId || null);
  const [draftChat, setDraftChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [messageInput, setMessageInput] = useState('');
  const [draftsByChat, setDraftsByChat] = useState(() => readStoredDrafts());
  const [messagesPage, setMessagesPage] = useState(1);
  const [messagesHasMore, setMessagesHasMore] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [chatQuery, setChatQuery] = useState('');
  const [chatFilter, setChatFilter] = useState('all');
  const [conversationQuery, setConversationQuery] = useState('');
  const [activeConversationMatchIndex, setActiveConversationMatchIndex] = useState(0);
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [forwardingMessage, setForwardingMessage] = useState(null);
  const [forwarding, setForwarding] = useState(false);
  const [mediaGalleryOpen, setMediaGalleryOpen] = useState(false);
  const [chatError, setChatError] = useState('');
  const [messageError, setMessageError] = useState('');
  const [securitySummary, setSecuritySummary] = useState(null);
  const [securityLoading, setSecurityLoading] = useState(false);
  const [securityModalOpen, setSecurityModalOpen] = useState(false);
  const [securityActionLoading, setSecurityActionLoading] = useState('');
  const [peerActionLoading, setPeerActionLoading] = useState(false);
  const [chatSocketConnected, setChatSocketConnected] = useState(false);
  const [recordingState, setRecordingState] = useState({ active: false, kind: '', durationSec: 0, uploading: false, uploadProgress: 0, levels: normalizeLevels([]) });

  const [stories, setStories] = useState([]);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [storyComposerOpen, setStoryComposerOpen] = useState(false);
  const [storyCreating, setStoryCreating] = useState(false);
  const [storyDraft, setStoryDraft] = useState({ kind: 'status', audience: 'all', intent: '', content: '', duration_minutes: 60, chat_user_id: '', community_id: '' });
  const [storyViewerStory, setStoryViewerStory] = useState(null);
  const [storyReplies, setStoryReplies] = useState([]);
  const [storyReplyInput, setStoryReplyInput] = useState('');
  const [storyReplySending, setStoryReplySending] = useState(false);
  const [storyActionLoading, setStoryActionLoading] = useState('');
  const [storyCommunities, setStoryCommunities] = useState([]);

  const selectedChat = useMemo(
    () => chats.find((chat) => String(chat.id) === String(selectedChatId)) || (String(draftChat?.id) === String(selectedChatId) ? draftChat : null),
    [chats, draftChat, selectedChatId]
  );

  useDocumentTitle('Чаты', selectedChat?.name || draftChat?.name || '');

  const storyDurationOptions = useMemo(() => {
    const options = [];
    for (let minutes = 10; minutes <= 60; minutes += 10) {
      options.push({ value: minutes, label: `${minutes} мин` });
    }
    for (let hours = 2; hours <= 48; hours += 1) {
      options.push({ value: hours * 60, label: `${hours} ч` });
    }
    return options;
  }, []);

  const loadStories = useCallback(async ({ silent = false } = {}) => {
    try {
      if (!silent) setStoriesLoading(true);
      const res = await getStories();
      setStories(Array.isArray(res.data?.stories) ? res.data.stories : []);
    } catch (error) {
      console.error('Ошибка загрузки историй:', error);
    } finally {
      if (!silent) setStoriesLoading(false);
    }
  }, []);

  const loadStoryCommunities = useCallback(async () => {
    try {
      const res = await getCommunities({ page: 1, limit: 50 });
      setStoryCommunities(Array.isArray(res.data?.communities) ? res.data.communities.filter((item) => item?.is_member) : []);
    } catch (error) {
      console.error('Ошибка загрузки сообществ для историй:', error);
    }
  }, []);

  const handleSubmitStory = useCallback(async () => {
    const payload = {
      kind: storyDraft.kind || 'status',
      audience: storyDraft.audience || 'all',
      intent: String(storyDraft.intent || '').trim(),
      content: String(storyDraft.content || '').trim(),
      duration_minutes: Number(storyDraft.duration_minutes || 60),
      chat_user_id: storyDraft.chat_user_id ? Number(storyDraft.chat_user_id) : undefined,
      community_id: storyDraft.community_id ? Number(storyDraft.community_id) : undefined,
    };
    if (!payload.content) {
      showToast('Добавьте текст истории');
      return;
    }
    setStoryCreating(true);
    try {
      const res = await createStory(payload);
      const nextStory = res.data?.story;
      if (nextStory) {
        setStories((prev) => [nextStory, ...prev.filter((item) => String(item.id) !== String(nextStory.id))]);
      }
      setStoryComposerOpen(false);
      setStoryDraft({ kind: 'status', audience: 'all', intent: '', content: '', duration_minutes: 60, chat_user_id: '', community_id: '' });
      showToast('История опубликована');
      loadStories({ silent: true });
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось опубликовать историю'));
    } finally {
      setStoryCreating(false);
    }
  }, [storyDraft, loadStories]);

  const openStoryViewer = useCallback(async (story) => {
    setStoryViewerStory(story || null);
    setStoryReplyInput('');
    try {
      if (story?.id) {
        await viewStory(story.id).catch(() => null);
        const repliesRes = await getStoryReplies(story.id);
        setStoryReplies(Array.isArray(repliesRes.data?.replies) ? repliesRes.data.replies : []);
        setStories((prev) => prev.map((item) => String(item.id) === String(story.id) ? { ...item, viewed: true } : item));
      } else {
        setStoryReplies([]);
      }
    } catch (error) {
      console.error('Ошибка открытия истории:', error);
      setStoryReplies([]);
    }
  }, []);

  const handleSendStoryReply = useCallback(async () => {
    if (!storyViewerStory?.id || !String(storyReplyInput || '').trim()) return;
    setStoryReplySending(true);
    try {
      const res = await replyToStory(storyViewerStory.id, { content: String(storyReplyInput || '').trim() });
      const reply = res.data?.reply;
      if (reply) setStoryReplies((prev) => [...prev, reply]);
      setStoryReplyInput('');
      showToast('Ответ на историю отправлен');
      loadStories({ silent: true });
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось ответить на историю'));
    } finally {
      setStoryReplySending(false);
    }
  }, [storyReplyInput, storyViewerStory?.id, loadStories]);

  const handleExtendStory = useCallback(async (durationMinutes) => {
    if (!storyViewerStory?.id) return;
    setStoryActionLoading('extend');
    try {
      const res = await extendStory(storyViewerStory.id, { duration_minutes: Number(durationMinutes) || 60 });
      const nextStory = res.data?.story;
      if (nextStory) {
        setStoryViewerStory(nextStory);
        setStories((prev) => prev.map((item) => String(item.id) === String(nextStory.id) ? { ...item, ...nextStory } : item));
      }
      showToast('История продлена');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось продлить историю'));
    } finally {
      setStoryActionLoading('');
    }
  }, [storyViewerStory?.id]);

  const handleDeleteStory = useCallback(async () => {
    if (!storyViewerStory?.id) return;
    setStoryActionLoading('delete');
    try {
      await deleteStory(storyViewerStory.id);
      setStories((prev) => prev.filter((item) => String(item.id) !== String(storyViewerStory.id)));
      setStoryViewerStory(null);
      setStoryReplies([]);
      showToast('История удалена');
    } catch (error) {
      showToast(getApiErrorMessage(error, 'Не удалось удалить историю'));
    } finally {
      setStoryActionLoading('');
    }
  }, [storyViewerStory?.id]);

  const loadConversationSecurity = useCallback(async (chatUserId, { force = false } = {}) => {
    const numericChatId = Number(chatUserId || 0);
    if (!numericChatId || !currentUser?.id || String(numericChatId) === String(currentUser.id)) {
      setSecuritySummary(null);
      return null;
    }
    try {
      setSecurityLoading(true);
      const summary = await getConversationE2EESecurity({ currentUser, remoteUserId: numericChatId, force });
      setSecuritySummary(summary);
      return summary;
    } catch (error) {
      console.error('Ошибка загрузки E2EE summary:', error);
      setSecuritySummary(null);
      return null;
    } finally {
      setSecurityLoading(false);
    }
  }, [currentUser]);

  const handleOpenSecurityPanel = useCallback(() => {
    setSecurityModalOpen(true);
    if (selectedChat?.id) {
      void loadConversationSecurity(selectedChat.id, { force: true });
    }
  }, [loadConversationSecurity, selectedChat?.id]);

  const handleCloseSecurityPanel = useCallback(() => {
    setSecurityModalOpen(false);
  }, []);



  const {
    callState,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    isCallAvailable,
    startAudioCall,
    startVideoCall,
    acceptIncomingCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleRemoteAudio,
    handleSocketEvent,
  } = useDirectCallController({ chatSocketClientRef, selectedChat });

  const loadChats = useCallback(async ({ withLoader = false } = {}) => {
    const requestId = ++chatsRequestIdRef.current;
    try {
      if (withLoader) setLoadingChats(true);
      const res = await getChats();
      if (requestId !== chatsRequestIdRef.current) return;
      const hydratedChats = await hydrateChatListForDisplay(res.data?.chats || [], currentUser?.id);
      if (requestId !== chatsRequestIdRef.current) return;
      const list = hydratedChats.map(normalizeChat);
      setChats(list);
      setChatError('');
      if (!selectedChatId && list[0]) {
        setSelectedChatId(String(list[0].id));
      }
      if (selectedChatId && list.some((chat) => String(chat.id) === String(selectedChatId))) {
        setDraftChat(null);
        requestUnreadRefresh();
      }
    } catch (err) {
      if (requestId !== chatsRequestIdRef.current) return;
      console.error('Ошибка чатов:', err);
      setChatError(getApiErrorMessage(err, 'Не удалось загрузить список чатов'));
    } finally {
      if (requestId === chatsRequestIdRef.current && withLoader) setLoadingChats(false);
    }
  }, [currentUser?.id, selectedChatId]);

  const loadMessages = useCallback(async (
    chatUserId,
    { withLoader = false, silentRead = false, page = 1, mode = 'replace' } = {},
  ) => {
    const requestId = ++messagesRequestIdRef.current;
    const isPrepend = mode === 'prepend';
    const stackNode = messageStackRef.current;
    const preserveScroll = isPrepend && stackNode
      ? { scrollTop: stackNode.scrollTop, scrollHeight: stackNode.scrollHeight }
      : null;
    try {
      if (withLoader) setLoadingMessages(true);
      if (isPrepend) setLoadingOlderMessages(true);
      const res = await getMessages(chatUserId, page, MESSAGES_PAGE_LIMIT);
      if (requestId !== messagesRequestIdRef.current) return;
      const normalizedMessages = [...(res.data?.messages || [])]
        .reverse()
        .map((item) => normalizeMessage(item, currentUser?.id))
        .filter(Boolean);
      const nextMessages = await hydrateMessagesForDisplay(normalizedMessages, currentUser?.id);
      if (requestId !== messagesRequestIdRef.current) return;
      setMessagesPage(Number(res.data?.page || page || 1));
      setMessagesHasMore(Boolean(res.data?.has_more));
      setMessages((prev) => {
        if (isPrepend) {
          const nextMap = new Map();
          [...nextMessages, ...prev].forEach((message) => {
            if (message?.id) nextMap.set(String(message.id), message);
          });
          return Array.from(nextMap.values()).sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        }
        return mergeServerMessages(nextMessages, prev);
      });
      if (preserveScroll) {
        window.requestAnimationFrame(() => {
          const node = messageStackRef.current;
          if (!node) return;
          node.scrollTop = Math.max(0, node.scrollHeight - preserveScroll.scrollHeight + preserveScroll.scrollTop);
        });
      }
      setMessageError('');
      try {
        const socketClient = chatSocketClientRef.current;
        const sentViaSocket = socketClient?.isConnected?.() ? socketClient.send('message:read', { conversation_with: Number(chatUserId) }) : false;
        if (!sentViaSocket) {
          await markConversationRead(chatUserId);
        }
      } catch (readErr) {
        if (!silentRead) {
          console.error('Ошибка отметки прочитанного:', readErr);
        }
      }
      setChats((prev) => prev.map((chat) => String(chat.id) === String(chatUserId) ? { ...chat, unread: 0 } : chat));
      requestUnreadRefresh();
    } catch (err) {
      if (requestId !== messagesRequestIdRef.current) return;
      console.error('Ошибка сообщений:', err);
      if (!isPrepend) setMessages([]);
      setMessageError(getApiErrorMessage(err, 'Не удалось загрузить переписку'));
    } finally {
      if (requestId === messagesRequestIdRef.current && withLoader) setLoadingMessages(false);
      if (requestId === messagesRequestIdRef.current && isPrepend) setLoadingOlderMessages(false);
    }
  }, [currentUser?.id]);

  const handleSecurityAction = useCallback(async (mode, deviceId) => {
    if (!selectedChat?.id || !deviceId) return;
    const key = `${mode}:${deviceId}`;
    try {
      setSecurityActionLoading(key);
      if (mode === 'verify') {
        await verifyRemoteE2EEDevice(selectedChat.id, deviceId);
        showToast('Устройство подтверждено', { tone: 'success' });
      } else if (mode === 'unverify') {
        unverifyRemoteE2EEDevice(selectedChat.id, deviceId);
        showToast('Подтверждение снято', { tone: 'success' });
      } else if (mode === 'accept') {
        await acceptRemoteE2EEDeviceChange(selectedChat.id, deviceId, { verify: false });
        showToast('Новый ключ принят', { tone: 'success' });
      } else if (mode === 'accept_verify') {
        await acceptRemoteE2EEDeviceChange(selectedChat.id, deviceId, { verify: true });
        showToast('Новый ключ принят и подтверждён', { tone: 'success' });
      }
      await loadConversationSecurity(selectedChat.id, { force: true });
      await loadMessages(selectedChat.id, { silentRead: true });
      await loadChats();
      setMessageError('');
    } catch (error) {
      console.error('Ошибка E2EE действия:', error);
      const nextError = getApiErrorMessage(error, 'Не удалось обновить статус устройства');
      setMessageError(nextError);
      showToast(nextError, { tone: 'danger' });
    } finally {
      setSecurityActionLoading('');
    }
  }, [loadChats, loadConversationSecurity, loadMessages, selectedChat?.id]);

  const hydrateSelectedChat = useCallback(async (chatId) => {
    const requestId = ++hydrateRequestIdRef.current;
    const exists = chats.some((chat) => String(chat.id) === String(chatId));
    if (exists) {
      setDraftChat(null);
      requestUnreadRefresh();
      return;
    }

    try {
      const [userRes, statusRes, friendshipRes] = await Promise.all([
        getUser(chatId),
        getUserOnlineStatus(chatId).catch(() => ({ data: null })),
        currentUser?.id && String(currentUser.id) !== String(chatId) ? checkFriendship(chatId).catch(() => ({ data: null })) : Promise.resolve({ data: { status: 'self' } }),
      ]);
      if (requestId !== hydrateRequestIdRef.current) return;
      const user = userRes.data || {};
      const status = statusRes.data || {};
      const friendshipStatus = user.friendship_status || friendshipRes.data?.status || (String(currentUser?.id || '') === String(chatId) ? 'self' : 'none');
      setDraftChat({
        id: String(user.id || chatId),
        name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'Новый чат',
        username: user.username || '',
        avatar: user.avatar || initials(`${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username || 'Новый чат'),
        online: Boolean(status.online),
        lastSeen: status.lastSeen || user.last_seen || null,
        lastMessage: '',
        unread: 0,
        friendship_status: friendshipStatus,
        isSelf: friendshipStatus === 'self',
        isPlaceholder: true,
      });
      setChatError('');
    } catch (err) {
      if (requestId !== hydrateRequestIdRef.current) return;
      console.error('Ошибка подготовки чата:', err);
      setDraftChat(null);
      requestUnreadRefresh();
      const nextError = getApiErrorMessage(err, 'Не удалось открыть выбранный чат');
      setChatError(nextError);
      showToast(nextError, { tone: 'danger' });
      if (String(selectedChatId || '') === String(chatId)) {
        setSelectedChatId(null);
        navigate('/messages', { replace: true });
      }
    }
  }, [chats, currentUser?.id, navigate, selectedChatId]);

  const handleRefreshChats = useCallback(() => {
    setChatError('');
    loadChats({ withLoader: true });
  }, [loadChats]);

  const handleRefreshConversation = useCallback(() => {
    if (!selectedChat?.id) return;
    setMessageError('');
    loadMessages(selectedChat.id, { withLoader: true, page: 1, mode: 'replace' });
  }, [loadMessages, selectedChat?.id]);

  const handleLoadOlderMessages = useCallback(() => {
    if (!selectedChat?.id || loadingOlderMessages || loadingMessages || !messagesHasMore) return;
    void loadMessages(selectedChat.id, {
      withLoader: false,
      silentRead: true,
      page: messagesPage + 1,
      mode: 'prepend',
    });
  }, [loadMessages, loadingMessages, loadingOlderMessages, messagesHasMore, messagesPage, selectedChat?.id]);

  useEffect(() => {
    let ignore = false;
    const bootstrapCurrentUser = async () => {
      if (currentUser?.id) return;
      try {
        const res = await getMe();
        if (ignore) return;
        setCurrentUser(res.data || {});
        setStoredUser(res.data || {});
      } catch (err) {
        console.error('Ошибка загрузки текущего пользователя:', err);
      }
    };
    bootstrapCurrentUser();
    return () => {
      ignore = true;
    };
  }, [currentUser?.id]);

  useEffect(() => {
    loadChats({ withLoader: true });
  }, [loadChats]);

  useEffect(() => {
    if (selectedChat?.id && !selectedChat?.isSelf) {
      void loadConversationSecurity(selectedChat.id);
      return;
    }
    setSecuritySummary(null);
    setSecurityModalOpen(false);
  }, [loadConversationSecurity, selectedChat?.id, selectedChat?.isSelf]);

  useEffect(() => {
    void pruneFailedMessageMediaDrafts();
  }, []);

  useEffect(() => {
    const onRelationshipUpdated = (event) => {
      const detail = event?.detail || {};
      const targetId = String(detail.userId || '');
      if (!targetId) return;
      const apply = (chat) => String(chat.id) === targetId ? {
        ...chat,
        ...(detail.user || {}),
        friendship_status: detail.status || chat.friendship_status || 'none',
      } : chat;
      setChats((prev) => prev.map(apply));
      setDraftChat((prev) => prev && String(prev.id) === targetId ? apply(prev) : prev);
    };

    window.addEventListener('app:relationship-updated', onRelationshipUpdated);
    return () => window.removeEventListener('app:relationship-updated', onRelationshipUpdated);
  }, []);

  useEffect(() => {
    if (userId) setSelectedChatId(String(userId));
  }, [userId]);

  useEffect(() => {
    if (!selectedChatId) {
      setMessageInput('');
      setMessages([]);
      setMessagesPage(1);
      setMessagesHasMore(false);
      setConversationQuery('');
      setActiveConversationMatchIndex(0);
      return;
    }
    setMessageInput(draftsByChat[String(selectedChatId)] || '');
    setMessagesPage(1);
    setMessagesHasMore(false);
    setConversationQuery('');
    setActiveConversationMatchIndex(0);
  }, [draftsByChat, selectedChatId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(MESSAGE_DRAFTS_STORAGE_KEY, JSON.stringify(draftsByChat));
    } catch {}
  }, [draftsByChat]);

  useEffect(() => {
    if (!recordingPreviewRef.current) return;
    if (recordingState.active && recordingState.kind === 'video_note' && recorderStreamRef.current) {
      recordingPreviewRef.current.srcObject = recorderStreamRef.current;
      const maybePlay = recordingPreviewRef.current.play?.();
      if (maybePlay?.catch) maybePlay.catch(() => {});
      return;
    }
    recordingPreviewRef.current.srcObject = null;
  }, [recordingState.active, recordingState.kind]);

  useEffect(() => () => {
    if (recordingTimerRef.current) {
      window.clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    const stream = recorderStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
    }
    stopWaveformMonitoring();
    failedMediaPreviewURLsRef.current.forEach((_, retryKey) => revokeFailedPreviewURLs(retryKey));
  }, [revokeFailedPreviewURLs, stopWaveformMonitoring]);

  useEffect(() => {
    if (!selectedChatId) return;
    if (String(selectedChatId) === String(currentUser?.id)) {
      navigate('/messages', { replace: true });
      return;
    }
    hydrateSelectedChat(selectedChatId);
    loadMessages(selectedChatId, { withLoader: true, page: 1, mode: 'replace' });
  }, [currentUser?.id, hydrateSelectedChat, loadMessages, navigate, selectedChatId]);


  useEffect(() => {
    if (!selectedChatId || !currentUser?.id) return undefined;
    let cancelled = false;
    const restoreFailedDrafts = async () => {
      try {
        const drafts = await listFailedMessageMediaDraftsForChat(selectedChatId);
        if (cancelled || !Array.isArray(drafts) || !drafts.length) return;
        setMessages((prev) => {
          const next = [...prev];
          drafts.forEach((draft) => {
            const retryKey = String(draft.retryKey || '');
            if (!retryKey || next.some((item) => String(item.retry_key || '') === retryKey)) return;
            const objectUrl = URL.createObjectURL(draft.blob);
            const posterUrl = draft.posterBlob ? URL.createObjectURL(draft.posterBlob) : '';
            failedMediaPreviewURLsRef.current.set(retryKey, { objectUrl, posterUrl });
            next.push(buildFailedMediaMessageFromDraft(draft, currentUser.id, objectUrl, posterUrl));
            failedMediaPayloadsRef.current.set(retryKey, buildRetryActionFromDraft(draft));
          });
          return next.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
        });
      } catch (err) {
        console.error('Не удалось восстановить черновики voice/video:', err);
      }
    };
    void restoreFailedDrafts();
    return () => { cancelled = true; };
  }, [buildRetryActionFromDraft, currentUser?.id, selectedChatId]);

  useEffect(() => {
    if (!selectedChatId || chatSocketConnected) return undefined;

    const tick = async () => {
      if (document.hidden) return;
      await Promise.all([
        loadChats({ withLoader: false }),
        loadMessages(selectedChatId, { withLoader: false, silentRead: true }),
      ]);
    };

    pollingRef.current = window.setInterval(tick, 30000);
    return () => {
      if (pollingRef.current) {
        window.clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [chatSocketConnected, loadChats, loadMessages, selectedChatId]);

  useEffect(() => {
    const node = messageStackRef.current;
    if (!node) return undefined;

    const onScroll = () => {
      const distanceToBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
      shouldAutoScrollRef.current = distanceToBottom < 80;
    };

    onScroll();
    node.addEventListener('scroll', onScroll);
    return () => node.removeEventListener('scroll', onScroll);
  }, [selectedChatId]);

  useEffect(() => {
    const node = messageStackRef.current;
    if (!node) return undefined;
    const chatChanged = previousChatIdRef.current !== selectedChatId;
    previousChatIdRef.current = selectedChatId;
    if (!chatChanged && !shouldAutoScrollRef.current) return undefined;

    const frame = window.requestAnimationFrame(() => {
      const currentNode = messageStackRef.current;
      if (!currentNode) return;
      currentNode.scrollTop = currentNode.scrollHeight;
      shouldAutoScrollRef.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages.length, selectedChatId]);

  useEffect(() => {
    if (!activeConversationMatchId || !messageStackRef.current) return undefined;
    const frame = window.requestAnimationFrame(() => {
      const target = messageStackRef.current?.querySelector?.(`[data-message-id="${activeConversationMatchId}"]`);
      if (target?.scrollIntoView) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeConversationMatchId]);

    useEffect(() => {
    const client = getChatSocketClient();
    chatSocketClientRef.current = client;
    client.configure();
    client.connect();
    const unsubscribeStatus = client.subscribeStatus(setChatSocketConnected);
    const unsubscribeEvents = client.subscribe((detail) => {
      Promise.resolve(handleSocketEvent(detail)).then(async (handled) => {
        if (handled) return;
        const type = detail?.type || '';
        const data = detail?.data || {};
        if (type === 'message:sent') {
        const normalizedMessage = normalizeMessage(data?.message, currentUser?.id);
        if (!normalizedMessage) return;
        const message = (await hydrateMessagesForDisplay([normalizedMessage], currentUser?.id))[0] || normalizedMessage;
        setMessages((prev) => prev.map((item) => item.client_id === detail.client_id ? { ...item, ...message, pending: false, fxDirection: item.fxDirection || 'outgoing' } : item));
        upsertChatPreview(message.to_user_id, { lastMessage: message.preview_text || messagePreviewText(message), unread: 0, isPlaceholder: false });
        return;
      }
      if (type === 'message:new') {
        const message = data?.message;
        const conversationWith = String(data?.conversation_with || '');
        if (!message || !conversationWith) return;
        const outgoing = Boolean(data?.outgoing);
        let currentUnread = 0;
        setChats((prev) => {
          const existing = prev.find((chat) => String(chat.id) === conversationWith);
          currentUnread = Number(existing?.unread || 0);
          return prev;
        });
        appendOrReplaceMessage(message, {
          conversationWith,
          bumpUnread: !outgoing && String(selectedChatId || '') !== conversationWith,
          baseUnread: currentUnread,
          animate: !outgoing,
        });
        if (!outgoing) {
          recordChatIncoming(conversationWith, message.created_at || message.createdAt || Date.now());
          playMessageTone('receive');
        }
        if (!outgoing && String(selectedChatId || '') === conversationWith) {
          client.send('message:read', { conversation_with: Number(conversationWith) });
          setChats((prev) => prev.map((chat) => String(chat.id) === conversationWith ? { ...chat, unread: 0 } : chat));
          requestUnreadRefresh();
        }
        return;
      }
      if (type === 'message:read') {
        handleRefreshChats();
        return;
      }
      if (type === 'message:updated') {
        const updated = normalizeMessage(data?.message, currentUser?.id);
        if (!updated) return;
        const conversationWith = String(data?.conversation_with || '');
        void (async () => {
          const hydrated = (await hydrateMessagesForDisplay([updated], currentUser?.id))[0] || updated;
          if (conversationWith && String(selectedChatId || '') === conversationWith) {
            setMessages((prev) => prev.map((item) => String(item.id) === String(hydrated.id) ? { ...item, ...hydrated } : item));
          }
          handleRefreshChats();
        })();
        return;
      }
        if (type === 'message:deleted') {
          const messageId = String(data?.message_id || '');
          const conversationWith = String(data?.conversation_with || '');
          if (messageId && String(selectedChatId || '') === conversationWith) {
            setMessages((prev) => prev.filter((item) => String(item.id) !== messageId));
          }
        }
      }).catch((error) => {
        console.error('Ошибка call event:', error);
      });
    });

    return () => {
      unsubscribeStatus();
      unsubscribeEvents();
      client.disconnect();
    };
  }, [appendOrReplaceMessage, currentUser?.id, handleRefreshChats, handleSocketEvent, playMessageTone, selectedChatId, upsertChatPreview]);

  useEffect(() => {
    const onAppAction = (event) => {
      const action = event?.detail?.action;
      if (action === 'messages.refresh') {
        if (selectedChatId) {
          handleRefreshConversation();
        } else {
          handleRefreshChats();
        }
      }
      if (action === 'messages.focusSearch') {
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('app:action', onAppAction);
    return () => window.removeEventListener('app:action', onAppAction);
  }, [chatSocketConnected, handleRefreshChats, handleRefreshConversation, selectedChatId]);

  useEffect(() => {
    const onRealtimeEvent = (event) => {
      const detail = event?.detail || {};
      const conversationWith = String(detail?.data?.conversation_with || '');
      if (chatSocketConnected) return;
      if (detail.type === 'message:new') {
        handleRefreshChats();
        if (conversationWith && conversationWith === String(selectedChatId || '')) {
          shouldAutoScrollRef.current = true;
          handleRefreshConversation();
        }
      }
      if (detail.type === 'message:read') {
        handleRefreshChats();
      }
      if (detail.type === 'message:updated') {
        handleRefreshChats();
        if (conversationWith && conversationWith === String(selectedChatId || '')) {
          handleRefreshConversation();
        }
      }
    };

    window.addEventListener(REALTIME_BROWSER_EVENT, onRealtimeEvent);
    return () => window.removeEventListener(REALTIME_BROWSER_EVENT, onRealtimeEvent);
  }, [chatSocketConnected, handleRefreshChats, handleRefreshConversation, selectedChatId]);

  const chatsWithDrafts = useMemo(() => chats.map((chat) => {
    const draftValue = String(draftsByChat[String(chat.id)] || '').trim();
    return {
      ...chat,
      hasDraft: Boolean(draftValue),
      draftPreview: draftValue,
    };
  }), [chats, draftsByChat]);

  const chatStats = useMemo(() => ({
    total: chatsWithDrafts.length,
    unread: chatsWithDrafts.reduce((sum, chat) => sum + Number(chat.unread || 0), 0),
    online: chatsWithDrafts.filter((chat) => chat.online).length,
  }), [chatsWithDrafts]);

  const filteredChats = useMemo(() => {
    const value = chatQuery.trim().toLowerCase();
    return chatsWithDrafts.filter((chat) => {
      const matchesSearch = !value ||
        chat.name.toLowerCase().includes(value) ||
        (chat.username || '').toLowerCase().includes(value) ||
        (chat.lastMessage || '').toLowerCase().includes(value) ||
        (chat.draftPreview || '').toLowerCase().includes(value);
      if (!matchesSearch) return false;
      if (chatFilter === 'unread') return Number(chat.unread || 0) > 0;
      if (chatFilter === 'online') return chat.online;
      return true;
    });
  }, [chatFilter, chatQuery, chatsWithDrafts]);

  const conversationMatches = useMemo(() => {
    const query = conversationQuery.trim().toLowerCase();
    if (!query) return [];
    return messages
      .map((message) => ({ id: String(message.id), value: messageSearchText(message).toLowerCase() }))
      .filter((entry) => entry.value.includes(query));
  }, [conversationQuery, messages]);

  useEffect(() => {
    setActiveConversationMatchIndex((prev) => {
      if (!conversationMatches.length) return 0;
      return Math.min(prev, conversationMatches.length - 1);
    });
  }, [conversationMatches]);

  const activeConversationMatchId = conversationMatches[activeConversationMatchIndex]?.id || '';
  const timelineItems = useMemo(() => buildTimeline(messages), [messages]);

  const upsertChatPreview = useCallback((chatId, update) => {
    const nextId = String(chatId);
    setChats((prev) => {
      const index = prev.findIndex((chat) => String(chat.id) === nextId);
      if (index === -1) return prev;
      const current = prev[index];
      const updated = {
        ...current,
        ...update,
        id: nextId,
        unread: typeof update.unread === 'number' ? update.unread : current.unread,
      };
      return [updated, ...prev.filter((chat) => String(chat.id) !== nextId)];
    });
  }, []);

  const appendOrReplaceMessage = useCallback(async (rawMessage, options = {}) => {
    const normalizedRaw = normalizeMessage(rawMessage, currentUser?.id);
    if (!normalizedRaw) return;
    const normalized = (await hydrateMessagesForDisplay([normalizedRaw], currentUser?.id))[0] || normalizedRaw;
    const messageId = String(normalized.id);
    const selectedId = String(selectedChatId || '');
    const fromId = String(rawMessage?.from_user_id || rawMessage?.fromUserId || '');
    const toId = String(rawMessage?.to_user_id || rawMessage?.toUserID || '');
    const conversationId = options.conversationWith ? String(options.conversationWith) : (normalized.mine ? toId : fromId);

    upsertChatPreview(conversationId, {
      lastMessage: normalized.preview_text || messagePreviewText(normalized),
      unread: options.bumpUnread ? options.baseUnread + 1 : options.unread,
      online: options.online,
      lastSeen: options.lastSeen,
      isPlaceholder: false,
    });

    if (selectedId && selectedId === conversationId) {
      let appendedNewMessage = false;
      let nextMessageId = messageId;
      setMessages((prev) => {
        const withoutPending = normalized.pending || !options.clientId
          ? prev
          : prev.map((item) => item.client_id === options.clientId ? { ...item, ...normalized, pending: false, fxDirection: item.fxDirection || normalized.fxDirection || '' } : item);
        const existing = withoutPending.find((item) => String(item.id) === messageId);
        if (existing) {
          nextMessageId = String(existing.id);
          return withoutPending.map((item) => String(item.id) === messageId ? { ...item, ...normalized, pending: false, fxDirection: item.fxDirection || normalized.fxDirection || '' } : item);
        }
        appendedNewMessage = true;
        const withFx = options.animate ? { ...normalized, fxDirection: normalized.mine ? 'outgoing' : 'incoming' } : normalized;
        nextMessageId = String(withFx.id);
        return [...withoutPending, withFx].sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
      });
      if (options.animate && appendedNewMessage) {
        queueMessageFxClear(nextMessageId);
      }
      shouldAutoScrollRef.current = true;
    }
  }, [currentUser?.id, queueMessageFxClear, selectedChatId, upsertChatPreview]);

  const updateChatRelationship = (chatId, nextStatus) => {
    const patch = (chat) => String(chat.id) === String(chatId) ? { ...chat, friendship_status: nextStatus } : chat;
    setChats((prev) => prev.map(patch));
    setDraftChat((prev) => prev && String(prev.id) === String(chatId) ? { ...prev, friendship_status: nextStatus } : prev);
  };

  useEffect(() => () => {
    messageFxTimersRef.current.forEach((timer) => {
      window.clearTimeout?.(timer);
    });
    messageFxTimersRef.current.clear();
    if (feedbackAudioContextRef.current) {
      feedbackAudioContextRef.current.close?.().catch?.(() => {});
      feedbackAudioContextRef.current = null;
    }
  }, []);

  const selectedRelationship = selectedChat?.friendship_status || (selectedChat?.isSelf ? 'self' : 'none');

  const selectedChatProfilePath = selectedChat?.id ? `/profile/${selectedChat.id}` : '/friends';

  const handlePeerFriendAction = async () => {
    if (!selectedChat?.id || peerActionLoading) return;
    try {
      setPeerActionLoading(true);
      setChatError('');
      if (selectedRelationship === 'request_received') {
        await acceptFriendRequest(selectedChat.id);
        showToast('Заявка принята', { tone: 'success' });
        updateChatRelationship(selectedChat.id, 'friends');
        broadcastRelationshipUpdated({ userId: selectedChat.id, status: 'friends', previousStatus: selectedRelationship, request_sent: false, subscribed: false, user: selectedChat });
        requestUnreadRefresh();
        return;
      }
      if (selectedRelationship === 'friends') {
        const confirmed = await confirmAction({ title: 'Удалить из друзей', message: 'Пользователь будет удалён из вашего списка друзей.', confirmLabel: 'Удалить', tone: 'danger' });
        if (!confirmed) return;
        await unfriend(selectedChat.id);
        showToast('Пользователь удалён из друзей', { tone: 'success' });
        updateChatRelationship(selectedChat.id, 'none');
        broadcastRelationshipUpdated({ userId: selectedChat.id, status: 'none', previousStatus: selectedRelationship, request_sent: false, subscribed: false, user: selectedChat });
        return;
      }
      if (selectedRelationship === 'none' || selectedRelationship === 'subscribed') {
        await sendFriendRequest(selectedChat.id);
        showToast('Заявка отправлена', { tone: 'success' });
        updateChatRelationship(selectedChat.id, 'request_sent');
        broadcastRelationshipUpdated({ userId: selectedChat.id, status: 'request_sent', previousStatus: selectedRelationship, request_sent: true, subscribed: false, user: selectedChat });
        requestUnreadRefresh();
      }
    } catch (err) {
      console.error('Ошибка действия со связью в чате:', err);
      setChatError(getApiErrorMessage(err, 'Не удалось обновить статус связи'));
    } finally {
      setPeerActionLoading(false);
    }
  };

  const handlePeerSubscribeToggle = async () => {
    if (!selectedChat?.id || peerActionLoading) return;
    if (selectedRelationship === 'friends' || selectedRelationship === 'request_received' || selectedRelationship === 'request_sent' || selectedRelationship === 'self') return;
    try {
      setPeerActionLoading(true);
      setChatError('');
      if (selectedRelationship === 'subscribed') {
        await unsubscribe(selectedChat.id);
        showToast('Подписка отменена', { tone: 'success' });
        updateChatRelationship(selectedChat.id, 'none');
        broadcastRelationshipUpdated({ userId: selectedChat.id, status: 'none', previousStatus: selectedRelationship, request_sent: false, subscribed: false, user: selectedChat });
      } else {
        await subscribe(selectedChat.id);
        showToast('Подписка оформлена', { tone: 'success' });
        updateChatRelationship(selectedChat.id, 'subscribed');
        broadcastRelationshipUpdated({ userId: selectedChat.id, status: 'subscribed', previousStatus: selectedRelationship, request_sent: false, subscribed: true, user: selectedChat });
      }
    } catch (err) {
      console.error('Ошибка подписки в чате:', err);
      setChatError(getApiErrorMessage(err, 'Не удалось изменить подписку'));
    } finally {
      setPeerActionLoading(false);
    }
  };

  const handleConversationQueryChange = useCallback((event) => {
    setConversationQuery(event.target.value || '');
    setActiveConversationMatchIndex(0);
  }, []);

  const handleJumpConversationMatch = useCallback((direction) => {
    setActiveConversationMatchIndex((prev) => {
      if (!conversationMatches.length) return 0;
      const next = prev + direction;
      if (next < 0) return conversationMatches.length - 1;
      if (next >= conversationMatches.length) return 0;
      return next;
    });
  }, [conversationMatches.length]);

  const handleClearConversationSearch = useCallback(() => {
    setConversationQuery('');
    setActiveConversationMatchIndex(0);
  }, []);

  const handleMessageInputChange = useCallback((event) => {
    const value = event.target.value;
    setMessageInput(value);
    if (!selectedChatId) return;
    setDraftsByChat((prev) => ({ ...prev, [String(selectedChatId)]: value }));
  }, [selectedChatId]);

  const relationshipMeta = (() => {
    if (selectedChat?.isSelf || selectedRelationship === 'self') return { label: 'Это вы', cls: 'neutral' };
    if (selectedRelationship === 'friends') return { label: 'Друзья', cls: 'green' };
    if (selectedRelationship === 'request_sent') return { label: 'Заявка отправлена', cls: 'warning' };
    if (selectedRelationship === 'request_received') return { label: 'Ждёт подтверждения', cls: 'blue' };
    if (selectedRelationship === 'subscribed') return { label: 'Подписка', cls: 'accent' };
    return { label: 'Нет связи', cls: 'neutral' };
  })();

  const handleSelectChat = (chatId) => {
    const nextChatId = String(chatId);
    if (selectedChatId) {
      setDraftsByChat((prev) => ({ ...prev, [String(selectedChatId)]: messageInput }));
    }
    setSelectedChatId(nextChatId);
    setMessageError('');
    setMessageInput(draftsByChat[nextChatId] || '');
    navigate(`/messages/${nextChatId}`);
  };

  const queueMessageFxClear = useCallback((messageId, delay = 680) => {
    if (!messageId || typeof window === 'undefined') return;
    const key = String(messageId);
    const previous = messageFxTimersRef.current.get(key);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      messageFxTimersRef.current.delete(key);
      setMessages((prev) => prev.map((item) => String(item.id) === key ? { ...item, fxDirection: '' } : item));
    }, delay);
    messageFxTimersRef.current.set(key, timer);
  }, []);

  const playMessageTone = useCallback((kind = 'send') => {
    if (typeof window === 'undefined') return;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) return;
    const now = Date.now();
    const last = Number(feedbackToneAtRef.current?.[kind] || 0);
    if (now - last < 90) return;
    feedbackToneAtRef.current = { ...feedbackToneAtRef.current, [kind]: now };
    try {
      let ctx = feedbackAudioContextRef.current;
      if (!ctx || ctx.state === 'closed') {
        ctx = new AudioContextCtor();
        feedbackAudioContextRef.current = ctx;
      }
      if (ctx.state === 'suspended') {
        ctx.resume?.().catch?.(() => {});
      }
      const baseTime = ctx.currentTime + 0.01;
      const tones = kind === 'receive'
        ? [
            { frequency: 560, duration: 0.045, gain: 0.03, type: 'sine', offset: 0 },
            { frequency: 760, duration: 0.065, gain: 0.04, type: 'triangle', offset: 0.045 },
          ]
        : [
            { frequency: 720, duration: 0.04, gain: 0.03, type: 'triangle', offset: 0 },
            { frequency: 930, duration: 0.055, gain: 0.026, type: 'sine', offset: 0.038 },
          ];
      tones.forEach((tone) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = tone.type;
        osc.frequency.setValueAtTime(tone.frequency, baseTime + tone.offset);
        gain.gain.setValueAtTime(0.0001, baseTime + tone.offset);
        gain.gain.exponentialRampToValueAtTime(tone.gain, baseTime + tone.offset + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, baseTime + tone.offset + tone.duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(baseTime + tone.offset);
        osc.stop(baseTime + tone.offset + tone.duration + 0.018);
      });
    } catch {
      // ignore subtle audio feedback errors
    }
  }, []);

  const stopWaveformMonitoring = useCallback(() => {
    if (waveformFrameRef.current && typeof window !== 'undefined') {
      window.cancelAnimationFrame(waveformFrameRef.current);
      waveformFrameRef.current = null;
    }
    analyserRef.current = null;
    if (audioContextRef.current) {
      audioContextRef.current.close?.().catch?.(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const startWaveformMonitoring = useCallback((stream) => {
    if (typeof window === 'undefined' || !stream || typeof window.AudioContext === 'undefined') return;
    try {
      stopWaveformMonitoring();
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextCtor) return;
      const ctx = new AudioContextCtor();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      analyser.smoothingTimeConstant = 0.78;
      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      audioContextRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        const current = analyserRef.current;
        if (!current) return;
        current.getByteFrequencyData(data);
        const sample = [];
        const bucket = Math.max(1, Math.floor(data.length / 16));
        for (let index = 0; index < data.length; index += bucket) {
          let total = 0;
          let count = 0;
          for (let inner = index; inner < Math.min(data.length, index + bucket); inner += 1) {
            total += data[inner];
            count += 1;
          }
          sample.push(((total / Math.max(count, 1)) / 255));
        }
        setRecordingState((prev) => prev.active ? { ...prev, levels: normalizeLevels([...(prev.levels || []), ...sample]) } : prev);
        waveformFrameRef.current = window.requestAnimationFrame(loop);
      };
      waveformFrameRef.current = window.requestAnimationFrame(loop);
    } catch {
      // ignore waveform errors
    }
  }, [stopWaveformMonitoring]);

  const stopRecorderTracks = useCallback(() => {
    const stream = recorderStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      recorderStreamRef.current = null;
    }
    stopWaveformMonitoring();
  }, [stopWaveformMonitoring]);

  const markMessageAsFailed = useCallback((message, retryFactory, errorText) => {
    if (message?.retry_key && typeof retryFactory === 'function') {
      failedMediaPayloadsRef.current.set(message.retry_key, retryFactory);
    }
    setMessages((prev) => {
      const next = prev.filter((item) => String(item.id) !== String(message.id));
      next.push({ ...message, pending: false, failed: true });
      return next;
    });
    setMessageError(errorText);
  }, []);

  const revokeFailedPreviewURLs = useCallback((retryKey) => {
    const current = failedMediaPreviewURLsRef.current.get(String(retryKey || ''));
    if (!current) return;
    if (current.objectUrl) URL.revokeObjectURL(current.objectUrl);
    if (current.posterUrl && current.posterUrl !== current.objectUrl) URL.revokeObjectURL(current.posterUrl);
    failedMediaPreviewURLsRef.current.delete(String(retryKey || ''));
  }, []);

  const buildRetryActionFromDraft = useCallback((draft) => async () => {
    const stored = draft || await getFailedMessageMediaDraft(draft?.retryKey || draft?.retry_key);
    if (!stored?.blob) throw new Error('Черновик медиа больше недоступен');
    const kind = normalizeMessageType(stored.kind);
    setRecordingState({ active: false, kind: '', durationSec: 0, uploading: true, uploadProgress: 0, levels: normalizeLevels([]) });
    try {
      const blob = stored.blob;
      const ext = extensionFromMime(stored.mime, kind);
      const file = new File([blob], `${kind}-${Date.now()}.${ext}`, { type: stored.mime || blob.type || (kind === 'voice' ? 'audio/webm' : 'video/webm') });
      const meta = kind === 'video_note' ? await getBlobVideoMetadata(blob) : { width: 0, height: 0 };
      const posterBlob = stored.posterBlob || (kind === 'video_note' ? await generateVideoPosterBlob(blob) : null);
      let mediaPayload;
      const e2eeForChat = await canEncryptDirectMessages({ currentUser, toUserId: selectedChatId });
      if (e2eeForChat) {
        mediaPayload = await uploadEncryptedMessageMedia({
          kind,
          blob,
          posterBlob: posterBlob || null,
          meta: { mime: stored.mime || blob.type || file.type, durationSec: stored.durationSec || 0, width: meta.width || 0, height: meta.height || 0 },
        });
      } else {
        let uploadRes;
        if (posterBlob && kind === 'video_note') {
          const form = new FormData();
          form.append('file', file);
          form.append('kind', kind);
          form.append('duration_sec', String(stored.durationSec || 0));
          form.append('width', String(meta.width || 0));
          form.append('height', String(meta.height || 0));
          form.append('thumb', new File([posterBlob], `poster-${Date.now()}.jpg`, { type: 'image/jpeg' }));
          uploadRes = await API.post('/media/upload-message', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
        } else {
          uploadRes = await uploadMessageMedia(file, kind, { durationSec: stored.durationSec || 0, width: meta.width || 0, height: meta.height || 0 });
        }
        mediaPayload = uploadRes.data?.asset || null;
      }
      if (!mediaPayload?.url) throw new Error('Не удалось сохранить медиа');
      await dispatchPayloadMessage({ type: kind, content: '', media: mediaPayload }, { successToast: kind === 'voice' ? 'Голосовое сообщение отправлено' : 'Видеокружок отправлен' });
      await removeFailedMessageMediaDraft(stored.retryKey);
      revokeFailedPreviewURLs(stored.retryKey);
      setMessages((prev) => prev.filter((item) => String(item.retry_key || '') !== String(stored.retryKey)));
      failedMediaPayloadsRef.current.delete(stored.retryKey);
    } finally {
      setRecordingState({ active: false, kind: '', durationSec: 0, uploading: false, uploadProgress: 0, levels: normalizeLevels([]) });
    }
  }, [currentUser, dispatchPayloadMessage, revokeFailedPreviewURLs, selectedChatId]);

  const dispatchPayloadMessage = useCallback(async (payload, options = {}) => {
    if (!selectedChatId || sending) return false;
    const optimisticId = `tmp-${Date.now()}`;
    const optimisticMessage = normalizeMessage({
      id: optimisticId,
      type: payload?.type || 'text',
      content: payload?.content || '',
      media: payload?.media || null,
      created_at: new Date().toISOString(),
      from_user_id: currentUser?.id,
      to_user_id: selectedChatId,
      pending: true,
      client_id: optimisticId,
      fxDirection: 'outgoing',
    }, currentUser?.id);

    setSending(true);
    setMessageError('');
    shouldAutoScrollRef.current = true;
    setMessages((prev) => [...prev, optimisticMessage]);
    queueMessageFxClear(optimisticId);
    playMessageTone('send');
    if ((payload?.type || 'text') === 'text') {
      setMessageInput('');
      setDraftsByChat((prev) => ({ ...prev, [String(selectedChatId)]: '' }));
    }

    try {
      let preparedPayload = payload;
      let e2eeActive = false;
      const encrypted = await encryptDirectMessagePayload({
        currentUser,
        toUserId: selectedChatId,
        payload,
        clientMessageId: optimisticId,
      });
      preparedPayload = encrypted?.payload || payload;
      e2eeActive = Boolean(encrypted?.e2ee);

      const socketClient = chatSocketClientRef.current;
      const sentViaSocket = !e2eeActive && socketClient?.isConnected?.()
        ? socketClient.send('message:send', { to_user_id: Number(selectedChatId), ...(preparedPayload || {}) }, optimisticId)
        : false;

      if (!sentViaSocket) {
        const res = await sendMessage(selectedChatId, preparedPayload);
        const message = res.data?.data || res.data?.message_data || res.data;
        const messageObjectRaw = normalizeMessage(
          message && typeof message === 'object'
            ? message
            : {
                id: optimisticId,
                ...(preparedPayload || {}),
                created_at: new Date().toISOString(),
                from_user_id: currentUser?.id,
                to_user_id: selectedChatId,
              },
          currentUser?.id,
        );
        const messageObject = (await hydrateMessagesForDisplay([messageObjectRaw], currentUser?.id))[0] || messageObjectRaw;
        setMessages((prev) => prev.map((item) => item.id === optimisticId ? { ...item, ...messageObject, pending: false, fxDirection: item.fxDirection || 'outgoing' } : item));
      }

      setChats((prev) => {
        const exists = prev.some((chat) => String(chat.id) === String(selectedChatId));
        const nextChat = {
          ...(selectedChat || {}),
          id: String(selectedChatId),
          lastMessage: optimisticMessage.preview_text || messagePreviewText(optimisticMessage),
          unread: 0,
          isPlaceholder: false,
        };
        if (!exists) return [nextChat, ...prev];
        return [nextChat, ...prev.filter((chat) => String(chat.id) !== String(selectedChatId))];
      });
      setDraftChat(null);
      requestUnreadRefresh();
      if (options?.successToast) {
        showToast(options.successToast, { tone: 'success' });
      }
      return true;
    } catch (err) {
      console.error('Ошибка отправки:', err);
      setMessages((prev) => prev.filter((item) => item.id !== optimisticId));
      if ((payload?.type || 'text') === 'text') {
        const draftBack = String(payload?.content || '');
        setMessageInput(draftBack);
        setDraftsByChat((prev) => ({ ...prev, [String(selectedChatId)]: draftBack }));
      }
      const nextError = getApiErrorMessage(err, 'Не удалось отправить сообщение');
      setMessageError(nextError);
      if (String(nextError).includes('Ключи собеседника изменились') || String(err?.message || '').includes('Ключи собеседника изменились')) {
        setSecurityModalOpen(true);
        if (selectedChatId) {
          void loadConversationSecurity(selectedChatId, { force: true });
        }
      }
      return false;
    } finally {
      setSending(false);
    }
  }, [currentUser, loadConversationSecurity, playMessageTone, queueMessageFxClear, selectedChat, selectedChatId, sending]);

  const stopRecording = useCallback((shouldSend = true) => {
    recorderShouldSendRef.current = shouldSend;
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop();
      return;
    }
    if (!shouldSend) {
      if (recordingTimerRef.current) {
        window.clearInterval(recordingTimerRef.current);
        recordingTimerRef.current = null;
      }
      stopRecorderTracks();
      setRecordingState({ active: false, kind: '', durationSec: 0, uploading: false, uploadProgress: 0, levels: normalizeLevels([]) });
    }
  }, [stopRecorderTracks]);

  const startRecording = useCallback(async (kind) => {
    if (!selectedChatId || sending || recordingState.uploading) return;
    if (recordingState.active) {
      if (recordingState.kind === kind) {
        stopRecording(true);
      }
      return;
    }
    if (typeof window === 'undefined' || !window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      setMessageError('Устройство не поддерживает запись медиа');
      return;
    }

    try {
      setMessageError('');
      const constraints = kind === 'video_note'
        ? {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: { width: { ideal: 480, max: 720 }, height: { ideal: 480, max: 720 }, frameRate: { ideal: 24, max: 30 }, facingMode: 'user' },
          }
        : { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      const mimeType = pickSupportedRecorderMime(kind);
      const options = {};
      if (mimeType) options.mimeType = mimeType;
      if (kind === 'video_note') {
        options.audioBitsPerSecond = 64000;
        options.videoBitsPerSecond = 450000;
      } else {
        options.audioBitsPerSecond = 32000;
      }
      startWaveformMonitoring(stream);
      const recorder = new window.MediaRecorder(stream, options);
      recorderChunksRef.current = [];
      recorderRef.current = recorder;
      recorderStreamRef.current = stream;
      recorderShouldSendRef.current = true;
      recordingMetaRef.current = { kind, durationSec: 0 };

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) recorderChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        if (recordingTimerRef.current) {
          window.clearInterval(recordingTimerRef.current);
          recordingTimerRef.current = null;
        }
        const durationSec = Math.max(1, recordingMetaRef.current.durationSec || 0);
        const shouldSend = recorderShouldSendRef.current;
        const activeKind = recordingMetaRef.current.kind || kind;
        const chunks = [...recorderChunksRef.current];
        recorderChunksRef.current = [];
        recorderRef.current = null;
        stopRecorderTracks();
        setRecordingState((prev) => ({ ...prev, active: false, kind: '', durationSec: 0 }));
        if (!shouldSend || chunks.length === 0) {
          setRecordingState((prev) => ({ ...prev, uploading: false }));
          return;
        }
        setRecordingState({ active: false, kind: '', durationSec: 0, uploading: true, uploadProgress: 0, levels: normalizeLevels([]) });
        const mime = recorder.mimeType || (activeKind === 'video_note' ? 'video/webm' : 'audio/webm');
        const blob = new Blob(chunks, { type: mime });
        const retryKey = `${activeKind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const objectUrl = URL.createObjectURL(blob);
        try {
          const meta = activeKind === 'video_note' ? await getBlobVideoMetadata(blob) : { width: 0, height: 0 };
          const posterBlob = activeKind === 'video_note' ? await generateVideoPosterBlob(blob) : null;
          const ext = extensionFromMime(mime, activeKind);
          const file = new File([blob], `${activeKind}-${Date.now()}.${ext}`, { type: mime });
          const uploadAndSend = async () => {
            let uploadRes;
            const progressHandler = (event) => {
              const total = Number(event?.total || 0);
              const loaded = Number(event?.loaded || 0);
              const ratio = total > 0 ? Math.min(100, Math.round((loaded / total) * 100)) : 0;
              setRecordingState((prev) => prev.uploading ? { ...prev, uploadProgress: ratio } : prev);
            };
            if (posterBlob && activeKind === 'video_note') {
              const form = new FormData();
              form.append('file', file);
              form.append('kind', activeKind);
              form.append('duration_sec', String(durationSec));
              form.append('width', String(meta.width || 0));
              form.append('height', String(meta.height || 0));
              form.append('thumb', new File([posterBlob], `poster-${Date.now()}.jpg`, { type: 'image/jpeg' }));
              uploadRes = await API.post('/media/upload-message', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000, onUploadProgress: progressHandler });
            } else {
              uploadRes = await uploadMessageMedia(file, activeKind, { durationSec, width: meta.width || 0, height: meta.height || 0 }, { onUploadProgress: progressHandler });
            }
            const mediaPayload = uploadRes.data?.asset || null;
            if (!mediaPayload?.url) throw new Error('Не удалось сохранить медиа');
            const success = await dispatchPayloadMessage({ type: activeKind, content: '', media: mediaPayload }, { successToast: activeKind === 'voice' ? 'Голосовое сообщение отправлено' : 'Видеокружок отправлен' });
            if (!success) throw new Error(activeKind === 'voice' ? 'Не удалось отправить голосовое сообщение' : 'Не удалось отправить видеокружок');
          };
          await uploadAndSend();
          failedMediaPayloadsRef.current.delete(retryKey);
          await removeFailedMessageMediaDraft(retryKey);
          revokeFailedPreviewURLs(retryKey);
          URL.revokeObjectURL(objectUrl);
        } catch (err) {
          console.error('Ошибка записи/загрузки медиа:', err);
          const fallbackMessage = activeKind === 'voice' ? 'Не удалось отправить голосовое сообщение' : 'Не удалось отправить видеокружок';
          const posterBlob = activeKind === 'video_note' ? await generateVideoPosterBlob(blob) : null;
          const posterUrl = posterBlob ? URL.createObjectURL(posterBlob) : '';
          failedMediaPreviewURLsRef.current.set(retryKey, { objectUrl, posterUrl });
          const draft = { retryKey, chatId: selectedChatId, kind: activeKind, mime, durationSec, createdAt: Date.now(), blob, posterBlob };
          await saveFailedMessageMediaDraft(draft);
          const failedMessage = buildFailedMediaMessageFromDraft(draft, currentUser?.id, objectUrl, posterUrl);
          const retryAction = buildRetryActionFromDraft(draft);
          failedMediaPayloadsRef.current.set(retryKey, retryAction);
          markMessageAsFailed(failedMessage, retryAction, getApiErrorMessage(err, fallbackMessage));
        } finally {
          setRecordingState({ active: false, kind: '', durationSec: 0, uploading: false, uploadProgress: 0, levels: normalizeLevels([]) });
        }
      };

      recorder.start(250);
      if (recordingTimerRef.current) window.clearInterval(recordingTimerRef.current);
      setRecordingState({ active: true, kind, durationSec: 0, uploading: false, uploadProgress: 0, levels: normalizeLevels([]) });
      recordingTimerRef.current = window.setInterval(() => {
        const nextDuration = (recordingMetaRef.current.durationSec || 0) + 1;
        recordingMetaRef.current = { ...recordingMetaRef.current, durationSec: nextDuration };
        const maxDuration = maxDurationForKind(kind);
        setRecordingState((prev) => prev.active ? { ...prev, durationSec: nextDuration } : prev);
        if (nextDuration >= maxDuration) {
          stopRecording(true);
          showToast(kind === 'voice' ? `Голосовое ограничено ${maxDuration} сек.` : `Видеокружок ограничен ${maxDuration} сек.`, { tone: 'warning' });
        }
      }, 1000);
    } catch (err) {
      console.error('Ошибка запуска записи:', err);
      stopRecorderTracks();
      setRecordingState({ active: false, kind: '', durationSec: 0, uploading: false, uploadProgress: 0, levels: normalizeLevels([]) });
      setMessageError(getApiErrorMessage(err, kind === 'voice' ? 'Не удалось получить доступ к микрофону' : 'Не удалось получить доступ к камере или микрофону'));
    }
  }, [buildRetryActionFromDraft, currentUser?.id, dispatchPayloadMessage, markMessageAsFailed, recordingState.active, recordingState.kind, recordingState.uploading, revokeFailedPreviewURLs, selectedChatId, sending, startWaveformMonitoring, stopRecorderTracks, stopRecording]);

  const handleStartVoiceRecording = useCallback(() => { void startRecording('voice'); }, [startRecording]);
  const handleStartVideoRecording = useCallback(() => { void startRecording('video_note'); }, [startRecording]);
  const handleCancelRecording = useCallback(() => { stopRecording(false); }, [stopRecording]);
  const handleStopRecording = useCallback(() => { stopRecording(true); }, [stopRecording]);

  const handleRetryFailedMessage = useCallback(async (message) => {
    const retryKey = String(message?.retry_key || '');
    if (!retryKey) return;
    let retryFactory = failedMediaPayloadsRef.current.get(retryKey);
    if (!retryFactory) {
      const stored = await getFailedMessageMediaDraft(retryKey);
      if (stored) {
        retryFactory = buildRetryActionFromDraft(stored);
        failedMediaPayloadsRef.current.set(retryKey, retryFactory);
      }
    }
    if (!retryFactory) {
      setMessageError('Нечего повторно отправлять: временные данные уже недоступны');
      return;
    }
    setMessages((prev) => prev.filter((item) => item.id !== message.id));
    try {
      await retryFactory();
      failedMediaPayloadsRef.current.delete(retryKey);
    } catch (err) {
      console.error('Ошибка повторной отправки медиа:', err);
      const stored = await getFailedMessageMediaDraft(retryKey);
      if (stored) {
        const existingUrls = failedMediaPreviewURLsRef.current.get(retryKey) || {};
        const objectUrl = existingUrls.objectUrl || URL.createObjectURL(stored.blob);
        const posterUrl = existingUrls.posterUrl || (stored.posterBlob ? URL.createObjectURL(stored.posterBlob) : '');
        failedMediaPreviewURLsRef.current.set(retryKey, { objectUrl, posterUrl });
        setMessages((prev) => [...prev, buildFailedMediaMessageFromDraft(stored, currentUser?.id, objectUrl, posterUrl)]);
      }
      setMessageError(getApiErrorMessage(err, 'Не удалось повторно отправить медиа'));
    }
  }, [buildRetryActionFromDraft, currentUser?.id]);

  const handleStartEdit = useCallback((message) => {
    if (!message || message.pending || message.failed) return;
    setEditingMessage(message);
    setMessageInput(String(message.content || message.text || ''));
    window.requestAnimationFrame(() => messageInputRef.current?.focus());
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setMessageInput('');
  }, []);

  const handleOpenForward = useCallback((message) => {
    if (!message || message.pending) return;
    setForwardingMessage(message);
  }, []);

  const handleCloseForward = useCallback(() => {
    if (forwarding) return;
    setForwardingMessage(null);
  }, [forwarding]);

  const handleForwardToChat = useCallback(async (targetChatId) => {
    const payload = buildForwardPayloadFromMessage(forwardingMessage);
    if (!targetChatId || !payload) return;
    try {
      setForwarding(true);
      let preparedPayload = payload;
      const encrypted = await encryptDirectMessagePayload({ currentUser, toUserId: targetChatId, payload, clientMessageId: `forward-${Date.now().toString(36)}` });
      preparedPayload = encrypted?.payload || payload;
      await sendMessage(targetChatId, preparedPayload);
      showToast('Сообщение переслано', { tone: 'success' });
      setForwardingMessage(null);
      handleRefreshChats();
    } catch (err) {
      setMessageError(getApiErrorMessage(err, 'Не удалось переслать сообщение'));
    } finally {
      setForwarding(false);
    }
  }, [currentUser, forwardingMessage, handleRefreshChats]);

  const handleJumpToMessage = useCallback((messageId) => {
    setMediaGalleryOpen(false);
    window.requestAnimationFrame(() => {
      const target = messageStackRef.current?.querySelector?.(`[data-message-id="${messageId}"]`);
      if (target?.scrollIntoView) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, []);

  const handleSend = async () => {
    if (!selectedChatId || !messageInput.trim() || sending) return;
    const draft = messageInput.trim();
    if (editingMessage?.id) {
      try {
        setSending(true);
        setMessageError('');
        let payload = { type: 'text', content: draft };
        if (editingMessage.is_encrypted || editingMessage.isEncrypted) {
          const encrypted = await encryptDirectMessagePayload({ currentUser, toUserId: selectedChatId, payload, clientMessageId: `edit-${editingMessage.id}-${Date.now().toString(36)}` });
          payload = encrypted?.payload || payload;
        }
        const res = await updateMessage(editingMessage.id, payload);
        const message = res.data?.data || res.data?.message_data || res.data;
        const normalized = normalizeMessage(message && typeof message === 'object' ? message : { ...editingMessage, content: draft, edited_at: new Date().toISOString() }, currentUser?.id);
        const hydrated = (await hydrateMessagesForDisplay([normalized], currentUser?.id))[0] || normalized;
        setMessages((prev) => prev.map((item) => String(item.id) === String(editingMessage.id) ? { ...item, ...hydrated } : item));
        handleRefreshChats();
        setEditingMessage(null);
        setMessageInput('');
        setDraftsByChat((prev) => ({ ...prev, [String(selectedChatId)]: '' }));
        showToast('Сообщение обновлено', { tone: 'success' });
        return;
      } catch (err) {
        setMessageError(getApiErrorMessage(err, 'Не удалось обновить сообщение'));
        return;
      } finally {
        setSending(false);
      }
    }
    recordChatReply(selectedChatId);
    await dispatchPayloadMessage({ type: 'text', content: draft });
  };

  const handleDelete = async (messageId) => {
    const confirmed = await confirmAction({ title: 'Удалить сообщение', message: 'Сообщение исчезнет только из этого чата.', confirmLabel: 'Удалить', tone: 'danger' });
    if (!confirmed) return;
    try {
      setDeletingId(messageId);
      await deleteMessage(messageId);
      if (String(editingMessage?.id || '') === String(messageId)) { setEditingMessage(null); setMessageInput(''); }
      setMessages((prev) => prev.filter((item) => item.id !== messageId));
      handleRefreshChats();
      setMessageError('');
      showToast('Сообщение удалено', { tone: 'success' });
    } catch (err) {
      console.error('Ошибка удаления:', err);
      setMessageError(getApiErrorMessage(err, 'Не удалось удалить сообщение'));
    } finally {
      setDeletingId(null);
    }
  };

  useEffect(() => {
    loadStories();
    loadStoryCommunities();
  }, [loadStories, loadStoryCommunities]);

  const mediaGalleryItems = useMemo(() => messages.filter((item) => item?.media?.url && (normalizeMessageType(item.type) === 'voice' || normalizeMessageType(item.type) === 'video_note')).map((item) => ({ id: item.id, type: normalizeMessageType(item.type), content: item.content || '', created_at: item.created_at, mine: Boolean(item.mine), media: item.media })), [messages]);

  return (
    <div className="pa-message-layout pa-messages-redesign">
      <MessagesSidebarBlock
        navigate={navigate}
        chatStats={chatStats}
        chatQuery={chatQuery}
        setChatQuery={setChatQuery}
        searchInputRef={searchInputRef}
        chatFilter={chatFilter}
        setChatFilter={setChatFilter}
        chatFilters={CHAT_FILTERS}
        handleRefreshChats={handleRefreshChats}
        chatError={chatError}
        loadingChats={loadingChats}
        chats={chats}
        filteredChats={filteredChats}
        selectedChatId={selectedChatId}
        handleSelectChat={handleSelectChat}
        stories={stories}
        storiesLoading={storiesLoading}
        onOpenCreateStory={() => setStoryComposerOpen(true)}
        onOpenStory={openStoryViewer}
      />

      <MessagesStoriesComposerModal
        open={storyComposerOpen}
        onClose={() => setStoryComposerOpen(false)}
        onSubmit={handleSubmitStory}
        submitting={storyCreating}
        draft={storyDraft}
        setDraft={setStoryDraft}
        durationOptions={storyDurationOptions}
        chats={chats}
        communities={storyCommunities}
      />

      <MessagesStoriesViewerModal
        open={Boolean(storyViewerStory)}
        onClose={() => { setStoryViewerStory(null); setStoryReplies([]); setStoryReplyInput(''); }}
        story={storyViewerStory}
        replies={storyReplies}
        replyInput={storyReplyInput}
        setReplyInput={setStoryReplyInput}
        onReply={handleSendStoryReply}
        replying={storyReplySending}
        durationOptions={storyDurationOptions}
        onExtend={handleExtendStory}
        extending={storyActionLoading === 'extend'}
        onDelete={handleDeleteStory}
        deleting={storyActionLoading === 'delete'}
        canDelete={Boolean(storyViewerStory && String(storyViewerStory.user_id) === String(currentUser?.id))}
        canExtend={Boolean(storyViewerStory && String(storyViewerStory.user_id) === String(currentUser?.id))}
      />

      <MessagesConversationBlock
        navigate={navigate}
        selectedChat={selectedChat}
        relationshipMeta={relationshipMeta}
        selectedRelationship={selectedRelationship}
        selectedChatProfilePath={selectedChatProfilePath}
        handleRefreshConversation={handleRefreshConversation}
        handlePeerFriendAction={handlePeerFriendAction}
        handlePeerSubscribeToggle={handlePeerSubscribeToggle}
        peerActionLoading={peerActionLoading}
        messageError={messageError}
        loadingMessages={loadingMessages}
        loadingOlderMessages={loadingOlderMessages}
        messages={messages}
        timelineItems={timelineItems}
        messageStackRef={messageStackRef}
        messageInputRef={messageInputRef}
        handleDelete={handleDelete}
        handleRetryFailedMessage={handleRetryFailedMessage}
        deletingId={deletingId}
        messageInput={messageInput}
        editingMessage={editingMessage}
        handleMessageInputChange={handleMessageInputChange}
        handleSend={handleSend}
        handleStartEdit={handleStartEdit}
        handleCancelEdit={handleCancelEdit}
        handleOpenForward={handleOpenForward}
        sending={sending}
        recordingState={recordingState}
        recordingPreviewRef={recordingPreviewRef}
        handleStartVoiceRecording={handleStartVoiceRecording}
        handleStartVideoRecording={handleStartVideoRecording}
        handleStopRecording={handleStopRecording}
        handleCancelRecording={handleCancelRecording}
        handleRefreshChats={handleRefreshChats}
        handleLoadOlderMessages={handleLoadOlderMessages}
        messagesHasMore={messagesHasMore}
        conversationQuery={conversationQuery}
        handleConversationQueryChange={handleConversationQueryChange}
        conversationMatchesCount={conversationMatches.length}
        activeConversationMatchIndex={activeConversationMatchIndex}
        activeConversationMatchId={activeConversationMatchId}
        handleJumpConversationMatch={handleJumpConversationMatch}
        handleClearConversationSearch={handleClearConversationSearch}
        callState={callState}
        isCallAvailable={isCallAvailable}
        startAudioCall={startAudioCall}
        startVideoCall={startVideoCall}
        acceptIncomingCall={acceptIncomingCall}
        declineCall={declineCall}
        endCall={endCall}
        toggleMute={toggleMute}
        toggleCamera={toggleCamera}
        toggleRemoteAudio={toggleRemoteAudio}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        remoteAudioRef={remoteAudioRef}
        securitySummary={securitySummary}
        securityLoading={securityLoading}
        mediaGalleryItems={mediaGalleryItems}
        mediaGalleryOpen={mediaGalleryOpen}
        handleOpenMediaGallery={() => setMediaGalleryOpen(true)}
        handleCloseMediaGallery={() => setMediaGalleryOpen(false)}
        handleJumpToMessage={handleJumpToMessage}
        forwardingMessage={forwardingMessage}
        forwarding={forwarding}
        chatsForForward={filteredChats.length ? filteredChats : chats}
        handleForwardToChat={handleForwardToChat}
        handleCloseForward={handleCloseForward}
        securityModalOpen={securityModalOpen}
        securityActionLoading={securityActionLoading}
        handleOpenSecurityPanel={handleOpenSecurityPanel}
        handleCloseSecurityPanel={handleCloseSecurityPanel}
        handleSecurityAction={handleSecurityAction}
      />
    </div>
  );
}
