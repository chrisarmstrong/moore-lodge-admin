/**
 * Samson's service worker.
 *
 * Two things make this different from a stock offline-first worker, and both
 * are worth understanding before changing anything here.
 *
 * 1. The app sits behind Cloudflare Access. When a session expires, Access
 *    answers a navigation with a redirect to a login page on another origin.
 *    A worker that cached responses blindly would eventually store that login
 *    page under `/day/2026-08-20` and serve it forever. Navigations here are
 *    only ever cached when the response is a real same-origin 200.
 *
 * 2. These pages carry guests' names, phone numbers, email addresses and
 *    dietary requirements. Keeping that on a phone is a deliberate trade:
 *    worth it so the diary opens in a kitchen with no signal, but it means the
 *    cache has to be thrown away the moment Access stops recognising us. That
 *    is what `purgeDiary` is for, and why it runs on every bounce to login.
 */

// Replaced by the Worker with the Cloudflare deployment id when this file is
// served. A hand-maintained constant is the classic way to ship a change and
// leave everyone on the old worker because nobody remembered to bump it.
const VERSION = '__VERSION__';
const SHELL = `samson-shell-${VERSION}`;   // fonts, icons, the offline page
const DIARY = `samson-diary-${VERSION}`;   // rendered pages — guest data lives here
const MINE = new Set([SHELL, DIARY]);

const SHELL_ASSETS = [
  '/offline.html',
  '/fonts/Romie-Light.woff2',
  '/fonts/CaslonDoric-Regular-Web.woff2',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// How many days of the diary to keep. Enough to cover a shift and the days
// either side of it, not enough to become an archive of guest details.
const DIARY_LIMIT = 12;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // One failed asset shouldn't block the whole install.
    await Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url)));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      // Lets the network request start while the worker is still booting.
      await self.registration.navigationPreload.enable();
    }
    const names = await caches.keys();
    await Promise.all(names.filter((name) => !MINE.has(name)).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'purge') event.waitUntil(purgeDiary());
  if (event.data === 'version') event.source?.postMessage({ version: VERSION });
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Access login, and anything else

  // A tap handled inside the page fetches its own replacement, which is a
  // navigation in everything but `mode`. It must come through here or the
  // diary stops being available offline the moment the page stops reloading
  // itself — and, far worse, an Access bounce would stop purging it.
  if (request.mode === 'navigate' || request.headers.get('x-samson-nav')) {
    event.respondWith(page(event));
    return;
  }
  if (isShellAsset(url.pathname)) {
    event.respondWith(shellAsset(request));
  }
});

function isShellAsset(pathname) {
  return pathname.startsWith('/fonts/')
    || pathname.startsWith('/icons/')
    || pathname === '/manifest.webmanifest';
}

/**
 * Pages: network first, because a diary that is quietly out of date is worse
 * than one that takes a moment to load.
 */
async function page(event) {
  const { request } = event;
  try {
    const preloaded = await event.preloadResponse;
    const response = preloaded || await fetch(request);

    // A navigation request carries `redirect: "manual"`, so an Access bounce
    // arrives as an opaque redirect: status 0, type "opaqueredirect". Handing
    // it straight back is what makes the browser follow it to the login page —
    // and the page's own fetches ask for the same treatment for the same
    // reason, so this holds for both.
    if (response.type === 'opaqueredirect' || response.redirected) {
      event.waitUntil(purgeDiary());
      return response;
    }

    // `basic` means same-origin and readable. Anything else — opaque, errored,
    // a 403 from the Worker's own auth check — is not the diary.
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(remember(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request, { cacheName: DIARY, ignoreSearch: false });
    if (cached) return cached;

    const fallback = await caches.match('/offline.html', { cacheName: SHELL });
    return fallback || new Response(
      '<!doctype html><meta charset=utf-8><title>Offline</title><p>Samson is offline.',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    );
  }
}

/** Fonts and icons never change in place, so the cached copy is always right. */
async function shellAsset(request) {
  const cached = await caches.match(request, { cacheName: SHELL });
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok && response.type === 'basic') {
      const cache = await caches.open(SHELL);
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    return cached || Response.error();
  }
}

async function remember(request, response) {
  const cache = await caches.open(DIARY);
  await cache.put(request, response);
  await trim(cache);
}

/** Oldest-first eviction. Cache.keys() returns insertion order. */
async function trim(cache) {
  const keys = await cache.keys();
  const excess = keys.length - DIARY_LIMIT;
  for (let i = 0; i < excess; i += 1) await cache.delete(keys[i]);
}

async function purgeDiary() {
  await caches.delete(DIARY);
}
