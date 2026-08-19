// Proves an installed app picks up a new deployment: a changed version stamp
// must produce a new worker, new caches, and a page that reloads itself.
import { readFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { chromium } from 'playwright';
const LAUNCH = process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {};

const R = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { pageHead, pageTail } = await import(`${R}/src/views/layout.js`);
const { monthShell } = await import(`${R}/src/views/month.js`);

let VERSION = 'build-one';
const swSource = readFileSync(`${R}/public/sw.js`, 'utf8');
const TYPES = { '.woff2':'font/woff2', '.png':'image/png', '.svg':'image/svg+xml',
                '.webmanifest':'application/manifest+json', '.html':'text/html' };

const server = createServer((req, res) => {
  const p = req.url.split('?')[0];
  if (p === '/sw.js') {
    res.writeHead(200, { 'content-type':'text/javascript', 'cache-control':'no-cache' });
    return res.end(swSource.replace('__VERSION__', VERSION));
  }
  if (p === '/' || p.startsWith('/calendar')) {
    const shell = { ...monthShell({ month:'2026-08', today:'2026-08-06' }), version: VERSION };
    res.writeHead(200, { 'content-type':'text/html; charset=utf-8', 'cache-control':'no-store' });
    return res.end(pageHead(shell) + `<p class="empty">body ${VERSION}</p>` + pageTail());
  }
  const f = `${R}/public${p}`;
  if (existsSync(f)) {
    res.writeHead(200, { 'content-type': TYPES[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream' });
    return res.end(readFileSync(f));
  }
  res.writeHead(404); res.end();
}).listen(8794);

let fail = 0;
const check = (label, ok, detail='') => { if(!ok){fail++;console.log(`FAIL ${label}  ${detail}`);} else console.log(`ok   ${label}  ${detail}`); };

const browser = await chromium.launch(LAUNCH);
const ctx = await browser.newContext({ viewport:{width:393,height:852}, isMobile:true, hasTouch:true });
const page = await ctx.newPage();

await page.goto('http://localhost:8794/', { waitUntil:'networkidle' });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.waitForTimeout(400);

const first = await page.evaluate(async () => ({
  build: document.querySelector('meta[name=build]').content,
  caches: await caches.keys(),
}));
check('page carries the build stamp', first.build === 'build-one', first.build);
check('caches are namespaced by build', first.caches.every(n => n.includes('build-one')), first.caches.join(','));

// A favicon and a header mark that actually resolve.
const assets = await page.evaluate(async () => {
  const out = {};
  for (const url of ['/icons/favicon.svg','/icons/favicon-32.png','/icons/monogram.svg']) {
    const r = await fetch(url); out[url] = r.status;
  }
  out.markPainted = !!document.querySelector('.wordmark .mark');
  const style = getComputedStyle(document.querySelector('.mark'));
  out.mask = (style.webkitMaskImage || style.maskImage || '').includes('monogram.svg');
  return out;
});
check('favicon.svg served', assets['/icons/favicon.svg'] === 200);
check('favicon-32.png served', assets['/icons/favicon-32.png'] === 200);
check('monogram served', assets['/icons/monogram.svg'] === 200);
check('mark sits in the wordmark', assets.markPainted && assets.mask, `mask ${assets.mask}`);

// The mask silently paints nothing if the SVG has no intrinsic size — the CSS
// all computes correctly and the element still reserves its box, so checking
// the style alone says everything is fine while the header shows a gap.
const svgSized = await page.evaluate(async () => {
  const text = await (await fetch('/icons/monogram.svg')).text();
  const root = text.slice(0, text.indexOf('>'));
  return /width="\d+"/.test(root) && /height="\d+"/.test(root);
});
check('monogram has intrinsic width and height', svgSized);

// Now deploy a new version, exactly as `wrangler deploy` would.
VERSION = 'build-two';

const reloaded = page.waitForNavigation({ timeout: 15000 }).catch(() => null);
await page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  await r.update();                       // what visibilitychange triggers
});
await reloaded;
await page.waitForTimeout(800);

const second = await page.evaluate(async () => ({
  build: document.querySelector('meta[name=build]').content,
  body: document.body.textContent.includes('body build-two'),
  caches: await caches.keys(),
}));
check('new worker took over and the page reloaded itself', second.build === 'build-two', second.build);
check('new UI is on screen', second.body);
check('old caches cleaned up', second.caches.every(n => n.includes('build-two')), second.caches.join(','));

await browser.close(); server.close();
console.log(fail ? `\n${fail} FAILED` : '\nall checks passed');
process.exit(fail ? 1 : 0);
