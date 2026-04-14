import API from './api.js';
import { getStableE2EEDeviceIDSync } from './e2eeDevice.js';

const VAULT_DB_NAME = 'friendscape-secure-vault-v1';
const VAULT_STORE = 'entries';
const KEY_PREFIX = 'e2ee_bundle_user_';
const LAST_REGISTERED_AT_PREFIX = 'e2ee_last_registered_at_user_';
const PREVIEW_CACHE_KEY = 'e2ee_preview_cache_v1';
const TRUST_CACHE_KEY = 'e2ee_remote_trust_v1';
const DEFAULT_PREKEY_COUNT = 12;
const BACKUP_VERSION = 1;
const BACKUP_KDF_ITERATIONS = 250000;
const REMOTE_BUNDLE_TTL_MS = 5 * 60 * 1000;
const MEDIA_URL_CACHE = new Map();
const remoteBundleCache = new Map();

function canUseWebCrypto() {
  return typeof window !== 'undefined' && typeof window.crypto !== 'undefined' && !!window.crypto.subtle;
}

function safeLocalStorage() {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function userVaultKey(userId) {
  return `${KEY_PREFIX}${String(userId || '').trim()}`;
}

function lastRegisteredKey(userId) {
  return `${LAST_REGISTERED_AT_PREFIX}${String(userId || '').trim()}`;
}

function encodeBase64Url(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  source.forEach((value) => {
    binary += String.fromCharCode(value);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  if (!normalized) return new Uint8Array();
  const padded = `${normalized}${'='.repeat((4 - (normalized.length % 4)) % 4)}`;
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function stableStringify(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function exportPublicKeyString(jwk) {
  return stableStringify(jwk);
}

function parseJwkString(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function utf8Encode(value) {
  return new TextEncoder().encode(String(value ?? ''));
}

function utf8Decode(bytes) {
  return new TextDecoder().decode(bytes);
}

async function sha256Base64Url(value) {
  const digest = await window.crypto.subtle.digest('SHA-256', utf8Encode(value));
  return encodeBase64Url(new Uint8Array(digest));
}

function trustCacheEntryKey(userId, deviceId) {
  return `${String(userId || '').trim()}:${String(deviceId || '').trim()}`;
}

function readTrustCache() {
  const storage = safeLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(TRUST_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeTrustCache(next) {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(TRUST_CACHE_KEY, JSON.stringify(next || {}));
  } catch {
    // ignore storage errors
  }
}

function readTrustCacheEntry(userId, deviceId) {
  const cache = readTrustCache();
  return cache[trustCacheEntryKey(userId, deviceId)] || null;
}

function writeTrustCacheEntry(userId, deviceId, entry) {
  if (!userId || !deviceId || !entry) return;
  const cache = readTrustCache();
  cache[trustCacheEntryKey(userId, deviceId)] = {
    ...(cache[trustCacheEntryKey(userId, deviceId)] || {}),
    ...(entry || {}),
    updatedAt: Date.now(),
  };
  writeTrustCache(cache);
}

function clearTrustCacheEntry(userId, deviceId) {
  const cache = readTrustCache();
  delete cache[trustCacheEntryKey(userId, deviceId)];
  writeTrustCache(cache);
}

function isTrustEntryVerified(entry, fingerprint) {
  return Boolean(entry?.verified_at && entry?.verified_fingerprint && String(entry.verified_fingerprint) === String(fingerprint || ''));
}

function formatFingerprintGroups(fingerprint, groupSize = 6) {
  const normalized = String(fingerprint || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!normalized) return '—';
  const groups = [];
  for (let index = 0; index < normalized.length; index += groupSize) {
    groups.push(normalized.slice(index, index + groupSize));
  }
  return groups.join(' ');
}

function formatSafetyNumberFromBytes(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (!source.length) return '—';
  const groups = [];
  for (let index = 0; index < Math.min(source.length - 1, 24); index += 2) {
    const value = (((source[index] || 0) << 8) | (source[index + 1] || 0)) % 100000;
    groups.push(String(value).padStart(5, '0'));
  }
  return groups.join(' ');
}

async function computeSafetyNumber(localFingerprint, remoteFingerprint, remoteUserId, remoteDeviceId) {
  const digest = await window.crypto.subtle.digest(
    'SHA-256',
    utf8Encode(`friendscape-safety-v1::${String(localFingerprint || '')}::${String(remoteFingerprint || '')}::${String(remoteUserId || '')}::${String(remoteDeviceId || '')}`),
  );
  return formatSafetyNumberFromBytes(new Uint8Array(digest));
}


function randomBytes(length) {
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return bytes;
}

function openVault() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const request = window.indexedDB.open(VAULT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_STORE)) {
        db.createObjectStore(VAULT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function vaultGet(key) {
  const db = await openVault();
  if (!db) {
    const storage = safeLocalStorage();
    const raw = storage?.getItem(key) || '';
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return new Promise((resolve) => {
    const tx = db.transaction(VAULT_STORE, 'readonly');
    const store = tx.objectStore(VAULT_STORE);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}

async function vaultSet(key, value) {
  const db = await openVault();
  if (!db) {
    safeLocalStorage()?.setItem(key, JSON.stringify(value));
    return;
  }
  await new Promise((resolve) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    tx.objectStore(VAULT_STORE).put(value, key);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      resolve();
    };
  });
}

function readPreviewCache() {
  const storage = safeLocalStorage();
  if (!storage) return {};
  try {
    const raw = storage.getItem(PREVIEW_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writePreviewCache(next) {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(PREVIEW_CACHE_KEY, JSON.stringify(next || {}));
  } catch {
    // ignore cache quota errors
  }
}

function setCachedPreview(messageId, preview) {
  if (!messageId || !preview) return;
  const current = readPreviewCache();
  current[String(messageId)] = {
    preview: String(preview),
    updatedAt: Date.now(),
  };
  const keys = Object.keys(current);
  if (keys.length > 200) {
    keys.sort((left, right) => Number(current[right]?.updatedAt || 0) - Number(current[left]?.updatedAt || 0));
    const trimmed = {};
    keys.slice(0, 160).forEach((key) => {
      trimmed[key] = current[key];
    });
    writePreviewCache(trimmed);
    return;
  }
  writePreviewCache(current);
}

function getCachedPreview(messageId) {
  if (!messageId) return '';
  const current = readPreviewCache();
  return String(current[String(messageId)]?.preview || '');
}

async function computeRemoteDeviceFingerprint(signingKey, exchangeKey) {
  return sha256Base64Url(`${String(signingKey || '')}::${String(exchangeKey || '')}`);
}

function buildSignedPreKeyPayload(device) {
  const signedPreKey = parseJwkString(device?.signed_pre_key);
  return stableStringify({
    device_id: String(device?.device_id || ''),
    signed_pre_key_id: String(device?.signed_pre_key_id || ''),
    signed_pre_key: signedPreKey || null,
    algorithm: String(device?.algorithm || 'p256-e2ee-v1'),
  });
}

async function verifySignedPreKeyBundle(device) {
  const signingKey = parseJwkString(device?.identity_signing_key);
  if (!signingKey || !device?.signed_pre_key || !device?.signed_pre_key_signature) return false;
  try {
    const verifyKey = await importECDSAPublicKey(signingKey);
    return window.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      decodeBase64Url(device.signed_pre_key_signature),
      utf8Encode(buildSignedPreKeyPayload(device)),
    );
  } catch {
    return false;
  }
}

function buildGenericEncryptedHint(payload) {
  const type = String(payload?.type || 'text');
  if (type === 'voice') return 'Голосовое сообщение';
  if (type === 'video_note') return 'Видеосообщение';
  if (payload?.media) return 'Медиа';
  return 'Сообщение';
}

async function evaluateRemoteDeviceTrust(userId, device) {
  const fingerprint = await computeRemoteDeviceFingerprint(device?.identity_signing_key, device?.identity_exchange_key);
  const existing = readTrustCacheEntry(userId, device?.device_id);
  if (!existing?.fingerprint) {
    return { status: 'new', fingerprint };
  }
  if (String(existing.fingerprint) !== String(fingerprint)) {
    return { status: 'changed', fingerprint, previousFingerprint: String(existing.fingerprint) };
  }
  return { status: 'trusted', fingerprint };
}

async function pinRemoteDeviceTrust(userId, device) {
  const trust = await evaluateRemoteDeviceTrust(userId, device);
  if (trust.status === 'changed') return trust;
  writeTrustCacheEntry(userId, device?.device_id, {
    fingerprint: trust.fingerprint,
    signing_key: String(device?.identity_signing_key || ''),
    exchange_key: String(device?.identity_exchange_key || ''),
  });
  return { ...trust, status: trust.status === 'new' ? 'trusted' : trust.status };
}

async function generateECDSAKeyPair() {
  return window.crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
}

async function generateECDHKeyPair() {
  return window.crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
}

async function exportJwkPair(pair) {
  const [publicKey, privateKey] = await Promise.all([
    window.crypto.subtle.exportKey('jwk', pair.publicKey),
    window.crypto.subtle.exportKey('jwk', pair.privateKey),
  ]);
  return { publicJwk: publicKey, privateJwk: privateKey };
}

async function signSignedPreKey(signingPrivateKey, payload) {
  const encoded = utf8Encode(payload);
  const signature = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingPrivateKey,
    encoded,
  );
  return encodeBase64Url(signature);
}

async function importECDSAPrivateKey(jwk) {
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

async function importECDSAPublicKey(jwk) {
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

async function importECDHPrivateKey(jwk) {
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
}

async function importECDHPublicKey(jwk) {
  return window.crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
}

async function importHkdfKey(rawBytes) {
  return window.crypto.subtle.importKey('raw', rawBytes, 'HKDF', false, ['deriveKey']);
}

async function deriveAesKeyFromSharedSecret(privateJwk, publicJwk, saltBytes) {
  const [privateKey, publicKey] = await Promise.all([
    importECDHPrivateKey(privateJwk),
    importECDHPublicKey(publicJwk),
  ]);
  const sharedSecret = await window.crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicKey },
    privateKey,
    256,
  );
  const hkdfBase = await importHkdfKey(sharedSecret);
  return window.crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: saltBytes,
      info: utf8Encode('friendscape-e2ee-wrap-v2'),
    },
    hkdfBase,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function importAesKey(rawKeyBytes) {
  return window.crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function aesGcmEncryptRaw(rawKeyBytes, plainBytes, ivBytes, aadBytes) {
  const key = await importAesKey(rawKeyBytes);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: aadBytes || new Uint8Array() },
    key,
    plainBytes,
  );
  return new Uint8Array(encrypted);
}

async function aesGcmDecryptRaw(rawKeyBytes, cipherBytes, ivBytes, aadBytes) {
  const key = await importAesKey(rawKeyBytes);
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: aadBytes || new Uint8Array() },
    key,
    cipherBytes,
  );
  return new Uint8Array(decrypted);
}

async function deriveBackupKey(passphrase, saltBytes, iterations = BACKUP_KDF_ITERATIONS) {
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    utf8Encode(String(passphrase || '')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptBackupEnvelope(payload, passphrase) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveBackupKey(passphrase, salt, BACKUP_KDF_ITERATIONS);
  const cipher = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8Encode('friendscape-e2ee-backup-v1') },
    key,
    utf8Encode(stableStringify(payload)),
  );
  return {
    version: BACKUP_VERSION,
    algorithm: 'pbkdf2-aesgcm-v1',
    kdf: 'PBKDF2-SHA256',
    kdf_iterations: BACKUP_KDF_ITERATIONS,
    salt: encodeBase64Url(salt),
    iv: encodeBase64Url(iv),
    ciphertext: encodeBase64Url(new Uint8Array(cipher)),
  };
}

async function decryptBackupEnvelope(backup, passphrase) {
  const key = await deriveBackupKey(
    passphrase,
    decodeBase64Url(backup?.salt),
    Number(backup?.kdf_iterations || BACKUP_KDF_ITERATIONS),
  );
  const plain = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: decodeBase64Url(backup?.iv),
      additionalData: utf8Encode('friendscape-e2ee-backup-v1'),
    },
    key,
    decodeBase64Url(backup?.ciphertext),
  );
  return JSON.parse(utf8Decode(new Uint8Array(plain)));
}

async function createSignedPreKeyBundleFromIdentity(deviceId, algorithm, identitySigningPrivateJwk) {
  const signedPreKeyPair = await generateECDHKeyPair();
  const signedPreKeyExport = await exportJwkPair(signedPreKeyPair);
  const signedPreKeyId = `spk-${Date.now().toString(36)}`;
  const signedPayload = stableStringify({
    device_id: deviceId,
    signed_pre_key_id: signedPreKeyId,
    signed_pre_key: signedPreKeyExport.publicJwk,
    algorithm: algorithm || 'p256-e2ee-v1',
  });
  const signingPrivateKey = await importECDSAPrivateKey(identitySigningPrivateJwk);
  const signature = await signSignedPreKey(signingPrivateKey, signedPayload);
  return {
    id: signedPreKeyId,
    publicJwk: signedPreKeyExport.publicJwk,
    privateJwk: signedPreKeyExport.privateJwk,
    signature,
  };
}

async function createOneTimePreKeySet() {
  const oneTimePreKeys = [];
  for (let index = 0; index < DEFAULT_PREKEY_COUNT; index += 1) {
    const pair = await generateECDHKeyPair();
    const exported = await exportJwkPair(pair);
    oneTimePreKeys.push({
      keyId: `otk-${Date.now().toString(36)}-${index}`,
      publicJwk: exported.publicJwk,
      privateJwk: exported.privateJwk,
      uploadedAt: null,
    });
  }
  return oneTimePreKeys;
}

async function buildRestoredBundleForCurrentDevice(userId, decryptedBackup) {
  const sourceBundle = decryptedBackup?.bundle || {};
  const identitySigning = sourceBundle?.identitySigning;
  const identityExchange = sourceBundle?.identityExchange;
  if (!identitySigning?.publicJwk || !identitySigning?.privateJwk || !identityExchange?.publicJwk || !identityExchange?.privateJwk) {
    throw new Error('Backup не содержит полного набора identity-ключей');
  }
  const now = new Date().toISOString();
  const deviceId = getStableE2EEDeviceIDSync();
  const algorithm = String(sourceBundle?.algorithm || 'p256-e2ee-v1');
  return {
    version: 1,
    userId,
    deviceId,
    label: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : 'web-device',
    algorithm,
    createdAt: sourceBundle?.createdAt || now,
    updatedAt: now,
    identitySigning,
    identityExchange,
    signedPreKey: await createSignedPreKeyBundleFromIdentity(deviceId, algorithm, identitySigning.privateJwk),
    oneTimePreKeys: await createOneTimePreKeySet(),
  };
}

function normalizeBackupTrustCache(trustCache) {
  if (!trustCache || typeof trustCache !== 'object') return {};
  const normalized = {};
  Object.entries(trustCache).forEach(([key, value]) => {
    if (!key || !value || typeof value !== 'object') return;
    normalized[key] = value;
  });
  return normalized;
}

async function createFreshBundle(userId) {
  const deviceId = getStableE2EEDeviceIDSync();
  const now = new Date().toISOString();
  const signingPair = await generateECDSAKeyPair();
  const exchangePair = await generateECDHKeyPair();
  const signedPreKeyPair = await generateECDHKeyPair();

  const signingExport = await exportJwkPair(signingPair);
  const exchangeExport = await exportJwkPair(exchangePair);
  const signedPreKeyExport = await exportJwkPair(signedPreKeyPair);
  const signedPreKeyId = `spk-${Date.now().toString(36)}`;
  const signedPayload = stableStringify({
    device_id: deviceId,
    signed_pre_key_id: signedPreKeyId,
    signed_pre_key: signedPreKeyExport.publicJwk,
    algorithm: 'p256-e2ee-v1',
  });
  const signature = await signSignedPreKey(signingPair.privateKey, signedPayload);

  const oneTimePreKeys = [];
  for (let index = 0; index < DEFAULT_PREKEY_COUNT; index += 1) {
    const pair = await generateECDHKeyPair();
    const exported = await exportJwkPair(pair);
    oneTimePreKeys.push({
      keyId: `otk-${Date.now().toString(36)}-${index}`,
      publicJwk: exported.publicJwk,
      privateJwk: exported.privateJwk,
      uploadedAt: null,
    });
  }

  return {
    version: 1,
    userId,
    deviceId,
    label: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 120) : 'web-device',
    algorithm: 'p256-e2ee-v1',
    createdAt: now,
    updatedAt: now,
    identitySigning: signingExport,
    identityExchange: exchangeExport,
    signedPreKey: {
      id: signedPreKeyId,
      publicJwk: signedPreKeyExport.publicJwk,
      privateJwk: signedPreKeyExport.privateJwk,
      signature,
    },
    oneTimePreKeys,
  };
}

async function getOrCreateBundle(userId, options = {}) {
  const key = userVaultKey(userId);
  if (!options.forceNewBundle) {
    const existing = await vaultGet(key);
    if (existing?.deviceId && existing?.identitySigning?.publicJwk && existing?.identityExchange?.publicJwk && existing?.signedPreKey?.publicJwk) {
      return existing;
    }
  }
  const fresh = await createFreshBundle(userId);
  await vaultSet(key, fresh);
  return fresh;
}

async function buildLocalBundleSummary(userId) {
  const bundle = await getOrCreateBundle(userId);
  const signing = exportPublicKeyString(bundle?.identitySigning?.publicJwk);
  const exchange = exportPublicKeyString(bundle?.identityExchange?.publicJwk);
  const fingerprint = await computeRemoteDeviceFingerprint(signing, exchange);
  return {
    device_id: String(bundle?.deviceId || ''),
    algorithm: String(bundle?.algorithm || 'p256-e2ee-v1'),
    fingerprint,
    fingerprint_formatted: formatFingerprintGroups(fingerprint),
    identity_signing_key: signing,
    identity_exchange_key: exchange,
  };
}

async function clearLocalBundle(userId) {
  const key = userVaultKey(userId);
  const db = await openVault();
  if (!db) {
    safeLocalStorage()?.removeItem(key);
    safeLocalStorage()?.removeItem(lastRegisteredKey(userId));
    return;
  }
  await new Promise((resolve) => {
    const tx = db.transaction(VAULT_STORE, 'readwrite');
    tx.objectStore(VAULT_STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); resolve(); };
  });
  safeLocalStorage()?.removeItem(lastRegisteredKey(userId));
}

function buildRegistrationPayload(bundle) {
  const oneTimePreKeys = Array.isArray(bundle?.oneTimePreKeys)
    ? bundle.oneTimePreKeys.map((item) => ({
        key_id: item.keyId,
        public_key: exportPublicKeyString(item.publicJwk),
      }))
    : [];

  return {
    device_id: bundle.deviceId,
    label: bundle.label || 'web-device',
    algorithm: bundle.algorithm || 'p256-e2ee-v1',
    identity_signing_key: exportPublicKeyString(bundle.identitySigning.publicJwk),
    identity_exchange_key: exportPublicKeyString(bundle.identityExchange.publicJwk),
    signed_pre_key: exportPublicKeyString(bundle.signedPreKey.publicJwk),
    signed_pre_key_signature: bundle.signedPreKey.signature,
    signed_pre_key_id: bundle.signedPreKey.id,
    one_time_prekeys: oneTimePreKeys,
  };
}

function normalizeRemoteDevice(device) {
  const oneTimePreKey = device?.one_time_pre_key && typeof device.one_time_pre_key === 'object'
    ? {
        key_id: String(device.one_time_pre_key.key_id || ''),
        public_key: String(device.one_time_pre_key.public_key || ''),
      }
    : null;
  return {
    device_id: String(device?.device_id || ''),
    label: String(device?.label || ''),
    algorithm: String(device?.algorithm || 'p256-e2ee-v1'),
    identity_signing_key: String(device?.identity_signing_key || ''),
    identity_exchange_key: String(device?.identity_exchange_key || ''),
    signed_pre_key: String(device?.signed_pre_key || ''),
    signed_pre_key_signature: String(device?.signed_pre_key_signature || ''),
    signed_pre_key_id: String(device?.signed_pre_key_id || ''),
    available_one_time_prekeys: Number(device?.available_one_time_prekeys || 0),
    one_time_pre_key: oneTimePreKey,
  };
}

async function fetchRemoteUserBundles(userId, { force = false } = {}) {
  const numericUserId = Number(userId || 0);
  if (!numericUserId) return [];
  const cached = remoteBundleCache.get(numericUserId);
  if (!force && cached && (Date.now() - cached.cachedAt) < REMOTE_BUNDLE_TTL_MS) {
    return cached.devices;
  }
  const response = await API.get(`/e2ee/prekeys/${numericUserId}`);
  const rawDevices = Array.isArray(response?.data?.devices)
    ? response.data.devices.map(normalizeRemoteDevice).filter((item) => item.device_id && item.identity_signing_key && item.identity_exchange_key)
    : [];
  const devices = [];
  for (const item of rawDevices) {
    const signatureValid = await verifySignedPreKeyBundle(item);
    const trust = await evaluateRemoteDeviceTrust(numericUserId, item);
    const entry = readTrustCacheEntry(numericUserId, item.device_id);
    devices.push({
      ...item,
      signature_valid: signatureValid,
      trust_status: trust.status,
      fingerprint: trust.fingerprint,
      fingerprint_formatted: formatFingerprintGroups(trust.fingerprint),
      verified: isTrustEntryVerified(entry, trust.fingerprint),
    });
  }
  remoteBundleCache.set(numericUserId, { cachedAt: Date.now(), devices });
  return devices;
}

async function fetchOwnRegisteredDevices() {
  const response = await API.get('/e2ee/devices');
  return Array.isArray(response?.data?.devices)
    ? response.data.devices.map(normalizeRemoteDevice).filter((item) => item.device_id && item.identity_exchange_key)
    : [];
}

function buildEncryptedContentHint(payload) {
  return buildGenericEncryptedHint(payload);
}

function buildPlainPayload(payload) {
  return {
    version: 1,
    type: String(payload?.type || 'text'),
    content: String(payload?.content || ''),
    media: payload?.media || null,
    sent_at: new Date().toISOString(),
  };
}

function uniqueByDeviceId(devices) {
  const next = [];
  const seen = new Set();
  (devices || []).forEach((device) => {
    const deviceId = String(device?.device_id || '');
    if (!deviceId || seen.has(deviceId)) return;
    seen.add(deviceId);
    next.push(device);
  });
  return next;
}

async function createWrapForDevice(messageKeyBytes, targetDevice, role) {
  const targetPublic = parseJwkString(targetDevice?.signed_pre_key || targetDevice?.identity_exchange_key);
  if (!targetPublic) return null;
  const targetKind = targetDevice?.signed_pre_key ? 'signed_pre_key' : 'identity_exchange';
  const ephemeralPair = await generateECDHKeyPair();
  const ephemeralExport = await exportJwkPair(ephemeralPair);
  const saltBytes = randomBytes(16);
  const ivBytes = randomBytes(12);
  const wrapKey = await deriveAesKeyFromSharedSecret(ephemeralExport.privateJwk, targetPublic, saltBytes);
  const wrappedKey = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: ivBytes, additionalData: utf8Encode(String(targetDevice?.device_id || '')) },
    wrapKey,
    messageKeyBytes,
  );
  return {
    device_id: String(targetDevice?.device_id || ''),
    role,
    target_kind: targetKind,
    signed_pre_key_id: String(targetDevice?.signed_pre_key_id || ''),
    ephemeral_public_key: exportPublicKeyString(ephemeralExport.publicJwk),
    salt: encodeBase64Url(saltBytes),
    iv: encodeBase64Url(ivBytes),
    wrapped_key: encodeBase64Url(wrappedKey),
  };
}

