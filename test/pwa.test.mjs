import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

// Set CHROMIUM to a browser binary where Playwright's own download isn't wanted.
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { WixBookings } = await import(`${R}/src/adapters/wix-bookings.js`);
const { groupIntoSittings, monthGrid, monthSummary } = await import(`${R}/src/calendar.js`);
const { monthShell, monthBody } = await import(`${R}/src/views/month.js`);
const { dayShell, dayBody } = await import(`${R}/src/views/day.js`);
const { pageHead, pageTail } = await import(`${R}/src/views/layout.js`);
const render = (shell, body) => pageHead(shell) + body + pageTail();
const { RESERVATIONS, EXPERIENCES, LOCATIONS } = await import('./fixture.mjs');
const newView = await import('../src/views/new.js');

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
  '/': render(monthShell({ month:'2026-08', today:'2026-08-06' }), monthBody({ month:'2026-08', weeks:monthGrid('2026-08', byDate), summary:monthSummary(byDate), today:'2026-08-06' })),
  '/new': (() => {
    const { newShell, newBody } = newView;
    return render(newShell({ date:'2026-08-06' }), newBody({
      date:'2026-08-06', today:'2026-08-06',
      experiences: [...experiences.values()].filter((e) => e.visible),
      sittings: (byDate.get('2026-08-06') || []).filter((s) => s.bookings.length > 0),
    }));
  })(),
  '/day': render(dayShell({ date:'2026-08-06' }), dayBody({ date:'2026-08-06', sittings: byDate.get('2026-08-06'), weeks:monthGrid('2026-08', byDate), month:'2026-08', today:'2026-08-06' })),
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
  for (const path of ['/','/day','/new']) {
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
      // A closed <summary> is a button in every way that matters — and the one
      // on each booking is now the gate to every action there is, so leaving
      // summaries out of this check left the most-tapped control unmeasured.
      // An open one is a heading, and .ask deliberately shrinks it to suit.
      for (const el of document.querySelectorAll('a[href], button, details:not([open]) > summary')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (el.classList.contains('skip')) continue;
        if (r.height < MIN) out.push(`${el.className||el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      return out;
    }, 44);
    check(`${name} ${path} — every tap target >= 44px tall`, small.length === 0, small.slice(0,4).join(' '));

    // The title ellipsises, which means overflow:hidden, which clips at the
    // padding box — and that box sat above the foot of a "g". Comparing the
    // ink against the clip box catches it; computed style never would.
    const clip = await page.evaluate(() => {
      const h = document.querySelector('.titlebar h1');
      if (!h) return null;
      const box = h.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(h);
      const ink = range.getBoundingClientRect();
      return { top: ink.top - box.top, bottom: box.bottom - ink.bottom };
    });
    check(`${name} ${path} — the title's descenders are not clipped`,
      clip && clip.top >= 0 && clip.bottom >= 0,
      clip ? `${clip.top.toFixed(1)}px above, ${clip.bottom.toFixed(1)}px below` : 'no title');
  }
  await ctx.close();
}

// Taking a booking with a handset against your ear
{
  const ctx = await browser.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8799/new', { waitUntil:'networkidle' });

  const form = await page.evaluate(() => {
    const bottom = (sel) => document.querySelector(sel).getBoundingClientRect().bottom + window.scrollY;
    return {
      forms: document.querySelectorAll('form').length,
      nested: !!document.querySelector('form form'),
      pickers: document.querySelectorAll('.book input[type=date], .book input[type=time]:not(.reveals input)').length,
      visiblePickers: [...document.querySelectorAll('input[type=date], input[type=time]')]
        .filter((el) => el.offsetParent !== null).length,
      chips: document.querySelectorAll('.chip').length,
      timeHidden: getComputedStyle(document.querySelector('#time').closest('.reveals')).display === 'none',
      phoneEnds: bottom('#phone'),
      viewport: window.innerHeight,
      seatsShown: document.querySelectorAll('.chipleft').length,
    };
  });

  // A form inside a form is invalid, and the parser resolves it by closing the
  // outer one — which silently puts most of the booking outside the form.
  check('no form is nested inside another', !form.nested);
  check('the date picker is its own form', form.forms >= 2, `${form.forms} forms`);

  // The whole point: nothing on the common path opens a modal wheel.
  check('no picker is on screen until asked for', form.visiblePickers === 0, `${form.visiblePickers} showing`);
  check('the time field stays shut until "another time"', form.timeHidden);
  check('when, sitting and party are taps', form.chips >= 12, `${form.chips} chips`);
  check('each sitting says how much room is left', form.seatsShown >= 1, `${form.seatsShown}`);

  // Everything that has to be read back to the caller, without scrolling.
  check('the booking down to the phone number fits one screen',
    form.phoneEnds <= form.viewport, `${Math.round(form.phoneEnds)}px in ${form.viewport}px`);

  const small = await page.evaluate(() => [...document.querySelectorAll('.chip')]
    .filter((el) => el.getBoundingClientRect().height < 44).length);
  check('every chip is a real tap target', small === 0, `${small} too small`);

  // Choosing "another time" is what reveals the time field — no second tap on
  // a disclosure to say what the chip already said.
  await page.click('.chip:has(input[value="other"])');
  const revealed = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#time').closest('.reveals')).display !== 'none');
  check('choosing "another time" reveals the time field', revealed);

  await ctx.close();
}

