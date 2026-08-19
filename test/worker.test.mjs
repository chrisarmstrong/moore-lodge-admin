// Drives the Worker itself: a real Access assertion, a real form post, and the
// ways a booking must not be changeable.
import worker from '../src/worker.js';
import { NOTE_LIMIT } from '../src/actions.js';

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
// What the booking actually is when the write goes to apply itself, which is
// not necessarily what the page that posted the form believed.
let onDisk = { status: 'RESERVED' };
let posted = null;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (init.method === 'POST' && u.endsWith('/reservations') && !u.includes('/query')) {
    posted = JSON.parse(init.body);
    return { ok:true, status:200, text: async () => JSON.stringify({ reservation:{
      id:ID, revision:'1', status:'RESERVED', paymentStatus:'NOT_PAID', source:'OFFLINE',
      details:{ startDate:posted.reservation.details.startDate, partySize:posted.reservation.details.partySize },
      reservee:posted.reservation.reservee, createdDate:'2026-08-01T00:00:00Z' } }) };
  }
  if (u.includes('reservation-locations')) {
    return { ok:true, status:200, text: async () => JSON.stringify({ reservationLocations:[{ id:'loc-1', configuration:{} }] }) };
  }
  if (u.includes('cloudflareaccess.com')) return { ok:true, status:200, json: async () => ({ keys:[jwk] }) };
  if (init.method === 'PATCH') {
    patched = JSON.parse(init.body);
    return { ok:true, status:200, text: async () => JSON.stringify({ reservation:{ id:ID, revision:'8', status:'RESERVED', paymentStatus:'PAID', details:{ startDate:'2026-08-06T11:30:00Z', partySize:2 }, reservee:{}, createdDate:'2026-08-01T00:00:00Z' } }) };
  }
  if ((init.method || 'GET') === 'GET') {
    return { ok:true, status:200, text: async () => JSON.stringify({ reservation:{ id:ID, revision:'7', status:onDisk.status, paymentStatus:'NOT_PAID', details:{ startDate:'2026-08-06T11:30:00Z', partySize:2 }, reservee:{}, createdDate:'2026-08-01T00:00:00Z' } }) };
  }
  return { ok:true, status:200, text: async () => JSON.stringify({ experiences: [], reservationLocations: [] }) };
};

const env = { WIX_API_KEY:'k', WIX_SITE_ID:'s', ACCESS_TEAM_DOMAIN:TEAM, ACCESS_AUD:AUD,
              CF_VERSION_METADATA:{ id:'test-build' } };
const ctx = { waitUntil() {} };