async function buildEncryptedEnvelope(bundle, recipientUserId, payload, options = {}) {
  const recipientDevicesRaw = await fetchRemoteUserBundles(recipientUserId, { force: Boolean(options.forceRefresh) });
  const recipientDevices = recipientDevicesRaw.filter((device) => device.signature_valid && device.trust_status !== 'changed');
  if (!recipientDevices.length) {
    const hasChanged = recipientDevicesRaw.some((device) => device.trust_status === 'changed');
    if (hasChanged) {
      throw new Error('Ключи собеседника изменились. Нужна повторная проверка устройства.');
    }
    throw new Error('У получателя пока нет активных E2EE-устройств');
  }
  for (const device of recipientDevices) {
    await pinRemoteDeviceTrust(recipientUserId, device);
  }
  const ownDevices = await fetchOwnRegisteredDevices().catch(() => []);
  const wrapTargets = uniqueByDeviceId([
    ...recipientDevices.map((device) => ({ ...device, __role: 'recipient' })),
    ...ownDevices.map((device) => ({ ...device, __role: 'sender' })),
  ]);
  if (!wrapTargets.length) {
    throw new Error('Не удалось подготовить E2EE-ключи для отправки');
  }

  const plainPayload = buildPlainPayload(payload);
  const plainBytes = utf8Encode(JSON.stringify(plainPayload));
  const messageKeyBytes = randomBytes(32);
  const messageIvBytes = randomBytes(12);
  const aad = stableStringify({
    version: 2,
    type: plainPayload.type,
    to_user_id: Number(recipientUserId || 0),
    sender_device_id: bundle.deviceId,
  });
  const cipherBytes = await aesGcmEncryptRaw(messageKeyBytes, plainBytes, messageIvBytes, utf8Encode(aad));

  const wraps = [];
  for (const device of wrapTargets) {
     
    const wrap = await createWrapForDevice(messageKeyBytes, device, device.__role || 'recipient');
    if (wrap) wraps.push(wrap);
  }
  if (!wraps.length) {
    throw new Error('Не удалось завернуть message key для устройств чата');
  }

  const header = {
    version: 2,
    iv: encodeBase64Url(messageIvBytes),
    sent_at: plainPayload.sent_at,
    payload_encoding: 'json',
    cipher: 'AES-GCM-256',
  };
  const signaturePayload = stableStringify({
    ciphertext: encodeBase64Url(cipherBytes),
    header,
    aad,
    wraps: wraps.map((item) => ({
      device_id: item.device_id,
      role: item.role,
      target_kind: item.target_kind,
      signed_pre_key_id: item.signed_pre_key_id,
      ephemeral_public_key: item.ephemeral_public_key,
      salt: item.salt,
      iv: item.iv,
      wrapped_key: item.wrapped_key,
    })),
  });
  const signingPrivateKey = await importECDSAPrivateKey(bundle.identitySigning.privateJwk);
  const signatureBytes = await window.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    signingPrivateKey,
    utf8Encode(signaturePayload),
  );

  const keyEnvelope = {
    version: 2,
    sender_identity_signing_key: exportPublicKeyString(bundle.identitySigning.publicJwk),
    sender_identity_exchange_key: exportPublicKeyString(bundle.identityExchange.publicJwk),
    signature: encodeBase64Url(signatureBytes),
    wraps,
  };

  return {
    type: String(payload?.type || 'text'),
    encrypted: {
      scheme: 'friendscape-e2ee-p256-aesgcm-v2',
      sender_device_id: bundle.deviceId,
      recipient_device_id: recipientDevices[0]?.device_id || 'multi',
      ciphertext: encodeBase64Url(cipherBytes),
      header: JSON.stringify(header),
      aad,
      content_hint: buildEncryptedContentHint(payload),
      client_message_id: String(options.clientMessageId || `e2ee-${Date.now().toString(36)}`),
      key_envelope: JSON.stringify(keyEnvelope),
    },
  };
}

