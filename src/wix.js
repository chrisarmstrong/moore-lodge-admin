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
  }

  async post(path, body, { cacheTtl = 0 } = {}) {
    return this.request('POST', path, body, cacheTtl);
  }

  async get(path, { cacheTtl = 0 } = {}) {
    return this.request('GET', path, null, cacheTtl);
  }

  async request(method, path, body, cacheTtl) {
    const response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        authorization: this.apiKey,
        'wix-site-id': this.siteId,
        'content-type': 'application/json',
      },
      body: body == null ? undefined : JSON.stringify(body),
      // Read-heavy screens refresh often. A short edge cache keeps the diary
      // responsive without letting it drift far from the truth.
      cf: cacheTtl ? { cacheTtl, cacheEverything: true } : undefined,
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
  async queryAll(path, query, collection, { limit = 100, maxPages = 25, cacheTtl = 0 } = {}) {
    const items = [];
    let cursor = null;

    for (let page = 0; page < maxPages; page += 1) {
      const body = {
        query: cursor
          ? { cursorPaging: { limit, cursor } }
          : { ...query, cursorPaging: { limit } },
      };
      const response = await this.post(path, body, { cacheTtl });
      const batch = response[collection] || [];
      items.push(...batch);

      cursor = response.pagingMetadata?.cursors?.next;
      if (!cursor || batch.length === 0) break;
    }

    return items;
  }
}
