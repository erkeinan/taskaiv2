// TaskAI service worker: makes the app installable and opens it offline.
// It only caches the app's own files. Data calls to Supabase are never cached
// here; the app keeps its own small saved copy of the task list.
const CACHE = 'taskai-v3';
const SHARE = 'taskai-share';
const SHELL = ['/', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Android share menu: another app sends a photo, file or text here. Keep it, then open the app.
async function receiveShare(req) {
  try {
    const form = await req.formData();
    const cache = await caches.open(SHARE);
    const meta = { title: form.get('title') || '', text: form.get('text') || '', url: form.get('url') || '' };
    await cache.put('/share/meta', new Response(JSON.stringify(meta), { headers: { 'Content-Type': 'application/json' } }));
    const file = form.getAll('file').find((f) => f && typeof f === 'object' && f.size > 0);
    if (file) {
      await cache.put('/share/file', new Response(file, { headers: { 'Content-Type': file.type || 'application/octet-stream', 'x-name': encodeURIComponent(file.name || 'shared') } }));
    } else {
      await cache.delete('/share/file');
    }
  } catch (e) {
    /* open the app anyway */
  }
  return Response.redirect('/?share=1', 303);
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method === 'POST' && new URL(req.url).pathname === '/share-target') {
    event.respondWith(receiveShare(req));
    return;
  }
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Pages: network first, saved copy when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('/', copy));
          return res;
        })
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Built files never change under the same name: cache first.
  if (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
            return res;
          }),
      ),
    );
  }
});

// Tapping a task reminder opens (or focuses) the app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('/');
    }),
  );
});
