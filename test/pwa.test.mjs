import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Set CHROMIUM to a browser binary where Playwright's own download isn't wanted.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { WixBookings } = await import(`${R}/src/adapters/wix-bookings.js`);
const { groupIntoSittings, monthGrid, monthSummary } = await import(`${R}/src/calendar.js`);
const { monthView } = await import(`${R}/src/views/month.js`);
const { dayView } = await import(`${R}/src/views/day.js`);
const { RESERVATIONS, EXPERIENCES, LOCATIONS } = await import('./fixture.mjs');

const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => ({ ok:true, status:200, text: async () => JSON.stringify(
  String(url).includes('/experiences/') ? { experiences: EXPERIENCES }
  : String(url).includes('/reservation-locations/') ? { reservationLocations: LOCATIONS }
  : { reservations: RESERVATIONS })});

const repo = new WixBookings({ WIX_API_KEY:'k', WIX_SITE_ID:'s' });
const bookings = await repo.inRange({ start:new Date('2026-07-31T23:00:00Z'), end:new Date('2026-08-31T23:00:00Z') });
const experiences = await repo.experiences();
const byDate = groupIntoSittings(bookings, experiences, new Date('2026-08-05T12:00:00Z'));
const pages = {
  '/': monthView({ month:'2026-08', weeks:monthGrid('2026-08', byDate), summary:monthSummary(byDate), today:'2026-08-06' }),
  '/day': dayView({ date:'2026-08-06', sittings: byDate.get('2026-08-06') }),
};

const TYPES = { '.woff2':'font/woff2', '.png':'image/png', '.js':'text/javascript',
                '.webmanifest':'application/manifest+json', '.html':'text/html' };
const server = createServer((req,res)=>{
  const p = req.url.split('?')[0];
  if (pages[p]) { res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); return res.end(pages[p]); }
  const file = `${R}/public${p}`;
  if (existsSync(file)) {
    const ext = p.slice(p.lastIndexOf('.'));
    res.writeHead(200,{'content-type':TYPES[ext]||'application/octet-stream'});
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end('nope');
}).listen(8799);

let fail = 0;
const check = (label, ok, detail='') => {
  if (!ok) { fail++; console.log(`FAIL ${label}${detail?'  '+detail:''}`); }
  else console.log(`ok   ${label}${detail?'  '+detail:''}`);
};

const browser = await chromium.launch(LAUNCH);

// iPhone-ish viewport, the narrowest phone the team is likely to hold.
for (const [name, vp] of [['iPhone SE (375px)', {width:375,height:667}], ['iPhone 15 (393px)', {width:393,height:852}]]) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  for (const path of ['/','/day']) {
    await page.goto(`http://localhost:8799${path}`, { waitUntil:'networkidle' });
    const overflow = await page.evaluate(() => ({
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
      bodyW: document.body.scrollWidth,
    }));
    check(`${name} ${path} — no horizontal scroll`,
      overflow.scrollW <= overflow.clientW, `${overflow.scrollW}px in ${overflow.clientW}px`);

    const small = await page.evaluate((MIN) => {
      const out = [];
      for (const el of document.querySelectorAll('a[href], button')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (el.classList.contains('skip')) continue;
        if (r.height < MIN) out.push(`${el.className||el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    }, 44);
    check(`${name} ${path} — every tap target >= 44px tall`, small.length === 0, small.slice(0,4).join(' '));
  }
  await ctx.close();
}

// Manifest and install metadata
{
  const ctx = await browser.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8799/', { waitUntil:'networkidle' });
  const head = await page.evaluate(() => ({
    manifest: document.querySelector('link[rel=manifest]')?.getAttribute('crossorigin'),
    themeLight: document.querySelector('meta[name=theme-color][media*=light]')?.content,
    themeDark: document.querySelector('meta[name=theme-color][media*=dark]')?.content,
    appleIcon: !!document.querySelector('link[rel=apple-touch-icon]'),
    appleCapable: document.querySelector('meta[name=apple-mobile-web-app-capable]')?.content,
    splashes: document.querySelectorAll('link[rel=apple-touch-startup-image]').length,
    viewportFit: /viewport-fit=cover/.test(document.querySelector('meta[name=viewport]').content),
    preloads: document.querySelectorAll('link[rel=preload][as=font][crossorigin]').length,
  }));
  check('manifest linked with use-credentials', head.manifest === 'use-credentials', head.manifest || 'missing');
  check('theme-color for both schemes', !!head.themeLight && !!head.themeDark, `${head.themeLight} / ${head.themeDark}`);
  check('apple touch icon present', head.appleIcon);
  check('apple standalone capable', head.appleCapable === 'yes');
  check('iOS startup images', head.splashes >= 12, `${head.splashes} links`);
  check('viewport-fit=cover for safe areas', head.viewportFit);
  check('fonts preloaded with crossorigin', head.preloads === 2, `${head.preloads}`);

  const m = await (await realFetch('http://localhost:8799/manifest.webmanifest')).json();
  check('manifest has id/scope/start_url', !!m.id && m.scope === '/' && m.start_url === '/');
  check('manifest display standalone', m.display === 'standalone');
  check('manifest has 192 and 512 icons',
    m.icons.some(i=>i.sizes==='192x192') && m.icons.some(i=>i.sizes==='512x512'));
  check('manifest has a maskable icon', m.icons.some(i=>i.purpose==='maskable'));
  check('manifest shortcut to today', m.shortcuts?.[0]?.url === '/today');
  for (const icon of m.icons) {
    const r = await realFetch(`http://localhost:8799${icon.src}`);
    check(`icon ${icon.src} served`, r.ok && r.headers.get('content-type')==='image/png');
  }
  await ctx.close();
}

// Service worker: registers, caches, serves offline
{
  const ctx = await browser.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8799/', { waitUntil:'networkidle' });
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.ready;
    return { scope: r.scope, active: !!r.active };
  });
  check('service worker active at root scope', reg.active && reg.scope.endsWith('/'), reg.scope);

  await page.goto('http://localhost:8799/day', { waitUntil:'networkidle' });
  await page.waitForTimeout(600);
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const out = {};
    for (const n of names) out[n] = (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname);
    return out;
  });
  const diary = Object.entries(cached).find(([n]) => n.includes('diary'))?.[1] || [];
  const shell = Object.entries(cached).find(([n]) => n.includes('shell'))?.[1] || [];
  check('diary page cached for offline', diary.includes('/day'), diary.join(','));
  check('shell assets cached', shell.includes('/offline.html') && shell.some(p=>p.includes('.woff2')), `${shell.length} entries`);

  await ctx.setOffline(true);
  const offlineDay = await page.goto('http://localhost:8799/day', { waitUntil:'domcontentloaded' });
  check('cached day served while offline', offlineDay.status() === 200);
  const bannerShown = await page.evaluate(() => {
    const b = document.getElementById('stale');
    return b && !b.hidden ? b.textContent : null;
  });
  check('offline banner tells the truth about staleness', !!bannerShown, bannerShown || 'not shown');

  const unseen = await page.goto('http://localhost:8799/day/2099-01-01', { waitUntil:'domcontentloaded' });
  const isFallback = await page.evaluate(() => document.title.includes('Offline'));
  check('offline fallback for an unvisited page', isFallback, `status ${unseen?.status()}`);
  await ctx.close();
}

await browser.close(); server.close();
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
