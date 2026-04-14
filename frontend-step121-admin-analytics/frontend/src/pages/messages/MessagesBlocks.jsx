import { useEffect, useRef, useState } from 'react';
import PostAuthEmptyState from '../../components/postauth/PostAuthEmptyState';
import PostAuthHero from '../../components/postauth/PostAuthHero';
import PostAuthSearchField from '../../components/postauth/PostAuthSearchField';
import PostAuthSectionHead from '../../components/postauth/PostAuthSectionHead';
import { resolveEncryptedMediaObjectURL } from '../../services/e2ee';

function shouldSubmitOnEnter(event) {
  return event.key === 'Enter' && !event.shiftKey && !event.isComposing && !event.nativeEvent?.isComposing && event.keyCode !== 229;
}

function formatTime(value) {
  if (!value) return 'сейчас';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'сейчас' : d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDurationShort(totalSeconds = 0) {
  const safe = Math.max(0, Number(totalSeconds) || 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function copyToClipboardSafe(value) {
  const text = String(value || '').trim();
  if (!text || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return false;
  navigator.clipboard.writeText(text).catch(() => {});
  return true;
}

function triggerDownloadFromURL(url, filename = 'media') {
  const safeUrl = String(url || '').trim();
  if (!safeUrl || typeof document === 'undefined') return false;
  const link = document.createElement('a');
  link.href = safeUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  return true;
}

function highlightMessageText(text, query, { active = false } = {}) {
  const raw = String(text || '');
  const normalized = String(query || '').trim();
  if (!normalized) return raw;
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = raw.split(regex);
  return parts.map((part, index) => {
    if (!part) return null;
    const matched = part.toLowerCase() === normalized.toLowerCase();
    if (!matched) return <span key={`${index}-${part}`}>{part}</span>;
    return <mark key={`${index}-${part}`} className={`pa-message-highlight ${active ? 'active' : ''}`}>{part}</mark>;
  });
}

function messageDeliveryLabel(message) {
  if (!message?.mine) return '';
  if (message.failed) return 'Не отправлено';
  if (message.pending) return 'Отправляется';
  return message.is_read ? 'Прочитано' : 'Доставлено';
}

const waveformCache = new Map();

function buildWaveformBarsFromAudioBuffer(audioBuffer, count = 28) {
  if (!audioBuffer || count <= 0) return [];
  const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
  const sampleCount = Math.max(1, audioBuffer.length || 1);
  const blockSize = Math.max(1, Math.floor(sampleCount / count));
  const sampleStep = Math.max(1, Math.floor(blockSize / 64));
  const bars = [];
  let maxValue = 0;

  for (let blockIndex = 0; blockIndex < count; blockIndex += 1) {
    const start = blockIndex * blockSize;
    const end = Math.min(sampleCount, start + blockSize);
    let total = 0;
    let samplesRead = 0;
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channelData = audioBuffer.getChannelData(channelIndex);
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += sampleStep) {
        total += Math.abs(channelData[sampleIndex] || 0);
        samplesRead += 1;
      }
    }
    const average = samplesRead > 0 ? total / samplesRead : 0;
    if (average > maxValue) maxValue = average;
    bars.push(average);
  }

  if (maxValue <= 0) return [];
  return bars.map((value) => Number(Math.max(0.1, Math.min(1, value / maxValue)).toFixed(3)));
}

async function loadWaveformBars(url, count = 28) {
  if (!url || typeof window === 'undefined') return [];
  const cacheKey = `${url}::${count}`;
  if (waveformCache.has(cacheKey)) return waveformCache.get(cacheKey);

  const job = (async () => {
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) return [];
    const buffer = await response.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return [];
    const audioContext = new AudioContextClass();
    try {
      const decoded = await audioContext.decodeAudioData(buffer.slice(0));
      return buildWaveformBarsFromAudioBuffer(decoded, count);
    } finally {
      try {
        await audioContext.close();
      } catch {
        // ignore close errors
      }
    }
  })().catch(() => []);

  waveformCache.set(cacheKey, job);
  return job;
}


function useResolvedMediaSources(media) {
  const [sources, setSources] = useState({ url: String(media?.url || ''), thumbUrl: String(media?.thumb_url || ''), loading: Boolean(media?.encrypted_blob) });

  useEffect(() => {
    let cancelled = false;
    if (!media?.encrypted_blob) {
      setSources({ url: String(media?.url || ''), thumbUrl: String(media?.thumb_url || ''), loading: false });
      return undefined;
    }
    setSources((prev) => ({ ...prev, loading: true }));
    Promise.all([
      resolveEncryptedMediaObjectURL(media, 'main').catch(() => ''),
      media?.thumb_url ? resolveEncryptedMediaObjectURL(media, 'thumb').catch(() => '') : Promise.resolve(''),
    ]).then(([url, thumbUrl]) => {
      if (cancelled) return;
      setSources({ url: String(url || ''), thumbUrl: String(thumbUrl || ''), loading: false });
    });
    return () => {
      cancelled = true;
    };
  }, [media]);

  return sources;
}

function WaveformBars({ bars, progress = 0, loading = false }) {
  const safeProgress = Math.max(0, Math.min(1, progress));
  const activeCount = Math.max(0, Math.round((bars.length || 1) * safeProgress));

  if (!bars.length) {
    return (
      <div className={`pa-voice-waveform pa-voice-waveform-fallback ${loading ? 'is-loading' : ''}`} aria-hidden="true">
        <span className="pa-voice-waveform-fallback-track" />
        <span className="pa-voice-waveform-fallback-progress" style={{ width: `${safeProgress * 100}%` }} />
      </div>
    );
  }

  return (
    <div className="pa-voice-waveform" aria-hidden="true">
      {bars.map((value, index) => (
        <span
          key={`${index}-${value}`}
          className={`pa-voice-wave-bar ${index < activeCount ? 'active' : ''}`}
          style={{ height: `${Math.max(18, Math.round(16 + value * 30))}px` }}
        />
      ))}
    </div>
  );
}

function VoiceMessagePlayer({ media, caption, failed, searchQuery = '', activeSearchMatch = false }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [bars, setBars] = useState([]);
  const { url: resolvedAudioURL, loading: encryptedMediaLoading } = useResolvedMediaSources(media);
  const [waveformLoading, setWaveformLoading] = useState(Boolean(media?.url));
  const duration = Number(media?.duration_sec) > 0 ? Number(media.duration_sec) : 0;
  const ratio = duration > 0 ? Math.min(1, currentTime / duration) : 0;

  useEffect(() => {
    let cancelled = false;
    if (!resolvedAudioURL) {
      setBars([]);
      setWaveformLoading(false);
      return undefined;
    }
    setWaveformLoading(true);
    loadWaveformBars(resolvedAudioURL)
      .then((nextBars) => {
        if (cancelled) return;
        setBars(Array.isArray(nextBars) ? nextBars : []);
      })
      .finally(() => {
        if (!cancelled) setWaveformLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [media?.url, resolvedAudioURL]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    const sync = () => {
      setCurrentTime(Number.isFinite(audio.currentTime) ? audio.currentTime : 0);
      setPlaying(!audio.paused && !audio.ended);
    };
    audio.addEventListener('timeupdate', sync);
    audio.addEventListener('play', sync);
    audio.addEventListener('pause', sync);
    audio.addEventListener('ended', sync);
    audio.addEventListener('loadedmetadata', sync);
    return () => {
      audio.removeEventListener('timeupdate', sync);
      audio.removeEventListener('play', sync);
      audio.removeEventListener('pause', sync);
      audio.removeEventListener('ended', sync);
      audio.removeEventListener('loadedmetadata', sync);
    };
  }, [media?.url]);

  const togglePlayback = () => {
    const audio = audioRef.current;
    if (!audio || failed) return;
    if (audio.paused) {
      audio.play?.().catch(() => {});
      return;
    }
    audio.pause();
  };

  const handleSeek = (event) => {
    const next = Number(event.target.value || 0);
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(next)) return;
    audio.currentTime = next;
    setCurrentTime(next);
  };

  return (
    <div className="pa-voice-card">
      <audio ref={audioRef} preload="metadata" className="pa-hidden-audio" src={resolvedAudioURL} />
      <div className="pa-voice-head">
        <span className="pa-voice-badge">🎤 Голосовое</span>
        <span className="pa-voice-duration">{formatDurationShort(duration || currentTime)}</span>
      </div>
      <div className="pa-voice-player-shell">
        <button type="button" className="pa-voice-play-btn" onClick={togglePlayback} disabled={failed}>
          {playing ? '❚❚' : '▶'}
        </button>
        <div className="pa-voice-main">
          <WaveformBars bars={bars} progress={ratio} loading={waveformLoading} />
          <input
            type="range"
            min="0"
            max={Math.max(duration, currentTime, 1)}
            step="0.1"
            value={Math.min(currentTime, Math.max(duration, currentTime, 1))}
            onChange={handleSeek}
            className="pa-voice-progress"
            disabled={failed || encryptedMediaLoading}
          />
        </div>
      </div>
      <div className="pa-action-row pa-message-asset-actions">
        <button type="button" className="pa-link-btn" onClick={() => triggerDownloadFromURL(resolvedAudioURL, `voice-${media?.duration_sec || 'clip'}.webm`)} disabled={!resolvedAudioURL || encryptedMediaLoading}>Скачать</button>
      </div>
      {caption ? <div className="pa-message-text pa-message-caption">{highlightMessageText(caption, searchQuery, { active: activeSearchMatch })}</div> : null}
    </div>
  );
}

function VideoNoteCard({ media, caption, searchQuery = '', activeSearchMatch = false }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const { url: resolvedVideoURL, thumbUrl: resolvedThumbURL, loading: encryptedMediaLoading } = useResolvedMediaSources(media);
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play?.().catch(() => {});
      return;
    }
    video.pause();
  };

  return (
    <div className="pa-video-note-card">
      <button type="button" className="pa-video-note-shell" onClick={togglePlayback} disabled={encryptedMediaLoading}>
        <video ref={videoRef} controls={false} playsInline preload="metadata" className="pa-video-note-player" poster={resolvedThumbURL || undefined} src={resolvedVideoURL} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        {!playing && <span className="pa-video-note-play">▶</span>}
      </button>
      <div className="pa-video-note-meta-row">
        <span className="pa-voice-badge">🎬 Видеокружок</span>
        {media.duration_sec > 0 && <span className="pa-voice-duration">{formatDurationShort(media.duration_sec)}</span>}
      </div>
      <div className="pa-action-row pa-message-asset-actions">
        <button type="button" className="pa-link-btn" onClick={() => triggerDownloadFromURL(resolvedVideoURL, `video-note-${media?.duration_sec || 'clip'}.webm`)} disabled={!resolvedVideoURL || encryptedMediaLoading}>Скачать</button>
      </div>
      {caption ? <div className="pa-message-text pa-message-caption">{highlightMessageText(caption, searchQuery, { active: activeSearchMatch })}</div> : null}
    </div>
  );
}

