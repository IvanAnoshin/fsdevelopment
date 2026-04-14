const STORAGE_KEYS = {
  user: 'user',
  tempToken: 'temp_token',
  savedAccounts: 'saved_accounts_v2',
  activeAccount: 'active_account_key_v2',
  behaviorAuthOutcome: 'dfsn_behavior_auth_outcome_v1',
};

const isBrowser = typeof window !== 'undefined';
let inMemoryAccessToken = '';

function safeSessionStorage() {
  if (!isBrowser) return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function safeLocalStorage() {
  if (!isBrowser) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function emitAuthChanged() {
  if (!isBrowser) return;
  window.dispatchEvent(new CustomEvent('app:auth-changed'));
}

function readRaw(key, storage = 'session') {
  const source = storage === 'local' ? safeLocalStorage() : safeSessionStorage();
  return source?.getItem(key) ?? null;
}

function writeRaw(key, value, storage = 'session') {
  const source = storage === 'local' ? safeLocalStorage() : safeSessionStorage();
  if (!source) return;
  if (value == null || value === '') {
    source.removeItem(key);
    emitAuthChanged();
    return;
  }
  source.setItem(key, value);
  emitAuthChanged();
}

function removeRaw(key, storage = 'session') {
  const source = storage === 'local' ? safeLocalStorage() : safeSessionStorage();
  source?.removeItem(key);
  emitAuthChanged();
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function accountKeyForUser(user) {
  if (!user) return '';
  if (user.id != null) return `user:${user.id}`;
  if (user.username) return `username:${String(user.username).toLowerCase()}`;
  const first = String(user.first_name || '').trim().toLowerCase();
  const last = String(user.last_name || '').trim().toLowerCase();
  if (first || last) return `name:${first}.${last}`;
  return '';
}

function displayNameForUser(user) {
  if (!user) return 'Аккаунт';
  const fullName = `${user.first_name || ''} ${user.last_name || ''}`.trim();
  return fullName || user.username || `Аккаунт #${user.id || '—'}`;
}

function sanitizeSavedAccount(account) {
  if (!account || typeof account !== 'object') return null;
  if (!account.key || !account.user) return null;
  return {
    key: String(account.key),
    user: account.user,
    label: account.label || displayNameForUser(account.user),
    subtitle: account.subtitle || (account.user.username ? `@${account.user.username}` : ''),
    createdAt: account.createdAt || new Date().toISOString(),
    lastUsedAt: account.lastUsedAt || new Date().toISOString(),
  };
}

function readSavedAccountsRaw() {
  const local = safeLocalStorage();
  const items = parseJson(local?.getItem(STORAGE_KEYS.savedAccounts), []);
  if (!Array.isArray(items)) return [];
  return items.map(sanitizeSavedAccount).filter(Boolean);
}

function writeSavedAccountsRaw(items) {
  const local = safeLocalStorage();
  if (!local) return;
  local.setItem(STORAGE_KEYS.savedAccounts, JSON.stringify(items));
}

function markActiveAccount(key) {
  const local = safeLocalStorage();
  if (!local) return;
  if (!key) {
    local.removeItem(STORAGE_KEYS.activeAccount);
    return;
  }
  local.setItem(STORAGE_KEYS.activeAccount, key);
}

function syncCurrentAccountRecord(nextUser) {
  const local = safeLocalStorage();
  if (!local) return;
  const user = nextUser ?? getStoredUser();
  if (!user) return;
  const key = accountKeyForUser(user);
  if (!key) return;

  const now = new Date().toISOString();
  const list = readSavedAccountsRaw();
  const existing = list.find((item) => item.key === key);
  const record = sanitizeSavedAccount({
    key,
    user,
    label: displayNameForUser(user),
    subtitle: user.username ? `@${user.username}` : '',
    createdAt: existing?.createdAt || now,
    lastUsedAt: now,
  });
  const nextList = [record, ...list.filter((item) => item.key !== key)].slice(0, 8);
  writeSavedAccountsRaw(nextList);
  markActiveAccount(key);
}

export function setBehaviorAuthOutcome(label) {
  writeRaw(STORAGE_KEYS.behaviorAuthOutcome, label || '');
}

export function getBehaviorAuthOutcome() {
  return readRaw(STORAGE_KEYS.behaviorAuthOutcome) || '';
}

export function clearBehaviorAuthOutcome() {
  removeRaw(STORAGE_KEYS.behaviorAuthOutcome);
}

export function getToken() {
  return inMemoryAccessToken || '';
}

export function setToken(token) {
  inMemoryAccessToken = String(token || '').trim();
  emitAuthChanged();
}

export function clearToken() {
  inMemoryAccessToken = '';
  emitAuthChanged();
}

export function getTempToken() {
  return readRaw(STORAGE_KEYS.tempToken) || '';
}

export function setTempToken(token) {
  writeRaw(STORAGE_KEYS.tempToken, token || '');
}

export function clearTempToken() {
  removeRaw(STORAGE_KEYS.tempToken);
}

export function getStoredUser() {
  const raw = readRaw(STORAGE_KEYS.user);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    removeRaw(STORAGE_KEYS.user);
    return null;
  }
}

export function setStoredUser(user) {
  if (!user) {
    removeRaw(STORAGE_KEYS.user);
    return;
  }
  writeRaw(STORAGE_KEYS.user, JSON.stringify(user));
  syncCurrentAccountRecord(user);
}

export function getSavedAccounts() {
  const activeKey = safeLocalStorage()?.getItem(STORAGE_KEYS.activeAccount) || '';
  return readSavedAccountsRaw().map((account) => ({
    key: account.key,
    user: account.user,
    label: account.label,
    subtitle: account.subtitle,
    lastUsedAt: account.lastUsedAt,
    isActive: account.key === activeKey,
  }));
}

export function switchToSavedAccount(accountKey) {
  const account = readSavedAccountsRaw().find((item) => item.key === accountKey);
  if (!account) return false;
  markActiveAccount(account.key);
  emitAuthChanged();
  return false;
}

export function removeSavedAccount(accountKey) {
  const local = safeLocalStorage();
  if (!local) return false;
  const nextList = readSavedAccountsRaw().filter((item) => item.key !== accountKey);
  writeSavedAccountsRaw(nextList);
  const activeKey = local.getItem(STORAGE_KEYS.activeAccount) || '';
  if (activeKey === accountKey) {
    local.removeItem(STORAGE_KEYS.activeAccount);
  }
  emitAuthChanged();
  return true;
}

export function clearCurrentSession() {
  clearToken();
  const session = safeSessionStorage();
  const local = safeLocalStorage();
  session?.removeItem(STORAGE_KEYS.user);
  session?.removeItem(STORAGE_KEYS.tempToken);
  local?.removeItem(STORAGE_KEYS.activeAccount);
  emitAuthChanged();
}

export function clearAuthStorage() {
  clearCurrentSession();
}

export function clearAllSavedAccounts() {
  const local = safeLocalStorage();
  local?.removeItem(STORAGE_KEYS.savedAccounts);
  local?.removeItem(STORAGE_KEYS.activeAccount);
  emitAuthChanged();
}