async function verifyEnvelopeSignature(envelope, ciphertext, header, aad) {
  const publicJwk = parseJwkString(envelope?.sender_identity_signing_key);
  if (!publicJwk || !envelope?.signature) return false;
  try {
    const verifyKey = await importECDSAPublicKey(publicJwk);
    const signaturePayload = stableStringify({
      ciphertext,
      header,
      aad,
      wraps: Array.isArray(envelope?.wraps)
        ? envelope.wraps.map((item) => ({
            device_id: item.device_id,
            role: item.role,
            target_kind: item.target_kind,
            signed_pre_key_id: item.signed_pre_key_id,
            ephemeral_public_key: item.ephemeral_public_key,
            salt: item.salt,
            iv: item.iv,
            wrapped_key: item.wrapped_key,
          }))
        : [],
    });
    return window.crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      verifyKey,
      decodeBase64Url(envelope.signature),
      utf8Encode(signaturePayload),
    );
  } catch {
    return false;
  }
}

async function decryptWrapForCurrentDevice(bundle, envelope) {
  const wraps = Array.isArray(envelope?.wraps) ? envelope.wraps : [];
  const wrap = wraps.find((item) => String(item?.device_id || '') === String(bundle?.deviceId || ''));
  if (!wrap) return null;
  let privateJwk = bundle?.identityExchange?.privateJwk;
  if (wrap.target_kind === 'signed_pre_key') {
    privateJwk = bundle?.signedPreKey?.privateJwk;
  }
  if (wrap.target_kind === 'one_time_pre_key') {
    const matched = Array.isArray(bundle?.oneTimePreKeys)
      ? bundle.oneTimePreKeys.find((item) => String(item?.keyId || '') === String(wrap.signed_pre_key_id || ''))
      : null;
    privateJwk = matched?.privateJwk || null;
  }
  if (!privateJwk) return null;
  const ephemeralPublic = parseJwkString(wrap.ephemeral_public_key);
  if (!ephemeralPublic) return null;
  const wrapKey = await deriveAesKeyFromSharedSecret(privateJwk, ephemeralPublic, decodeBase64Url(wrap.salt));
  const wrappedKey = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64Url(wrap.iv), additionalData: utf8Encode(String(wrap.device_id || '')) },
    wrapKey,
    decodeBase64Url(wrap.wrapped_key),
  );
  return new Uint8Array(wrappedKey);
}

