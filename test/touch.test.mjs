/**
 * What a tap does before the answer arrives.
 *
 * Two promises are made on a tablet in a kitchen, and neither of them is about
 * how fast Wix is. A control has to move under the finger, and the view has to
 * change on the tap rather than when the diary turns up. Both are only true if
 * something is on screen while the network is still thinking, so the server
 * here holds its second flush open deliberately: every check below runs in the
 * window where a real Samson would still be waiting on Wix.
 */
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { chromium } from 'playwright';

const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};
const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

const { pageHead, pageTail, skeleton, SHELL_FLUSHED, RETIRE_SKELETON } = await import(`${R}/src/views/layout.js`);
const { monthShell, monthBody } = await import(`${R}/src/views/month.js`);
const { dayShell, dayBody } = await import(`${R}/src/views/day.js`);
const { groupIntoSittings, monthGrid, monthSummary } = await import(`${R}/src/calendar.js`);
const { WixBookings } = await import(`${R}/src/adapters/wix-bookings.js`);
const { RESERVATIONS, EXPERIENCES, LOCATIONS } = await import('./fixture.mjs');

globalThis.fetch = async (url) => ({ ok: true, status: 200, text: async () => JSON.stringify(
  String(url).includes('/experiences/') ? { experiences: EXPERIENCES }
    : String(url).includes('/reservation-locations/') ? { reservationLocations: LOCATIONS }
      : { reservations: RESERVATIONS })});

const repo = new WixBookings({ WIX_API_KEY: 'k', WIX_SITE_ID: 's' });
const experiences = await repo.experiences();
const byDate = groupIntoSittings(
  await repo.inRange({ start: new Date('2026-07-31T23:00:00Z'), end: new Date('2026-08-31T23:00:00Z') }),
  experiences, new Date('2026-08-05T12:00:00Z'),
);

const MONTH = '2026-08';
const TODAY = '2026-08-06';
const VERSION = 'touch-build';

// How long the stubbed Wix takes, and how long Cloudflare takes to answer at
// all. Both are long enough that every assertion below is made while the page
// is genuinely still waiting, rather than after it has quietly won on
// localhost — which is the one place Samson will never run.
const REACH = 400;
const WIX = 700;

const TYPES = { '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.html': 'text/html' };

/** The same two-flush shape src/worker.js streams. */
function stream(res, shell, kind, body) {
  setTimeout(() => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.write(pageHead({ ...shell, version: VERSION }) + skeleton(kind) + SHELL_FLUSHED);
    setTimeout(() => res.end(RETIRE_SKELETON + body() + pageTail()), WIX - REACH);
  }, REACH);
}

const handler = (req, res) => {
  const path = req.url.split('?')[0];

  const month = path.match(/^\/calendar\/(\d{4}-\d{2})$/);
  if (month) {
    return stream(res, monthShell({ month: month[1], today: TODAY }), 'month', () => monthBody({
      month: month[1], weeks: monthGrid(month[1], byDate), summary: monthSummary(byDate), today: TODAY,
    }));
  }

  const day = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
  if (day) {
    return stream(res, dayShell({ date: day[1] }), 'day', () => dayBody({
      date: day[1], sittings: byDate.get(day[1]) || [], weeks: monthGrid(MONTH, byDate),
      month: MONTH, today: TODAY, back: `/day/${day[1]}`,
    }));
  }

  // A worker served as anything but JavaScript is refused, silently, and every
  // offline check below then waits on a registration that never comes.
  if (path === '/sw.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
    return res.end(readFileSync(`${R}/public/sw.js`, 'utf8').replace('__VERSION__', VERSION));
  }

  const file = `${R}/public${path}`;
  if (existsSync(file) && path !== '/') {
    res.writeHead(200, { 'content-type': TYPES[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' });
    return res.end(readFileSync(file));
  }
  res.writeHead(404); res.end('nope');
};

const server = createServer(handler).listen(8793);
// A second origin, for the one scenario that needs the lodge's signal to go
// away completely. Emulated offline does not reach a service worker's own
// fetches, so the only honest way to take the network away is to take it away.
const remote = createServer(handler).listen(8792);

let fail = 0;
const check = (label, ok, detail = '') => {
  if (!ok) { fail += 1; console.log(`FAIL ${label}${detail ? `  ${detail}` : ''}`); }
  else console.log(`ok   ${label}${detail ? `  ${detail}` : ''}`);
};

/** The x scale out of a computed matrix, which is what a dip amounts to. */
const scaleOf = (transform) => {
  const parts = /matrix\(([^)]+)\)/.exec(transform || '');
  return parts ? parseFloat(parts[1].split(',')[0]) : 1;
};

const HOME = 'http://localhost:8793';
const browser = await chromium.launch(LAUNCH);
// iPad landscape: the shape that gets the planner beside the day, and the
// device the diary is actually read on.
const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, hasTouch: true });
const page = await ctx.newPage();
// The service worker is not the subject here, and a second worker fetching
// pages in the background makes the timings below a lie.
await page.addInitScript(() => {
  Object.defineProperty(navigator, 'serviceWorker', { get: () => undefined });
});