// The day beside its month, where there is room for both
{
  for (const [label, vp, expected] of [
    ['phone', { width:393, height:852 }, false],
    ['tablet portrait', { width:820, height:1180 }, false],
    ['tablet landscape', { width:1024, height:768 }, true],
    ['desktop', { width:1440, height:900 }, true],
  ]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    await page.goto('http://localhost:8799/day', { waitUntil:'networkidle' });

    const shown = await page.evaluate(() => {
      const planner = document.querySelector('.planner');
      return planner ? getComputedStyle(planner).display !== 'none' : false;
    });
    check(`${label} — planner ${expected ? 'shown' : 'hidden'}`, shown === expected, `shown: ${shown}`);

    if (expected) {
      // Sticky is the whole point. Scroll to the very bottom of the day and the
      // month must still be there, whole — not merely somewhere on the page.
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(80);
      const seen = await page.evaluate(() => {
        const r = document.querySelector('.planner').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, viewport: window.innerHeight };
      });
      check(`${label} — the month is still there at the foot of the day`,
        seen.top >= 0 && seen.bottom <= seen.viewport + 1,
        `${seen.top.toFixed(0)}–${seen.bottom.toFixed(0)} in ${seen.viewport}`);
    }
    await ctx.close();
  }
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

  const card = await page.evaluate(() => {
    const get = (sel, attr = 'content') => document.querySelector(sel)?.getAttribute(attr);
    return {
      image: get('meta[property="og:image"]'),
      title: get('meta[property="og:title"]'),
      width: get('meta[property="og:image:width"]'),
      height: get('meta[property="og:image:height"]'),
      twitter: get('meta[name="twitter:card"]'),
    };
  });
  check('link preview card declared', card.image?.startsWith('https://'), card.image || 'missing');
  check('and sized, which some unfurlers need up front',
    card.width === '1200' && card.height === '630', `${card.width}x${card.height}`);
  check('large-image card for Twitter/Slack', card.twitter === 'summary_large_image', card.twitter);
  // Fixed on purpose. A per-page title would be frozen at share time by every
  // unfurler that caches, and would put covers in front of whoever holds the link.
  check('the card says the same thing on every page', card.title === 'Samson', card.title);

  // The mark is an empty box, so under `align-items: baseline` it supplied the
  // flex baseline instead of the word next to it, and everything in the bar
  // lined up against the wrong thing. Measure the ink, not the CSS.
  const header = await page.evaluate(() => {
    const word = document.querySelector('.wordmark');
    const mark = document.querySelector('.mark');
    const text = [...word.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
    const range = document.createRange(); range.selectNode(text);
    const t = [...range.getClientRects()][0];
    const m = mark.getBoundingClientRect();
    return { delta: Math.abs((m.top + m.bottom) / 2 - (t.top + t.bottom) / 2) };
  });
  check('the mark is centred on the wordmark', header.delta <= 2, `${header.delta.toFixed(1)}px apart`);

  const m = await (await realFetch('http://localhost:8799/manifest.webmanifest')).json();
  check('manifest has id/scope/start_url', !!m.id && m.scope === '/' && m.start_url === '/');
  check('manifest display standalone', m.display === 'standalone');
  check('manifest has 192 and 512 icons',
    m.icons.some(i=>i.sizes==='192x192') && m.icons.some(i=>i.sizes==='512x512'));
  check('manifest has a maskable icon', m.icons.some(i=>i.purpose==='maskable'));
  check('manifest shortcut to today', m.shortcuts?.[0]?.url === '/today');
  // A card at the wrong size is dropped or letterboxed, and it fails silently.
  const cardRes = await realFetch('http://localhost:8799/icons/card.png');
  const bytes = new Uint8Array(await cardRes.arrayBuffer());
  const view = new DataView(bytes.buffer);
  check('card served as a png', cardRes.ok && cardRes.headers.get('content-type') === 'image/png');
  // IHDR width and height are the two big-endian 32-bit words at offset 16.
  check('card is really 1200x630', view.getUint32(16) === 1200 && view.getUint32(20) === 630,
    `${view.getUint32(16)}x${view.getUint32(20)}`);

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