function buildPreviewFromPayload(payload) {
  const type = String(payload?.type || 'text');
  if (type === 'voice') return '🎤 Голосовое сообщение';
  if (type === 'video_note') return '🎬 Видеосообщение';
  const content = String(payload?.content || '').trim();
  if (!content && payload?.media) return '📎 Медиа';
  return content;
}

export function getCurrentE2EEDeviceID() {
  return getStableE2EEDeviceIDSync();
}

export async function getCurrentLocalE2EEDeviceSummary(user) {
  const userId = Number(user?.id || 0);
  if (!userId || !canUseWebCrypto()) return null;
  return buildLocalBundleSummary(userId);
}

export async function ensureE2EEReady(user, options = {}) {
  const userId = Number(user?.id || 0);
  if (!userId || !canUseWebCrypto()) {
    return { ready: false, reason: 'unsupported' };
  }

  const bundle = await getOrCreateBundle(userId, { forceNewBundle: Boolean(options.forceNewBundle) });
  const storage = safeLocalStorage();
  const lastRegisteredAt = Number(storage?.getItem(lastRegisteredKey(userId)) || 0);

  let shouldRegister = !lastRegisteredAt || (Date.now() - lastRegisteredAt) > (12 * 60 * 60 * 1000);
  try {
    const statusRes = await API.get('/e2ee/status');
    const status = statusRes?.data || {};
    const current = status.current_device || null;
    const available = Number(current?.available_one_time_prekeys || 0);
    shouldRegister = shouldRegister || !status.current_device_registered || available < 8;
  } catch {
    shouldRegister = true;
  }

  shouldRegister = shouldRegister || Boolean(options.forceRegister) || Boolean(options.forceNewBundle);

  if (!shouldRegister) {
    return { ready: true, registered: true, skipped: true, deviceId: bundle.deviceId };
  }

  const payload = buildRegistrationPayload(bundle);
  const response = await API.post('/e2ee/devices/register', payload);
  storage?.setItem(lastRegisteredKey(userId), String(Date.now()));
  remoteBundleCache.delete(Number(userId));
  return { ready: true, registered: true, deviceId: bundle.deviceId, response: response?.data || null };
}