await page.goto(`${HOME}/calendar/${MONTH}`, { waitUntil: 'load' });

// ── A control moves under the finger ────────────────────────────────────────
{
  const box = await page.locator('.cell a.open').first().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // The dip is a transition, so the computed value the instant the finger
  // lands is still the resting one. This is the frame a person would see.
  const held = await page.evaluate(() => new Promise((done) => setTimeout(() => {
    const el = document.querySelector('.cell a.open.pressed');
    done(el ? { transform: getComputedStyle(el).transform, wash: getComputedStyle(el).backgroundColor } : null);
  }, 120)));
  await page.mouse.up();
  check('a day answers the press before it is released', !!held);
  check('and it does so by moving, not only by tinting',
    held && scaleOf(held.transform) < .99, held ? held.transform : 'not pressed');
  check('the tint is there as well', held && !/rgba\(0, 0, 0, 0\)/.test(held.wash),
    held ? held.wash : '');
}

// The same, for the things that are not links — iOS is the one that withholds
// :active from a button, so the class has to be doing the work.
{
  await page.goto(`${HOME}/day/${TODAY}`, { waitUntil: 'load' });
  await page.locator('.reveal > summary').first().waitFor();
  const summary = page.locator('.reveal > summary').first();
  const box = await summary.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  const scale = await page.evaluate(() => new Promise((done) => setTimeout(() => {
    const el = document.querySelector('.reveal > summary.pressed');
    done(el ? getComputedStyle(el).transform : null);
  }, 120)));
  await page.mouse.up();
  check('a disclosure presses too', scale && scaleOf(scale) < .99, scale || 'no transform');
}

// A press that turns into a scroll was never a press.
{
  const arrow = page.locator('.titlebar .arrow').first();
  const box = await arrow.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => dispatchEvent(new Event('scroll')));
  const still = await page.evaluate(() => !!document.querySelector('.pressed'));
  await page.mouse.up();
  check('a press that becomes a scroll is let go of', !still);
}

// ── The view switches on the tap ────────────────────────────────────────────
{
  await page.goto(`${HOME}/calendar/${MONTH}`, { waitUntil: 'load' });
  const before = await page.title();

  await page.locator(`.cell a.open[href="/day/${TODAY}"]`).click({ noWaitAfter: true });

  // Immediately: the day's shape is on screen and the month's is gone, while
  // the server is still holding the diary back.
  const instant = await page.evaluate(() => ({
    url: location.pathname,
    busy: document.getElementById('main').getAttribute('aria-busy'),
    cls: document.getElementById('main').className,
    skeleton: document.querySelectorAll('.sk').length,
    grid: document.querySelectorAll('.grid .cell').length,
    cards: document.querySelectorAll('.sk-card').length,
    title: document.title,
  }));
  check('the address changes on the tap', instant.url === `/day/${TODAY}`, instant.url);
  check('the month is off screen at once', instant.grid === 0, `${instant.grid} cells left`);
  check('a skeleton of the day is on screen instead', instant.cards >= 3, `${instant.cards} cards`);
  check('and it is the day\'s layout, not the month\'s', instant.cls === 'split', instant.cls || '(none)');
  check('the page says it is working', instant.busy === 'true');
  check('and none of it waited on the server', before === instant.title, instant.title);

  // Then the shell, which the server can send without asking Wix anything.
  await page.waitForFunction(() => !!document.querySelector('.titlebar h1:not(:empty)'), null, { timeout: 5000 });
  const shell = await page.evaluate(() => ({
    title: document.title,
    heading: document.querySelector('.titlebar h1').textContent.trim(),
    stillBusy: document.getElementById('main').getAttribute('aria-busy'),
    waiting: document.querySelectorAll('.sk-card').length,
  }));
  check('the real title lands ahead of the diary', /August/.test(shell.heading), shell.heading);
  check('the tab says so too', /Samson/.test(shell.title), shell.title);
  check('the body is still a skeleton at that point', shell.waiting >= 3 && shell.stillBusy === 'true');

  // And finally the diary.
  await page.waitForFunction(() => document.getElementById('main').getAttribute('aria-busy') === null,
    null, { timeout: 5000 });
  const arrived = await page.evaluate(() => ({
    sittings: document.querySelectorAll('.sitting').length,
    empty: !!document.querySelector('.empty'),
    showing: [...document.querySelectorAll('.sk')].filter((el) => getComputedStyle(el).display !== 'none').length,
    planner: document.querySelector('main.split > .planner:not(.sk)')
      ? getComputedStyle(document.querySelector('main.split > .planner:not(.sk)')).display : 'missing',
  }));
  check('the diary replaces the skeleton', arrived.sittings > 0 || arrived.empty,
    `${arrived.sittings} sittings`);
  check('and no skeleton is left showing behind it', arrived.showing === 0, `${arrived.showing} showing`);
  check('the planner is beside the day, as it is on a fresh load', arrived.planner === 'block', arrived.planner);
}

