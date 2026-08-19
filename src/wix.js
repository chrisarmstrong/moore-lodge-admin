/**
 * A thin Wix REST client.
 *
 * Site-level calls authenticate with an API key in `Authorization` and the site
 * id in `wix-site-id` — see
 * https://dev.wix.com/docs/api-reference/articles/authentication/api-keys/make-api-calls-with-an-api-key
 *
 * Nothing above this file should import it. Samson talks to the interfaces in
 * `domain.js`; only the adapters know Wix exists. That boundary is the whole
 * reason this can later be swapped for our own database without the views
 * noticing.
 */

const BASE = 'https://www.wixapis.com';

export class WixError extends Error {
  constructor(path, status, body) {
    super(`Wix ${path} returned ${status}`);
    this.name = 'WixError';
    this.status = status;
    this.body = body;
  }
}

export class WixClient {
  constructor(env) {
    this.apiKey = env.WIX_API_KEY;
    this.siteId = env.WIX_SITE_ID;
    if (!this.apiKey) throw new Error('WIX_API_KEY is not configured');
    if (!this.siteId) throw new Error('WIX_SITE_ID is not configured');
    // Two screens in the same request often want the same answer.
    this.inflight = new Map();
  }

  async post(path, body) {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        authorization: this.apiKey,
        'wix-site-id': this.siteId,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) throw new WixError(path, response.status, text.slice(0, 500));
    return text ? JSON.parse(text) : {};
  }

  /**
   * Walks a cursor-paged query to completion.
   *
   * Offset paging is deliberately not used here: the Reservations API accepts
   * `paging.offset` and then ignores it, returning the first page over and
   * over, which is a very quiet way to get a wrong answer.
   */
  async queryAll(path, query, collection, { limit = 100, maxPages = 25 } = {}) {
    const items = [];
    let cursor = null;

    for (let page = 0; page < maxPages; page += 1) {
      const body = {
        query: cursor
          ? { cursorPaging: { limit, cursor } }
          : { ...query, cursorPaging: { limit } },
      };
      const response = await this.post(path, body);
      const batch = response[collection] || [];
      items.push(...batch);

      cursor = response.pagingMetadata?.cursors?.next;
      if (!cursor || batch.length === 0) break;
    }

    return items;
  }

  /**
   * The same query, but answered from the edge cache when it can be.
   *
   * The obvious approach — `fetch(..., { cf: { cacheTtl } })` — silently does
   * nothing here, because every Wix query is a POST and Cloudflare does not
   * cache POST responses. The TTLs that used to sit on those calls were inert,
   * which is why a page that only needed the schedule still made five round
   * trips. So the result is stored against a synthetic GET key instead.
   *
   * Only the site's configuration goes through this. Reservations change while
   * somebody is looking at them and are always fetched fresh.
   */
  async cachedQueryAll(path, query, collection, { ttl, key, ctx } = {}) {
    // `caches` only exists on Workers. Under test, and anywhere else this code
    // is exercised outside the runtime, the query simply isn't cached.
    const cache = typeof caches === 'undefined' ? null : caches.default;
    if (!cache) return this.queryAll(path, query, collection);

    const cacheKey = new Request(
      `https://samson.invalid/wix${path}/${encodeURIComponent(key)}`,
      { headers: { 'x-site': this.siteId } },
    );

    const hit = await cache.match(cacheKey);
    if (hit) return hit.json();

    // Two screens rendering at once shouldn't both go and ask.
    const pending = this.inflight.get(cacheKey.url);
    if (pending) return pending;

    const work = (async () => {
      const items = await this.queryAll(path, query, collection);
      const store = cache.put(cacheKey, new Response(JSON.stringify(items), {
        headers: {
          'content-type': 'application/json',
          'cache-control': `public, max-age=${ttl}`,
        },
      }));
      if (ctx?.waitUntil) ctx.waitUntil(store); else await store;
      return items;
    })().finally(() => this.inflight.delete(cacheKey.url));

    this.inflight.set(cacheKey.url, work);
    return work;
  }
}
