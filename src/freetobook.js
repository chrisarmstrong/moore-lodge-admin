/**
 * A thin freetobook client.
 *
 * freetobook's booking-page API is public and unauthenticated. The widget token
 * below appears in every "Book Now" link on moorelodge.co.uk and in
 * freetobook's own client bundle — it is an address, not a credential, and the
 * public site's `worker.js` reads the same two endpoints to price a stay.
 *
 * Being public is also the limit of what it can say: it answers with
 * availability, never with a reservation. What that does and does not tell
 * housekeeping is `adapters/freetobook-rooms.js`'s problem, not this file's.
 *
 * Nothing above the adapter should import this. Samson talks to the interfaces
 * in `domain.js`; only the adapters know where the data came from.
 */

const BASE = 'https://freetobook.com/booking-pages';

/** Overridable so a rotated token is a config change, not a deploy. */
const WIDGET_TOKEN = '5cWUXm0z5BjtoXzCF6KQUnHkptuvdz0ODcSNPVZGpwaZ9cmmOl21HdTOOeQpx';

/**
 * freetobook's API sits behind a WAF that answers 403 to requests without a
 * browser-shaped User-Agent, and Workers send none by default. Identifies us
 * honestly while still matching the `Mozilla/5.0 (...)` shape the filter wants.
 * Learned on the public site; it costs nothing to carry it across.
 */
const USER_AGENT = 'Mozilla/5.0 (compatible; MooreLodge/1.0; +https://moorelodge.co.uk)';

export class FreetobookError extends Error {
  constructor(path, status) {
    super(`freetobook ${path} returned ${status}`);
    this.name = 'FreetobookError';
    this.status = status;
  }
}

export class Freetobook {
  constructor(env = {}, ctx) {
    this.token = env.FREETOBOOK_WIDGET_TOKEN || WIDGET_TOKEN;
    this.ctx = ctx;
    // Two screens in the same request often want the same answer.
    this.inflight = new Map();
  }

  /** The property and its units: ids, names, and the order the site shows them. */
  widget(ttl) {
    return this.get(`widgets/${this.token}`, ttl);
  }

  /** Every night in `[from, to]`, per unit. Both bounds are local dates. */
  availability(from, to, ttl) {
    return this.get(
      `widgets/${this.token}/properties/availability?from_date=${from}&to_date=${to}`,
      ttl,
    );
  }

  /**
   * Caching goes through the Cache API rather than `cf: { cacheEverything }`.
   * With `cacheEverything` set, the origin request is made by Cloudflare's
   * caching layer instead of by the Worker, and freetobook's WAF answered 403
   * to it — every call failed in production while succeeding everywhere else.
   * Here the request stays the Worker's own and the response is cached after.
   *
   * freetobook answers `no-store`, so the copy we keep is written with our own
   * cache-control; otherwise the Cache API refuses to hold it.
   */
  async get(path, ttl) {
    const url = `${BASE}/${path}`;
    // `caches` only exists on Workers. Under test the call simply isn't cached.
    const cache = typeof caches === 'undefined' ? null : caches.default;
    const key = new Request(url, { method: 'GET' });

    // The cache is strictly best effort: it is bypassed on workers.dev
    // subdomains, where `put` can throw. A caching problem must never be able
    // to take the diary's room strip down.
    try {
      const hit = await cache?.match(key);
      if (hit) return await hit.json();
    } catch {
      // fall through and fetch it live
    }

    const pending = this.inflight.get(url);
    if (pending) return pending;

    const work = (async () => {
      const response = await fetch(url, {
        headers: { accept: 'application/json', 'user-agent': USER_AGENT },
      });
      if (!response.ok) throw new FreetobookError(path, response.status);
      const body = await response.text();

      try {
        const store = cache?.put(key, new Response(body, {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': `public, max-age=${ttl}`,
          },
        }));
        if (store) {
          if (this.ctx?.waitUntil) this.ctx.waitUntil(store); else await store;
        }
      } catch {
        // not cacheable here; the caller still gets its data
      }
      return JSON.parse(body);
    })().finally(() => this.inflight.delete(url));

    this.inflight.set(url, work);
    return work;
  }
}
