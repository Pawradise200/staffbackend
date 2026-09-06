// Pawradise 員工系統 service worker（2026-09-06 提速）
// 策略：
//   殼（頁面/JS/圖/字體）＝ cache 先行、背景更新（開 app 即開，改版下次開自動生效）
//   API（script.google.com）＝ 一律行網絡，唔 cache——佣金/更表/檢查記錄必須係最新
// ⚠️ 改任何殼檔案（index.html / app.js / 圖）都要令 VERSION 行前一格，唔係員工會食舊 cache
const VERSION = 'pw-v2-20260906b';
const SHELL = [
  './',
  './index.html',
  './app.js?v=20260906b',
  './react.production.min.js',
  './react-dom.production.min.js',
  './manifest.json',
  './pawradise-logo.jpg',
  './pawradise-logo-full.png',
  './daki-cert.png',
  './daki-explore.png',
  './daki-heart.png',
  './icon-192.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // API 永遠行網絡
  if (url.hostname === 'script.google.com' || url.hostname === 'script.googleusercontent.com') return;
  // 字體（googleapis/gstatic）：cache 先行，冇先落網
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(VERSION).then(c => c.match(e.request).then(hit => hit || fetch(e.request).then(res => {
        if (res.ok || res.type === 'opaque') c.put(e.request, res.clone());
        return res;
      })))
    );
    return;
  }
  // 同源殼檔案：cache 即回＋背景更新
  if (url.origin === self.location.origin) {
    e.respondWith(
      caches.open(VERSION).then(c => c.match(e.request).then(hit => {
        const refresh = fetch(e.request).then(res => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        }).catch(() => hit);
        return hit || refresh;
      }))
    );
  }
});
