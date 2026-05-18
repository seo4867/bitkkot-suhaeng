// 빛꽃수행일지 Service Worker
const CACHE_NAME = 'bitkkot-v1';

// 오프라인에서도 동작하도록 핵심 파일 캐시
const CORE_ASSETS = [
  '/',
  '/index.html',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// 설치 시 핵심 파일 캐시
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(CORE_ASSETS).catch(() => {
        // 일부 파일 캐시 실패해도 계속 진행
      });
    })
  );
  self.skipWaiting();
});

// 활성화 시 이전 캐시 정리
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// 네트워크 우선, 실패 시 캐시 사용 (Network First 전략)
self.addEventListener('fetch', (event) => {
  // 외부 요청(유튜브, 구글폰트 등)은 캐시 안 함
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // 성공하면 캐시에도 저장
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // 네트워크 실패 시 캐시에서 제공
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('/');
        });
      })
  );
});
