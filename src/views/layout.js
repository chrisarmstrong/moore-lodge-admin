/**
 * The page shell.
 *
 * Server-rendered, no framework, no build step — the same approach as the
 * public site. This is a page that has to open instantly on a phone, in a
 * kitchen, on rural wifi, held in one hand, so the whole of it is one small
 * document with its styles inline.
 *
 * It is also installed to a home screen and expected to behave like an app, so
 * the head below is doing real work: safe areas, install metadata, theme colour
 * per scheme, and a service worker that is deliberately careful about what it
 * keeps.
 */

export function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/** Portrait startup images, light and dark, for the iPhones staff actually carry. */
const IOS_SPLASH = [
  { w: 1170, h: 2532, dppx: 3 },
  { w: 1179, h: 2556, dppx: 3 },
  { w: 1206, h: 2622, dppx: 3 },
  { w: 1290, h: 2796, dppx: 3 },
  { w: 1320, h: 2868, dppx: 3 },
  { w: 1125, h: 2436, dppx: 3 },
].flatMap(({ w, h, dppx }) => {
  const media = `(device-width:${w / dppx}px) and (device-height:${h / dppx}px)`
    + ` and (-webkit-device-pixel-ratio:${dppx}) and (orientation:portrait)`;
  return [
    `<link rel="apple-touch-startup-image" media="${media} and (prefers-color-scheme:dark)" href="/icons/splash-${w}x${h}-dark.png">`,
    `<link rel="apple-touch-startup-image" media="${media}" href="/icons/splash-${w}x${h}.png">`,
  ];
}).join('\n');

export function page({ title, heading, sub, nav = '', body }) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">

<title>${escape(title)} · Samson</title>

<!-- Painted before first paint, so the notch and home-bar bands match the page
     rather than flashing white on launch. -->
<meta name="theme-color" content="#F7F4EC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151013" media="(prefers-color-scheme: dark)">

<!-- use-credentials matters: the manifest is fetched without cookies by
     default, and Cloudflare Access would bounce that fetch to a login page,
     leaving the app uninstallable for no visible reason. -->
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="apple-touch-icon" href="/icons/icon-180.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Samson">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
${IOS_SPLASH}

<!-- Self-hosted and same-origin, but a font preload still needs crossorigin or
     the browser fetches it twice. -->
<link rel="preload" href="/fonts/Romie-Light.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/CaslonDoric-Regular-Web.woff2" as="font" type="font/woff2" crossorigin>

<meta name="rendered-at" content="${new Date().toISOString()}">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="bar">
  <a class="wordmark" href="/">Samson</a>
  <span class="estate">Moore Lodge</span>
</header>
<p class="stale" id="stale" hidden></p>
<main id="main">
  <div class="head">
    <h1>${escape(heading)}</h1>
    ${sub ? `<p class="sub">${escape(sub)}</p>` : ''}
  </div>
  ${nav}
  ${body}
</main>
<footer class="foot"><p>Reading live from Wix. Nothing here writes back — yet.</p></footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

const SCRIPT = `
(function () {
  if ('serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {});
    });
  }

  // A cached page can be hours old. Say so plainly rather than letting somebody
  // read yesterday's covers as today's.
  var banner = document.getElementById('stale');
  var renderedAt = document.querySelector('meta[name="rendered-at"]');
  function check() {
    if (!banner || !renderedAt) return;
    if (navigator.onLine) { banner.hidden = true; return; }
    var when = new Date(renderedAt.content);
    var time = isNaN(when) ? '' : ' as it was at ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    banner.textContent = 'Offline — showing the diary' + time + '.';
    banner.hidden = false;
  }
  addEventListener('online', check);
  addEventListener('offline', check);
  check();
})();
`;

