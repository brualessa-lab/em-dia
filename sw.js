// Service worker do Em Dia: permite instalar como app e abrir mesmo com internet ruim.
// Sempre tenta a versão nova primeiro; o cache só entra quando a rede falha.
// Os dados (/api/...) nunca são guardados no cache.
const CACHE = 'emdia-v2';
const ARQUIVOS = ['/', '/app.js', '/styles.css', '/manifest.webmanifest', '/icones/icone-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(e.request)
      .then((r) => {
        if (r.ok) { const copia = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copia)); }
        return r;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/')))
  );
});

// aviso mandado pelo servidor (chega mesmo com o Em Dia fechado)
self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch {}
  e.waitUntil(self.registration.showNotification(m.titulo || 'Em Dia', {
    body: m.corpo || 'Você tem contas perto de vencer.',
    tag: m.tag || 'duofinn',
    icon: '/icones/icone-192.png',
    badge: '/icones/icone-192.png',
  }));
});

// tocar na notificação abre (ou traz para frente) o Em Dia
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then((janelas) => (janelas.length ? janelas[0].focus() : self.clients.openWindow('/')))
  );
});
