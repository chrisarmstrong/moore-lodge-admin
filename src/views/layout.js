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

export function page(opts) {
  return pageHead(opts) + opts.body + pageTail();
}

/**
 * Everything that can be written before Wix has answered.
 *
 * The title, the date and the arrows all come from the URL, so the shell can
 * be on screen in a few tens of milliseconds while the diary itself is still
 * being fetched. Only the part that needs data waits.
 */
/** Absolute, because Open Graph will not take a relative image. */
const SITE = 'https://samson.moorelodge.co.uk';

export function pageHead({ title, heading, sub, nav = '', titlebar = '', version = 'dev', flash = null, wide = false, split = false, add = null }) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">

<title>${escape(title)} · Samson</title>

<!-- The card is deliberately the same on every page: the mark and the word.
     An unfurl is cached at the moment somebody shares it, so a card naming a
     date and its covers would be frozen at whatever the diary said then and
     read as current — and it would put guest numbers in front of anyone who
     came by the link. There is nothing here a stranger cannot already learn
     from the hostname. -->
<meta property="og:type" content="website">
<meta property="og:site_name" content="Samson">
<meta property="og:title" content="Samson">
<meta property="og:description" content="The Moore Lodge back office.">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/icons/card.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Samson">
<meta name="twitter:card" content="summary_large_image">

<!-- Painted before first paint, so the notch and home-bar bands match the page
     rather than flashing white on launch. -->
<meta name="theme-color" content="#F7F4EC" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#151013" media="(prefers-color-scheme: dark)">

<!-- use-credentials matters: the manifest is fetched without cookies by
     default, and Cloudflare Access would bounce that fetch to a login page,
     leaving the app uninstallable for no visible reason. -->
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="icon" href="/icons/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png">
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
<meta name="build" content="${escape(version)}">
<style>${CSS}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="bar">
  <a class="wordmark" href="/"><i class="mark" aria-hidden="true"></i>Samson</a>
  <a class="add" href="${add ? `/new/${escape(add)}` : '/new'}" aria-label="Take a booking over the phone">
    <span aria-hidden="true">+</span><span class="addword">Booking</span>
  </a>
</header>
<p class="stale" id="stale" hidden></p>
${flash ? `<p class="flash${flash.ok ? '' : ' bad'}" role="status">${escape(flash.text)}</p>` : ''}
<main id="main"${wide || split ? ` class="${[wide && 'wide', split && 'split'].filter(Boolean).join(' ')}"` : ''}>
  ${titlebar || `<div class="head"><h1>${escape(heading)}</h1>${sub ? `<p class="sub">${escape(sub)}</p>` : ''}</div>`}
  ${nav}`;
}

export function pageTail() {
  return `</main>
<footer class="foot"><p>Reading live from Wix. Nothing here writes back — yet.</p></footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/**
 * Shown while the diary is on its way, then hidden by a stylesheet that
 * arrives with the real content. No script, no flash of empty page, and the
 * shape matches what replaces it so nothing jumps.
 */
export function skeleton(kind) {
  const rows = kind === 'month'
    ? `<div class="sk-stats">${'<div class="sk-tile"></div>'.repeat(5)}</div>
       <div class="sk-grid">${'<div class="sk-cell"></div>'.repeat(35)}</div>`
    : `${'<div class="sk-card"><div class="sk-line w40"></div><div class="sk-line w70"></div><div class="sk-line w55"></div></div>'.repeat(3)}`;
  return `<div id="sk" class="sk" aria-hidden="true">${rows}</div>`;
}

/** Emitted just before the real content, which retires the skeleton. */
export const RETIRE_SKELETON = '<style>#sk{display:none}</style>';

