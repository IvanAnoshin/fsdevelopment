import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { getVapidPublicKey, savePushSubscription } from '../services/api';
import { getToken } from '../services/authStorage';

export default function PushSetup() {
  const location = useLocation();
  const lastTokenRef = useRef('');

  useEffect(() => {
    const token = getToken();
    if (!token) {
      lastTokenRef.current = '';
      return;
    }

    if (lastTokenRef.current === token) return;
    lastTokenRef.current = token;
    const run = () => { void setupPush(); };
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(run, { timeout: 2500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(run, 900);
    return () => window.clearTimeout(id);
  }, [location.pathname]);

  async function setupPush() {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission === 'denied') return;

    try {
      const permission = Notification.permission === 'granted'
        ? 'granted'
        : await Notification.requestPermission();

      if (permission !== 'granted') return;

      const registration = await navigator.serviceWorker.register('/sw.js');
      const existing = await registration.pushManager.getSubscription();

      let subscription = existing;
      if (!subscription) {
        const res = await getVapidPublicKey();
        const vapidKey = res.data?.public_key;
        if (!vapidKey) return;
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        });
      }

      await savePushSubscription({
        endpoint: subscription.endpoint,
        auth_key: arrayBufferToBase64(subscription.getKey('auth')),
        p256dh_key: arrayBufferToBase64(subscription.getKey('p256dh')),
      });
    } catch (err) {
      console.error('Ошибка настройки push:', err);
    }
  }

  return null;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function arrayBufferToBase64(buffer) {
  if (!buffer) return '';
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
