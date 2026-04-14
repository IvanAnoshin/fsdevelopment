import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCallConfig, showToast } from '../../services/api';
import {
  RUNTIME_WEBRTC_BUNDLE_POLICY,
  RUNTIME_WEBRTC_ICE_CANDIDATE_POOL_SIZE,
  RUNTIME_WEBRTC_ICE_SERVERS_JSON,
  RUNTIME_WEBRTC_ICE_TRANSPORT_POLICY,
  RUNTIME_WEBRTC_RTCP_MUX_POLICY,
} from '../../services/runtimeConfig.js';

const OUTGOING_RING_TIMEOUT_MS = 35_000;
const CONNECT_TIMEOUT_MS = 25_000;
const DISCONNECT_GRACE_MS = 8_000;
const SIGNALING_GRACE_MS = 10_000;
const MAX_ICE_RESTARTS = 2;
const RUNTIME_WEBRTC_CONFIG_TTL_MS = 5 * 60 * 1000;


let runtimeWebRTCConfigCache = null;
let runtimeWebRTCConfigFetchedAt = 0;
let runtimeWebRTCConfigPromise = null;

const DEFAULT_STATE = {
  open: false,
  status: 'idle',
  direction: null,
  kind: 'audio',
  sessionId: '',
  peerId: null,
  peerName: '',
  peerUsername: '',
  peerAvatar: '',
  muted: false,
  cameraEnabled: true,
  speakerEnabled: true,
  peerAudioEnabled: true,
  peerVideoEnabled: true,
  localReady: false,
  remoteReady: false,
  remoteVideoReady: false,
  connectedAt: '',
  durationLabel: '',
  error: '',
};

function normalizePeer(peer = {}) {
  return {
    peerId: peer?.id || null,
    peerName: peer?.name || '',
    peerUsername: peer?.username || '',
    peerAvatar: peer?.avatar || '',
  };
}

function normalizeIceServer(entry) {
  if (!entry) return null;
  if (typeof entry === 'string') return { urls: [entry] };
  if (Array.isArray(entry)) return entry.length ? { urls: entry } : null;
  if (typeof entry === 'object') {
    const urls = Array.isArray(entry.urls) ? entry.urls : typeof entry.urls === 'string' ? [entry.urls] : [];
    if (!urls.length) return null;
    return {
      urls,
      ...(entry.username ? { username: entry.username } : {}),
      ...(entry.credential ? { credential: entry.credential } : {}),
    };
  }
  return null;
}

function normalizeIceTransportPolicy(value, fallback = 'all') {
  const next = String(value || '').trim().toLowerCase();
  return next === 'relay' ? 'relay' : fallback;
}

function normalizeBundlePolicy(value, fallback = 'max-bundle') {
  const next = String(value || '').trim().toLowerCase();
  return ['balanced', 'max-compat', 'max-bundle'].includes(next) ? next : fallback;
}

function normalizeRTCPMuxPolicy(value, fallback = 'require') {
  const next = String(value || '').trim().toLowerCase();
  return next === 'require' ? next : fallback;
}

function normalizeIceCandidatePoolSize(value, fallback = 6) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const next = Math.max(0, Math.min(10, Math.floor(numeric)));
  return next;
}

function buildEnvWebRTCConfig() {
  const raw = String(RUNTIME_WEBRTC_ICE_SERVERS_JSON || '').trim();
  let iceServers = [];
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      const normalized = (Array.isArray(parsed) ? parsed : [parsed]).map(normalizeIceServer).filter(Boolean);
      if (normalized.length) iceServers = normalized;
    } catch {
      iceServers = [];
    }
  }

  return {
    iceServers,
    iceTransportPolicy: normalizeIceTransportPolicy(RUNTIME_WEBRTC_ICE_TRANSPORT_POLICY, 'all'),
    bundlePolicy: normalizeBundlePolicy(RUNTIME_WEBRTC_BUNDLE_POLICY, 'max-bundle'),
    rtcpMuxPolicy: normalizeRTCPMuxPolicy(RUNTIME_WEBRTC_RTCP_MUX_POLICY, 'require'),
    iceCandidatePoolSize: normalizeIceCandidatePoolSize(RUNTIME_WEBRTC_ICE_CANDIDATE_POOL_SIZE, 6),
  };
}