export async function clearCurrentUserE2EEBundle(user) {
  const userId = Number(user?.id || 0);
  if (!userId) return;
  await clearLocalBundle(userId);
  remoteBundleCache.delete(userId);
}

export async function resetCurrentE2EEDevice(user) {
  const userId = Number(user?.id || 0);
  if (!userId) throw new Error('Не найден пользователь для E2EE reset');
  await API.post('/e2ee/devices/reset-current');
  await clearCurrentUserE2EEBundle(user);
  return ensureE2EEReady(user, { forceNewBundle: true, forceRegister: true });
}

export async function revokeE2EEDevice(deviceId) {
  return API.delete(`/e2ee/devices/${encodeURIComponent(deviceId)}`);
}

export async function getE2EEStatus() {
  return API.get('/e2ee/status');
}

export async function getE2EEDevices() {
  return API.get('/e2ee/devices');
}

export async function getE2EEPreKeyBundle(userId) {
  return API.get(`/e2ee/prekeys/${userId}`);
}

export async function getE2EEBackupStatus() {
  return API.get('/e2ee/backup/status');
}

export async function createEncryptedE2EEBackup(user, passphrase) {
  const userId = Number(user?.id || 0);
  if (!userId || !canUseWebCrypto()) throw new Error('E2EE backup недоступен на этом устройстве');
  const safePassphrase = String(passphrase || '');
  if (safePassphrase.trim().length < 8) throw new Error('Используй парольную фразу минимум из 8 символов');
  const bundle = await getOrCreateBundle(userId);
  const localSummary = await buildLocalBundleSummary(userId);
  const payload = {
    schema: 'friendscape-e2ee-backup-v1',
    created_at: new Date().toISOString(),
    source_device_id: bundle.deviceId,
    source_fingerprint: localSummary?.fingerprint || '',
    bundle,
    trust_cache: normalizeBackupTrustCache(readTrustCache()),
  };
  const encrypted = await encryptBackupEnvelope(payload, safePassphrase);
  const response = await API.put('/e2ee/backup', {
    ...encrypted,
    source_device_id: bundle.deviceId,
    source_fingerprint: localSummary?.fingerprint || '',
    backup_scope: 'bundle',
  });
  return response?.data || null;
}

