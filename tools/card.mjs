/**
 * Draws the link preview card: the mark, and "Samson" underneath.
 *
 * Rendered through a real browser with the real woff2 rather than traced by
 * hand, so the wordmark on the card is the same Romie Light as the wordmark in
 * the header. Run it after changing either.
 *
 *   node tools/card.mjs
 */
import { chromium } from 'playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const font = readFileSync(join(root, 'public/fonts/Romie-Light.woff2')).toString('base64');

// The mark's own paths, lifted from the monogram and painted in the light
// ground colour. Same artwork as the favicon, same colours as the dark theme.
const mark = readFileSync(join(root, 'public/icons/monogram.svg'), 'utf8')
  .replace(/fill="#000"/g, 'fill="#F7F4EC"')
  .replace(/fill="black"/g, 'fill="#F7F4EC"')
  .replace('<svg ', '<svg class="mark" ');

const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face{font-family:"Romie";src:url(data:font/woff2;base64,${font}) format("woff2");font-weight:300;font-display:block}
  *{margin:0;padding:0;box-sizing:border-box}
  body{width:1200px;height:630px;background:#151013;display:flex;flex-direction:column;
       align-items:center;justify-content:center;gap:38px}
  .mark{width:230px;height:230px}
  h1{font-family:"Romie",serif;font-weight:300;font-size:104px;line-height:1;
     color:#F7F4EC;letter-spacing:.01em}
</style>${mark}<h1>Samson</h1>`;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
const png = await page.screenshot({ type: 'png' });
await browser.close();

writeFileSync(join(root, 'public/icons/card.png'), png);
console.log(`public/icons/card.png — ${(png.length / 1024).toFixed(1)}kB`);
