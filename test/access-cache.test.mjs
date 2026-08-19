// The privacy test: when Cloudflare Access stops recognising the session, the
// cached diary — guest names, phone numbers, dietary notes — must not survive
// on the device.
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Set CHROMIUM to a browser binary where Playwright's own download isn't wanted.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { WixBookings } = await import(`${R}/src/adapters/wix-bookings.js`);
const { groupIntoSittings } = await import(`${R}/src/calendar.js`);
const { dayView } = await import(`${R}/src/views/day.js`);
const { RESERVATIONS, EXPERIENCES, LOCATIONS } = await import('./fixture.mjs');

globalThis.fetch = async (url) => ({ ok:true, status:200, text: async () => JSON.stringify(
  String(url).includes('/experiences/') ? { experiences: EXPERIENCES }
  : String(url).includes('/reservation-locations/') ? { reservationLocations: LOCATIONS }
  : { reservations: RESERVATIONS })});
const repo = new WixBookings({ WIX_API_KEY:'k', WIX_SITE_ID:'s' });
const byDate = groupIntoSittings(
  await repo.inRange({ start:new Date('2026-07-31T23:00:00Z'), end:new Date('2026-08-31T23:00:00Z') }),
  await repo.experiences(), new Date('2026-08-05T12:00:00Z'));
const dayHtml = dayView({ date:'2026-08-06', sittings: byDate.get('2026-08-06') });

// Stands in for the Access login origin.
const login = createServer((_,res)=>{ res.writeHead(200,{'content-type':'text/html'}); res.end('<title>Sign in</title>Access login'); }).listen(8797);

let sessionExpired = false;
const TYPES = { '.woff2':'font/woff2', '.png':'image/png', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.html':'text/html' };
const app = createServer((req,res)=>{
  const p = req.url.split('?')[0];
  if (p === '/day') {
    if (sessionExpired) { res.writeHead(302,{location:'http://localhost:8797/login'}); return res.end(); }
    res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); return res.end(dayHtml);
  }
  const file = `${R}/public${p}`;
  if (existsSync(file)) {
    res.writeHead(200,{'content-type':TYPES[p.slice(p.lastIndexOf('.'))]||'application/octet-stream'});
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end('nope');
}).listen(8796);

let fail = 0;
const check = (label, ok, detail='') => { if (!ok) { fail++; console.log(`FAIL ${label}  ${detail}`); } else console.log(`ok   ${label}  ${detail}`); };

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true });
const page = await ctx.newPage();

await page.goto('http://localhost:8796/day', { waitUntil:'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.goto('http://localhost:8796/day', { waitUntil:'networkidle' });
await page.waitForTimeout(600);

const before = await page.evaluate(async () => {
  const n = (await caches.keys()).find(k => k.includes('diary'));
  if (!n) return { entries: [], holdsGuestData: false };
  const c = await caches.open(n);
  const keys = await c.keys();
  const body = keys.length ? await (await c.match(keys[0])).text() : '';
  return { entries: keys.map(r => new URL(r.url).pathname), holdsGuestData: /Dunlop|Hen Party|@/.test(body) };
});
check('diary cached while signed in', before.entries.includes('/day'), before.entries.join(','));
check('and it really does hold guest details', before.holdsGuestData);

// Now the Access session lapses.
sessionExpired = true;
await page.goto('http://localhost:8796/day', { waitUntil:'domcontentloaded' }).catch(()=>{});
await page.waitForTimeout(800);

const landed = page.url();
check('browser followed the bounce to login', landed.includes('8797'), landed);

// CacheStorage is per origin. Straight after the bounce the page is sitting on
// the login host, where there was never a cache to find — reading it there
// would report success no matter what the worker did. Come back to the app's
// own origin first, via a page the worker will not confuse for the diary.
await page.goto('http://localhost:8796/offline.html', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(400);

const after = await page.evaluate(async () => {
  const n = (await caches.keys()).find(k => k.includes('diary'));
  if (!n) return { gone: true, entries: [] };
  const c = await caches.open(n);
  return { gone: false, entries: (await c.keys()).map(r => new URL(r.url).pathname) };
});
check('the day page with guest details is gone', !after.entries.includes('/day'),
  after.gone ? 'whole cache deleted' : `cache holds ${after.entries.join(',') || 'nothing'}`);

const shellSurvives = await page.evaluate(async () => {
  const n = (await caches.keys()).find(k => k.includes('shell'));
  return n ? (await (await caches.open(n)).keys()).length : 0;
});
check('fonts and icons kept — no data in them', shellSurvives > 0, `${shellSurvives} entries`);

await browser.close(); app.close(); login.close();
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
