import API from './api';

export const getMediaConfig = () => API.get('/media/config');
export const createMediaUploadDraft = (data) => API.post('/media/presign', data);

export async function uploadMediaAsset(file, kind = 'images') {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  return API.post('/media/upload', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export const SUPPORTED_MEDIA_UPLOAD_TYPES = [
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/ogg',
];

export const SUPPORTED_MEDIA_UPLOAD_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.heic', '.heif', '.mp4', '.webm', '.mov', '.ogv'];

export async function uploadMediaImage(file, kind = 'images') {
  return uploadMediaAsset(file, kind);
}
export const VOICE_MAX_DURATION_SEC = 180;
export const VIDEO_NOTE_MAX_DURATION_SEC = 90;

const DRAFT_DB_NAME = 'friendscape-message-media';
const DRAFT_STORE = 'failed-message-media-drafts';
const DRAFT_DB_VERSION = 1;
let draftDbPromise = null;

function openDraftDb() {
  if (typeof window === 'undefined' || !window.indexedDB) return Promise.resolve(null);
  if (draftDbPromise) return draftDbPromise;
  draftDbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const store = db.objectStoreNames.contains(DRAFT_STORE)
        ? request.transaction.objectStore(DRAFT_STORE)
        : db.createObjectStore(DRAFT_STORE, { keyPath: 'retryKey' });
      if (!store.indexNames.contains('chatId')) store.createIndex('chatId', 'chatId', { unique: false });
      if (!store.indexNames.contains('createdAt')) store.createIndex('createdAt', 'createdAt', { unique: false });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('indexedDB open failed'));
  });
  return draftDbPromise;
}

async function withDraftStore(mode, handler) {
  const db = await openDraftDb();
  if (!db) return null;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DRAFT_STORE, mode);
    const store = tx.objectStore(DRAFT_STORE);
    const result = handler(store, resolve, reject);
    tx.onerror = () => reject(tx.error || new Error('indexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('indexedDB transaction aborted'));
    if (result && typeof result.onsuccess !== 'function') {
      tx.oncomplete = () => resolve(result);
    }
  });
}

export async function uploadMessageMedia(file, kind = 'voice', meta = {}, options = {}) {
  const form = new FormData();
  form.append('file', file);
  form.append('kind', kind);
  if (meta?.durationSec != null) form.append('duration_sec', String(meta.durationSec));
  if (meta?.width != null) form.append('width', String(meta.width));
  if (meta?.height != null) form.append('height', String(meta.height));
  return API.post('/media/upload-message', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
    onUploadProgress: options?.onUploadProgress,
  });
}

export async function saveFailedMessageMediaDraft(draft) {
  if (!draft?.retryKey || !draft?.blob) return null;
  const payload = { retryKey: String(draft.retryKey), chatId: String(draft.chatId || ''), kind: String(draft.kind || 'voice'), mime: String(draft.mime || ''), durationSec: Number(draft.durationSec || 0), createdAt: Number(draft.createdAt || Date.now()), blob: draft.blob, posterBlob: draft.posterBlob || null };
  return withDraftStore('readwrite', (store, resolve, reject) => { const req = store.put(payload); req.onsuccess = () => resolve(payload); req.onerror = () => reject(req.error || new Error('draft save failed')); return req; });
}
export async function getFailedMessageMediaDraft(retryKey) {
  if (!retryKey) return null;
  return withDraftStore('readonly', (store, resolve, reject) => { const req = store.get(String(retryKey)); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error || new Error('draft get failed')); return req; });
}
export async function listFailedMessageMediaDraftsForChat(chatId) {
  if (!chatId) return [];
  return withDraftStore('readonly', (store, resolve, reject) => {
    if (!store.indexNames.contains('chatId')) {
      const req = store.getAll(); req.onsuccess = () => resolve((req.result || []).filter((item) => String(item.chatId) === String(chatId))); req.onerror = () => reject(req.error || new Error('draft list failed')); return req;
    }
    const req = store.index('chatId').getAll(String(chatId)); req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error || new Error('draft list failed')); return req;
  });
}
export async function removeFailedMessageMediaDraft(retryKey) {
  if (!retryKey) return null;
  return withDraftStore('readwrite', (store, resolve, reject) => { const req = store.delete(String(retryKey)); req.onsuccess = () => resolve(true); req.onerror = () => reject(req.error || new Error('draft delete failed')); return req; });
}
export async function pruneFailedMessageMediaDrafts(maxAgeMs = 72 * 60 * 60 * 1000) {
  const drafts = await withDraftStore('readonly', (store, resolve, reject) => { const req = store.getAll(); req.onsuccess = () => resolve(req.result || []); req.onerror = () => reject(req.error || new Error('draft prune load failed')); return req; });
  if (!Array.isArray(drafts) || !drafts.length) return 0;
  const threshold = Date.now() - maxAgeMs;
  const stale = drafts.filter((item) => Number(item?.createdAt || 0) < threshold);
  await Promise.all(stale.map((item) => removeFailedMessageMediaDraft(item.retryKey)));
  return stale.length;
}