function normalizeRuntimeRTCConfiguration(payload = {}) {
  const iceServers = (Array.isArray(payload?.ice_servers) ? payload.ice_servers : [])
    .map(normalizeIceServer)
    .filter(Boolean);

  return {
    iceServers: iceServers.length ? iceServers : buildEnvWebRTCConfig().iceServers,
    iceTransportPolicy: normalizeIceTransportPolicy(payload?.ice_transport_policy, 'all'),
    bundlePolicy: normalizeBundlePolicy(payload?.bundle_policy, 'max-bundle'),
    rtcpMuxPolicy: normalizeRTCPMuxPolicy(payload?.rtcp_mux_policy, 'require'),
    iceCandidatePoolSize: normalizeIceCandidatePoolSize(payload?.ice_candidate_pool_size, 6),
    turnEnabled: Boolean(payload?.turn_enabled),
    turnMode: String(payload?.turn_mode || '').trim(),
    configWarning: String(payload?.config_warning || '').trim(),
  };
}

async function loadWebRTCConfiguration() {
  const now = Date.now();
  if (runtimeWebRTCConfigCache && now - runtimeWebRTCConfigFetchedAt < RUNTIME_WEBRTC_CONFIG_TTL_MS) {
    return runtimeWebRTCConfigCache;
  }
  if (runtimeWebRTCConfigPromise) return runtimeWebRTCConfigPromise;

  runtimeWebRTCConfigPromise = getCallConfig()
    .then((response) => {
      const normalized = normalizeRuntimeRTCConfiguration(response?.data || {});
      runtimeWebRTCConfigCache = normalized;
      runtimeWebRTCConfigFetchedAt = Date.now();
      return normalized;
    })
    .catch(() => ({ ...buildEnvWebRTCConfig(), configWarning: 'Не удалось получить серверную конфигурацию WebRTC' }))
    .finally(() => {
      runtimeWebRTCConfigPromise = null;
    });

  return runtimeWebRTCConfigPromise;
}

function safeSessionDescription(description) {
  if (!description) return null;
  try {
    return new RTCSessionDescription(description);
  } catch {
    return description;
  }
}

function safeIceCandidate(candidate) {
  if (!candidate) return null;
  try {
    return new RTCIceCandidate(candidate);
  } catch {
    return candidate;
  }
}

function formatDuration(from) {
  if (!from) return '';
  const startedAt = new Date(from).getTime();
  if (Number.isNaN(startedAt)) return '';
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseMediaError(error, kind) {
  const name = String(error?.name || '').trim();
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return kind === 'video'
      ? 'Нужен доступ к камере и микрофону для видеозвонка'
      : 'Нужен доступ к микрофону для аудиозвонка';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return kind === 'video' ? 'Камера или микрофон не найдены на устройстве' : 'Микрофон не найден на устройстве';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Устройство уже используется другим приложением';
  }
  if (name === 'OverconstrainedError') {
    return 'Устройство не поддерживает запрошенные параметры звонка';
  }
  return kind === 'video' ? 'Не удалось подготовить видеозвонок' : 'Не удалось подготовить аудиозвонок';
}