export async function restoreEncryptedE2EEBackup(user, passphrase) {
  const userId = Number(user?.id || 0);
  if (!userId || !canUseWebCrypto()) throw new Error('Восстановление E2EE backup недоступно');
  const safePassphrase = String(passphrase || '');
  if (safePassphrase.trim().length < 8) throw new Error('Введите парольную фразу от E2EE backup');
  const response = await API.get('/e2ee/backup/download');
  const backup = response?.data?.backup || null;
  if (!backup?.ciphertext) throw new Error('Сервер не вернул E2EE backup');
  let decrypted;
  try {
    decrypted = await decryptBackupEnvelope(backup, safePassphrase);
  } catch {
    throw new Error('Не удалось расшифровать E2EE backup. Проверь парольную фразу.');
  }
  if (String(decrypted?.schema || '') !== 'friendscape-e2ee-backup-v1') {
    throw new Error('Неподдерживаемый формат E2EE backup');
  }
  const restoredBundle = await buildRestoredBundleForCurrentDevice(userId, decrypted);
  await vaultSet(userVaultKey(userId), restoredBundle);
  const mergedTrust = { ...readTrustCache(), ...normalizeBackupTrustCache(decrypted?.trust_cache) };
  writeTrustCache(mergedTrust);
  safeLocalStorage()?.removeItem(lastRegisteredKey(userId));
  await ensureE2EEReady(user, { forceRegister: true });
  await API.post('/e2ee/backup/restore-complete').catch(() => null);
  remoteBundleCache.delete(Number(userId));
  return { ok: true, restored_bundle: restoredBundle, source_device_id: decrypted?.source_device_id || backup?.source_device_id || '' };
}

export async function deleteEncryptedE2EEBackup() {
  return API.delete('/e2ee/backup');
}

export async function canEncryptDirectMessages({ currentUser, toUserId }) {
  const userId = Number(currentUser?.id || 0);
  const recipientUserId = Number(toUserId || 0);
  if (!userId || !recipientUserId || !canUseWebCrypto()) return false;
  try {
    const recipientDevices = await fetchRemoteUserBundles(recipientUserId, { force: true });
    if (recipientDevices.some((device) => device.trust_status === 'changed')) {
      throw new Error('Ключи собеседника изменились. Нужна повторная проверка устройства.');
    }
    return recipientDevices.some((device) => device.signature_valid);
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('изменились')) throw error;
    return false;
  }
}

export async function getConversationE2EESecurity({ currentUser, remoteUserId, force = false } = {}) {
  const userId = Number(currentUser?.id || 0);
  const targetUserId = Number(remoteUserId || 0);
  if (!userId || !targetUserId || !canUseWebCrypto()) {
    return {
      available: false,
      supported: false,
      reason: 'unsupported',
      current_device: null,
      remote_devices: [],
      has_changed_keys: false,
      has_unverified_devices: false,
      verified_devices_count: 0,
      remote_device_count: 0,
    };
  }
  const currentDevice = await buildLocalBundleSummary(userId);
  let remoteDevices = [];
  try {
    remoteDevices = await fetchRemoteUserBundles(targetUserId, { force });
  } catch {
    remoteDevices = [];
  }
  const summarized = [];
  for (const device of remoteDevices) {
    const entry = readTrustCacheEntry(targetUserId, device.device_id);
    const verified = isTrustEntryVerified(entry, device.fingerprint);
    const safetyNumber = await computeSafetyNumber(currentDevice.fingerprint, device.fingerprint, targetUserId, device.device_id);
    summarized.push({
      ...device,
      verified,
      fingerprint_formatted: formatFingerprintGroups(device.fingerprint),
      safety_number: safetyNumber,
      trust_label: device.trust_status === 'changed' ? 'Ключ изменился' : (verified ? 'Подтверждено' : 'Не подтверждено'),
    });
  }
  const hasChangedKeys = summarized.some((device) => device.trust_status === 'changed');
  const hasUnverifiedDevices = summarized.some((device) => device.signature_valid && device.trust_status !== 'changed' && !device.verified);
  const verifiedDevicesCount = summarized.filter((device) => device.verified).length;
  return {
    available: summarized.length > 0,
    supported: summarized.some((device) => device.signature_valid && device.trust_status !== 'changed'),
    reason: summarized.length ? '' : 'no-remote-devices',
    current_device: currentDevice,
    remote_devices: summarized,
    has_changed_keys: hasChangedKeys,
    has_unverified_devices: hasUnverifiedDevices,
    verified_devices_count: verifiedDevicesCount,
    remote_device_count: summarized.length,
  };
}