function renderMessageBody(message, { searchQuery = '', activeSearchMatch = false } = {}) {
  const type = String(message?.type || 'text').toLowerCase();
  const media = message?.media;
  if (type === 'voice' && media?.url) {
    return <VoiceMessagePlayer media={media} caption={message.content} failed={Boolean(message.failed)} searchQuery={searchQuery} activeSearchMatch={activeSearchMatch} />;
  }
  if (type === 'video_note' && media?.url) {
    return <VideoNoteCard media={media} caption={message.content} searchQuery={searchQuery} activeSearchMatch={activeSearchMatch} />;
  }
  return <div className="pa-message-text">{highlightMessageText(message.content || message.text, searchQuery, { active: activeSearchMatch })}</div>;
}

function RecordingPanel({ recordingState, recordingPreviewRef, handleStopRecording, handleCancelRecording }) {
  if (!recordingState?.active && !recordingState?.uploading) return null;
  const levels = Array.isArray(recordingState?.levels) ? recordingState.levels : [];
  const uploadProgress = Math.max(0, Math.min(100, Number(recordingState?.uploadProgress) || 0));
  return (
    <div className="pa-recording-panel">
      <div className="pa-recording-main">
        <div className="pa-recording-title">
          {recordingState.uploading
            ? 'Загружаем медиа…'
            : recordingState.kind === 'video_note'
              ? 'Записывается видеокружок'
              : 'Записывается голосовое сообщение'}
        </div>
        <div className="pa-recording-text">
          {recordingState.uploading
            ? `Прогресс загрузки: ${uploadProgress}%`
            : `Длительность: ${formatDurationShort(recordingState.durationSec)}`}
        </div>
        {!recordingState.uploading && levels.length > 0 && <WaveformBars bars={levels} progress={1} />}
        {recordingState.uploading && <div className="pa-upload-progress"><span style={{ width: `${uploadProgress}%` }} /></div>}
      </div>
      {recordingState.kind === 'video_note' && !recordingState.uploading ? (
        <video ref={recordingPreviewRef} muted autoPlay playsInline className="pa-recording-preview" />
      ) : (
        <div className="pa-recording-indicator" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      )}
      {!recordingState.uploading && (
        <div className="pa-recording-actions">
          <button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={handleCancelRecording}>Отмена</button>
          <button className="pa-primary-btn pa-secondary-btn-compact" type="button" onClick={handleStopRecording}>Стоп и отправить</button>
        </div>
      )}
    </div>
  );
}

function callStatusLabel(callState) {
  if (!callState?.open) return '';
  if (callState.status === 'incoming') return callState.kind === 'video' ? 'Входящий видеозвонок' : 'Входящий аудиозвонок';
  if (callState.status === 'dialing' || callState.status === 'outgoing') return callState.kind === 'video' ? 'Вызываем видео…' : 'Вызываем…';
  if (callState.status === 'connecting') return 'Соединяем…';
  if (callState.status === 'active') {
    const suffix = callState.durationLabel ? ` · ${callState.durationLabel}` : '';
    return `${callState.kind === 'video' ? 'Видеозвонок активен' : 'Аудиозвонок активен'}${suffix}`;
  }
  return 'Звонок';
}

function renderPeerBadge(callState) {
  const fallback = callState?.peerName?.trim()?.[0] || 'C';
  const avatar = callState?.peerAvatar;
  if (avatar && typeof avatar === 'string' && (avatar.startsWith('http') || avatar.startsWith('/'))) {
    return <img src={avatar} alt={callState.peerName || 'avatar'} className="pa-call-avatar-image" />;
  }
  return <span>{avatar && avatar.length <= 3 ? avatar : fallback}</span>;
}

