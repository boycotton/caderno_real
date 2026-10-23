// Service worker: deixa o app abrir mesmo sem internet (o Drive, claro, precisa de rede).
const VERSION = 'caderno-v19';
const CORE = [
  './', 'index.html', 'css/app.css', 'manifest.webmanifest',
  'js/main.js', 'js/calc.js', 'js/explorer.js', 'js/recognize.js', 'js/learn.js', 'js/jdict.js', 'js/editor.js', 'js/ink.js', 'js/pdfio.js', 'js/templates.js', 'js/drive.js', 'js/store.js', 'js/ui.js',
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdf-lib.esm.min.js',
  'vendor/fonts/pixelify-sans-latin-400-normal.woff2', 'vendor/fonts/pixelify-sans-latin-700-normal.woff2', 'vendor/fonts/vt323-latin-400-normal.woff2',
  'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Google APIs: sempre pela rede
  // rede primeiro (pega atualizações), cache se estiver offline
  e.respondWith(
    // no-cache: sempre confere com o servidor (o GitHub Pages guarda arquivos por 10 min e misturaria versões)
    fetch(e.request.url, { cache: 'no-cache', credentials: 'same-origin' }).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html')))
  );
});
