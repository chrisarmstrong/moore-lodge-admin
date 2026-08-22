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
const { dayShell, dayBody } = await import(`${R}/src/views/day.js`);
const { pageHead, pageTail } = await import(`${R}/src/views/layout.js`);
const render = (shell, body) => pageHead(shell) + body + pageTail();
const { RESERVATIONS, EXPERIENCES, LOCATIONS } = await import('./fixture.mjs');

globalThis.fetch = async (url) => ({ ok:true, status:200, text: async () => JSON.stringify(
  String(url).includes('/experiences/') ? { experiences: EXPERIENCES }
  : String(url).includes('/reservation-locations/') ? { reservationLocations: LOCATIONS }
  : { reservations: RESERVATIONS })});
const repo = new WixBookings({ WIX_API_KEY:'k', WIX_SITE_ID:'s' });
const byDate = groupIntoSittings(
  await repo.inRange({ start:new Date('2026-07-31T23:00:00Z'), end:new Date('2026-08-31T23:00:00Z') }),
  await repo.experiences(), new Date('2026-08-05T12:00:00Z'));
const dayHtml = render(dayShell({ date:'2026-08-06' }), dayBody({ date:'2026-08-06', sittings: byDate.get('2026-08-06') }));

// Stands in for the Access login origin.
const login = createServer((_,res)=>{ res.writeHead(200,{'content-type':'text/html'}); res.end('<title>Sign in</title>Access login'); }).listen(8797);

let sessionExpired = false;
const TYPES = { '.woff2':'font/woff2', '.png':'image/png', '.js':'text/javascript', '.webmanifest':'application/manifest+json', '.html':'text/html' };
const app = createServer((req,res)=>{
  const p = req.url.split('?')[0];
  // Any day, so there is a real diary page to tap through to.
  if (p === '/day' || p.startsWith('/day/')) {
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

// The same promise, for the tap that never becomes a browser navigation.
//
// A page that swaps its own content fetches the next day itself, and that
// fetch is where an expired session now shows up. If it were followed quietly
// the worker would keep serving a diary full of guest details to somebody
// Access has stopped recognising — so it must bounce to login exactly as a
// whole-page load does, and take the cache with it.
sessionExpired = false;
await page.goto('http://localhost:8796/day', { waitUntil:'networkidle' });
await page.waitForTimeout(600);
const warm = await page.evaluate(async () => {
  const n = (await caches.keys()).find(k => k.includes('diary'));
  return n ? (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname) : [];
});
check('signed in again, the diary is back in the cache', warm.includes('/day'), warm.join(',') || 'empty');

sessionExpired = true;
await page.locator('.titlebar .arrow[rel=next]').click({ noWaitAfter: true });
await page.waitForURL(/8797/, { timeout: 8000 }).catch(() => {});
check('a tap on an expired session lands on login, not on a blank page',
  page.url().includes('8797'), page.url());

await page.goto('http://localhost:8796/offline.html', { waitUntil:'domcontentloaded' });
await page.waitForTimeout(400);
const swept = await page.evaluate(async () => {
  const n = (await caches.keys()).find(k => k.includes('diary'));
  return n ? (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname) : [];
});
// As above, /offline.html gets cached again by the navigation that brought us
// back to this origin. It is the days that must not have survived.
check('and the guest details went with it', !swept.some((path) => path.startsWith('/day')),
  swept.join(',') || 'nothing left');

await browser.close(); app.close(); login.close();
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
