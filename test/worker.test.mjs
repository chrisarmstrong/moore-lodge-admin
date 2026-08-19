// Drives the Worker itself: a real Access assertion, a real form post, and the
// ways a booking must not be changeable.
import worker from '../src/worker.js';

let fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}  ${JSON.stringify(got)}`);
};

const TEAM = 'plain-leaf-6898.cloudflareaccess.com';
const AUD = 'test-audience';
const ORIGIN = 'https://samson.moorelodge.co.uk';
const ID = '006abfa7-e990-41dd-af31-b4574c1b8a55';

const b64 = (b) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const enc = (o) => b64(new TextEncoder().encode(JSON.stringify(o)));
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name:'RSASSA-PKCS1-v1_5', modulusLength:2048, publicExponent:new Uint8Array([1,0,1]), hash:'SHA-256' }, true, ['sign','verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid:'k1', alg:'RS256' };

async function assertion() {
  const h = enc({ alg:'RS256', kid:'k1' });
  const p = enc({ aud:[AUD], iss:`https://${TEAM}`, email:'chris@moorelodge.co.uk', sub:'u1',
                  exp: Math.floor(Date.now()/1000) + 3600 });
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64(sig)}`;
}

let patched = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.includes('cloudflareaccess.com')) return { ok:true, status:200, json: async () => ({ keys:[jwk] }) };
  if (init.method === 'PATCH') {
    patched = JSON.parse(init.body);
    return { ok:true, status:200, text: async () => JSON.stringify({ reservation:{ id:ID, revision:'8', status:'RESERVED', paymentStatus:'PAID', details:{ startDate:'2026-08-06T11:30:00Z', partySize:2 }, reservee:{}, createdDate:'2026-08-01T00:00:00Z' } }) };
  }
  if ((init.method || 'GET') === 'GET') {
    return { ok:true, status:200, text: async () => JSON.stringify({ reservation:{ id:ID, revision:'7', status:'RESERVED', paymentStatus:'NOT_PAID', details:{ startDate:'2026-08-06T11:30:00Z', partySize:2 }, reservee:{}, createdDate:'2026-08-01T00:00:00Z' } }) };
  }
  return { ok:true, status:200, text: async () => JSON.stringify({ experiences: [], reservationLocations: [] }) };
};

const env = { WIX_API_KEY:'k', WIX_SITE_ID:'s', ACCESS_TEAM_DOMAIN:TEAM, ACCESS_AUD:AUD,
              CF_VERSION_METADATA:{ id:'test-build' } };
const ctx = { waitUntil() {} };

const post = async (path, { origin = ORIGIN, fetchSite, back = '/day/2026-08-06', token } = {}) => {
  const headers = { 'content-type':'application/x-www-form-urlencoded' };
  if (origin) headers.origin = origin;
  if (fetchSite) headers['sec-fetch-site'] = fetchSite;
  headers['Cf-Access-Jwt-Assertion'] = token ?? await assertion();
  return worker.fetch(new Request(`${ORIGIN}${path}`, {
    method:'POST', headers, body:new URLSearchParams({ back }),
  }), env, ctx);
};

console.log('--- a staff member marking a booking paid ---');
{
  patched = null;
  const res = await post(`/booking/${ID}/paid`);
  is('redirects rather than re-rendering', res.status, 302);
  is('lands back on the day it came from',
    res.headers.get('location').startsWith('/day/2026-08-06?done='), true);
  is('says what happened', decodeURIComponent(res.headers.get('location').split('done=')[1]), 'Marked as paid.');
  is('wrote the change', patched.reservation.paymentStatus, 'PAID');
  is('with the revision it read first', patched.reservation.revision, '7');
}

console.log('--- and putting one back that was called off ---');
{
  patched = null;
  const res = await post(`/booking/${ID}/restore`, { back:'/called-off/2026-08-06' });
  is('writes the status back to reserved', patched.reservation.status, 'RESERVED');
  is('and returns to the list it came from',
    res.headers.get('location').startsWith('/called-off/2026-08-06?done='), true);
  is('saying so', decodeURIComponent(res.headers.get('location').split('done=')[1]), 'Back on the diary.');
}

console.log('--- the ways a booking must not be changeable ---');
{
  patched = null;
  const cross = await post(`/booking/${ID}/paid`, { origin:'https://evil.example' });
  is('a form on another site is refused', cross.status, 403);
  is('and nothing was written', patched, null);

  const noOrigin = await post(`/booking/${ID}/paid`, { origin:null });
  is('no origin and no same-site hint is refused', noOrigin.status, 403);

  const sameSite = await post(`/booking/${ID}/paid`, { origin:null, fetchSite:'same-origin' });
  is('but a same-origin navigation without Origin is allowed', sameSite.status, 302);

  const unknown = await post(`/booking/${ID}/detonate`);
  is('an action that does not exist is a 404', unknown.status, 404);

  const badId = await post('/booking/not-a-uuid/paid');
  is('a malformed id is a 404', badId.status, 404);

  const noAuth = await post(`/booking/${ID}/paid`, { token:'nonsense' });
  is('a bad Access assertion never reaches the action', noAuth.status, 403);
}

console.log('--- where it sends you afterwards ---');
{
  const away = await post(`/booking/${ID}/paid`, { back:'https://evil.example/steal' });
  is('an off-site return path is ignored', away.headers.get('location').startsWith('/?done='), true);
  const list = await post(`/booking/${ID}/paid`, { back:'/settle/2026-08' });
  is('a real page of ours is honoured', list.headers.get('location').startsWith('/settle/2026-08?done='), true);
}

console.log('--- methods Samson does not answer ---');
{
  const res = await worker.fetch(new Request(`${ORIGIN}/day/2026-08-06`, {
    method:'DELETE', headers:{ 'Cf-Access-Jwt-Assertion': await assertion() },
  }), env, ctx);
  is('DELETE is turned away', res.status, 405);
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