export async function encryptDirectMessagePayload({ currentUser, toUserId, payload, clientMessageId }) {
  const userId = Number(currentUser?.id || 0);
  const recipientUserId = Number(toUserId || 0);
  if (!userId || !recipientUserId || !canUseWebCrypto()) {
    return { payload, e2ee: false, reason: 'unsupported' };
  }
  const bundle = await getOrCreateBundle(userId);
  try {
    const encryptedPayload = await buildEncryptedEnvelope(bundle, recipientUserId, payload, { clientMessageId });
    return { payload: encryptedPayload, e2ee: true, deviceId: bundle.deviceId };
  } catch (error) {
    const message = String(error?.message || '');
    if (message.includes('нет активных E2EE-устройств')) {
      return { payload, e2ee: false, reason: 'recipient-no-devices' };
    }
    throw error;
  }
}


export async function verifyRemoteE2EEDevice(userId, deviceId) {
  const devices = await fetchRemoteUserBundles(userId, { force: true });
  const target = devices.find((item) => String(item.device_id) === String(deviceId || ''));
  if (!target) {
    throw new Error('Устройство не найдено для подтверждения');
  }
  if (!target.signature_valid) {
    throw new Error('Нельзя подтвердить устройство с невалидной подписью');
  }
  if (target.trust_status === 'changed') {
    throw new Error('Сначала прими новый ключ устройства');
  }
  writeTrustCacheEntry(userId, target.device_id, {
    fingerprint: target.fingerprint,
    signing_key: String(target.identity_signing_key || ''),
    exchange_key: String(target.identity_exchange_key || ''),
    verified_at: Date.now(),
    verified_fingerprint: target.fingerprint,
  });
  remoteBundleCache.delete(Number(userId));
  return { ok: true, device_id: target.device_id };
}

export async function acceptRemoteE2EEDeviceChange(userId, deviceId, { verify = false } = {}) {
  const devices = await fetchRemoteUserBundles(userId, { force: true });
  const target = devices.find((item) => String(item.device_id) === String(deviceId || ''));
  if (!target) {
    throw new Error('Не удалось загрузить новый ключ устройства');
  }
  if (!target.signature_valid) {
    throw new Error('Подпись нового ключа не прошла проверку');
  }
  writeTrustCacheEntry(userId, target.device_id, {
    fingerprint: target.fingerprint,
    signing_key: String(target.identity_signing_key || ''),
    exchange_key: String(target.identity_exchange_key || ''),
    verified_at: verify ? Date.now() : null,
    verified_fingerprint: verify ? target.fingerprint : null,
  });
  remoteBundleCache.delete(Number(userId));
  return { ok: true, device_id: target.device_id };
}

export function unverifyRemoteE2EEDevice(userId, deviceId) {
  const entry = readTrustCacheEntry(userId, deviceId);
  if (!entry) {
    clearTrustCacheEntry(userId, deviceId);
    return { ok: true, device_id: deviceId };
  }
  const { verified_at, verified_fingerprint, ...rest } = entry;
  void verified_at;
  void verified_fingerprint;
  writeTrustCacheEntry(userId, deviceId, {
    ...rest,
    verified_at: null,
    verified_fingerprint: null,
  });
  remoteBundleCache.delete(Number(userId));
  return { ok: true, device_id: deviceId };
}

export function formatE2EEFingerprint(value) {
  return formatFingerprintGroups(value);
}

export async function decryptMessageForDisplay(message, currentUserId) {
  if (!message?.is_encrypted) {
    return {
      ...message,
      e2ee_status: 'plaintext',
      preview_text: buildPreviewFromPayload({ type: message?.type, content: message?.content, media: message?.media }),
    };
  }
  const numericUserId = Number(currentUserId || 0);
  if (!numericUserId || !canUseWebCrypto()) {
    const fallbackPreview = getCachedPreview(message.id) || String(message?.content_hint || message?.content || '🔒 Зашифрованное сообщение');
    return { ...message, content: fallbackPreview, preview_text: fallbackPreview, e2ee_status: 'locked' };
  }
  try {
    const bundle = await getOrCreateBundle(numericUserId);
    const header = JSON.parse(String(message?.cipher_header || message?.header || '{}'));
    const envelope = JSON.parse(String(message?.key_envelope || '{}'));
    const verified = await verifyEnvelopeSignature(envelope, String(message?.ciphertext || ''), header, String(message?.cipher_aad || message?.aad || ''));
    if (!verified) {
      throw new Error('Подпись E2EE envelope не прошла проверку');
    }
    if (Number(message?.from_user_id || 0) && Number(message?.from_user_id || 0) !== numericUserId) {
      const trust = await evaluateRemoteDeviceTrust(Number(message.from_user_id), {
        device_id: String(message?.sender_device_id || ''),
        identity_signing_key: String(envelope?.sender_identity_signing_key || ''),
        identity_exchange_key: String(envelope?.sender_identity_exchange_key || ''),
      });
      if (trust.status === 'changed') {
        const warningPreview = '⚠️ Ключи собеседника изменились';
        return { ...message, content: warningPreview, preview_text: warningPreview, e2ee_status: 'untrusted', e2ee_verified: false };
      }
      writeTrustCacheEntry(Number(message.from_user_id), String(message?.sender_device_id || ''), {
        fingerprint: trust.fingerprint,
        signing_key: String(envelope?.sender_identity_signing_key || ''),
        exchange_key: String(envelope?.sender_identity_exchange_key || ''),
      });
    }
    const messageKeyBytes = await decryptWrapForCurrentDevice(bundle, envelope);
    if (!messageKeyBytes) {
      const fallbackPreview = getCachedPreview(message.id) || String(message?.content_hint || message?.content || '🔒 Зашифрованное сообщение');
      return { ...message, content: fallbackPreview, preview_text: fallbackPreview, e2ee_status: 'locked-device' };
    }
    const plainBytes = await aesGcmDecryptRaw(
      messageKeyBytes,
      decodeBase64Url(message.ciphertext),
      decodeBase64Url(header.iv),
      utf8Encode(String(message?.cipher_aad || message?.aad || '')),
    );
    const decryptedPayload = JSON.parse(utf8Decode(plainBytes));
    const preview = buildPreviewFromPayload(decryptedPayload) || String(message?.content_hint || 'Сообщение');
    setCachedPreview(message.id, preview);
    return {
      ...message,
      type: decryptedPayload.type || message.type,
      content: decryptedPayload.content || '',
      media: decryptedPayload.media || null,
      preview_text: preview,
      decrypted_payload: decryptedPayload,
      e2ee_status: 'decrypted',
      e2ee_verified: true,
    };
  } catch (error) {
    console.error('E2EE decrypt failed:', error);
    const fallbackPreview = getCachedPreview(message.id) || String(message?.content_hint || message?.content || '🔒 Зашифрованное сообщение');
    return { ...message, content: fallbackPreview, preview_text: fallbackPreview, e2ee_status: 'failed' };
  }
}