// A skeleton that is not the shape of what replaces it is a jump, not a hint.
// Measured mid-stream on purpose: once the diary lands there is nothing left
// to compare, and this is the reflow a tablet used to see on every page.
{
  await page.goto(`${HOME}/day/${TODAY}`, { waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const el = document.querySelector('.planner.sk');
    return el && getComputedStyle(el).display !== 'none';
  }, null, { timeout: 5000 });
  const early = await page.evaluate(() => {
    const el = document.querySelector('.planner.sk');
    const detail = document.querySelector('.detail.sk');
    return { planner: el.getBoundingClientRect(), detail: detail.getBoundingClientRect() };
  });
  await page.waitForLoadState('load');
  const late = await page.evaluate(() => ({
    planner: document.querySelector('main.split > .planner:not(.sk)').getBoundingClientRect(),
    detail: document.querySelector('main.split > .detail:not(.sk)').getBoundingClientRect(),
  }));
  check('the streamed skeleton already stands where the planner will',
    Math.abs(early.planner.width - late.planner.width) < 1 && Math.abs(early.planner.x - late.planner.x) < 1,
    `${Math.round(early.planner.width)}px at ${Math.round(early.planner.x)} then ${Math.round(late.planner.width)}px at ${Math.round(late.planner.x)}`);
  check('and the day itself does not slide sideways when it arrives',
    Math.abs(early.detail.x - late.detail.x) < 1,
    `${Math.round(early.detail.x)} then ${Math.round(late.detail.x)}`);
}

// ── Nothing sits under the header ───────────────────────────────────────────
//
// The bar is sticky, so anything that sticks under it has to know how tall it
// is. That height used to be a guess, and it was 25px short: on a landscape
// tablet the day began hard against the bar, and the planner and the sitting
// headings slid a good 60px beneath it on the way down the page.
{
  await page.goto(`${HOME}/day/${TODAY}`, { waitUntil: 'load' });
  const rest = await page.evaluate(() => {
    const bar = document.querySelector('.bar').getBoundingClientRect();
    const h1 = document.querySelector('.titlebar h1');
    const ink = document.createRange();
    ink.selectNodeContents(h1);
    return {
      toTitle: ink.getBoundingClientRect().top - bar.bottom,
      toDetail: document.querySelector('main.split > .detail:not(.sk)').getBoundingClientRect().top - bar.bottom,
    };
  });
  check('the title is not up against the header', rest.toTitle > 8, `${rest.toTitle.toFixed(1)}px`);
  check('nor is the day beside it', rest.toDetail > 8, `${rest.toDetail.toFixed(1)}px`);

  await page.evaluate(() => scrollTo(0, 500));
  await page.waitForTimeout(120);
  const moving = await page.evaluate(() => {
    const bar = document.querySelector('.bar').getBoundingClientRect();
    const planner = document.querySelector('main.split > .planner:not(.sk)').getBoundingClientRect();
    const heading = document.querySelector('.sitting > h2').getBoundingClientRect();
    return { planner: planner.top - bar.bottom, heading: heading.top - bar.bottom };
  });
  check('the planner sticks below the header, not behind it',
    moving.planner >= 0, `${moving.planner.toFixed(1)}px`);
  check('and so does a sitting heading', moving.heading >= -0.5, `${moving.heading.toFixed(1)}px`);
}