function MessagesCallOverlay({
  callState,
  localVideoRef,
  remoteVideoRef,
  remoteAudioRef,
  acceptIncomingCall,
  declineCall,
  endCall,
  toggleMute,
  toggleCamera,
  toggleRemoteAudio,
}) {
  if (!callState?.open) return null;

  const isIncoming = callState.status === 'incoming';
  const showMediaStage = callState.kind === 'video';

  return (
    <div className="pa-call-overlay">
      <audio ref={remoteAudioRef} autoPlay playsInline />
      <div className={`pa-call-shell ${showMediaStage ? 'video' : 'audio'}`}>
        <div className="pa-call-surface" />
        {showMediaStage && callState.remoteVideoReady ? (
          <video ref={remoteVideoRef} autoPlay playsInline className="pa-call-remote-video" />
        ) : null}

        <div className="pa-call-head">
          <div className="pa-call-peer">
            <div className="pa-call-avatar">{renderPeerBadge(callState)}</div>
            <div className="pa-call-peer-meta">
              <div className="pa-call-peer-name">{callState.peerName || 'Собеседник'}</div>
              <div className="pa-call-peer-status">{callStatusLabel(callState)}</div>
            </div>
          </div>
          <div className="pa-pill accent">{callState.kind === 'video' ? 'Видео' : 'Аудио'}</div>
        </div>

        <div className="pa-call-stage">
          {showMediaStage ? (
            <>
              {!callState.remoteVideoReady && (
                <div className="pa-call-empty-video">
                  <div className="pa-call-empty-ring">{renderPeerBadge(callState)}</div>
                  <div className="pa-call-empty-note">{callState.peerVideoEnabled ? 'Ждём видео собеседника…' : 'Камера собеседника выключена'}</div>
                </div>
              )}
              {callState.localReady && (
                <div className="pa-call-local-preview">
                  <video ref={localVideoRef} autoPlay muted playsInline className="pa-call-local-video" />
                  {!callState.cameraEnabled && <div className="pa-call-local-badge">Камера выключена</div>}
                </div>
              )}
            </>
          ) : (
            <div className="pa-call-audio-stage">
              <div className="pa-call-audio-ring">{renderPeerBadge(callState)}</div>
              <div className="pa-call-audio-copy">
                <div className="pa-call-audio-title">{callState.remoteReady || callState.status === 'active' ? 'Голосовой канал активен' : 'Подключаем голосовой канал'}</div>
                <div className="pa-call-audio-text">Собеседник останется в этом же glass-экране чата. Завершение звонка не ломает переписку.</div>
              </div>
            </div>
          )}
        </div>

        {!isIncoming && (callState.kind !== 'video' ? !callState.peerAudioEnabled : !callState.peerAudioEnabled || !callState.peerVideoEnabled) ? (
          <div className="pa-pill neutral">
            {!callState.peerAudioEnabled && !callState.peerVideoEnabled && callState.kind === 'video'
              ? 'Собеседник выключил микрофон и камеру'
              : !callState.peerAudioEnabled
                ? 'Собеседник выключил микрофон'
                : 'Собеседник выключил камеру'}
          </div>
        ) : null}

        {callState.error && <div className="pa-error pa-call-error">{callState.error}</div>}

        {isIncoming ? (
          <div className="pa-call-actions incoming">
            <button className="pa-secondary-btn pa-call-btn decline" type="button" onClick={declineCall}>Отклонить</button>
            <button className="pa-primary-btn pa-call-btn accept" type="button" onClick={acceptIncomingCall}>Принять</button>
          </div>
        ) : (
          <div className="pa-call-actions controls">
            <button className={`pa-secondary-btn pa-call-mini-btn ${callState.muted ? 'active' : ''}`} type="button" onClick={toggleMute}>
              {callState.muted ? 'Микрофон выкл.' : 'Микрофон'}
            </button>
            <button className={`pa-secondary-btn pa-call-mini-btn ${!callState.speakerEnabled ? 'active' : ''}`} type="button" onClick={toggleRemoteAudio}>
              {!callState.speakerEnabled ? 'Звук выкл.' : 'Звук'}
            </button>
            {callState.kind === 'video' && (
              <button className={`pa-secondary-btn pa-call-mini-btn ${!callState.cameraEnabled ? 'active' : ''}`} type="button" onClick={toggleCamera}>
                {!callState.cameraEnabled ? 'Камера выкл.' : 'Камера'}
              </button>
            )}
            <button className="pa-secondary-btn pa-call-mini-btn danger" type="button" onClick={endCall}>Завершить</button>
          </div>
        )}
      </div>
    </div>
  );
}


function storyDurationLabel(minutes) {
  const safe = Number(minutes || 0);
  if (safe < 60) return `${safe} мин`;
  const hours = Math.round(safe / 60);
  return `${hours} ч`;
}

function formatStoryRemaining(expiresAt) {
  const target = new Date(expiresAt || '').getTime();
  if (!Number.isFinite(target)) return 'скоро исчезнет';
  const diff = Math.max(0, target - Date.now());
  const totalMinutes = Math.ceil(diff / 60000);
  if (totalMinutes < 60) return `${totalMinutes} мин осталось`;
  const hours = Math.ceil(totalMinutes / 60);
  return `${hours} ч осталось`;
}