export async function hydrateMessagesForDisplay(messages, currentUserId) {
  const list = Array.isArray(messages) ? messages : [];
  const next = await Promise.all(list.map((item) => decryptMessageForDisplay(item, currentUserId)));
  return next;
}

export async function hydrateChatListForDisplay(chats, currentUserId) {
  const list = Array.isArray(chats) ? chats : [];
  return Promise.all(list.map(async (chat) => {
    const lastMessage = chat?.last_message;
    if (!lastMessage?.is_encrypted) return chat;
    const hydrated = await decryptMessageForDisplay(lastMessage, currentUserId);
    return {
      ...chat,
      last_message: hydrated,
    };
  }));
}

export async function uploadEncryptedMessageMedia({ kind, blob, posterBlob = null, meta = {}, onUploadProgress = null }) {
  if (!blob || !canUseWebCrypto()) {
    throw new Error('Не удалось подготовить encrypted media');
  }
  const mediaKey = randomBytes(32);
  const mediaIv = randomBytes(12);
  const cipherBytes = await aesGcmEncryptRaw(mediaKey, new Uint8Array(await blob.arrayBuffer()), mediaIv, utf8Encode(`media:${kind}`));
  const form = new FormData();
  form.append('kind', kind);
  form.append('original_mime', String(meta.mime || blob.type || 'application/octet-stream'));
  form.append('duration_sec', String(meta.durationSec || 0));
  form.append('width', String(meta.width || 0));
  form.append('height', String(meta.height || 0));
  form.append('encrypted', 'true');
  form.append('file', new File([cipherBytes], `${kind}-${Date.now()}.bin`, { type: 'application/octet-stream' }));

  let thumbIvEncoded = '';
  if (posterBlob) {
    const thumbIv = randomBytes(12);
    const thumbCipherBytes = await aesGcmEncryptRaw(mediaKey, new Uint8Array(await posterBlob.arrayBuffer()), thumbIv, utf8Encode(`thumb:${kind}`));
    thumbIvEncoded = encodeBase64Url(thumbIv);
    form.append('thumb', new File([thumbCipherBytes], `thumb-${Date.now()}.bin`, { type: 'application/octet-stream' }));
  }

  const response = await API.post('/media/upload-message-encrypted', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 60000,
    onUploadProgress: typeof onUploadProgress === 'function'
      ? (event) => {
          const total = Number(event.total || 0);
          const loaded = Number(event.loaded || 0);
          onUploadProgress(total > 0 ? Math.round((loaded / total) * 100) : 0);
        }
      : undefined,
  });

  const asset = response?.data?.asset || null;
  if (!asset?.url) {
    throw new Error('Сервер не вернул encrypted media asset');
  }

  return {
    kind,
    encrypted_blob: true,
    url: asset.url,
    thumb_url: asset.thumb_url || '',
    original_mime: String(meta.mime || blob.type || 'application/octet-stream'),
    duration_sec: Number(meta.durationSec || 0),
    width: Number(meta.width || 0),
    height: Number(meta.height || 0),
    bytes: Number(blob.size || meta.bytes || 0),
    key: encodeBase64Url(mediaKey),
    iv: encodeBase64Url(mediaIv),
    thumb_iv: thumbIvEncoded,
  };
}

export async function resolveEncryptedMediaObjectURL(media, variant = 'main') {
  if (!media?.encrypted_blob) {
    return variant === 'thumb' ? String(media?.thumb_url || '') : String(media?.url || '');
  }
  const sourceURL = variant === 'thumb' ? String(media?.thumb_url || '') : String(media?.url || '');
  const iv = variant === 'thumb' ? String(media?.thumb_iv || '') : String(media?.iv || '');
  if (!sourceURL || !iv || !media?.key) return '';
  const cacheKey = `${variant}:${sourceURL}:${iv}`;
  if (MEDIA_URL_CACHE.has(cacheKey)) {
    return MEDIA_URL_CACHE.get(cacheKey);
  }
  const response = await fetch(sourceURL, { credentials: 'include' });
  if (!response.ok) {
    throw new Error('Не удалось загрузить encrypted media');
  }
  const cipherBytes = new Uint8Array(await response.arrayBuffer());
  const plainBytes = await aesGcmDecryptRaw(
    decodeBase64Url(media.key),
    cipherBytes,
    decodeBase64Url(iv),
    utf8Encode(variant === 'thumb' ? `thumb:${media.kind || 'media'}` : `media:${media.kind || 'media'}`),
  );
  const mime = variant === 'thumb' ? 'image/jpeg' : String(media?.original_mime || media?.mime || 'application/octet-stream');
  const objectURL = URL.createObjectURL(new Blob([plainBytes], { type: mime }));
  MEDIA_URL_CACHE.set(cacheKey, objectURL);
  return objectURL;
}
