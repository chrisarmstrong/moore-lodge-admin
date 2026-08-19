/**
 * Cloudflare Access authentication.
 *
 * Access authenticates staff at the edge and forwards a signed JWT. That is not
 * on its own enough: anyone who can reach the Worker's origin directly would
 * bypass the edge check entirely. So every request verifies the assertion here,
 * against Access's own signing keys, before any handler runs.
 *
 * Verifying it also tells us *who* is acting, which is what makes an audit
 * trail possible once Samson can refund and adjust balances.
 */

const JWKS_TTL_MS = 60 * 60 * 1000; // Access rotates keys slowly; an hour is ample.

/** @type {{ url: string, keys: Map<string, CryptoKey>, fetchedAt: number } | null} */
let jwksCache = null;

export class AccessError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccessError';
  }
}

/**
 * Verifies the Access assertion on a request.
 *
 * @returns {Promise<{ email: string, userId: string, expiresAt: Date }>}
 * @throws {AccessError} when the request carries no assertion, or an invalid one.
 */
export async function authenticate(request, env) {
  const teamDomain = required(env, 'ACCESS_TEAM_DOMAIN'); // e.g. moorelodge.cloudflareaccess.com
  const audience = required(env, 'ACCESS_AUD');

  const token = readToken(request);
  if (!token) throw new AccessError('no Access assertion on request');

  const parts = token.split('.');
  if (parts.length !== 3) throw new AccessError('malformed assertion');
  const [rawHeader, rawPayload, rawSignature] = parts;

  const header = decodeJson(rawHeader);
  if (header.alg !== 'RS256') throw new AccessError(`unexpected algorithm ${header.alg}`);
  if (!header.kid) throw new AccessError('assertion has no key id');

  const key = await signingKey(teamDomain, header.kid);
  const verified = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    decodeBase64Url(rawSignature),
    new TextEncoder().encode(`${rawHeader}.${rawPayload}`),
  );
  if (!verified) throw new AccessError('assertion signature does not verify');

  const claims = decodeJson(rawPayload);
  const now = Math.floor(Date.now() / 1000);
  const skew = 60; // tolerate a minute of clock drift either way

  if (claims.iss !== `https://${teamDomain}`) throw new AccessError('assertion issued elsewhere');
  if (!audiences(claims.aud).includes(audience)) throw new AccessError('assertion is for another application');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new AccessError('assertion expired');
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) throw new AccessError('assertion not yet valid');

  return {
    email: claims.email || 'unknown',
    userId: claims.sub || '',
    expiresAt: new Date(claims.exp * 1000),
  };
}

function readToken(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header.trim();

  // Browsers navigating to the app carry it as a cookie rather than a header.
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

function audiences(aud) {
  if (Array.isArray(aud)) return aud;
  return typeof aud === 'string' ? [aud] : [];
}

/**
 * Access publishes its public keys as a JWKS. They are cached in module scope,
 * which on Workers means per-isolate — a cold isolate pays one fetch, and a
 * rotated key that misses the cache forces a refresh below.
 */
async function signingKey(teamDomain, kid) {
  const url = `https://${teamDomain}/cdn-cgi/access/certs`;
  const fresh = jwksCache
    && jwksCache.url === url
    && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS;

  if (fresh && jwksCache.keys.has(kid)) return jwksCache.keys.get(kid);

  // Either the cache is stale, or it is warm but lacks this key id — which is
  // what a key rotation looks like from here. Both want the same refresh.
  const response = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
  if (!response.ok) throw new AccessError(`could not fetch Access keys (${response.status})`);
  const { keys = [] } = await response.json();

  const imported = new Map();
  for (const jwk of keys) {
    if (!jwk.kid) continue;
    imported.set(
      jwk.kid,
      await crypto.subtle.importKey(
        'jwk',
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      ),
    );
  }
  jwksCache = { url, keys: imported, fetchedAt: Date.now() };

  const key = imported.get(kid);
  if (!key) throw new AccessError('assertion signed by an unknown key');
  return key;
}

function decodeJson(segment) {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment)));
  } catch {
    throw new AccessError('assertion is not valid JSON');
  }
}

function decodeBase64Url(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/')
    .padEnd(segment.length + ((4 - (segment.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function required(env, name) {
  const value = env[name];
  if (!value) throw new AccessError(`${name} is not configured`);
  // Left as shipped, this would sail past the truthiness check and fail later
  // as an unexplained fetch error against REPLACE-ME.cloudflareaccess.com.
  if (String(value).includes('REPLACE-ME')) {
    throw new AccessError(`${name} is still set to its placeholder`);
  }
  return value;
}
