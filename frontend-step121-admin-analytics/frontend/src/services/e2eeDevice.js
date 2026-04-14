const DEVICE_STORAGE_KEY = 'e2ee_device_id_v1';

function safeLocalStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createFallbackId() {
  const randomPart = Math.random().toString(36).slice(2, 12);
  return `e2ee-${Date.now().toString(36)}-${randomPart}`;
}

export function getStableE2EEDeviceIDSync() {
  const storage = safeLocalStorage();
  const existing = storage?.getItem(DEVICE_STORAGE_KEY) || '';
  if (existing) return existing;
  const next = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `e2ee-${crypto.randomUUID()}`
    : createFallbackId();
  storage?.setItem(DEVICE_STORAGE_KEY, next);
  return next;
}