const SCRIPT = `
(function () {
  var STALE_AFTER = 3 * 60 * 1000;
  var reloading = false;

  function renderedAt() {
    var meta = document.querySelector('meta[name="rendered-at"]');
    var when = meta && new Date(meta.content);
    return when && !isNaN(when) ? when : null;
  }

  function refresh() {
    if (reloading) return;
    reloading = true;
    location.reload();
  }

  if ('serviceWorker' in navigator) {
    addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (registration) {
        // A new worker taking over means a new deployment has landed. The diary
        // is read-only, so there is nothing to lose by picking it up at once.
        navigator.serviceWorker.addEventListener('controllerchange', refresh);

        // A phone left on the diary all afternoon never navigates, so it would
        // otherwise never notice either a new version or newer bookings.
        addEventListener('visibilitychange', function () {
          if (document.visibilityState !== 'visible' || !navigator.onLine) return;
          registration.update();
          var when = renderedAt();
          if (when && Date.now() - when.getTime() > STALE_AFTER) refresh();
        });
      }).catch(function () {});
    });
  }

  // A cached page can be hours old. Say so plainly rather than letting somebody
  // read yesterday's covers as today's.
  var banner = document.getElementById('stale');
  function check() {
    if (!banner) return;
    if (navigator.onLine) { banner.hidden = true; return; }
    var when = renderedAt();
    var time = when ? ' as it was at ' + when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
    banner.textContent = 'Offline — showing the diary' + time + '.';
    banner.hidden = false;
  }
  addEventListener('online', function () { check(); refresh(); });
  addEventListener('offline', check);
  check();

  // Taking a booking is not idempotent and Wix is not instant, so the second
  // tap somebody makes while wondering whether the first one landed would book
  // the same party twice. The server checks too — this is only what stops the
  // tap being worth making, and what says something is happening.
  addEventListener('submit', function (event) {
    var form = event.target;
    if (!form || form.method !== 'post') return;
    var button = form.querySelector('button[type=submit][data-busy]');
    if (!button) return;
    if (form.dataset.sent) { event.preventDefault(); return; }
    form.dataset.sent = '1';
    // Disabling before the browser serialises the form would drop the button's
    // own name and value, so it waits for the tick after submission begins.
    setTimeout(function () {
      button.disabled = true;
      button.textContent = button.dataset.busy;
    }, 0);
  });
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
  max-width:44rem;margin:0 auto;
  padding:0 max(1rem,var(--left)) calc(4rem + var(--bottom)) max(1rem,var(--right));
}
main.wide{max-width:60rem}

.bar{
  /* Centred, not baseline-aligned: the mark is an empty box, so it — not the
     wordmark's text — was supplying the flex baseline, and anything sitting
     beside it lined up against the wrong thing. */
  display:flex;align-items:center;gap:.75rem;
  padding:calc(.85rem + var(--top)) max(1rem,var(--left)) .85rem max(1rem,var(--right));
  border-bottom:1px solid var(--rule);background:var(--surface);
  position:sticky;top:0;z-index:5;
}
.wordmark{
  font-family:var(--display);font-size:1.35rem;color:var(--accent);
  text-decoration:none;letter-spacing:.02em;
  display:inline-flex;align-items:center;gap:.45rem;
  min-height:var(--tap);margin:-.75rem 0;padding-right:.5rem;
}
/* Masked rather than inlined: the monogram is 8KB of path data, which would
   otherwise ride along on every page. As a mask it is fetched once, cached by
   the service worker, and still takes its colour from the theme. */
.mark{
  width:1.35em;height:1.35em;flex:none;background:currentColor;
  -webkit-mask:url(/icons/monogram.svg) center/contain no-repeat;
  mask:url(/icons/monogram.svg) center/contain no-repeat;
}

.stale{
  margin:0;padding:.6rem max(1rem,var(--left));background:var(--warn);color:var(--ground);
  font-size:.8rem;text-align:center;position:sticky;top:0;z-index:6;
}

/* The title and its arrows are one control, not a heading with a button bar
   underneath. Arrows are bare glyphs at a 48px target — a white box around a
   chevron is a web form's idea of navigation, not an app's. */
.titlebar{
  display:grid;grid-template-columns:var(--tap) minmax(0,1fr) var(--tap);
  align-items:center;padding:1.1rem 0 .5rem;gap:.25rem;
}
.titlebar .arrow{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:var(--tap);min-width:var(--tap);
  font-family:var(--display);font-size:1.7rem;line-height:1;color:var(--accent);
  text-decoration:none;border-radius:50%;touch-action:manipulation;
  -webkit-touch-callout:none;
}
.titlebar .arrow:active{background:var(--press)}
.titlebar .title{text-align:center;min-width:0}
/* The ellipsis needs overflow:hidden, and overflow:hidden clips at the padding
   box — which at this line-height sits above the foot of a "g". Padding gives
   the descender somewhere to go; the negative margin puts the layout back. */
.titlebar h1{
  font-family:var(--display);font-weight:300;font-size:clamp(1.4rem,5.5vw,2rem);
  line-height:1.15;padding:.16em 0;margin:-.16em 0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.titlebar .sub{margin:.15rem 0 0;color:var(--muted);font-size:.82rem}
/* The arrows belong to the title. Pinned to the edges of a 60rem grid they end
   up a third of a window away from it, so the cluster is capped once there is
   room to spare — on a phone it already fills the width. */
@media(min-width:640px){.titlebar{max-width:32rem;margin-inline:auto}}
.titlebar .sub a{color:var(--accent);text-decoration:none;padding:.25rem 0}

.subnav{display:flex;justify-content:center;gap:1.25rem;margin:0 0 1.25rem}
.subnav a,.subnav span{
  display:inline-flex;align-items:center;min-height:var(--tap);
  font-size:.85rem;color:var(--accent);text-decoration:none;touch-action:manipulation;
}
.subnav span{color:var(--muted)}

.flash{
  margin:0;padding:.75rem max(1rem,var(--left));
  background:var(--full);color:var(--ground);font-size:.85rem;text-align:center;
}
.flash.bad{background:var(--warn)}

.actions{display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.6rem}
.actions form{margin:0}
.act{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:44px;padding:0 .85rem;
  font-family:var(--body);font-size:.85rem;color:var(--accent);
  background:var(--surface);border:1px solid var(--rule);border-radius:2px;
  cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;
  text-decoration:none;  /* .act is worn by buttons and by links; only one of them underlines */
}
.act:active{background:var(--press)}
.act.grave{color:var(--warn);border-color:var(--warn)}

/* Anything with consequences asks once more, without a script and without a
   dialog that a stray tap can dismiss into doing the thing anyway. */
.ask{display:inline-block}
.ask > summary{
  display:inline-flex;align-items:center;justify-content:center;
  min-height:44px;padding:0 .85rem;list-style:none;cursor:pointer;
  font-size:.85rem;color:var(--warn);border:1px solid var(--warn);border-radius:2px;
  touch-action:manipulation;
}
.ask > summary::-webkit-details-marker{display:none}
.ask[open]{display:block;width:100%;border:1px solid var(--warn);background:var(--warn-wash);padding:.6rem}
.ask[open] > summary{border:0;padding:0;min-height:0;margin-bottom:.4rem;font-weight:400}
.ask p{margin:0 0 .6rem;font-size:.85rem;color:var(--ink)}

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
.stat.link{text-decoration:none;display:block;touch-action:manipulation}
.stat.link span{color:var(--accent)}
.stat.link:active{background:var(--sunk)}
.stat.quiet b{color:var(--muted)}

/* The day beside its month, once there is room for both — landscape tablet and
   up. Below that the planner is not shown at all: a 40px cell is a poor tap
   target on a phone, and the month view is one tap away regardless. */
.planner{display:none}

@media(min-width:62rem){
  /* main itself is the grid, so the title and its arrows sit in the left column
     with the calendar rather than floating centred over both — and because they
     are already inside main, they keep going out with the first flush. */
  /* auto auto 1fr, not three autos: the detail column spans all three rows, and
     a spanning item distributes its height across every auto track it covers —
     which pushed the title and the nav apart by a third of the day's length
     each. Only the last track may grow, and it is the one the planner sticks in. */
  main.split{
    display:grid;grid-template-columns:16rem minmax(0,1fr);
    grid-template-rows:auto auto 1fr;column-gap:2.5rem;
  }
  main.split > .titlebar{grid-area:1/1;padding-top:0}
  main.split > .titlebar h1{font-size:1.5rem}
  main.split > .subnav{grid-area:2/1;justify-content:flex-start;gap:1rem;margin-bottom:.75rem}
  /* align-self:start matters as much as the sticky does. A grid item stretches
     to its area by default, so the planner's own box became the full 800px of
     row 3 — taller than a landscape tablet, which is precisely the case where
     a sticky element cannot stay wholly on screen. Sized to its content, it
     travels inside that tall area instead of being it. */
  main.split > .planner{display:block;grid-area:3/1;align-self:start;position:sticky;top:1rem}
  /* Spanning all three rows makes the last one absorb the remaining height,
     which is what gives the sticky planner a tall enough box to travel in. */
  main.split > .detail{grid-area:1/2/4/3;min-width:0}
}

.pgrid{
  display:grid;grid-template-columns:repeat(7,minmax(0,1fr));
  gap:1px;background:var(--rule);border:1px solid var(--rule);
}
.pdow{
  background:var(--ground);color:var(--muted);font-size:.62rem;text-align:center;
  padding:.3rem 0;letter-spacing:.04em;
}
.pcell{
  background:var(--surface);min-height:2.6rem;padding:.25rem 0 .2rem;
  display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:.05rem;
  text-decoration:none;color:var(--ink);touch-action:manipulation;
}
.pcell.outside{background:var(--sunk)}
.pcell:hover{background:var(--press)}
.pn{font-size:.72rem;line-height:1;color:var(--muted);font-variant-numeric:tabular-nums}
.pcovers{
  font-family:var(--display);font-size:.8rem;line-height:1;color:var(--accent);
  font-variant-numeric:tabular-nums;
}
/* Today is a fact about the date; the day being read is a fact about the page.
   They are different things and a day can be both, so they cannot share a mark. */
.pcell.now .pn{color:var(--accent);font-weight:600}
.pcell.here{background:var(--accent)}
.pcell.here .pn,.pcell.here .pcovers{color:var(--ground)}
.pall{
  display:flex;align-items:center;justify-content:center;min-height:var(--tap);
  margin-top:.5rem;font-size:.8rem;color:var(--accent);text-decoration:none;
}

.daysum{margin:0 0 .75rem;color:var(--muted);font-size:.9rem}
/* A day's sittings sit under one date, not one date each. */
.dayrule{
  font-family:var(--display);font-weight:300;font-size:1.05rem;
  margin:1.5rem 0 .5rem;padding-bottom:.3rem;border-bottom:1px solid var(--rule);
}
.dayrule:first-of-type{margin-top:0}

.cues{display:flex;flex-wrap:wrap;gap:.5rem;margin:0 0 1.25rem}
.cue{
  display:flex;align-items:center;justify-content:space-between;gap:.6rem;
  flex:1 1 14rem;min-height:var(--tap);padding:0 1rem;
  border:1px solid var(--rule);background:var(--surface);color:var(--accent);
  text-decoration:none;font-size:.9rem;border-radius:2px;touch-action:manipulation;
}
.cue:active{background:var(--press)}
.cue-sub{color:var(--muted);font-size:.82rem;white-space:nowrap}
.cue.quiet{color:var(--muted);border-style:dashed}
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

/* A bare covers count sitting under a bare date read as two dates. Filling it
   says "this many people", and colouring it carries the state the dots used
   to — sold out, oversold — without a second row of marks. */
.compact{display:none}
.covers{
  display:flex;align-items:center;justify-content:center;
  /* As wide as the cell allows, inside the same padding the date sits in. */
  width:100%;aspect-ratio:1;border-radius:50%;
  background:var(--accent);color:var(--ground);
  font-family:var(--body);font-size:clamp(.85rem,3.6vw,1.1rem);
  font-variant-numeric:tabular-nums;line-height:1;
}
.covers.full{background:var(--full)}
.covers.over{background:var(--warn)}
.covers.none{background:transparent;color:var(--muted);border:1px dashed var(--rule-strong)}

@media(max-width:560px){
  .cell{min-height:3.6rem;padding:.35rem;display:flex;flex-direction:column;align-items:center;gap:.2rem}
  .cell .n{align-self:flex-start}
  .pill{display:none}
  .compact{display:flex;width:100%;padding:0 .1rem}
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
.booking .party{text-align:right;font-family:var(--display);font-size:1.35rem;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--accent)}
.booking .who{font-size:1.05rem}
.booking .line{grid-column:2;display:flex;flex-wrap:wrap;align-items:baseline;gap:.3rem .6rem}
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
.booking .tags{display:flex;gap:.4rem;flex-wrap:wrap}
.booking .note{grid-column:2;font-size:.9rem;background:var(--warn-wash);border-left:2px solid var(--warn);padding:.45rem .6rem;margin-top:.35rem}
.booking .note b{font-weight:400;color:var(--warn)}
.booking.dim{opacity:.55}
.booking.chase{background:var(--warn-wash)}
/* Contacts fold away so a sitting can be scanned in one screen. Dietary notes
   and messages to the team deliberately stay out here in the open — they are
   the reason somebody opens this page in a kitchen. */
.reveal{grid-column:1/-1;margin:.15rem 0 0}
.reveal > summary{
  display:flex;align-items:center;gap:.4rem;min-height:var(--tap);
  font-size:.8rem;color:var(--accent);cursor:pointer;list-style:none;
  touch-action:manipulation;
}
/* Right-aligned: it is the least important thing on the row, and it now sits
   under the notes where a left edge would read as another note. */
.reveal > summary{justify-content:flex-end}
.reveal > summary::-webkit-details-marker{display:none}
.reveal > summary::after{content:"›";display:inline-block;transition:transform .15s}
.reveal[open] > summary::after{transform:rotate(90deg)}
.reveal > summary:active{background:var(--press)}
.reveal[open] > summary{color:var(--muted)}

/* The one thing in the header besides the way home. It is a phone call being
   taken, so it is always one tap away from wherever somebody happens to be. */
.add{
  margin-left:auto;display:inline-flex;align-items:center;gap:.35rem;
  min-height:var(--tap);padding:0 .8rem;
  color:var(--accent);text-decoration:none;font-size:.85rem;
  border:1px solid var(--rule-strong);border-radius:2px;touch-action:manipulation;
}
.add span[aria-hidden]{font-size:1.1rem;line-height:1}
.add:active{background:var(--press)}
@media(max-width:24rem){.addword{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}}

.book,.when{max-width:34rem}

/* Three taps before any typing: when, which sitting, how many. Each is a real
   answer rather than a picker somebody has to aim at one-handed. */
.chips{border:0;padding:0;margin:0 0 .9rem;min-width:0}
.chips legend,.chips .legend{padding:0;margin:0;font-size:.72rem;color:var(--muted);letter-spacing:.04em;margin-bottom:.35rem}
.chiprow{display:flex;flex-wrap:wrap;gap:.35rem}
.chip{
  display:inline-flex;align-items:center;justify-content:center;gap:.4rem;
  min-height:44px;padding:0 .7rem;
  border:1px solid var(--rule-strong);border-radius:2px;background:var(--surface);
  color:var(--ink);text-decoration:none;font-size:.9rem;
  cursor:pointer;touch-action:manipulation;-webkit-tap-highlight-color:transparent;
}
.chip input{position:absolute;opacity:0;pointer-events:none;width:1px;height:1px}
.chip:active{background:var(--press)}
/* Sized so one through six and "More" make a single row on a 393px phone: a
   second row of numbers is a second place to look for a number. */
.chip.num{min-width:44px;padding:0 .3rem;font-variant-numeric:tabular-nums}
.chip.num.wider{padding:0 .55rem}
/* A whole row, because a sitting is a sentence: when, what, and how much room. */
.chip.wide{width:100%;justify-content:flex-start;margin-bottom:.35rem}
.chiptime{font-family:var(--display);font-size:1.05rem}
.chipwhat{flex:1;color:var(--muted);font-size:.85rem}
.chipleft{font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums}
.chip.spent .chipleft{color:var(--warn)}
/* A day the experience does not run. Dimmed and dashed, still tappable: it is
   information, not a locked door. */
.chip.shut{border-style:dashed;color:var(--muted)}
/* Selection is a filled chip, not a tick: it has to be readable at a glance
   from a phone held at arm's length while somebody is talking. */
.chip.on,.chip:has(input:checked){background:var(--accent);border-color:var(--accent);color:var(--ground)}
.chip.on .chipwhat,.chip:has(input:checked) .chipwhat,
.chip.on .chipleft,.chip:has(input:checked) .chipleft{color:var(--ground);opacity:.75}
.chip:has(input:focus-visible){outline:2px solid var(--accent);outline-offset:2px}
.chosen{margin:.4rem 0 0;font-size:.8rem;color:var(--muted)}

/* The field behind a chip appears because the chip was chosen, not because a
   second thing was opened. A disclosure summary costs a whole 48px row to say
   what the chip beside it already said. */
.book .reveals,.chips .reveals{display:none}
.chips:has(input[value="other"]:checked) .reveals.pair{display:grid;margin-top:.6rem}
.chips:has(input[value="other"]:checked) .reveals.field{display:flex;margin-top:.6rem}

.datepick > summary{list-style:none}
.datepick > summary::-webkit-details-marker{display:none}
.datepick[open]{width:100%}
/* A closed <details> hides its children by not rendering them, which an
   explicit display on a child is enough to undo — so the picker says so
   itself rather than trusting the default. */
.datepick:not([open]) .jump{display:none}
.jump{display:flex;gap:.5rem;align-items:center;margin-top:.5rem}
.jump input{
  font-family:var(--body);font-size:16px;min-height:var(--tap);flex:1;min-width:0;
  padding:0 .6rem;background:var(--surface);border:1px solid var(--rule-strong);border-radius:2px;color:var(--ink);
}

.more{margin:0 0 .5rem}
.more > summary{
  display:inline-flex;align-items:center;min-height:var(--tap);
  font-size:.85rem;color:var(--accent);cursor:pointer;list-style:none;touch-action:manipulation;
}
.more > summary::-webkit-details-marker{display:none}
.more > summary::after{content:" ›"}
.more[open] > summary::after{content:" ⌄"}

/* Well away from the primary, because a thumb is imprecise and the two
   outcomes are not comparable. */
/* A link, not a button — but still something a thumb has to be able to hit. */
.giveup{
  display:inline-flex;align-items:center;min-height:44px;
  font-size:.82rem;color:var(--muted);text-decoration:underline;
  text-underline-offset:.2em;touch-action:manipulation;
}
.act[disabled]{opacity:.6;cursor:default}
.field{margin:0 0 .9rem;display:flex;flex-direction:column;gap:.3rem}
.field label{font-size:.72rem;color:var(--muted);letter-spacing:.04em}
.field input,.field select,.field textarea{
  font-family:var(--body);font-size:1rem;color:var(--ink);
  background:var(--surface);border:1px solid var(--rule-strong);border-radius:2px;
  padding:0 .6rem;min-height:var(--tap);width:100%;
}
.field textarea{padding:.5rem .6rem;min-height:3.4rem;resize:vertical;line-height:1.4}
.field input:focus,.field select:focus,.field textarea:focus{
  outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent);
}
/* Under 16px iOS zooms the page in on focus and does not zoom back out, which
   on a form this long strands somebody mid-booking. */
@media(max-width:560px){.field input,.field select,.field textarea{font-size:16px}}
.hint{margin:0;font-size:.78rem;color:var(--muted);line-height:1.4}
.pair{display:grid;grid-template-columns:1fr;gap:0}
@media(min-width:30rem){.pair{grid-template-columns:1fr 1fr;column-gap:1rem}}
.running{
  margin:0 0 1.25rem;padding:.6rem .8rem;font-size:.85rem;line-height:1.5;
  background:var(--sunk);border-left:2px solid var(--rule-strong);
}
.running b{font-weight:400;color:var(--muted)}
/* The two outcomes at opposite ends of the row: leaving is a quiet link on the
   left, taking the booking is the weight on the right, and a thumb aimed at
   either is nowhere near the other. */
.submit{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:1.5rem 0 .75rem}
.submit .act{min-height:52px;padding:0 1.4rem;font-size:.95rem}
.act.primary{background:var(--accent);color:var(--ground);border-color:var(--accent)}
.error ul{margin:.4rem 0 0;padding-left:1.1rem}
.error li{margin:.15rem 0}

.notefield{display:flex;flex-direction:column;gap:.35rem;margin-top:.75rem}
.notefield label{font-size:.72rem;color:var(--muted);letter-spacing:.04em}
.notefield textarea{
  font-family:var(--body);font-size:.9rem;line-height:1.4;color:var(--ink);
  background:var(--surface);border:1px solid var(--rule-strong);border-radius:2px;
  padding:.5rem .6rem;resize:vertical;min-height:3.4rem;width:100%;
}
/* 16px or larger, or iOS zooms the page in when it takes focus and leaves it
   there — the one font-size on the page that is not a matter of taste. */
@media(max-width:560px){.notefield textarea{font-size:16px}}
.notefield textarea:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
.notefield button{align-self:flex-start}

.sk{pointer-events:none}
.sk-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(7rem,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);margin-bottom:1.5rem}
.sk-tile{background:var(--surface);height:4.6rem}
.sk-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule)}
.sk-cell{background:var(--surface);min-height:3.6rem}
.sk-card{border:1px solid var(--rule);background:var(--surface);padding:1rem;margin-bottom:1rem}
.sk-line{height:.85rem;background:var(--sunk);border-radius:2px;margin-bottom:.55rem}
.sk-line.w40{width:40%}.sk-line.w70{width:70%}.sk-line.w55{width:55%}
@media (prefers-reduced-motion:no-preference){
  .sk-tile,.sk-cell,.sk-line{animation:pulse 1.4s ease-in-out infinite}
}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.55}}
@media(max-width:560px){ .sk-stats{grid-template-columns:repeat(2,minmax(0,1fr))} }

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
