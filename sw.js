/* FinDash Service Worker */
const VERSION = 'findash-v2';
const SHELL_CACHE = `${VERSION}-shell`;
const RUNTIME_CACHE = `${VERSION}-runtime`;

// Casca do app: o que garante a abertura offline
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

// Domínios que NUNCA devem ser interceptados (sync em tempo real do Firebase)
const BYPASS_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Só GET; Firebase e afins passam direto (websocket/long-polling do sync)
  if (event.request.method !== 'GET') return;
  if (BYPASS_HOSTS.some((h) => url.hostname.includes(h))) return;

  // 1) Navegações (o HTML): network-first, cai pro cache offline.
  //    Assim, toda atualização que você publicar chega na primeira abertura com internet.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((resp) => {
          const copy = resp.clone();
          caches.open(SHELL_CACHE).then((c) => c.put('./index.html', copy));
          return resp;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 2) CDNs (Tailwind, Chart.js, fontes, SDK Firebase) e demais assets:
  //    stale-while-revalidate — responde do cache na hora e atualiza por trás.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((resp) => {
          if (resp && (resp.status === 200 || resp.type === 'opaque')) {
            const copy = resp.clone();
            caches.open(RUNTIME_CACHE).then((c) => c.put(event.request, copy));
          }
          return resp;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