// ── Stepping through dates ──────────────────────────────────────────────────
//
// The arrows are tapped over and over, and the date is the whole content of
// the interaction — so the server names each arrow's destination on the link
// itself, and the tap paints it. Measured in the window before the server has
// said anything at all.
{
  await page.goto(`${HOME}/day/${TODAY}`, { waitUntil: 'load' });
  const target = await page.locator('.titlebar .arrow[rel=next]').boundingBox();
  check('the arrows are a bigger target than a phone gives them',
    target.width >= 56 && target.height >= 56, `${Math.round(target.width)}x${Math.round(target.height)}`);

  await page.locator('.titlebar .arrow[rel=next]').click({ noWaitAfter: true });
  const stepped = await page.evaluate(() => ({
    path: location.pathname,
    heading: document.querySelector('.titlebar h1').textContent.trim(),
    sub: (document.querySelector('.titlebar .sub') || {}).textContent,
    next: (document.querySelector('.titlebar .arrow[data-side=next]') || {}).getAttribute
      ? document.querySelector('.titlebar .arrow[data-side=next]').getAttribute('href') : null,
    busy: document.getElementById('main').getAttribute('aria-busy'),
    cards: document.querySelectorAll('.sk-card').length,
  }));
  check('the date changes on the tap', stepped.heading === '7 August', stepped.heading);
  check('and so does the day of the week under it', stepped.sub === 'Friday', stepped.sub);
  check('with the diary behind a skeleton', stepped.busy === 'true' && stepped.cards >= 3);
  check('and an arrow that already points at the day after',
    stepped.next === '/day/2026-08-08', stepped.next || 'no arrow');

  // Which is the point: a second tap lands before the first has been answered.
  // This one goes to a day nothing on screen can name — the arrow was drawn
  // here, not sent — so it steps and shimmers rather than steps and lies.
  await page.locator('.titlebar .arrow[data-side=next]').click({ noWaitAfter: true });
  const twice = await page.evaluate(() => ({
    path: location.pathname,
    busy: document.getElementById('main').getAttribute('aria-busy'),
    cards: document.querySelectorAll('.sk-card').length,
    claimed: document.querySelector('.titlebar h1'),
  }));
  check('a second tap steps again without waiting for the first',
    twice.path === '/day/2026-08-08' && twice.busy === 'true' && twice.cards >= 3, twice.path);
  check('and does not put a date it cannot know on the page', twice.claimed === null);

  await page.waitForFunction(() => document.getElementById('main').getAttribute('aria-busy') === null,
    null, { timeout: 5000 });
  const landed = await page.evaluate(() => ({
    path: location.pathname,
    heading: document.querySelector('.titlebar h1').textContent.trim(),
    next: document.querySelector('.titlebar .arrow[rel=next]').getAttribute('href'),
  }));
  check('and the diary that arrives is the one for the day showing',
    landed.path === '/day/2026-08-08' && landed.heading === '8 August',
    `${landed.path} — ${landed.heading}`);
  check('with the server\'s own arrows back in place', landed.next === '/day/2026-08-09', landed.next);
}

// The way back is the one destination a page can always name for itself.
{
  await page.goto(`${HOME}/day/${TODAY}`, { waitUntil: 'load' });
  await page.locator('.titlebar .arrow[rel=next]').click({ noWaitAfter: true });
  await page.locator('.titlebar .arrow[data-side=prev]').click({ noWaitAfter: true });
  const corrected = await page.evaluate(() => {
    const h1 = document.querySelector('.titlebar h1');
    return { path: location.pathname, heading: h1 ? h1.textContent.trim() : null };
  });
  check('stepping back names the day it came from, straight away',
    corrected.path === `/day/${TODAY}` && corrected.heading === '6 August',
    `${corrected.path} — ${corrected.heading}`);
}

// The planner is the other way a date changes on a landscape tablet, and a
// shimmering title beside a live one reads as a fault.
{
  await page.goto(`${HOME}/day/${TODAY}`, { waitUntil: 'load' });
  await page.locator('main.split > .planner:not(.sk) .pcell[href="/day/2026-08-12"]').click({ noWaitAfter: true });
  const named = await page.evaluate(() => document.querySelector('.titlebar h1').textContent.trim());
  check('a day tapped in the planner names itself at once', named === '12 August', named);
}

