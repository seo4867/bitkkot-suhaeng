const CACHE = 'bitkkot-v3';
const CORE  = ['/', '/index.html', '/icons/icon-192.png'];

self.addEventListener('install',  e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE).catch(()=>{})));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks =>
    Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  // Firebase Auth 요청은 캐시 안 함
  if (e.request.url.includes('firebaseapp.com') ||
      e.request.url.includes('googleapis.com') ||
      e.request.url.includes('google.com')) return;

  if (!e.request.url.startsWith(self.location.origin)) return;

  // GET 요청만 캐시
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      const fetchPromise = fetch(e.request).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
        }
        return response;
      }).catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
