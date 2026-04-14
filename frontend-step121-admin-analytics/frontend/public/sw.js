self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const payload = (() => {
    if (!event.data) {
      return {
        title: 'Friendscape',
        body: 'У вас новое уведомление',
        url: '/feed',
      };
    }
    try {
      return event.data.json();
    } catch (_) {
      return {
        title: 'Friendscape',
        body: event.data.text() || 'У вас новое уведомление',
        url: '/feed',
      };
    }
  })();

  const title = payload.title || 'Friendscape';
  const options = {
    body: payload.body || 'У вас новое уведомление',
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    data: {
      url: payload.url || '/feed',
    },
    vibrate: [200, 100, 200],
    requireInteraction: Boolean(payload.requireInteraction),
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification?.data?.url || '/feed';

  event.waitUntil((async () => {
    const allClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of allClients) {
      const url = new URL(client.url);
      if (url.origin === self.location.origin) {
        await client.focus();
        client.postMessage({ type: 'notification-click', url: targetUrl });
        if ('navigate' in client && url.pathname + url.search + url.hash !== targetUrl) {
          try {
            await client.navigate(targetUrl);
          } catch (_) {}
        }
        return;
      }
    }
    await clients.openWindow(targetUrl);
  })());
});