export function useDirectCallController({ chatSocketClientRef, selectedChat }) {
  const getSocketClient = useCallback(() => chatSocketClientRef?.current || null, [chatSocketClientRef]);
  const [callState, setCallState] = useState(DEFAULT_STATE);

  const peerConnectionRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const pendingOfferRef = useRef(null);
  const pendingCandidatesRef = useRef([]);
  const currentCallRef = useRef(DEFAULT_STATE);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const remoteAudioRef = useRef(null);
  const endingRef = useRef(false);
  const politeRef = useRef(false);
  const makingOfferRef = useRef(false);
  const ignoreOfferRef = useRef(false);
  const isSettingRemoteAnswerPendingRef = useRef(false);
  const iceRestartAttemptsRef = useRef(0);
  const timersRef = useRef({ ring: null, connect: null, disconnect: null, signaling: null, duration: null });

  const mergeCallState = useCallback((patch) => {
    setCallState((prev) => {
      const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
      currentCallRef.current = next;
      return next;
    });
  }, []);

  const clearTimer = useCallback((name) => {
    const timer = timersRef.current[name];
    if (timer) {
      window.clearTimeout(timer);
      window.clearInterval(timer);
      timersRef.current[name] = null;
    }
  }, []);

  const clearAllTimers = useCallback(() => {
    clearTimer('ring');
    clearTimer('connect');
    clearTimer('disconnect');
    clearTimer('signaling');
    clearTimer('duration');
  }, [clearTimer]);

  const startDurationTicker = useCallback((connectedAt) => {
    clearTimer('duration');
    if (!connectedAt) return;
    const tick = () => mergeCallState({ durationLabel: formatDuration(connectedAt) });
    tick();
    timersRef.current.duration = window.setInterval(tick, 1000);
  }, [clearTimer, mergeCallState]);

  const teardownPeerConnection = useCallback(() => {
    const peerConnection = peerConnectionRef.current;
    if (peerConnection) {
      try { peerConnection.ontrack = null; } catch {}
      try { peerConnection.onicecandidate = null; } catch {}
      try { peerConnection.onconnectionstatechange = null; } catch {}
      try { peerConnection.oniceconnectionstatechange = null; } catch {}
      try { peerConnection.onnegotiationneeded = null; } catch {}
      try { peerConnection.close(); } catch {}
      peerConnectionRef.current = null;
    }
    pendingCandidatesRef.current = [];
    pendingOfferRef.current = null;
    makingOfferRef.current = false;
    ignoreOfferRef.current = false;
    isSettingRemoteAnswerPendingRef.current = false;
    iceRestartAttemptsRef.current = 0;
  }, []);

  const stopLocalStream = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    stream.getTracks().forEach((track) => {
      try { track.onended = null; } catch {}
      try { track.stop(); } catch {}
    });
    localStreamRef.current = null;
  }, []);

  const resetRemoteStream = useCallback(() => {
    const stream = remoteStreamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => {
        try { track.onended = null; } catch {}
        try { track.onmute = null; } catch {}
        try { track.onunmute = null; } catch {}
        try { track.stop(); } catch {}
      });
    }
    remoteStreamRef.current = null;
  }, []);

  const attachStreamToElements = useCallback(() => {
    const localVideo = localVideoRef.current;
    if (localVideo) {
      localVideo.srcObject = localStreamRef.current || null;
    }
    const remoteVideo = remoteVideoRef.current;
    if (remoteVideo) {
      remoteVideo.srcObject = remoteStreamRef.current || null;
      const playPromise = remoteVideo.play?.();
      if (playPromise?.catch) playPromise.catch(() => {});
    }
    const remoteAudio = remoteAudioRef.current;
    if (remoteAudio) {
      remoteAudio.srcObject = remoteStreamRef.current || null;
      remoteAudio.muted = !currentCallRef.current.speakerEnabled;
      const playPromise = remoteAudio.play?.();
      if (playPromise?.catch) playPromise.catch(() => {});
    }
  }, []);

  const refreshRemoteFlags = useCallback(() => {
    const stream = remoteStreamRef.current;
    if (!stream) {
      mergeCallState({ remoteReady: false, remoteVideoReady: false, peerAudioEnabled: false, peerVideoEnabled: false });
      attachStreamToElements();
      return;
    }
    const audioTracks = stream.getAudioTracks().filter((track) => track.readyState === 'live');
    const videoTracks = stream.getVideoTracks().filter((track) => track.readyState === 'live');
    const anyReady = audioTracks.length > 0 || videoTracks.length > 0;
    mergeCallState((prev) => ({
      remoteReady: anyReady,
      remoteVideoReady: videoTracks.length > 0 && prev.peerVideoEnabled,
      peerAudioEnabled: audioTracks.length > 0 ? prev.peerAudioEnabled : false,
      peerVideoEnabled: videoTracks.length > 0 ? prev.peerVideoEnabled : false,
    }));
    attachStreamToElements();
  }, [attachStreamToElements, mergeCallState]);

  const scheduleOutgoingTimeout = useCallback(() => {
    clearTimer('ring');
    timersRef.current.ring = window.setTimeout(() => {
      const current = currentCallRef.current;
      if (!current.open || !['dialing', 'outgoing'].includes(current.status)) return;
      getSocketClient()?.send('call:cancel', { session_id: current.sessionId, reason: 'timeout' });
      showToast('Собеседник не ответил', { tone: 'warning' });
      teardownPeerConnection();
      stopLocalStream();
      resetRemoteStream();
      mergeCallState({ ...DEFAULT_STATE, error: 'Нет ответа от собеседника' });
    }, OUTGOING_RING_TIMEOUT_MS);
  }, [clearTimer, getSocketClient, mergeCallState, resetRemoteStream, stopLocalStream, teardownPeerConnection]);

  const scheduleConnectTimeout = useCallback(() => {
    clearTimer('connect');
    timersRef.current.connect = window.setTimeout(() => {
      const current = currentCallRef.current;
      if (!current.open || !['connecting', 'outgoing', 'incoming'].includes(current.status)) return;
      getSocketClient()?.send(current.direction === 'outgoing' ? 'call:cancel' : 'call:end', { session_id: current.sessionId, reason: 'connect_timeout' });
      showToast('Не удалось установить соединение', { tone: 'danger' });
      teardownPeerConnection();
      stopLocalStream();
      resetRemoteStream();
      mergeCallState({ ...DEFAULT_STATE, error: 'Не удалось установить стабильное соединение' });
    }, CONNECT_TIMEOUT_MS);
  }, [clearTimer, getSocketClient, mergeCallState, resetRemoteStream, stopLocalStream, teardownPeerConnection]);

  const scheduleDisconnectGrace = useCallback(() => {
    clearTimer('disconnect');
    timersRef.current.disconnect = window.setTimeout(() => {
      const current = currentCallRef.current;
      if (!current.open || current.status !== 'active') return;
      showToast('Соединение со звонком потеряно', { tone: 'warning' });
      teardownPeerConnection();
      stopLocalStream();
      resetRemoteStream();
      mergeCallState({ ...DEFAULT_STATE, error: 'Соединение со звонком потеряно' });
    }, DISCONNECT_GRACE_MS);
  }, [clearTimer, mergeCallState, resetRemoteStream, stopLocalStream, teardownPeerConnection]);

  const scheduleSignalingLoss = useCallback(() => {
    clearTimer('signaling');
    timersRef.current.signaling = window.setTimeout(() => {
      const current = currentCallRef.current;
      if (!current.open || current.status === 'active') return;
      showToast('Соединение с сервером чата потеряно', { tone: 'warning' });
      teardownPeerConnection();
      stopLocalStream();
      resetRemoteStream();
      mergeCallState({ ...DEFAULT_STATE, error: 'Сигналинг звонка потерян' });
    }, SIGNALING_GRACE_MS);
  }, [clearTimer, mergeCallState, resetRemoteStream, stopLocalStream, teardownPeerConnection]);

  const resetCall = useCallback(({ preserveMessage = '' } = {}) => {
    clearAllTimers();
    teardownPeerConnection();
    stopLocalStream();
    resetRemoteStream();
    endingRef.current = false;
    politeRef.current = false;
    currentCallRef.current = { ...DEFAULT_STATE, error: preserveMessage };
    setCallState({ ...DEFAULT_STATE, error: preserveMessage });
  }, [clearAllTimers, resetRemoteStream, stopLocalStream, teardownPeerConnection]);

  useEffect(() => {
    attachStreamToElements();
  }, [attachStreamToElements, callState.localReady, callState.remoteReady, callState.remoteVideoReady, callState.speakerEnabled]);

  useEffect(() => () => {
    const state = currentCallRef.current;
    if (state?.open && getSocketClient()?.isConnected?.() && state.sessionId) {
      const type = state.status === 'incoming' ? 'call:reject' : state.status === 'outgoing' ? 'call:cancel' : 'call:end';
      getSocketClient()?.send(type, { session_id: state.sessionId, reason: 'leave' });
    }
    resetCall();
  }, [getSocketClient, resetCall]);

  useEffect(() => {
    const client = getSocketClient();
    if (!client?.subscribeStatus) return undefined;
    return client.subscribeStatus((connected) => {
      const current = currentCallRef.current;
      if (!current.open) return;
      if (connected) {
        clearTimer('signaling');
        if (current.error === 'Сигналинг звонка потерян') {
          mergeCallState({ error: '' });
        }
        return;
      }
      if (current.status !== 'active') {
        mergeCallState({ error: 'Соединение с сервером чата потеряно. Пытаемся восстановить…' });
        scheduleSignalingLoss();
      }
    });
  }, [clearTimer, getSocketClient, mergeCallState, scheduleSignalingLoss]);

  const ensureLocalStream = useCallback(async (kind, { forceRefresh = false } = {}) => {
    const current = localStreamRef.current;
    const hasLiveAudio = current?.getAudioTracks?.().some((track) => track.readyState === 'live');
    const hasLiveVideo = current?.getVideoTracks?.().some((track) => track.readyState === 'live');

    if (current && !forceRefresh) {
      if (kind === 'audio' && hasLiveAudio) return current;
      if (kind === 'video' && hasLiveAudio && hasLiveVideo) return current;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Браузер не поддерживает звонки');
    }

    if (current) {
      stopLocalStream();
    }

    const stream = await navigator.mediaDevices.getUserMedia(
      kind === 'video'
        ? {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: {
              facingMode: 'user',
              width: { ideal: 960, max: 1280 },
              height: { ideal: 540, max: 720 },
              frameRate: { ideal: 24, max: 30 },
            },
          }
        : {
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
            video: false,
          }
    );

    stream.getTracks().forEach((track) => {
      track.onended = () => {
        const state = currentCallRef.current;
        if (track.kind === 'audio') {
          mergeCallState({ muted: true });
        }
        if (track.kind === 'video') {
          mergeCallState({ cameraEnabled: false });
        }
        if (state.open && state.sessionId) {
          getSocketClient()?.send('call:toggle', {
            session_id: state.sessionId,
            audio_enabled: stream.getAudioTracks().some((audioTrack) => audioTrack.enabled && audioTrack.readyState === 'live'),
            video_enabled: stream.getVideoTracks().some((videoTrack) => videoTrack.enabled && videoTrack.readyState === 'live'),
          });
        }
      };
    });

    localStreamRef.current = stream;
    mergeCallState({
      localReady: true,
      muted: !stream.getAudioTracks().some((track) => track.enabled),
      cameraEnabled: kind !== 'video' ? false : stream.getVideoTracks().some((track) => track.enabled),
    });
    attachStreamToElements();
    return stream;
  }, [attachStreamToElements, getSocketClient, mergeCallState, stopLocalStream]);

  const restartIce = useCallback(async (reason = 'reconnect') => {
    const current = currentCallRef.current;
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection || !current.open || !current.sessionId || iceRestartAttemptsRef.current >= MAX_ICE_RESTARTS) {
      return false;
    }
    if (!getSocketClient()?.isConnected?.()) return false;
    if (makingOfferRef.current) return false;

    iceRestartAttemptsRef.current += 1;
    mergeCallState({ status: 'connecting', error: reason === 'failed' ? 'Переподключаем звонок…' : '' });

    try {
      makingOfferRef.current = true;
      if (typeof peerConnection.restartIce === 'function') {
        peerConnection.restartIce();
      }
      const offer = await peerConnection.createOffer({ iceRestart: true });
      await peerConnection.setLocalDescription(offer);
      getSocketClient()?.send('call:offer', {
        session_id: current.sessionId,
        offer: peerConnection.localDescription,
        restart: true,
      });
      scheduleConnectTimeout();
      return true;
    } catch (error) {
      console.error('ICE restart error', error);
      return false;
    } finally {
      makingOfferRef.current = false;
    }
  }, [getSocketClient, mergeCallState, scheduleConnectTimeout]);

  const createPeerConnection = useCallback(async (sessionId, kind) => {
    teardownPeerConnection();
    const stream = await ensureLocalStream(kind);
    const rtcConfig = await loadWebRTCConfiguration();
    if (!Array.isArray(rtcConfig.iceServers) || !rtcConfig.iceServers.length) {
      const warning = rtcConfig.configWarning || 'Для звонков не настроены ICE/STUN/TURN серверы';
      showToast(warning, { tone: 'warning' });
      throw new Error(warning);
    }
    const peerConnection = new RTCPeerConnection({
      iceServers: rtcConfig.iceServers,
      iceTransportPolicy: rtcConfig.iceTransportPolicy,
      bundlePolicy: rtcConfig.bundlePolicy,
      rtcpMuxPolicy: rtcConfig.rtcpMuxPolicy,
      iceCandidatePoolSize: rtcConfig.iceCandidatePoolSize,
    });
    remoteStreamRef.current = new MediaStream();
    stream.getTracks().forEach((track) => peerConnection.addTrack(track, stream));

    peerConnection.ontrack = (event) => {
      const target = remoteStreamRef.current || new MediaStream();
      event.streams.forEach((incomingStream) => {
        incomingStream.getTracks().forEach((track) => {
          if (!target.getTracks().some((existing) => existing.id === track.id)) {
            target.addTrack(track);
            track.onmute = () => {
              if (track.kind === 'audio') mergeCallState({ peerAudioEnabled: false });
              if (track.kind === 'video') mergeCallState({ peerVideoEnabled: false, remoteVideoReady: false });
            };
            track.onunmute = () => {
              if (track.kind === 'audio') mergeCallState({ peerAudioEnabled: true });
              if (track.kind === 'video') mergeCallState({ peerVideoEnabled: true, remoteVideoReady: true });
            };
            track.onended = () => {
              if (track.kind === 'audio') mergeCallState({ peerAudioEnabled: false });
              if (track.kind === 'video') mergeCallState({ peerVideoEnabled: false, remoteVideoReady: false });
              refreshRemoteFlags();
            };
          }
        });
      });
      remoteStreamRef.current = target;
      mergeCallState({
        remoteReady: target.getTracks().length > 0,
        remoteVideoReady: target.getVideoTracks().length > 0,
        peerAudioEnabled: target.getAudioTracks().length > 0,
        peerVideoEnabled: target.getVideoTracks().length > 0 || kind !== 'video',
      });
      attachStreamToElements();
    };

    peerConnection.onicecandidate = (event) => {
      if (!event.candidate || !getSocketClient()?.isConnected?.()) return;
      getSocketClient()?.send('call:ice', {
        session_id: sessionId,
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate,
      });
    };

    peerConnection.onconnectionstatechange = async () => {
      const state = peerConnection.connectionState;
      if (state === 'connected') {
        clearTimer('connect');
        clearTimer('disconnect');
        clearTimer('ring');
        iceRestartAttemptsRef.current = 0;
        const connectedAt = currentCallRef.current.connectedAt || new Date().toISOString();
        mergeCallState({ status: 'active', connectedAt, durationLabel: formatDuration(connectedAt), error: '' });
        startDurationTicker(connectedAt);
        return;
      }
      if (state === 'disconnected') {
        scheduleDisconnectGrace();
        void restartIce('disconnected');
        return;
      }
      if (state === 'failed') {
        const restarted = await restartIce('failed');
        if (!restarted && !endingRef.current) {
          showToast('Соединение со звонком не удалось восстановить', { tone: 'danger' });
          resetCall({ preserveMessage: 'Соединение со звонком потеряно' });
        }
        return;
      }
      if (state === 'closed' && !endingRef.current) {
        resetCall();
      }
    };

    peerConnection.oniceconnectionstatechange = () => {
      const state = peerConnection.iceConnectionState;
      if (state === 'connected' || state === 'completed') {
        clearTimer('disconnect');
      }
      if (state === 'failed') {
        void restartIce('failed');
      }
    };

    peerConnectionRef.current = peerConnection;
    return peerConnection;
  }, [attachStreamToElements, clearTimer, ensureLocalStream, getSocketClient, mergeCallState, refreshRemoteFlags, resetCall, restartIce, scheduleDisconnectGrace, startDurationTicker, teardownPeerConnection]);

  const applyQueuedCandidates = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;
    if (!peerConnection || !peerConnection.remoteDescription) return;
    const queued = [...pendingCandidatesRef.current];
    pendingCandidatesRef.current = [];
    for (const candidate of queued) {
      try {
        await peerConnection.addIceCandidate(safeIceCandidate(candidate));
      } catch (error) {
        console.error('ICE candidate error', error);
      }
    }
  }, []);

  const handleOffer = useCallback(async (payload) => {
    const sessionId = payload?.session_id || payload?.sessionId;
    const kind = payload?.kind || currentCallRef.current.kind;
    const offer = payload?.offer;
    if (!sessionId || !offer) return;

    const current = currentCallRef.current;
    if (String(current.sessionId || '') !== String(sessionId)) {
      pendingOfferRef.current = { sessionId, offer, kind };
      return;
    }

    try {
      const peerConnection = peerConnectionRef.current || await createPeerConnection(sessionId, kind);
      const offerDescription = safeSessionDescription(offer);
      const readyForOffer = !makingOfferRef.current && (peerConnection.signalingState === 'stable' || isSettingRemoteAnswerPendingRef.current);
      const offerCollision = !readyForOffer;
      ignoreOfferRef.current = !politeRef.current && offerCollision;
      if (ignoreOfferRef.current) {
        return;
      }
      if (offerCollision) {
        await Promise.all([
          peerConnection.setLocalDescription({ type: 'rollback' }),
          peerConnection.setRemoteDescription(offerDescription),
        ]);
      } else {
        await peerConnection.setRemoteDescription(offerDescription);
      }
      await applyQueuedCandidates();
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      getSocketClient()?.send('call:answer', { session_id: sessionId, answer: peerConnection.localDescription });
      mergeCallState({ status: 'connecting', error: '' });
      scheduleConnectTimeout();
    } catch (error) {
      console.error('Offer handling error', error);
      showToast('Не удалось подключить звонок', { tone: 'danger' });
      resetCall({ preserveMessage: 'Ошибка подключения звонка' });
    }
  }, [applyQueuedCandidates, createPeerConnection, getSocketClient, mergeCallState, resetCall, scheduleConnectTimeout]);

  const acceptIncomingCall = useCallback(async () => {
    const current = currentCallRef.current;
    if (!current.open || current.status !== 'incoming') return;
    try {
      mergeCallState({ status: 'connecting', error: '' });
      politeRef.current = true;
      await createPeerConnection(current.sessionId, current.kind);
      getSocketClient()?.send('call:accept', { session_id: current.sessionId });
      scheduleConnectTimeout();
      if (pendingOfferRef.current?.sessionId === current.sessionId) {
        const pending = pendingOfferRef.current;
        pendingOfferRef.current = null;
        await handleOffer({ session_id: current.sessionId, kind: current.kind, offer: pending.offer });
      }
    } catch (error) {
      console.error('Accept call error', error);
      showToast('Не удалось начать звонок', { tone: 'danger' });
      getSocketClient()?.send('call:reject', { session_id: current.sessionId, reason: 'media_error' });
      resetCall({ preserveMessage: parseMediaError(error, current.kind) });
    }
  }, [createPeerConnection, getSocketClient, handleOffer, mergeCallState, resetCall, scheduleConnectTimeout]);

  const declineCall = useCallback(() => {
    const current = currentCallRef.current;
    if (!current.sessionId) return;
    const type = current.status === 'incoming' ? 'call:reject' : current.status === 'outgoing' ? 'call:cancel' : 'call:end';
    getSocketClient()?.send(type, { session_id: current.sessionId, reason: 'manual' });
    resetCall();
  }, [getSocketClient, resetCall]);

  const endCall = useCallback(() => {
    const current = currentCallRef.current;
    if (!current.sessionId) return;
    endingRef.current = true;
    getSocketClient()?.send(current.status === 'outgoing' ? 'call:cancel' : 'call:end', { session_id: current.sessionId, reason: 'hangup' });
    resetCall();
  }, [getSocketClient, resetCall]);

  const startCall = useCallback(async (kind) => {
    if (!selectedChat?.id || selectedChat?.isSelf || currentCallRef.current.open) return;
    try {
      mergeCallState({
        open: true,
        status: 'dialing',
        direction: 'outgoing',
        kind,
        sessionId: '',
        ...normalizePeer({ id: selectedChat.id, name: selectedChat.name, username: selectedChat.username, avatar: selectedChat.avatar }),
        muted: false,
        cameraEnabled: kind === 'video',
        speakerEnabled: true,
        peerAudioEnabled: true,
        peerVideoEnabled: kind === 'video',
        localReady: false,
        remoteReady: false,
        remoteVideoReady: false,
        connectedAt: '',
        durationLabel: '',
        error: '',
      });
      politeRef.current = false;
      await ensureLocalStream(kind);
      const sent = getSocketClient()?.send('call:invite', { to_user_id: Number(selectedChat.id), kind });
      if (!sent) {
        showToast('Сокет ещё не подключён. Попробуйте снова через секунду.', { tone: 'warning' });
        resetCall({ preserveMessage: 'Нет соединения с сервером чата' });
        return;
      }
      scheduleOutgoingTimeout();
    } catch (error) {
      console.error('Start call error', error);
      showToast(parseMediaError(error, kind), { tone: 'danger' });
      resetCall({ preserveMessage: parseMediaError(error, kind) });
    }
  }, [ensureLocalStream, getSocketClient, mergeCallState, resetCall, scheduleOutgoingTimeout, selectedChat]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    const current = currentCallRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return;
    audioTrack.enabled = !audioTrack.enabled;
    const muted = !audioTrack.enabled;
    mergeCallState({ muted });
    if (current.sessionId) {
      getSocketClient()?.send('call:toggle', {
        session_id: current.sessionId,
        audio_enabled: !muted,
        video_enabled: current.kind === 'video' ? current.cameraEnabled : false,
      });
    }
  }, [getSocketClient, mergeCallState]);

  const toggleCamera = useCallback(() => {
    const current = currentCallRef.current;
    if (current.kind !== 'video') return;
    const stream = localStreamRef.current;
    const videoTrack = stream?.getVideoTracks?.()[0];
    if (!videoTrack) return;
    videoTrack.enabled = !videoTrack.enabled;
    const cameraEnabled = Boolean(videoTrack.enabled);
    mergeCallState({ cameraEnabled });
    if (current.sessionId) {
      getSocketClient()?.send('call:toggle', {
        session_id: current.sessionId,
        audio_enabled: !current.muted,
        video_enabled: cameraEnabled,
      });
    }
  }, [getSocketClient, mergeCallState]);

  const toggleRemoteAudio = useCallback(() => {
    mergeCallState((prev) => ({ speakerEnabled: !prev.speakerEnabled }));
  }, [mergeCallState]);

  const handleSocketEvent = useCallback(async (detail) => {
    const type = detail?.type || '';
    const data = detail?.data || {};
    if (!type.startsWith('call:')) return false;

    if (type === 'call:incoming') {
      const current = currentCallRef.current;
      if (current.open && current.sessionId && current.sessionId !== data.session_id) {
        getSocketClient()?.send('call:reject', { session_id: data.session_id, reason: 'busy' });
        return true;
      }
      clearTimer('ring');
      mergeCallState({
        open: true,
        status: 'incoming',
        direction: 'incoming',
        kind: data.kind || 'audio',
        sessionId: data.session_id || '',
        ...normalizePeer(data.peer),
        muted: false,
        cameraEnabled: (data.kind || 'audio') === 'video',
        speakerEnabled: true,
        peerAudioEnabled: true,
        peerVideoEnabled: (data.kind || 'audio') === 'video',
        localReady: false,
        remoteReady: false,
        remoteVideoReady: false,
        connectedAt: '',
        durationLabel: '',
        error: '',
      });
      return true;
    }

    if (type === 'call:outgoing') {
      mergeCallState((prev) => ({
        ...prev,
        open: true,
        status: 'outgoing',
        direction: 'outgoing',
        sessionId: data.session_id || prev.sessionId,
        kind: data.kind || prev.kind,
        ...normalizePeer(data.peer || { id: prev.peerId, name: prev.peerName, username: prev.peerUsername, avatar: prev.peerAvatar }),
      }));
      scheduleOutgoingTimeout();
      return true;
    }

    if (type === 'call:accepted') {
      const current = currentCallRef.current;
      if (!current.open) return true;
      try {
        const sessionId = data.session_id || current.sessionId;
        const kind = data.kind || current.kind;
        clearTimer('ring');
        mergeCallState((prev) => ({
          ...prev,
          sessionId,
          kind,
          status: 'connecting',
          ...normalizePeer(data.peer || { id: prev.peerId, name: prev.peerName, username: prev.peerUsername, avatar: prev.peerAvatar }),
        }));
        if (current.direction === 'outgoing') {
          const peerConnection = await createPeerConnection(sessionId, kind);
          makingOfferRef.current = true;
          const offer = await peerConnection.createOffer();
          await peerConnection.setLocalDescription(offer);
          getSocketClient()?.send('call:offer', { session_id: sessionId, offer: peerConnection.localDescription });
          makingOfferRef.current = false;
          scheduleConnectTimeout();
        }
      } catch (error) {
        makingOfferRef.current = false;
        console.error('Accepted call error', error);
        showToast('Не удалось поднять звонок', { tone: 'danger' });
        resetCall({ preserveMessage: 'Ошибка инициализации звонка' });
      }
      return true;
    }

    if (type === 'call:offer') {
      await handleOffer(data);
      return true;
    }

    if (type === 'call:answer') {
      const peerConnection = peerConnectionRef.current;
      if (!peerConnection || !data.answer) return true;
      try {
        isSettingRemoteAnswerPendingRef.current = true;
        await peerConnection.setRemoteDescription(safeSessionDescription(data.answer));
        isSettingRemoteAnswerPendingRef.current = false;
        await applyQueuedCandidates();
        mergeCallState({ status: 'connecting', error: '' });
        scheduleConnectTimeout();
      } catch (error) {
        isSettingRemoteAnswerPendingRef.current = false;
        console.error('Answer handling error', error);
      }
      return true;
    }

    if (type === 'call:ice') {
      const peerConnection = peerConnectionRef.current;
      const candidate = data.candidate;
      if (!candidate || ignoreOfferRef.current) return true;
      if (!peerConnection || !peerConnection.remoteDescription) {
        pendingCandidatesRef.current.push(candidate);
        return true;
      }
      try {
        await peerConnection.addIceCandidate(safeIceCandidate(candidate));
      } catch (error) {
        console.error('ICE add error', error);
      }
      return true;
    }

    if (type === 'call:toggle') {
      mergeCallState((prev) => ({
        peerAudioEnabled: typeof data.audio_enabled === 'boolean' ? data.audio_enabled : prev.peerAudioEnabled,
        peerVideoEnabled: typeof data.video_enabled === 'boolean' ? data.video_enabled : prev.peerVideoEnabled,
        remoteVideoReady: typeof data.video_enabled === 'boolean' ? (data.video_enabled ? prev.remoteVideoReady || prev.remoteReady : false) : prev.remoteVideoReady,
      }));
      return true;
    }

    if (type === 'call:busy') {
      showToast('Пользователь сейчас занят другим звонком', { tone: 'warning' });
      resetCall({ preserveMessage: 'Пользователь занят' });
      return true;
    }

    if (type === 'call:unavailable') {
      showToast('Пользователь сейчас недоступен для звонка', { tone: 'warning' });
      resetCall({ preserveMessage: 'Пользователь недоступен для звонка' });
      return true;
    }

    if (type === 'call:timeout') {
      showToast('Время ожидания звонка истекло', { tone: 'warning' });
      resetCall({ preserveMessage: 'Время ожидания звонка истекло' });
      return true;
    }

    if (type === 'call:reject' || type === 'call:cancel' || type === 'call:end') {
      const reason = String(data.reason || '').trim();
      const message = reason === 'disconnect'
        ? 'Собеседник вышел из звонка'
        : reason === 'media_error'
          ? 'Собеседник не смог подключить устройство'
          : type === 'call:reject'
            ? 'Звонок отклонён'
            : type === 'call:cancel'
              ? 'Звонок отменён'
              : 'Звонок завершён';
      showToast(message, { tone: 'neutral' });
      resetCall();
      return true;
    }

    return false;
  }, [applyQueuedCandidates, clearTimer, createPeerConnection, getSocketClient, handleOffer, mergeCallState, resetCall, scheduleConnectTimeout, scheduleOutgoingTimeout]);

  const isCallAvailable = useMemo(() => Boolean(selectedChat?.id) && !selectedChat?.isSelf && !callState.open, [callState.open, selectedChat?.id, selectedChat?.isSelf]);

  return {
    callState,
    localVideoRef,
    remoteVideoRef,
    remoteAudioRef,
    isCallAvailable,
    startAudioCall: () => { void startCall('audio'); },
    startVideoCall: () => { void startCall('video'); },
    acceptIncomingCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
    toggleRemoteAudio,
    handleSocketEvent,
  };
}
