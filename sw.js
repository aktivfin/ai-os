/* AI OS v3 — Service Worker */
const CACHE = 'ai-os-v1';
const STATIC = ['/', '/index.html', '/style.css', '/main.js'];

// ─── Install: кэшируем статику ────────────────────────────────────────────
self.addEventListener('install', e => {
    e.waitUntil(
        caches.open(CACHE)
            .then(c => c.addAll(STATIC))
            .catch(() => {}) // не блокируем SW если файлы недоступны
    );
    self.skipWaiting();
});

// ─── Activate: удаляем старые кэши ───────────────────────────────────────
self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

// ─── Fetch: network-first, fallback to cache ──────────────────────────────
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    // Не кэшируем запросы к Supabase и AI proxy
    if (e.request.url.includes('/rest/v1/') || e.request.url.includes('/api/ai')) return;
    e.respondWith(
        fetch(e.request)
            .then(r => {
                const clone = r.clone();
                caches.open(CACHE).then(c => c.put(e.request, clone));
                return r;
            })
            .catch(() => caches.match(e.request))
    );
});

// ─── Push: входящий push от сервера ──────────────────────────────────────
self.addEventListener('push', e => {
    const data = e.data?.json() || {};
    e.waitUntil(
        self.registration.showNotification(data.title || 'AI OS', {
            body:  data.body  || 'Новое уведомление',
            icon:  '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            tag:   data.tag   || 'ai-os',
            data:  data.url   || '/',
        })
    );
});

// ─── Message: локальное уведомление (из основного потока) ─────────────────
// Использование: navigator.serviceWorker.ready.then(r => r.active.postMessage({
//   type: 'NOTIFY', title: '...', body: '...', tag: '...'
// }))
self.addEventListener('message', e => {
    if (e.data?.type !== 'NOTIFY') return;
    self.registration.showNotification(e.data.title || 'AI OS', {
        body:    e.data.body  || '',
        icon:    '/icons/icon-192.png',
        badge:   '/icons/icon-192.png',
        tag:     e.data.tag   || ('ai-os-' + Date.now()),
        silent:  false,
    });
});

// ─── Notification click: открыть приложение ───────────────────────────────
self.addEventListener('notificationclick', e => {
    e.notification.close();
    e.waitUntil(
        self.clients.matchAll({ type: 'window' }).then(clients => {
            if (clients.length) return clients[0].focus();
            return self.clients.openWindow('/');
        })
    );
});
