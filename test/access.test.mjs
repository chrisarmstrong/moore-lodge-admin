// Cloudflare Access is the only thing standing between the diary and the
// internet, so it gets tested properly: a real RSA keypair, real signatures,
// and every way a request should be turned away.
import { authenticate, AccessError } from '../src/access.js';

let fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}  ${JSON.stringify(got)}`);
};
const rejects = async (label, fn, expected) => {
  try { await fn(); fail++; console.log(`FAIL ${label}\n  it was accepted`); }
  catch (error) {
    const ok = error instanceof AccessError && error.message.includes(expected);
    if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${error.message}`); }
    else console.log(`ok   ${label}  "${error.message}"`);
  }
};

const AUD = 'beb01093984400f1811b2db0fc78988f0464da5bb20ef9baf3c6478164acb1da';
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const encode = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
  true, ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'test-key', alg: 'RS256' };

// Each case gets its own team domain so the module-level JWKS cache, which is
// keyed by URL, never carries an answer over from the previous one.
let domainCounter = 0;
const freshDomain = () => `case${domainCounter += 1}.cloudflareaccess.com`;

let jwksServed = 0;
globalThis.fetch = async (url) => {
  jwksServed += 1;
  if (!String(url).endsWith('/cdn-cgi/access/certs')) throw new Error(`unexpected fetch: ${url}`);
  return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
};

async function mint({ domain, aud = [AUD], exp, nbf, kid = 'test-key', email = 'chris@moorelodge.co.uk' }) {
  const now = Math.floor(Date.now() / 1000);
  const header = encode({ alg: 'RS256', kid, typ: 'JWT' });
  const payload = encode({
    aud, iss: `https://${domain}`, email, sub: 'user-123',
    exp: exp ?? now + 3600, ...(nbf === undefined ? {} : { nbf }),
  });
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(signature)}`;
}

const request = (token, { asCookie = false } = {}) => new Request('https://samson.moorelodge.co.uk/', {
  headers: token == null ? {}
    : asCookie ? { Cookie: `foo=bar; CF_Authorization=${token}; baz=qux` }
    : { 'Cf-Access-Jwt-Assertion': token },
});
const env = (domain) => ({ ACCESS_TEAM_DOMAIN: domain, ACCESS_AUD: AUD });

console.log('--- a good assertion ---');
{
  const domain = freshDomain();
  const staff = await authenticate(request(await mint({ domain })), env(domain));
  is('identifies the person', staff.email, 'chris@moorelodge.co.uk');
  is('carries the subject', staff.userId, 'user-123');
  is('expiry is a date', staff.expiresAt instanceof Date, true);
}
{
  const domain = freshDomain();
  const staff = await authenticate(request(await mint({ domain }), { asCookie: true }), env(domain));
  is('accepts the cookie a browser sends', staff.email, 'chris@moorelodge.co.uk');
}
{
  const domain = freshDomain();
  const staff = await authenticate(request(await mint({ domain, aud: AUD })), env(domain));
  is('accepts aud as a bare string', staff.email, 'chris@moorelodge.co.uk');
}

console.log('--- the ways in that must not work ---');
{
  const domain = freshDomain();
  await rejects('no assertion at all', () => authenticate(request(null), env(domain)), 'no Access assertion');
  await rejects('not a JWT', () => authenticate(request('nonsense'), env(domain)), 'malformed');

  // An assertion for somebody else's Access application, signed by the same
  // team. This is the one that a plain signature check would let through.
  const other = await mint({ domain, aud: ['a-different-application'] });
  await rejects('another application', () => authenticate(request(other), env(domain)), 'another application');

  const expired = await mint({ domain, exp: Math.floor(Date.now() / 1000) - 3600 });
  await rejects('expired', () => authenticate(request(expired), env(domain)), 'expired');

  const future = await mint({ domain, nbf: Math.floor(Date.now() / 1000) + 3600 });
  await rejects('not valid yet', () => authenticate(request(future), env(domain)), 'not yet valid');

  const elsewhere = await mint({ domain: 'someone-else.cloudflareaccess.com' });
  await rejects('issued by another team', () => authenticate(request(elsewhere), env(domain)), 'issued elsewhere');
}
{
  // A token whose payload has been edited after signing.
  const domain = freshDomain();
  const [h, p, s] = (await mint({ domain })).split('.');
  const tampered = `${h}.${encode({ aud: [AUD], iss: `https://${domain}`, email: 'attacker@example.com', exp: 9999999999 })}.${s}`;
  await rejects('tampered payload', () => authenticate(request(tampered), env(domain)), 'signature does not verify');
}
{
  const domain = freshDomain();
  const unknown = await mint({ domain, kid: 'a-key-we-do-not-have' });
  await rejects('unknown signing key', () => authenticate(request(unknown), env(domain)), 'unknown key');
}
{
  const domain = freshDomain();
  const [, p, s] = (await mint({ domain })).split('.');
  const none = `${encode({ alg: 'none', kid: 'test-key' })}.${p}.${s}`;
  await rejects('alg none', () => authenticate(request(none), env(domain)), 'unexpected algorithm');
}

console.log('--- configuration ---');
{
  const token = await mint({ domain: 'x.cloudflareaccess.com' });
  await rejects('missing team domain',
    () => authenticate(request(token), { ACCESS_AUD: AUD }), 'ACCESS_TEAM_DOMAIN is not configured');
  await rejects('placeholder left in place',
    () => authenticate(request(token), { ACCESS_TEAM_DOMAIN: 'REPLACE-ME.cloudflareaccess.com', ACCESS_AUD: AUD }),
    'still set to its placeholder');
}

console.log('--- key caching ---');
{
  const domain = freshDomain();
  const before = jwksServed;
  await authenticate(request(await mint({ domain })), env(domain));
  await authenticate(request(await mint({ domain })), env(domain));
  await authenticate(request(await mint({ domain })), env(domain));
  is('keys fetched once for three requests', jwksServed - before, 1);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