const post = async (path, { origin = ORIGIN, fetchSite, back = '/day/2026-08-06', token, fields = {} } = {}) => {
  const headers = { 'content-type':'application/x-www-form-urlencoded' };
  if (origin) headers.origin = origin;
  if (fetchSite) headers['sec-fetch-site'] = fetchSite;
  headers['Cf-Access-Jwt-Assertion'] = token ?? await assertion();
  return worker.fetch(new Request(`${ORIGIN}${path}`, {
    method:'POST', headers, body:new URLSearchParams({ back, ...fields }),
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
  // It has to actually be called off. Before the route checked, this passed
  // against a live booking, which is the whole bug.
  onDisk = { status:'CANCELED' };
  patched = null;
  const res = await post(`/booking/${ID}/restore`, { back:'/called-off/2026-08-06' });
  is('writes the status back to reserved', patched.reservation.status, 'RESERVED');
  is('and returns to the list it came from',
    res.headers.get('location').startsWith('/called-off/2026-08-06?done='), true);
  is('saying so', decodeURIComponent(res.headers.get('location').split('done=')[1]), 'Back on the diary.');
  onDisk = { status:'RESERVED' };
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

console.log('--- writing a note to the team ---');
{
  patched = null;
  const res = await post(`/booking/${ID}/note`, { fields:{ note:'  coeliac, table by the window  ' } });
  is('writes the note', patched.reservation.teamMessage, 'coeliac, table by the window');
  is('says so', decodeURIComponent(res.headers.get('location').split('done=')[1]), 'Note saved.');

  patched = null;
  await post(`/booking/${ID}/note`, { fields:{ note:'x'.repeat(4000) } });
  is('and will not take an essay', patched.reservation.teamMessage.length, NOTE_LIMIT);

  patched = null;
  await post(`/booking/${ID}/note`, { fields:{ note:'' } });
  is('clearing it is allowed', patched.reservation.teamMessage, '');
}

console.log('--- the page decides what to offer; the route decides what to do ---');
{
  // The button is never drawn on a cancelled booking, but a form post does not
  // have to have come from a page we drew.
  onDisk = { status:'CANCELED' };
  patched = null;
  const res = await post(`/booking/${ID}/paid`);
  is('marking a cancelled booking paid is refused', patched, null);
  is('and it says why rather than pretending', /failed=/.test(res.headers.get('location')), true);

  patched = null;
  await post(`/booking/${ID}/restore`);
  is('but putting it back is exactly what it allows', patched.reservation.status, 'RESERVED');

  patched = null;
  await post(`/booking/${ID}/note`, { fields:{ note:'rang to say sorry' } });
  is('and a note is welcome on it too', patched.reservation.teamMessage, 'rang to say sorry');

  onDisk = { status:'RESERVED' };
  patched = null;
  await post(`/booking/${ID}/restore`);
  is('while restoring a live booking is refused', patched, null);
}

console.log('--- taking a booking over the phone ---');
{
  posted = null;
  const body = new URLSearchParams({
    date:'2026-08-06', time:'12:30', partySize:'4',
    firstName:'Ann', lastName:'Blair', phone:'+447700900123', email:'ann@example.com', note:'window table',
  });
  const res = await worker.fetch(new Request(`${ORIGIN}/new`, {
    method:'POST',
    headers:{ 'content-type':'application/x-www-form-urlencoded', origin:ORIGIN,
              'Cf-Access-Jwt-Assertion': await assertion() },
    body,
  }), env, ctx);

  is('the reservation is offline, which is what a phone booking is', posted.reservation.source, 'OFFLINE');
  is('half twelve in Ballymoney went up as 11:30Z', posted.reservation.details.startDate, '2026-08-06T11:30:00.000Z');
  is('and ends two hours later by default', posted.reservation.details.endDate, '2026-08-06T13:30:00.000Z');
  is('carries the location', posted.reservation.details.reservationLocationId, 'loc-1');
  is('the party size', posted.reservation.details.partySize, 4);
  is('the name and number the API insists on', [posted.reservation.reservee.firstName, posted.reservation.reservee.phone], ['Ann', '+447700900123']);
  is('the note rides along', posted.reservation.teamMessage, 'window table');
  // Status is left out on purpose: the location's approval setting decides
  // between RESERVED and REQUESTED, and we should not assert one over it.
  is('no status is asserted', 'status' in posted.reservation, false);
  is('lands on the day it was booked for', res.headers.get('location').startsWith('/day/2026-08-06?done='), true);
}

console.log('--- a form with something wrong in it ---');
{
  posted = null;
  const res = await worker.fetch(new Request(`${ORIGIN}/new`, {
    method:'POST',
    headers:{ 'content-type':'application/x-www-form-urlencoded', origin:ORIGIN,
              'Cf-Access-Jwt-Assertion': await assertion() },
    body:new URLSearchParams({ date:'2026-08-06', time:'12:30', partySize:'4', firstName:'Ann', phone:'' }),
  }), env, ctx);
  const page = await res.text();
  is('nothing was written', posted, null);
  is('and it says so on the form rather than redirecting', res.status, 422);
  is('naming what is wrong', /phone number is needed/.test(page), true);
  is('with the typing still in it', /value="Ann"/.test(page), true);
}

console.log('--- a booking form posted from somewhere else ---');
{
  posted = null;
  const res = await worker.fetch(new Request(`${ORIGIN}/new`, {
    method:'POST',
    headers:{ 'content-type':'application/x-www-form-urlencoded', origin:'https://evil.example',
              'Cf-Access-Jwt-Assertion': await assertion() },
    body:new URLSearchParams({ date:'2026-08-06', time:'12:30', partySize:'4', firstName:'Ann', phone:'+447700900123' }),
  }), env, ctx);
  is('is refused', res.status, 403);
  is('and books nothing', posted, null);
}

console.log('--- what somebody who is not signed in is told ---');
{
  const page = await worker.fetch(new Request(`${ORIGIN}/day/2026-08-06`), env, ctx);
  const body = await page.text();
  is('turned away', page.status, 403);
  is('and pointed at the address that signs them in', body.includes('samson.moorelodge.co.uk'), true);
  // The reason stays, but it is not the sentence they are asked to act on.
  is('the machine reason is demoted, not dropped', body.includes('class="sub"'), true);

  const unset = await worker.fetch(new Request(`${ORIGIN}/day/2026-08-06`),
    { ...env, ACCESS_AUD: 'REPLACE-ME' }, ctx);
  const setup = await unset.text();
  is('a misconfigured Worker says so outright', setup.includes('not configured'), true);
  is('and does not send anyone off to sign in', setup.includes('brought straight here'), false);
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
