/**
 * The page shell.
 *
 * Server-rendered, no framework, no build step — the same approach as the
 * public site. This is a page that has to open instantly on a phone, in a
 * kitchen, on rural wifi, held in one hand, so the whole of it is one small
 * document with its styles inline.
 */

export function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

export function page({ title, heading, sub, nav = '', body }) {
  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escape(title)} · Samson</title>
<style>${CSS}</style>
</head>
<body>
<header class="bar">
  <a class="wordmark" href="/">Samson</a>
  <span class="estate">Moore Lodge</span>
</header>
<main>
  <div class="head">
    <h1>${escape(heading)}</h1>
    ${sub ? `<p class="sub">${escape(sub)}</p>` : ''}
  </div>
  ${nav}
  ${body}
</main>
<footer class="foot"><p>Reading live from Wix. Nothing here writes back — yet.</p></footer>
</body>
</html>`;
}

const CSS = `
@font-face{font-family:"Romie";src:url(/fonts/Romie-Light.woff2) format("woff2");font-weight:300;font-display:swap}
@font-face{font-family:"Caslon Doric";src:url(/fonts/CaslonDoric-Regular-Web.woff2) format("woff2");font-weight:400;font-display:swap}

:root{
  --ground:#F7F4EC; --surface:#FFFFFF; --sunk:#F1ECDF;
  --ink:#1A1A1A; --muted:#6F6A62; --accent:#521033;
  --rule:#DFD8C6; --rule-strong:#C9C0A9;
  --warn:#8A5A16; --warn-wash:#FBF3E4;
  --full:#3F6B4A;
  --display:"Romie",Georgia,serif;
  --body:"Caslon Doric",-apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
}
@media (prefers-color-scheme:dark){
  :root{
    --ground:#151013; --surface:#1D171B; --sunk:#241D22;
    --ink:#EEE9E1; --muted:#A49C92; --accent:#E8DFAD;
    --rule:#332B31; --rule-strong:#463C43;
    --warn:#DDB472; --warn-wash:#251C13;
    --full:#8FBF9C;
  }
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--body);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
a{color:inherit}
main{max-width:60rem;margin:0 auto;padding:0 1rem 4rem}

.bar{display:flex;align-items:baseline;gap:.75rem;padding:1rem;border-bottom:1px solid var(--rule);background:var(--surface);position:sticky;top:0;z-index:5}
.wordmark{font-family:var(--display);font-size:1.35rem;color:var(--accent);text-decoration:none;letter-spacing:.02em}
.estate{font-size:.68rem;letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}

.head{padding:1.75rem 0 1rem}
h1{font-family:var(--display);font-weight:300;font-size:clamp(1.6rem,5vw,2.2rem);margin:0;line-height:1.15}
.sub{margin:.35rem 0 0;color:var(--muted);font-size:.9rem}

.nav{display:flex;align-items:center;gap:.5rem;margin-bottom:1.25rem;flex-wrap:wrap}
.nav a,.nav span.here{
  display:inline-block;padding:.4rem .75rem;border:1px solid var(--rule);background:var(--surface);
  text-decoration:none;font-size:.85rem;border-radius:2px;
}
.nav a:hover{border-color:var(--rule-strong)}
.nav span.here{color:var(--muted);border-style:dashed;background:transparent}
.nav .spacer{flex:1}

.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(7rem,1fr));gap:1px;background:var(--rule);border:1px solid var(--rule);margin-bottom:1.5rem}
.stat{background:var(--surface);padding:.9rem}
.stat b{display:block;font-family:var(--display);font-weight:300;font-size:1.6rem;line-height:1;font-variant-numeric:tabular-nums}
.stat span{display:block;font-size:.72rem;color:var(--muted);margin-top:.3rem;line-height:1.3}
.stat.flag b{color:var(--warn)}

.grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--rule);border:1px solid var(--rule)}
.dow{background:var(--sunk);padding:.4rem;text-align:center;font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.cell{background:var(--surface);min-height:5.5rem;padding:.4rem;position:relative}
.cell.outside{background:var(--sunk)}
.cell.today{box-shadow:inset 0 0 0 2px var(--accent)}
.cell .n{font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums}
.cell.busy .n{color:var(--ink)}
.cell a.open{position:absolute;inset:0;text-decoration:none}
.pill{display:block;margin-top:.25rem;font-size:.7rem;line-height:1.35;padding:.15rem .3rem;border-left:2px solid var(--accent);background:var(--sunk);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pill.full{border-left-color:var(--full)}
.pill.unpaid{border-left-color:var(--warn)}
.pill.pending{border-left-color:var(--rule-strong);color:var(--muted)}
.pill.over{border-left-color:var(--warn);color:var(--warn);background:var(--warn-wash)}
.pill b{font-variant-numeric:tabular-nums;font-weight:400}

@media(max-width:560px){
  .cell{min-height:4.25rem;padding:.3rem}
  .pill{font-size:.62rem}
}

.sitting{border:1px solid var(--rule);background:var(--surface);margin-bottom:1rem}
.sitting > h2{
  margin:0;padding:.75rem 1rem;border-bottom:1px solid var(--rule);
  font-family:var(--display);font-weight:300;font-size:1.15rem;
  display:flex;justify-content:space-between;align-items:baseline;gap:1rem;
}
.sitting > h2 .count{font-family:var(--body);font-size:.78rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.sitting > h2 .count.full{color:var(--full)}
.sitting > h2 .count.over{color:var(--warn)}

.booking{padding:.85rem 1rem;border-bottom:1px solid var(--rule);display:grid;grid-template-columns:2.5rem 1fr;gap:.25rem .8rem}
.booking:last-child{border-bottom:0}
.booking .party{font-family:var(--display);font-size:1.3rem;line-height:1.1;font-variant-numeric:tabular-nums;color:var(--accent)}
.booking .who{font-size:1rem}
.booking .meta{grid-column:2;font-size:.8rem;color:var(--muted);display:flex;gap:.75rem;flex-wrap:wrap}
.booking .meta a{color:var(--muted)}
.booking .note{grid-column:2;font-size:.83rem;background:var(--warn-wash);border-left:2px solid var(--warn);padding:.35rem .55rem;margin-top:.35rem}
.booking .note b{font-weight:400;color:var(--warn)}
.booking.dim{opacity:.55}

.tag{font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--rule-strong);padding:.1rem .35rem;white-space:nowrap}
.tag.warn{color:var(--warn);border-color:var(--warn)}
.tag.ok{color:var(--full);border-color:var(--full)}

.empty{border:1px dashed var(--rule-strong);padding:2rem 1rem;text-align:center;color:var(--muted);font-size:.9rem}
.error{border:1px solid var(--warn);background:var(--warn-wash);padding:1rem;font-size:.9rem}
.error code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.85em;word-break:break-all}

.foot{max-width:60rem;margin:0 auto;padding:1.5rem 1rem 3rem;border-top:1px solid var(--rule)}
.foot p{margin:0;font-size:.75rem;color:var(--muted)}
`;