// ── Back goes back ──────────────────────────────────────────────────────────
{
  await page.goto(`${HOME}/calendar/${MONTH}`, { waitUntil: 'load' });
  await page.evaluate(() => scrollTo(0, 260));
  await page.locator(`.cell a.open[href="/day/${TODAY}"]`).click({ noWaitAfter: true });
  await page.waitForFunction(() => document.getElementById('main').getAttribute('aria-busy') === null,
    null, { timeout: 5000 });
  check('a tap starts the new page at the top', await page.evaluate(() => window.scrollY) === 0);

  await page.goBack();
  await page.waitForFunction(() => document.querySelectorAll('.grid .cell').length > 0, null, { timeout: 5000 });
  const back = await page.evaluate(() => ({ path: location.pathname, y: Math.round(window.scrollY) }));
  check('back returns to the month', back.path === `/calendar/${MONTH}`, back.path);
  check('and to where it was being read', Math.abs(back.y - 260) <= 2, `${back.y}px`);
}

// ── The things a page fetch must not swallow ────────────────────────────────
{
  // An Access bounce is a redirect this page deliberately cannot read, so it
  // has to become a real navigation rather than an empty screen.
  await page.goto(`${HOME}/calendar/${MONTH}`, { waitUntil: 'load' });
  const asked = [];
  await page.route(`${HOME}/day/${TODAY}`, (route) => {
    asked.push(route.request().headers()['x-samson-nav'] || null);
    // Playwright cannot answer with an opaque redirect, but it can answer with
    // the thing that proves it was asked as a page: the marker header.
    route.fallback();
  });
  await page.locator(`.cell a.open[href="/day/${TODAY}"]`).click({ noWaitAfter: true });
  await page.waitForFunction(() => document.getElementById('main').getAttribute('aria-busy') === null,
    null, { timeout: 5000 });
  check('a page fetched by the page says so, so the worker can treat it as one',
    asked.length > 0 && asked.every((v) => v === '1'), asked.join(','));
}

await ctx.close();

// ── With no signal at all ───────────────────────────────────────────────────
//
// The service worker was out of the way above, because a second thing fetching
// pages makes the timings a lie. It is the whole point here: a tap in a kitchen
// with no signal has to reach a day that has already been opened, and has to
// admit it when it cannot.
{
  const AWAY = 'http://localhost:8792';
  const offline = await browser.newContext({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  const phone = await offline.newPage();

  await phone.goto(`${AWAY}/day/${TODAY}`, { waitUntil: 'load' });
  await phone.evaluate(async () => { await navigator.serviceWorker.ready; });
  // The worker claims the page and the page reloads itself, which is the same
  // thing that happens after a deploy. Let it finish before driving anything.
  await phone.waitForTimeout(1500);
  await phone.goto(`${AWAY}/day/2026-08-07`, { waitUntil: 'load' });
  await phone.goto(`${AWAY}/day/${TODAY}`, { waitUntil: 'load' });
  await phone.waitForTimeout(600);

  // No signal, for real, from both ends: the browser is told, which is what
  // the banner reads, and the diary's origin stops answering anybody, which is
  // what the service worker's own fetches actually run into. Emulation alone
  // does not reach those, and a closed server alone leaves navigator.onLine
  // insisting everything is fine.
  await offline.setOffline(true);
  remote.close();
  remote.closeAllConnections();
  await phone.locator('.titlebar .arrow[rel=next]').click({ noWaitAfter: true });
  await phone.waitForFunction(() => /7 August/.test(document.title), null, { timeout: 8000 }).catch(() => {});
  const seen = await phone.evaluate(() => ({
    title: document.title,
    path: location.pathname,
    sittings: document.querySelectorAll('.sitting').length,
    banner: document.getElementById('stale').hidden ? null : document.getElementById('stale').textContent,
  }));
  check('a tap reaches a day already opened, with no signal',
    seen.path === '/day/2026-08-07' && /7 August/.test(seen.title), `${seen.path} — ${seen.title}`);
  check('and says out loud that it is not current', !!seen.banner, seen.banner || 'no banner');

  // A day nobody opened while there was signal cannot be conjured, and the
  // page must hand over to the browser rather than sit on a skeleton forever.
  await phone.locator('.titlebar .arrow[rel=next]').click({ noWaitAfter: true });
  await phone.waitForFunction(() => /Offline/.test(document.title), null, { timeout: 8000 }).catch(() => {});
  check('a day that was never opened says so rather than hanging',
    /Offline/.test(await phone.title()), await phone.title());

  await offline.close();
}


await browser.close();
server.close();
remote.close();
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