const CSS = `
@font-face{font-family:"Romie";src:url(/fonts/Romie-Light.woff2) format("woff2");font-weight:300;font-display:swap}
@font-face{font-family:"Caslon Doric";src:url(/fonts/CaslonDoric-Regular-Web.woff2) format("woff2");font-weight:400;font-display:swap}

:root{
  --ground:#F7F4EC; --surface:#FFFFFF; --sunk:#F1ECDF;
  --ink:#1A1A1A; --muted:#6F6A62; --accent:#521033;
  --rule:#DFD8C6; --rule-strong:#C9C0A9;
  --warn:#8A5A16; --warn-wash:#FBF3E4;
  --full:#3F6B4A;
  --press:rgba(82,16,51,.08);
  --display:"Romie",Georgia,serif;
  --body:"Caslon Doric",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
  --top:env(safe-area-inset-top,0px);
  --bottom:env(safe-area-inset-bottom,0px);
  --left:env(safe-area-inset-left,0px);
  --right:env(safe-area-inset-right,0px);
  --tap:48px;
}
@media (prefers-color-scheme:dark){
  :root{
    --ground:#151013; --surface:#1D171B; --sunk:#241D22;
    --ink:#EEE9E1; --muted:#A49C92; --accent:#E8DFAD;
    --rule:#332B31; --rule-strong:#463C43;
    --warn:#DDB472; --warn-wash:#251C13;
    --full:#8FBF9C;
    --press:rgba(232,223,173,.1);
  }
}

*{box-sizing:border-box}

html{
  background:var(--ground);
  -webkit-text-size-adjust:100%;
  /* Stops the rubber-band from dragging the page off its own background, and
     stops an overscroll at the top turning into a browser pull-to-refresh. */
  overscroll-behavior-y:contain;
}
body{
  margin:0;background:var(--ground);color:var(--ink);
  font-family:var(--body);font-size:16px;line-height:1.55;
  -webkit-font-smoothing:antialiased;
  /* A phone must never scroll sideways. If something overflows, clip it here
     rather than letting the whole layout come unstuck from the viewport. */
  overflow-x:hidden;
  /* Chrome UI is furniture; guest details are not — see .booking below. */
  -webkit-user-select:none;user-select:none;
  -webkit-tap-highlight-color:transparent;
}
a{color:inherit;touch-action:manipulation}

.skip{position:absolute;left:-9999px;top:0}
.skip:focus{left:0;z-index:20;background:var(--surface);padding:1rem;border:1px solid var(--accent)}

main{
  max-width:60rem;margin:0 auto;
  padding:0 max(1rem,var(--left)) calc(4rem + var(--bottom)) max(1rem,var(--right));
}

.bar{
  display:flex;align-items:baseline;gap:.75rem;
  padding:calc(.85rem + var(--top)) max(1rem,var(--left)) .85rem max(1rem,var(--right));
  border-bottom:1px solid var(--rule);background:var(--surface);
  position:sticky;top:0;z-index:5;
}
.wordmark{
  font-family:var(--display);font-size:1.35rem;color:var(--accent);
  text-decoration:none;letter-spacing:.02em;
  display:inline-flex;align-items:center;min-height:var(--tap);margin:-.75rem 0;padding-right:.5rem;
}
.estate{font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}

.stale{
  margin:0;padding:.6rem max(1rem,var(--left));background:var(--warn);color:var(--ground);
  font-size:.8rem;text-align:center;position:sticky;top:0;z-index:6;
}

.head{padding:1.5rem 0 1rem}
h1{font-family:var(--display);font-weight:300;font-size:clamp(1.6rem,5vw,2.2rem);margin:0;line-height:1.15}
.sub{margin:.35rem 0 0;color:var(--muted);font-size:.9rem}

.nav{display:flex;align-items:center;gap:.5rem;margin-bottom:1.25rem;flex-wrap:wrap}
.nav a,.nav span.here{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:var(--tap);padding:0 .9rem;
  border:1px solid var(--rule);background:var(--surface);
  text-decoration:none;font-size:.9rem;border-radius:2px;
  touch-action:manipulation;
}
.nav a:active{background:var(--press);border-color:var(--rule-strong)}
.nav span.here{color:var(--muted);border-style:dashed;background:transparent}
.nav .spacer{flex:1 1 0;min-width:0}
.nav .short{display:none}
@media(max-width:560px){
  .nav .long{display:none}
  .nav .short{display:inline}
  .nav{gap:.4rem}
  .nav a,.nav span.here{padding:0 .7rem}
}

.stats{
  display:grid;grid-template-columns:repeat(auto-fit,minmax(7rem,1fr));
  gap:1px;background:var(--rule);border:1px solid var(--rule);margin-bottom:1.5rem;
}
.stat{background:var(--surface);padding:.9rem}
.stat b{display:block;font-family:var(--display);font-weight:300;font-size:1.6rem;line-height:1;font-variant-numeric:tabular-nums}
.stat span{display:block;font-size:.72rem;color:var(--muted);margin-top:.3rem;line-height:1.3}
.stat.flag b{color:var(--warn)}
@media(max-width:560px){
  .stats{grid-template-columns:repeat(2,minmax(0,1fr))}
  /* An odd number of tiles used to leave a dead grey box on the end. */
  .stat:last-child:nth-child(odd){grid-column:1/-1}
}

/* minmax(0,1fr) rather than 1fr: a plain 1fr will not shrink below the widest
   pill, so seven columns of "14:30 16/15" pushed the page wider than the phone
   and broke the sticky header away from the content. */
.grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)}
.dow{background:var(--sunk);padding:.4rem;text-align:center;font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.cell{background:var(--surface);min-height:5.5rem;padding:.4rem;position:relative;min-width:0}
.cell.outside{background:var(--sunk)}
.cell.today{box-shadow:inset 0 0 0 2px var(--accent)}
.cell .n{font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums}
.cell.busy .n{color:var(--ink)}
.cell a.open{
  position:absolute;inset:0;text-decoration:none;
  touch-action:manipulation;-webkit-touch-callout:none;
}
.cell a.open:active{background:var(--press)}
.pill{
  display:block;margin-top:.25rem;font-size:.7rem;line-height:1.35;padding:.15rem .3rem;
  border-left:2px solid var(--accent);background:var(--sunk);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.pill.full{border-left-color:var(--full)}
.pill.unpaid{border-left-color:var(--warn)}
.pill.pending{border-left-color:var(--rule-strong);color:var(--muted)}
.pill.over{border-left-color:var(--warn);color:var(--warn);background:var(--warn-wash)}
.pill b{font-variant-numeric:tabular-nums;font-weight:400}

.compact{display:none}
.compact b{font-family:var(--display);font-weight:300;font-size:1.15rem;line-height:1;font-variant-numeric:tabular-nums}
.dots{display:flex;gap:2px;margin-top:3px}
.dot{width:5px;height:5px;border-radius:50%;background:var(--accent);display:block}
.dot.full{background:var(--full)}
.dot.over{background:var(--warn)}
.dot.pending{background:var(--rule-strong)}

@media(max-width:560px){
  .cell{min-height:3.6rem;padding:.35rem}
  .pill{display:none}
  .compact{display:flex;flex-direction:column;align-items:flex-start;margin-top:.15rem}
}

.sitting{border:1px solid var(--rule);background:var(--surface);margin-bottom:1rem}
.sitting > h2{
  margin:0;padding:.85rem 1rem;border-bottom:1px solid var(--rule);
  font-family:var(--display);font-weight:300;font-size:1.15rem;
  display:flex;justify-content:space-between;align-items:baseline;gap:1rem;
  position:sticky;top:calc(3.2rem + var(--top));z-index:2;background:var(--surface);
}
.sitting > h2 .count{font-family:var(--body);font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.sitting > h2 .count.full{color:var(--full)}
.sitting > h2 .count.over{color:var(--warn)}

.booking{
  padding:.85rem 1rem;border-bottom:1px solid var(--rule);
  display:grid;grid-template-columns:2.5rem 1fr;gap:.35rem .8rem;
  /* Names, numbers and dietary notes get copied and read aloud. This is the
     one place selection and the long-press callout must survive. */
  -webkit-user-select:text;user-select:text;
}
.booking:last-child{border-bottom:0}
.booking .party{font-family:var(--display);font-size:1.35rem;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--accent)}
.booking .who{font-size:1.05rem}
.booking .contacts{grid-column:2;display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.15rem}
.booking .contacts a,.booking .contacts span{
  display:inline-flex;align-items:center;min-height:44px;padding:0 .6rem;
  border:1px solid var(--rule);border-radius:2px;
  font-size:.85rem;color:var(--ink);text-decoration:none;
  touch-action:manipulation;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
}
.booking .contacts a{-webkit-touch-callout:default}
.booking .contacts a:active{background:var(--press)}
.ref{font-size:.7rem;letter-spacing:.06em;color:var(--muted);font-variant-numeric:tabular-nums;align-self:center}
.booking .tags{grid-column:2;display:flex;gap:.4rem;flex-wrap:wrap;margin-top:.15rem}
.booking .note{grid-column:2;font-size:.9rem;background:var(--warn-wash);border-left:2px solid var(--warn);padding:.45rem .6rem;margin-top:.35rem}
.booking .note b{font-weight:400;color:var(--warn)}
.booking.dim{opacity:.55}
.booking.chase{background:var(--warn-wash)}
.swallowed{margin:0;padding:.6rem 1rem;font-size:.76rem;color:var(--muted);border-top:1px dashed var(--rule)}

.tag{font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--rule-strong);padding:.2rem .4rem;white-space:nowrap;color:var(--muted)}
.tag.warn{color:var(--warn);border-color:var(--warn)}
.tag.ok{color:var(--full);border-color:var(--full)}

.empty{border:1px dashed var(--rule-strong);padding:2rem 1rem;text-align:center;color:var(--muted);font-size:.9rem}
.error{border:1px solid var(--warn);background:var(--warn-wash);padding:1rem;font-size:.9rem}
.error code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em;word-break:break-all;-webkit-user-select:text;user-select:text}

.foot{
  max-width:60rem;margin:0 auto;
  padding:1.5rem max(1rem,var(--left)) calc(3rem + var(--bottom));
  border-top:1px solid var(--rule);
}
.foot p{margin:0;font-size:.75rem;color:var(--muted)}

/* Cross-document transitions turn a multi-page app into something that moves
   like a single one. Ignored where unsupported, which costs nothing. */
@view-transition{navigation:auto}

@media (prefers-reduced-motion:reduce){
  @view-transition{navigation:none}
  *{animation-duration:.01ms !important;transition-duration:.01ms !important}
}
`;