function StoryDurationWheel({ options = [], value, onChange }) {
  return (
    <div className="pa-story-wheel" role="listbox" aria-label="Время жизни истории">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={`pa-story-wheel-option ${Number(value) === Number(option.value) ? 'active' : ''}`}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function MessagesStoriesComposerModal({
  open,
  onClose,
  onSubmit,
  submitting,
  draft,
  setDraft,
  durationOptions,
  chats = [],
  communities = [],
}) {
  if (!open) return null;
  const audience = String(draft?.audience || 'all');
  const kind = String(draft?.kind || 'status');
  return <div className="pa-modal-backdrop" role="presentation" onClick={onClose}><div className="pa-card pa-message-modal pa-story-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="pa-section-title">Новая история</div><div className="pa-meta" style={{ marginTop: 6 }}>Короткая временная история для окна сообщений. Можно использовать как статус, намерение или быстрый анонс.</div><div className="pa-story-composer-grid" style={{ marginTop: 12 }}><div className="pa-story-field"><label className="pa-meta">Формат</label><div className="pa-pill-row" style={{ marginTop: 8 }}><button type="button" className={`pa-messages-filter-chip ${kind === 'status' ? 'active' : ''}`} onClick={() => setDraft((prev) => ({ ...prev, kind: 'status' }))}>Статус</button><button type="button" className={`pa-messages-filter-chip ${kind === 'intent' ? 'active' : ''}`} onClick={() => setDraft((prev) => ({ ...prev, kind: 'intent' }))}>Намерение</button><button type="button" className={`pa-messages-filter-chip ${kind === 'announcement' ? 'active' : ''}`} onClick={() => setDraft((prev) => ({ ...prev, kind: 'announcement' }))}>Анонс</button></div></div><div className="pa-story-field"><label className="pa-meta">Аудитория</label><div className="pa-pill-row" style={{ marginTop: 8, flexWrap: 'wrap' }}><button type="button" className={`pa-messages-filter-chip ${audience === 'all' ? 'active' : ''}`} onClick={() => setDraft((prev) => ({ ...prev, audience: 'all' }))}>Все</button><button type="button" className={`pa-messages-filter-chip ${audience === 'close_friends' ? 'active' : ''}`} onClick={() => setDraft((prev) => ({ ...prev, audience: 'close_friends' }))}>Близкие</button><button type="button" className={`pa-messages-filter-chip ${audience === 'chat' ? 'active' : ''}`} onClick={() => setDraft((prev) => ({ ...prev, audience: 'chat' }))}>Чат</button><button type="button" className={`pa-messages-filter-chip ${audience === 'community' ? 'active' : ''}`} onClick={() => setDraft((prev) => ({ ...prev, audience: 'community' }))}>Сообщество</button></div></div><div className="pa-story-field"><label className="pa-meta">Короткий ярлык</label><input className="pa-input" value={draft?.intent || ''} onChange={(event) => setDraft((prev) => ({ ...prev, intent: event.target.value.slice(0, 96) }))} placeholder="Например: свободен / ищу фидбек / анонс" /></div><div className="pa-story-field"><label className="pa-meta">Текст истории</label><textarea className="pa-input pa-story-textarea" value={draft?.content || ''} onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value.slice(0, 280) }))} placeholder="Напишите короткий статус, намерение или анонс" /></div>{audience === 'chat' ? <div className="pa-story-field"><label className="pa-meta">Чат</label><select className="pa-input" value={String(draft?.chat_user_id || '')} onChange={(event) => setDraft((prev) => ({ ...prev, chat_user_id: event.target.value || '' }))}><option value="">Выберите чат</option>{chats.map((chat) => <option key={chat.id} value={chat.id}>{chat.name}</option>)}</select></div> : null}{audience === 'community' ? <div className="pa-story-field"><label className="pa-meta">Сообщество</label><select className="pa-input" value={String(draft?.community_id || '')} onChange={(event) => setDraft((prev) => ({ ...prev, community_id: event.target.value || '' }))}><option value="">Выберите сообщество</option>{communities.map((community) => <option key={community.id} value={community.id}>{community.name}</option>)}</select></div> : null}<div className="pa-story-field"><label className="pa-meta">Время жизни</label><StoryDurationWheel options={durationOptions} value={draft?.duration_minutes} onChange={(next) => setDraft((prev) => ({ ...prev, duration_minutes: next }))} /></div></div><div className="pa-action-row" style={{ marginTop: 16, justifyContent: 'space-between', flexWrap: 'wrap' }}><span className="pa-pill neutral">История исчезнет через {storyDurationLabel(draft?.duration_minutes)}</span><div className="pa-action-row"><button className="pa-secondary-btn" type="button" onClick={onClose} disabled={submitting}>Отмена</button><button className="pa-primary-btn" type="button" onClick={onSubmit} disabled={submitting}>{submitting ? 'Создаю…' : 'Опубликовать'}</button></div></div></div></div>;
}

export function MessagesStoriesViewerModal({
  open,
  onClose,
  story,
  replies = [],
  replyInput,
  setReplyInput,
  onReply,
  replying,
  durationOptions,
  onExtend,
  extending,
  onDelete,
  deleting,
  canDelete,
  canExtend,
}) {
  const [extendValue, setExtendValue] = useState(60);
  useEffect(() => {
    if (!open) return;
    setExtendValue(Number(story?.duration_minutes || 60));
  }, [open, story?.id, story?.duration_minutes]);
  if (!open || !story) return null;
  return <div className="pa-modal-backdrop" role="presentation" onClick={onClose}><div className="pa-card pa-message-modal pa-story-viewer-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="pa-inline-row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}><div><div className="pa-section-title">{story.user?.first_name || story.user?.username || 'История'}</div><div className="pa-meta" style={{ marginTop: 6 }}>{story.intent || 'Временный статус'} · {formatStoryRemaining(story.expires_at)}</div></div><div className="pa-pill-row"><span className="pa-pill neutral">{story.audience === 'community' ? 'Сообщество' : story.audience === 'chat' ? 'Чат' : story.audience === 'close_friends' ? 'Близкие' : 'Все'}</span>{story.extend_count ? <span className="pa-pill warning">Продлений: {story.extend_count}/2</span> : null}</div></div><div className="pa-story-viewer-card" style={{ marginTop: 14 }}><div className="pa-story-viewer-intent">{story.intent || (story.kind === 'announcement' ? 'Анонс' : story.kind === 'intent' ? 'Намерение' : 'Статус')}</div><div className="pa-story-viewer-text">{story.content}</div>{story.community?.name ? <div className="pa-meta" style={{ marginTop: 12 }}>Сообщество: {story.community.name}</div> : null}</div>{canExtend ? <section className="pa-card pa-story-extend-card" style={{ marginTop: 12 }}><div className="pa-name" style={{ marginBottom: 8 }}>Продлить историю</div><div className="pa-meta" style={{ marginBottom: 10 }}>Можно продлить не больше двух раз.</div><StoryDurationWheel options={durationOptions} value={extendValue} onChange={setExtendValue} /><div className="pa-action-row" style={{ marginTop: 10, justifyContent: 'space-between', flexWrap: 'wrap' }}><span className="pa-pill neutral">Новое продление: {storyDurationLabel(extendValue)}</span><div className="pa-action-row">{canDelete ? <button className="pa-secondary-btn" type="button" onClick={onDelete} disabled={deleting}>{deleting ? 'Удаляю…' : 'Удалить'}</button> : null}<button className="pa-primary-btn" type="button" onClick={() => onExtend(extendValue)} disabled={extending || story.extend_count >= 2}>{extending ? 'Продлеваю…' : 'Продлить'}</button></div></div></section> : null}<section className="pa-card pa-story-replies-card" style={{ marginTop: 12 }}><div className="pa-section-title">Временный тред</div><div className="pa-meta" style={{ marginTop: 6 }}>Ответы живут вместе с историей и исчезнут после её завершения.</div><div className="pa-story-replies-list" style={{ marginTop: 12 }}>{replies.length ? replies.map((reply) => <div key={reply.id} className="pa-story-reply-item"><div className="pa-inline-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}><div className="pa-name">{reply.user?.first_name || reply.user?.username || 'Пользователь'}</div><div className="pa-meta">{formatTime(reply.created_at)}</div></div><div className="pa-bio" style={{ marginTop: 6 }}>{reply.content}</div></div>) : <div className="pa-meta">Ответов пока нет.</div>}</div><div className="pa-action-row" style={{ marginTop: 12, alignItems: 'stretch' }}><input className="pa-input" value={replyInput} onChange={(event) => setReplyInput(event.target.value)} placeholder="Ответить на историю" /><button className="pa-primary-btn" type="button" onClick={onReply} disabled={replying}>{replying ? 'Отправка…' : 'Ответить'}</button></div></section><div className="pa-action-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button className="pa-secondary-btn" type="button" onClick={onClose}>Закрыть</button></div></div></div>;
}

export function MessagesSidebarBlock({
  navigate,
  chatStats,
  chatQuery,
  setChatQuery,
  searchInputRef,
  chatFilter,
  setChatFilter,
  chatFilters,
  handleRefreshChats,
  chatError,
  loadingChats,
  chats,
  filteredChats,
  selectedChatId,
  handleSelectChat,
  stories,
  storiesLoading,
  onOpenCreateStory,
  onOpenStory,
}) {
  return (
    <section className="pa-card pa-messages-sidebar">
      <PostAuthHero
        className="pa-messages-hero"
        badge={<div className="pa-feed-badge pa-accent-badge">Связь с людьми</div>}
        title="Сообщения"
        text="Экран сообщений теперь разбит на два больших блока: список диалогов и активная переписка. Логика остаётся в одном месте, а JSX перестал быть монолитом."
        stats={[
          { key: 'total', value: chatStats.total, label: 'всего чатов', tone: 'neutral' },
          { key: 'unread', value: chatStats.unread, label: 'непрочитанных', tone: 'accent' },
          { key: 'online', value: chatStats.online, label: 'онлайн', tone: 'green' },
        ]}
      />

      <div className="pa-card pa-story-strip-card">
        <PostAuthSectionHead
          className="pa-messages-list-head"
          title="Истории"
          meta={`${Array.isArray(stories) ? stories.length : 0} активных`}
          actions={<button className="pa-link-btn" type="button" onClick={onOpenCreateStory}>Создать</button>}
        />
        {storiesLoading ? <div className="pa-loading" style={{ marginTop: 10 }}>Загружаю истории…</div> : (
          <div className="pa-story-strip">
            <button type="button" className="pa-story-chip pa-story-chip-create" onClick={onOpenCreateStory}>
              <div className="pa-story-chip-avatar">＋</div>
              <div className="pa-story-chip-label">Новая</div>
            </button>
            {(stories || []).map((story) => (
              <button key={story.id} type="button" className={`pa-story-chip ${story.viewed ? 'viewed' : ''}`} onClick={() => onOpenStory(story)}>
                <div className="pa-story-chip-avatar">{story.community?.name ? '🫂' : (story.user?.first_name?.[0] || story.user?.username?.[0] || '•')}</div>
                <div className="pa-story-chip-label">{story.community?.name || story.user?.first_name || story.user?.username || 'История'}</div>
                <div className="pa-story-chip-meta">{story.intent || 'Статус'}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="pa-card pa-messages-search-card">
        <PostAuthSearchField
          value={chatQuery}
          onChange={(event) => setChatQuery(event.target.value)}
          placeholder="Найти чат, имя или последнее сообщение"
          inputRef={searchInputRef}
        />
        <div className="pa-messages-filter-row">
          {chatFilters.map((filter) => {
            const count = filter.key === 'all'
              ? chatStats.total
              : filter.key === 'unread'
                ? chatStats.unread
                : chatStats.online;
            return (
              <button
                key={filter.key}
                type="button"
                className={`pa-messages-filter-chip ${chatFilter === filter.key ? 'active' : ''}`}
                onClick={() => setChatFilter(filter.key)}
              >
                <span>{filter.label}</span>
                <span className="pa-messages-filter-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      <PostAuthSectionHead
        className="pa-messages-list-head"
        title="Диалоги"
        meta={`${filteredChats.length} в текущем представлении`}
        actions={<button className="pa-link-btn" type="button" onClick={handleRefreshChats}>Обновить</button>}
      />

      {chatError && <div className="pa-error" style={{ marginTop: 12 }}>{chatError}</div>}
      {loadingChats ? <div className="pa-loading">Загружаю чаты…</div> : chats.length === 0 ? <PostAuthEmptyState title="Чатов пока нет" text="Начните разговор из профиля другого пользователя." icon="💬" primaryAction={{ label: 'Открыть людей', onClick: () => navigate('/friends') }} secondaryAction={{ label: 'Обновить', onClick: handleRefreshChats }} className="pa-messages-empty" /> : (
        <div className="pa-chat-list pa-chat-list-redesign">
          {filteredChats.map((chat) => (
            <button key={chat.id} type="button" className={`pa-chat-item pa-chat-item-redesign ${String(chat.id) === String(selectedChatId) ? 'active' : ''}`} onClick={() => handleSelectChat(chat.id)}>
              <div className="pa-chat-item-topline">
                <div className="pa-inline-row" style={{ minWidth: 0 }}>
                  <div className={`pa-avatar-sm pa-chat-avatar ${chat.online ? 'online' : ''}`}>{chat.avatar}</div>
                  <div className="pa-chat-main">
                    <div className="pa-chat-name-wrap">
                      <div className="pa-chat-name">{chat.name}</div>
                      {chat.online && <span className="pa-pill green">онлайн</span>}
                      {chat.isPlaceholder && <span className="pa-pill neutral">новый чат</span>}
                    </div>
                    <div className="pa-meta">{chat.username ? `@${chat.username}` : 'личный диалог'}</div>
                  </div>
                </div>
                <div className="pa-chat-item-side">
                  <span className="pa-time">{chat.lastMessage ? '' : formatTime(chat.lastSeen)}</span>
                  {chat.hasDraft && <span className="pa-pill warning">черновик</span>}
                  {chat.unread > 0 && <span className="pa-pill accent">{chat.unread}</span>}
                </div>
              </div>
              <div className="pa-chat-preview-row">
                <div className={`pa-chat-preview-text ${chat.hasDraft ? 'is-draft' : ''}`}>
                  {chat.hasDraft ? `Черновик: ${chat.draftPreview}` : (chat.lastMessage || (chat.online ? 'Можно написать прямо сейчас' : 'Переписка ещё не началась'))}
                </div>
              </div>
            </button>
          ))}
          {chatQuery.trim() && filteredChats.length === 0 && (
            <PostAuthEmptyState title="Совпадений нет" text="Попробуйте другой запрос, откройте людей или переключите фильтр чатов." icon="🔎" primaryAction={{ label: 'Открыть людей', onClick: () => navigate('/friends') }} secondaryAction={{ label: 'Очистить поиск', onClick: () => setChatQuery('') }} className="pa-messages-empty" />
          )}
        </div>
      )}
    </section>
  );
}


function MessagesE2EEModal({
  open,
  onClose,
  onRefresh,
  summary,
  loading,
  actionLoading,
  onAction,
}) {
  if (!open) return null;
  const remoteDevices = Array.isArray(summary?.remote_devices) ? summary.remote_devices : [];
  const currentDevice = summary?.current_device || null;
  return (
    <div className="pa-overlay" onClick={onClose}>
      <div className="pa-modal-wrap" onClick={(event) => event.stopPropagation()}>
        <div className="pa-modal pa-settings-modal" style={{ maxWidth: 760 }}>
          <div className="pa-discovery-badge">Проверка шифрования</div>
          <div className="pa-section-title" style={{ marginTop: 10 }}>Safety numbers и устройства</div>
          <div className="pa-bio" style={{ marginTop: 8 }}>
            Сверь safety number с собеседником по другому каналу. Если ключ изменился неожиданно, не отправляй новые секретные сообщения, пока не подтвердишь новое устройство.
          </div>
          <div className="pa-action-row" style={{ marginTop: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <div className="pa-pill-row">
              <span className={`pa-pill ${summary?.has_changed_keys ? 'red' : (summary?.verified_devices_count ? 'green' : 'warning')}`}>
                {summary?.has_changed_keys ? 'Ключ изменился' : (summary?.verified_devices_count ? 'Есть подтверждённые устройства' : 'Нужна проверка')}
              </span>
              <span className="pa-pill neutral">Устройств: {remoteDevices.length}</span>
            </div>
            <div className="pa-action-row" style={{ flexWrap: 'wrap' }}>
              <button className="pa-secondary-btn" type="button" onClick={onRefresh} disabled={loading}>Обновить</button>
              <button className="pa-secondary-btn" type="button" onClick={onClose}>Закрыть</button>
            </div>
          </div>

          {currentDevice && (
            <section className="pa-card pa-settings-panel" style={{ marginTop: 12 }}>
              <div className="pa-section-title">Текущее устройство</div>
              <div className="pa-bio" style={{ marginTop: 6 }}>Это fingerprint твоего активного устройства. Он участвует в расчёте safety numbers.</div>
              <div className="pa-postauth-summary-grid pa-settings-meta-grid" style={{ marginTop: 12 }}>
                <div className="pa-settings-meta-card"><div className="pa-settings-meta-label">Device ID</div><div className="pa-settings-meta-value">{currentDevice.device_id || '—'}</div></div>
                <div className="pa-settings-meta-card"><div className="pa-settings-meta-label">Fingerprint</div><div className="pa-settings-meta-value" style={{ wordBreak: 'break-word' }}>{currentDevice.fingerprint_formatted || '—'}</div></div>
              </div>
              <div className="pa-action-row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button className="pa-secondary-btn" type="button" onClick={() => copyToClipboardSafe(currentDevice.fingerprint_formatted || currentDevice.fingerprint || '')}>Скопировать fingerprint</button>
              </div>
            </section>
          )}

          <div className="pa-list" style={{ marginTop: 12 }}>
            {remoteDevices.length ? remoteDevices.map((device) => {
              const loadingKeyPrefix = String(actionLoading || '');
              const busy = loadingKeyPrefix.endsWith(`:${device.device_id}`);
              return (
                <section key={device.device_id} className="pa-card pa-settings-panel">
                  <div className="pa-settings-panel-head">
                    <div>
                      <div className="pa-section-title">{device.label || device.device_id || 'Устройство собеседника'}</div>
                      <div className="pa-bio" style={{ marginTop: 6 }}>Device ID: {device.device_id || '—'}</div>
                    </div>
                    <div className="pa-pill-row">
                      <span className={`pa-pill ${device.signature_valid ? 'green' : 'red'}`}>{device.signature_valid ? 'Подпись валидна' : 'Подпись невалидна'}</span>
                      <span className={`pa-pill ${device.trust_status === 'changed' ? 'red' : (device.verified ? 'green' : 'warning')}`}>{device.trust_status === 'changed' ? 'Ключ изменился' : (device.verified ? 'Подтверждено' : 'Не подтверждено')}</span>
                    </div>
                  </div>
                  <div className="pa-postauth-summary-grid pa-settings-meta-grid" style={{ marginTop: 12 }}>
                    <div className="pa-settings-meta-card"><div className="pa-settings-meta-label">Fingerprint</div><div className="pa-settings-meta-value" style={{ wordBreak: 'break-word' }}>{device.fingerprint_formatted || '—'}</div></div>
                    <div className="pa-settings-meta-card"><div className="pa-settings-meta-label">Safety number</div><div className="pa-settings-meta-value" style={{ wordBreak: 'break-word' }}>{device.safety_number || '—'}</div></div>
                  </div>
                  <div className="pa-action-row" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                    <button className="pa-secondary-btn" type="button" onClick={() => copyToClipboardSafe(device.fingerprint_formatted || device.fingerprint || '')}>Скопировать fingerprint</button>
                    <button className="pa-secondary-btn" type="button" onClick={() => copyToClipboardSafe(device.safety_number || '')}>Скопировать safety number</button>
                    {device.trust_status === 'changed' ? (
                      <>
                        <button className="pa-secondary-btn" type="button" onClick={() => onAction('accept', device.device_id)} disabled={busy}>Принять новый ключ</button>
                        <button className="pa-primary-btn" type="button" onClick={() => onAction('accept_verify', device.device_id)} disabled={busy}>Принять и подтвердить</button>
                      </>
                    ) : device.verified ? (
                      <button className="pa-secondary-btn" type="button" onClick={() => onAction('unverify', device.device_id)} disabled={busy}>Снять подтверждение</button>
                    ) : (
                      <button className="pa-primary-btn" type="button" onClick={() => onAction('verify', device.device_id)} disabled={busy || !device.signature_valid}>Подтвердить устройство</button>
                    )}
                  </div>
                </section>
              );
            }) : (
              <div className="pa-card" style={{ padding: 16 }}>У собеседника пока нет активных E2EE-устройств.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MessagesForwardModal({ open, onClose, chats = [], forwardingMessage, forwarding, onForward }) {
  const [query, setQuery] = useState('');
  if (!open || !forwardingMessage) return null;
  const value = String(query || '').trim().toLowerCase();
  const filtered = chats.filter((chat) => !value || `${chat?.name || ''} ${chat?.username || ''}`.toLowerCase().includes(value));
  return <div className="pa-modal-backdrop" role="presentation" onClick={onClose}><div className="pa-card pa-message-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="pa-section-title">Переслать сообщение</div><div className="pa-meta" style={{ marginTop: 6 }}>Выберите диалог для пересылки текущего сообщения.</div><div className="pa-card pa-message-forward-preview" style={{ marginTop: 12 }}>{renderMessageBody(forwardingMessage)}</div><div style={{ marginTop: 12 }}><PostAuthSearchField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Найти чат" /></div><div className="pa-message-modal-list" style={{ marginTop: 12 }}>{filtered.length ? filtered.map((chat) => <button key={chat.id} type="button" className="pa-message-modal-option" onClick={() => onForward(chat.id)} disabled={forwarding}><div className={`pa-avatar-sm ${chat.online ? 'online' : ''}`}>{chat.avatar}</div><div className="pa-message-modal-option-main"><div className="pa-name">{chat.name}</div><div className="pa-meta">{chat.username ? `@${chat.username}` : 'Личный чат'}</div></div><span className="pa-pill neutral">{forwarding ? '...' : 'Переслать'}</span></button>) : <div className="pa-meta">Ничего не найдено.</div>}</div><div className="pa-action-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button className="pa-secondary-btn" type="button" onClick={onClose} disabled={forwarding}>Закрыть</button></div></div></div>;
}

function MessagesMediaGalleryModal({ open, onClose, items = [], onJumpToMessage }) {
  if (!open) return null;
  return <div className="pa-modal-backdrop" role="presentation" onClick={onClose}><div className="pa-card pa-message-modal pa-message-gallery-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><div className="pa-section-title">Медиа в текущем чате</div><div className="pa-meta" style={{ marginTop: 6 }}>Здесь показываются медиа из уже загруженной истории.</div><div className="pa-message-modal-list" style={{ marginTop: 12 }}>{items.length ? items.slice().reverse().map((item) => <div key={item.id} className="pa-message-modal-option pa-message-gallery-item"><div className="pa-message-modal-option-main"><div className="pa-name">{item.type === 'voice' ? 'Голосовое сообщение' : 'Видеокружок'}{item.mine ? ' · ваше' : ''}</div><div className="pa-meta">{formatTime(item.created_at)}{item.content ? ` · ${item.content}` : ''}</div><div style={{ marginTop: 8 }}>{renderMessageBody(item)}</div></div><div className="pa-action-row pa-message-gallery-actions"><button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={() => onJumpToMessage(item.id)}>К сообщению</button></div></div>) : <div className="pa-meta">Медиа пока нет.</div>}</div><div className="pa-action-row" style={{ marginTop: 14, justifyContent: 'flex-end' }}><button className="pa-secondary-btn" type="button" onClick={onClose}>Закрыть</button></div></div></div>;
}

export function MessagesConversationBlock({
  navigate,
  selectedChat,
  relationshipMeta,
  selectedRelationship,
  selectedChatProfilePath,
  handleRefreshConversation,
  handlePeerFriendAction,
  handlePeerSubscribeToggle,
  peerActionLoading,
  messageError,
  loadingMessages,
  loadingOlderMessages,
  messages,
  timelineItems,
  messageStackRef,
  messageInputRef,
  handleDelete,
  handleRetryFailedMessage,
  deletingId,
  messageInput,
  editingMessage,
  handleMessageInputChange,
  handleSend,
  handleStartEdit,
  handleCancelEdit,
  handleOpenForward,
  sending,
  handleRefreshChats,
  handleLoadOlderMessages,
  messagesHasMore,
  conversationQuery,
  handleConversationQueryChange,
  conversationMatchesCount,
  activeConversationMatchIndex,
  activeConversationMatchId,
  handleJumpConversationMatch,
  handleClearConversationSearch,
  recordingState,
  recordingPreviewRef,
  handleStartVoiceRecording,
  handleStartVideoRecording,
  handleStopRecording,
  handleCancelRecording,
  callState,
  isCallAvailable,
  startAudioCall,
  startVideoCall,
  acceptIncomingCall,
  declineCall,
  endCall,
  toggleMute,
  toggleCamera,
  toggleRemoteAudio,
  localVideoRef,
  remoteVideoRef,
  remoteAudioRef,
  securitySummary,
  securityLoading,
  mediaGalleryItems,
  mediaGalleryOpen,
  handleOpenMediaGallery,
  handleCloseMediaGallery,
  handleJumpToMessage,
  forwardingMessage,
  forwarding,
  chatsForForward,
  handleForwardToChat,
  handleCloseForward,
  securityModalOpen,
  securityActionLoading,
  handleOpenSecurityPanel,
  handleCloseSecurityPanel,
  handleSecurityAction,
}) {
  const e2eeTone = securitySummary?.has_changed_keys ? 'red' : (securitySummary?.verified_devices_count ? 'green' : (securitySummary?.available ? 'warning' : 'neutral'));
  const e2eeLabel = securityLoading
    ? 'Проверяю ключи…'
    : securitySummary?.has_changed_keys
      ? 'Ключ изменился'
      : securitySummary?.verified_devices_count
        ? 'Устройства подтверждены'
        : securitySummary?.available
          ? 'Нужна проверка'
          : 'E2EE недоступно';
  return (
    <section className="pa-card pa-conversation pa-conversation-redesign">
      {selectedChat ? (
        <>
          <div className="pa-conversation-hero">
            <button type="button" className="pa-conversation-peer" onClick={() => navigate(`/profile/${selectedChat.id}`)}>
              <div className={`pa-avatar-sm pa-conversation-peer-avatar ${selectedChat.online ? 'online' : ''}`}>{selectedChat.avatar}</div>
              <div className="pa-conversation-peer-main">
                <div className="pa-name">{selectedChat.name}</div>
                <div className="pa-meta">{selectedChat.online ? 'В сети' : selectedChat.lastSeen ? `Был(а) ${formatTime(selectedChat.lastSeen)}` : 'Не в сети'}</div>
              </div>
            </button>
            <div className="pa-pill-row pa-conversation-top-actions">
              {isCallAvailable && (
                <>
                  <button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={startAudioCall}>Аудио</button>
                  <button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={startVideoCall}>Видео</button>
                </>
              )}
              <button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={handleOpenMediaGallery}>Медиа</button>
              <button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={() => navigate(selectedChatProfilePath)}>Профиль</button>
              {!selectedChat.isSelf && <button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={handleOpenSecurityPanel}>Шифрование</button>}
              <button className="pa-link-btn" type="button" onClick={handleRefreshConversation}>Обновить</button>
            </div>
          </div>

          <div className="pa-conversation-meta-card">
            <div className="pa-pill-row">
              <span className={`pa-pill ${relationshipMeta.cls}`}>{relationshipMeta.label}</span>
              {selectedChat.username && <span className="pa-pill neutral">@{selectedChat.username}</span>}
              {selectedChat.isPlaceholder && <span className="pa-pill neutral">новый диалог</span>}
              {!selectedChat.isSelf && <span className={`pa-pill ${e2eeTone}`}>{e2eeLabel}</span>}
            </div>
            {!selectedChat.isSelf && (
              <div className="pa-action-row pa-conversation-relation-actions">
                {(selectedRelationship === 'none' || selectedRelationship === 'subscribed' || selectedRelationship === 'request_received' || selectedRelationship === 'friends') && (
                  <button className="pa-secondary-btn" type="button" disabled={peerActionLoading || selectedRelationship === 'request_sent'} onClick={handlePeerFriendAction}>
                    {peerActionLoading ? '...' : selectedRelationship === 'friends' ? 'Удалить из друзей' : selectedRelationship === 'request_received' ? 'Принять заявку' : 'В друзья'}
                  </button>
                )}
                {(selectedRelationship === 'none' || selectedRelationship === 'subscribed') && (
                  <button className="pa-secondary-btn" type="button" disabled={peerActionLoading} onClick={handlePeerSubscribeToggle}>
                    {peerActionLoading ? '...' : selectedRelationship === 'subscribed' ? 'Отписаться' : 'Подписаться'}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="pa-card pa-conversation-search-card">
            <div className="pa-inline-row pa-conversation-search-head" style={{ justifyContent: 'space-between', width: '100%' }}>
              <div>
                <div className="pa-section-title">Поиск по переписке</div>
                <div className="pa-meta">Поиск работает по уже загруженной истории. Для более старых сообщений можно догрузить переписку выше.</div>
              </div>
              {conversationMatchesCount > 0 && (
                <span className="pa-pill accent">{activeConversationMatchIndex + 1} / {conversationMatchesCount}</span>
              )}
            </div>
            <div className="pa-conversation-search-row">
              <PostAuthSearchField
                value={conversationQuery}
                onChange={handleConversationQueryChange}
                placeholder="Найти текст, голосовое или медиа в текущем чате"
              />
              <div className="pa-inline-row pa-conversation-search-actions">
                <button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={() => handleJumpConversationMatch(-1)} disabled={!conversationMatchesCount}>↑</button>
                <button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={() => handleJumpConversationMatch(1)} disabled={!conversationMatchesCount}>↓</button>
                <button className="pa-link-btn" type="button" onClick={handleClearConversationSearch} disabled={!conversationQuery.trim()}>Очистить</button>
              </div>
            </div>
          </div>

          {!selectedChat.isSelf && securitySummary?.has_changed_keys && (
            <div className="pa-error" style={{ marginTop: 12 }}>
              Ключ одного из устройств собеседника изменился. Прежде чем отправлять новые личные сообщения, открой раздел шифрования и подтверди новый ключ.
              <div className="pa-action-row" style={{ marginTop: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="pa-secondary-btn" type="button" onClick={handleOpenSecurityPanel}>Проверить ключи</button>
              </div>
            </div>
          )}
          {!selectedChat.isSelf && !securitySummary?.has_changed_keys && securitySummary?.has_unverified_devices && (
            <div className="pa-card pa-settings-info-card" style={{ marginTop: 12, padding: 14 }}>
              <div className="pa-section-title">Шифрование активно, но устройства ещё не подтверждены</div>
              <div className="pa-bio" style={{ marginTop: 6 }}>Сверь safety number с собеседником и подтверди устройство, если хочешь защититься от незаметной подмены ключа.</div>
              <div className="pa-action-row" style={{ marginTop: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button className="pa-secondary-btn" type="button" onClick={handleOpenSecurityPanel}>Открыть проверку</button>
              </div>
            </div>
          )}

          {messageError && <div className="pa-error" style={{ marginTop: 12 }}>{messageError}<div className="pa-action-row" style={{ marginTop: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}><button className="pa-secondary-btn" type="button" onClick={handleRefreshConversation}>Повторить</button><button className="pa-primary-btn" type="button" onClick={() => navigate(selectedChatProfilePath)}>Открыть профиль</button></div></div>}
          {loadingMessages ? <div className="pa-loading">Загружаю переписку…</div> : (
            <div className="pa-message-stack pa-message-stack-redesign" ref={messageStackRef}>
              {messagesHasMore && (
                <div className="pa-message-stack-load-older">
                  <button className="pa-secondary-btn" type="button" onClick={handleLoadOlderMessages} disabled={loadingOlderMessages}>
                    {loadingOlderMessages ? 'Загружаю ранние сообщения…' : 'Загрузить более ранние сообщения'}
                  </button>
                </div>
              )}
              {conversationQuery.trim() && !conversationMatchesCount && (
                <div className="pa-message-search-note">По текущему запросу совпадений пока нет в загруженной истории.</div>
              )}
              {messages.length === 0 ? <PostAuthEmptyState title="Пустой диалог" text={selectedChat?.isSelf ? 'Это ваш собственный профиль — переписка недоступна.' : 'Напишите первое сообщение или откройте профиль собеседника.'} icon={selectedChat?.isSelf ? '🙈' : '✉️'} primaryAction={!selectedChat?.isSelf ? { label: 'Написать сообщение', onClick: () => messageInputRef.current?.focus() } : null} secondaryAction={!selectedChat?.isSelf ? { label: 'Открыть профиль', onClick: () => navigate(selectedChatProfilePath) } : null} className="pa-messages-empty" /> : timelineItems.map((item) => {
                if (item.type === 'divider') {
                  return <div key={item.id} className="pa-message-date-divider">{item.label}</div>;
                }
                const message = item.message;
                const mine = Boolean(message.mine);
                const activeSearchMatch = Boolean(activeConversationMatchId) && String(activeConversationMatchId) === String(message.id);
                const hasSearchMatch = conversationQuery.trim() && String(message.content || message.text || '').toLowerCase().includes(String(conversationQuery || '').trim().toLowerCase());
                const deliveryLabel = messageDeliveryLabel(message);
                return (
                  <div key={message.id} data-message-id={message.id} className={`pa-message-row ${mine ? 'mine' : 'theirs'} ${message.failed ? 'failed' : ''} ${message.fxDirection === 'outgoing' ? 'fx-outgoing' : ''} ${message.fxDirection === 'incoming' ? 'fx-incoming' : ''} ${hasSearchMatch ? 'search-match' : ''} ${activeSearchMatch ? 'search-match-current' : ''}`}>
                    <div className={`pa-message-bubble pa-message-bubble-redesign ${message.type === 'voice' ? 'has-voice' : ''} ${message.type === 'video_note' ? 'has-video-note' : ''}`}>
                      {renderMessageBody(message, { searchQuery: conversationQuery, activeSearchMatch })}
                      <div className="pa-meta-row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                        <div className="pa-inline-row pa-message-status-row">
                          <span className="pa-time">{message.failed ? 'Не отправлено' : message.pending ? 'Отправка…' : formatTime(message.created_at)}</span>
                          {message.edited_at && <span className="pa-pill warning">Изменено</span>}
                          {deliveryLabel && <span className={`pa-pill ${message.is_read ? 'green' : 'neutral'}`}>{deliveryLabel}</span>}
                        </div>
                        <div className="pa-inline-row pa-message-actions-row">
                          {message.content && (
                            <button className="pa-link-btn" type="button" onClick={() => copyToClipboardSafe(message.content)}>
                              Копировать
                            </button>
                          )}
                          {message.failed && mine && (
                            <button className="pa-link-btn" type="button" onClick={() => handleRetryFailedMessage(message)}>
                              Повторить
                            </button>
                          )}
                          {!message.pending && !message.failed && (
                            <button className="pa-link-btn" type="button" onClick={() => handleOpenForward(message)}>
                              Переслать
                            </button>
                          )}
                          {mine && !message.pending && !message.failed && message.type === 'text' && (
                            <button className="pa-link-btn" type="button" onClick={() => handleStartEdit(message)}>
                              Изменить
                            </button>
                          )}
                          {mine && !message.pending && !message.failed && (
                            <button className="pa-link-btn" onClick={() => handleDelete(message.id)} disabled={deletingId === message.id}>
                              {deletingId === message.id ? 'Удаляю…' : 'Удалить'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <RecordingPanel
            recordingState={recordingState}
            recordingPreviewRef={recordingPreviewRef}
            handleStopRecording={handleStopRecording}
            handleCancelRecording={handleCancelRecording}
          />
          {editingMessage && (<div className="pa-card pa-message-edit-banner"><div><div className="pa-section-title">Редактирование сообщения</div><div className="pa-meta" style={{ marginTop: 4 }}>После сохранения текст обновится в чате.</div></div><div className="pa-action-row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}><button className="pa-secondary-btn pa-secondary-btn-compact" type="button" onClick={handleCancelEdit}>Отмена</button></div></div>)}
          <div className="pa-message-input-row pa-message-input-row-redesign">
            <div className="pa-message-input-wrap pa-message-input-wrap-redesign pa-message-input-wrap-rich">
              <button type="button" className="pa-message-input-decor" onClick={recordingState.active && recordingState.kind === 'voice' ? handleStopRecording : handleStartVoiceRecording} disabled={recordingState.uploading}>
                {recordingState.active && recordingState.kind === 'voice' ? '■' : '🎤'}
              </button>
              <button type="button" className="pa-message-input-decor" onClick={recordingState.active && recordingState.kind === 'video_note' ? handleStopRecording : handleStartVideoRecording} disabled={recordingState.uploading}>
                {recordingState.active && recordingState.kind === 'video_note' ? '■' : '🎬'}
              </button>
              <input
                ref={messageInputRef}
                className="pa-input"
                value={messageInput}
                onChange={handleMessageInputChange}
                placeholder={recordingState.uploading ? 'Подождите, идёт загрузка…' : 'Напишите сообщение'}
                disabled={recordingState.active || recordingState.uploading}
                onKeyDown={(e) => { if (shouldSubmitOnEnter(e)) { e.preventDefault(); handleSend(); } }}
              />
            </div>
            <button className="pa-primary-btn" onClick={handleSend} disabled={!messageInput.trim() || sending || recordingState.active || recordingState.uploading}>{sending ? (editingMessage ? 'Сохраняю…' : 'Отправляю…') : (editingMessage ? 'Сохранить' : 'Отправить')}</button>
          </div>
          <MessagesForwardModal
            open={Boolean(forwardingMessage)}
            onClose={handleCloseForward}
            chats={chatsForForward}
            forwardingMessage={forwardingMessage}
            forwarding={forwarding}
            onForward={handleForwardToChat}
          />
          <MessagesMediaGalleryModal
            open={mediaGalleryOpen}
            onClose={handleCloseMediaGallery}
            items={mediaGalleryItems}
            onJumpToMessage={handleJumpToMessage}
          />
          <MessagesE2EEModal
            open={securityModalOpen}
            onClose={handleCloseSecurityPanel}
            onRefresh={handleOpenSecurityPanel}
            summary={securitySummary}
            loading={securityLoading}
            actionLoading={securityActionLoading}
            onAction={handleSecurityAction}
          />
        </>
      ) : <PostAuthEmptyState title="Выберите чат" text="Слева отображается список пользователей, с которыми уже была переписка. Можно открыть людей и начать новый диалог." icon="🧭" primaryAction={{ label: 'Открыть людей', onClick: () => navigate('/friends') }} secondaryAction={{ label: 'Обновить', onClick: handleRefreshChats }} className="pa-messages-empty" />}

      <MessagesCallOverlay
        callState={callState}
        localVideoRef={localVideoRef}
        remoteVideoRef={remoteVideoRef}
        remoteAudioRef={remoteAudioRef}
        acceptIncomingCall={acceptIncomingCall}
        declineCall={declineCall}
        endCall={endCall}
        toggleMute={toggleMute}
        toggleCamera={toggleCamera}
        toggleRemoteAudio={toggleRemoteAudio}
      />
    </section>
  );
}
