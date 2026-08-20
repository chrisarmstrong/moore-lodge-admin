/**
 * Samson — the Moore Lodge back office.
 *
 * Phase one: read-only, over the Wix data that is already there. Nothing here
 * writes, so nothing here can break a booking. The point of this phase is to
 * find out what the team actually needs from a dashboard while the real system
 * is still Wix's problem.
 *
 * Served on its own hostname, behind Cloudflare Access.
 */

import { authenticate, AccessError } from './access.js';
import { WixBookings } from './adapters/wix-bookings.js';
import { groupIntoSittings, monthGrid, monthSummary } from './calendar.js';
import { monthShell, monthBody } from './views/month.js';
import { dayShell, dayBody } from './views/day.js';
import { listShell, listBody, KINDS } from './views/list.js';
import { newShell, newBody } from './views/new.js';
import { readDraft } from './draft.js';
import { page, pageHead, pageTail, skeleton, RETIRE_SKELETON, escape } from './views/layout.js';
import { ACTIONS, permits } from './actions.js';
import {
  localDate, localMonth, monthWindow, dayWindow, isValidMonth, isValidDate,
} from './time.js';

/** Where a staff member is actually meant to arrive. */
const SAMSON = 'https://samson.moorelodge.co.uk';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Install metadata and static furniture carry no guest data, and several
    // of them are fetched by the browser in contexts that can't present the
    // Access cookie — a manifest fetch is uncredentialed by default, and the
    // service worker must be reachable to update itself. They stay public.
    if (isPublicAsset(url.pathname)) {
      const response = env.ASSETS ? await env.ASSETS.fetch(request) : notFound();
      if (url.pathname === '/sw.js') return serviceWorker(response, env);
      return withAssetHeaders(response, url.pathname);
    }

    let staff;
    try {
      staff = await authenticate(request, env);
    } catch (error) {
      if (error instanceof AccessError) return denied(error);
      throw error;
    }

    try {
      if (request.method === 'POST') return await act(request, url, env, staff);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return html(page({ title: 'No', heading: 'No', body: '<p class="empty">That is not something Samson does.</p>' }), 405);
      }
      return await route(url, env, staff, ctx);
    } catch (error) {
      console.error(error);
      return failed(error);
    }
  },
};

/**
 * The only path that changes anything.
 *
 * Access authenticates with a cookie, and a cookie is sent on a cross-site form
 * post as readily as on our own — so the assertion alone would let another site
 * cancel a booking on a signed-in phone. The origin check is what stops that,
 * and it belongs before anything is read or written.
 */
async function act(request, url, env, staff) {
  const origin = request.headers.get('origin');
  if (origin && origin !== url.origin) return refused('That request came from somewhere else.');
  if (!origin && request.headers.get('sec-fetch-site') !== 'same-origin') {
    return refused('That request did not come from Samson.');
  }

  if (url.pathname === '/new' || url.pathname === '/new/') return take(request, url, env, staff);

  const match = url.pathname.match(/^\/booking\/([0-9a-f-]{36})\/(\w+)\/?$/i);
  if (!match) return notFound();
  const [, id, name] = match;
  const action = ACTIONS[name];
  if (!action) return notFound();

  const form = await request.formData();
  const back = safeReturn(form.get('back'), url);

  try {
    const bookings = new WixBookings(env);
    const changes = action.from ? action.from(form) : action.changes;
    await bookings.apply(id, changes, (booking) => permits(booking, name));
    // Until there is a database of our own to write to, the log is the audit
    // trail: who did what, to which booking.
    console.log(JSON.stringify({ action: name, booking: id, by: staff.email }));
    return redirect(`${back}?done=${encodeURIComponent(action.done)}`);
  } catch (error) {
    console.error(error);
    return redirect(`${back}?failed=${encodeURIComponent(error.message || 'That did not work.')}`);
  }
}

/** What just happened, if anything, said back to whoever did it. */
function readFlash(url) {
  const done = url.searchParams.get('done');
  if (done) return { ok: true, text: done.slice(0, 200) };
  const failed = url.searchParams.get('failed');
  if (failed) return { ok: false, text: failed.slice(0, 200) };
  return null;
}

/**
 * Writes a booking taken over the phone.
 *
 * A rejected form is re-rendered rather than redirected, which is the one place
 * this app does not use post-redirect-get: the alternative is putting somebody's
 * typing in a query string, and retyping a booking because one field was wrong
 * is how a phone call goes badly. Nothing was written, so there is nothing for
 * a refresh to repeat.
 */
async function take(request, url, env, staff) {
  const bookings = new WixBookings(env);
  const form = await request.formData();
  const experiences = await bookings.experiences();
  const { draft, errors, values } = readDraft(form, { experiences });
  const date = isValidDate(values.date) ? values.date : localDate();

  if (!draft) {
    return html(page({
      ...newShell({ date }),
      version: buildVersion(env),
      body: newBody({ date, today: localDate(), experiences: offerable(experiences), values, errors }),
    }), 422);
  }

  try {
    // Cheap insurance against the tap somebody makes when Wix is slow.
    const twin = await bookings.alreadyThere(draft);
    if (twin) {
      return redirect(`/day/${localDate(twin.startsAt)}?done=${encodeURIComponent(`${twin.guestName} was already in the diary.`)}`);
    }

    const booking = await bookings.create(draft);
    console.log(JSON.stringify({ action: 'create', booking: booking.id, by: staff.email }));
    const day = localDate(booking.startsAt);
    return redirect(`/day/${day}?done=${encodeURIComponent(`${booking.guestName} is in the diary.`)}`);
  } catch (error) {
    console.error(error);
    // Wix refuses for reasons worth reading — a pacing conflict, a full
    // sitting — so its words go on the form rather than a generic apology.
    return html(page({
      ...newShell({ date }),
      version: buildVersion(env),
      body: newBody({ date, today: localDate(), experiences: offerable(experiences), values, errors: [error.message || 'Wix would not take that booking.'] }),
    }), 502);
  }
}

/** An archived or hidden experience is not something to sell down the phone. */
function offerable(experiences) {
  return [...experiences.values()].filter((experience) => experience.visible);
}

/** Only ever come back to a page of ours, never wherever a form field says. */
function safeReturn(value, url) {
  const candidate = typeof value === 'string' ? value : '';
  return /^\/(day|calendar|settle|chase|called-off)\/[\w-]+$/.test(candidate) ? candidate : '/';
}

async function route(url, env, staff, ctx) {
  const bookings = new WixBookings(env, ctx);
  const flash = readFlash(url);

  if (url.pathname === '/' || url.pathname === '') {
    return redirect(`/calendar/${localMonth()}`);
  }

  // The home-screen shortcut points here rather than at a date that would go
  // stale the moment it was installed.
  if (url.pathname === '/today') return redirect(`/day/${localDate()}`);

  const monthMatch = url.pathname.match(/^\/calendar\/(\d{4}-\d{2})\/?$/);
  if (monthMatch) {
    const month = monthMatch[1];
    if (!isValidMonth(month)) return badRequest('That is not a month.');
    const today = localDate();
    return stream({ ...monthShell({ month, today }), version: buildVersion(env), flash }, 'month', async () => {
      const { sittingsByDate } = await diary(bookings, monthWindow(month));
      return monthBody({
        month, weeks: monthGrid(month, sittingsByDate),
        summary: monthSummary(sittingsByDate), today,
      });
    });
  }

  const dayMatch = url.pathname.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (dayMatch) {
    const date = dayMatch[1];
    if (!isValidDate(date)) return badRequest('That is not a date.');
    // The window is the month, not the day. On a wide screen the day sits beside
    // a calendar, and asking for the month costs the same single round trip —
    // the page limit is 100 and a month does not come close — so one query
    // serves both columns rather than the phone paying for a second one.
    const month = localMonth(new Date(`${date}T12:00:00Z`));
    return stream({ ...dayShell({ date }), version: buildVersion(env), flash }, 'day', async () => {
      const { sittingsByDate } = await diary(bookings, monthWindow(month));
      return dayBody({
        date,
        sittings: sittingsByDate.get(date) || [],
        weeks: monthGrid(month, sittingsByDate),
        month,
        today: localDate(),
        back: `/day/${date}`,
      });
    });
  }

  const listMatch = url.pathname.match(/^\/(settle|chase|called-off)\/(\d{4}-\d{2}(?:-\d{2})?)\/?$/);
  if (listMatch) {
    const [, kind, period] = listMatch;
    const monthly = isValidMonth(period);
    if (!monthly && !isValidDate(period)) return badRequest('That is not a date.');
    if (!KINDS[kind]) return notFound();
    return stream({ ...listShell({ kind, period }), version: buildVersion(env), flash }, 'day', async () => {
      const window = monthly ? monthWindow(period) : dayWindow(period);
      const { sittingsByDate } = await diary(bookings, window);
      const sittings = [...sittingsByDate.values()].flat().sort((a, b) => a.startsAt - b.startsAt);
      return listBody({ kind, period, sittings, back: `/${kind}/${period}` });
    });
  }

  const newMatch = url.pathname.match(/^\/new(?:\/(\d{4}-\d{2}-\d{2}))?\/?$/);
  if (newMatch) {
    // The "another date" picker is a GET form, which can only give a query
    // string — so both spellings of the same request land here.
    const date = newMatch[1] || url.searchParams.get('date') || localDate();
    if (!isValidDate(date)) return badRequest('That is not a date.');
    return stream({ ...newShell({ date }), version: buildVersion(env), flash }, 'day', async () => {
      const [{ sittingsByDate }, experiences] = await Promise.all([
        diary(bookings, dayWindow(date)),
        bookings.experiences(),
      ]);
      const sittings = (sittingsByDate.get(date) || []).filter((sitting) => sitting.bookings.length > 0);
      return newBody({ date, today: localDate(), experiences: offerable(experiences), sittings });
    });
  }

  // Handy while setting Access up: confirms who the edge thinks you are.
  if (url.pathname === '/whoami') {
    return json({ email: staff.email, expiresAt: staff.expiresAt.toISOString() });
  }

  return notFound();
}

async function diary(bookings, window) {
  const [reservations, experiences] = await Promise.all([
    bookings.inRange(window),
    bookings.experiences(),
  ]);
  return { sittingsByDate: groupIntoSittings(reservations, experiences) };
}

/**
 * Sends the page in two pieces.
 *
 * The title, the date and the arrows are all known from the URL, so they go out
 * immediately along with a skeleton; the diary follows when Wix answers, half a
 * second later, and a stylesheet riding just ahead of it retires the skeleton.
 * The alternative — waiting for Wix before sending a single byte — leaves the
 * previous screen frozen on the phone with no sign anything is happening.
 *
 * The status line has already gone by the time the body is built, so a failure
 * here can only be reported inside the page rather than as a 502.
 */
function stream(shell, skeletonKind, buildBody) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const write = (text) => writer.write(encoder.encode(text));

  (async () => {
    await write(pageHead(shell) + skeleton(skeletonKind));
    try {
      const body = await buildBody();
      await write(RETIRE_SKELETON + body);
    } catch (error) {
      console.error(error);
      await write(`${RETIRE_SKELETON}<div class="error"><p>Samson could not read from Wix just now.</p>
        <p><code>${escape(error.message || 'unknown error')}</code></p>
        <p>Try again in a moment. The Wix dashboard is unaffected.</p></div>`);
    }
    await write(pageTail());
    await writer.close();
  })().catch((error) => {
    console.error(error);
    writer.abort(error);
  });

  return new Response(readable, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

const PUBLIC_ASSETS = ['/fonts/', '/icons/'];
const PUBLIC_FILES = new Set(['/manifest.webmanifest', '/sw.js', '/offline.html']);

function isPublicAsset(pathname) {
  return PUBLIC_FILES.has(pathname) || PUBLIC_ASSETS.some((prefix) => pathname.startsWith(prefix));
}

/**
 * The deployment id, which changes on every `wrangler deploy`.
 *
 * Stamping it into the worker script means the script's bytes change whenever
 * the app does, which is what makes a browser treat it as a new worker and run
 * the install-activate-claim cycle. Without it a CSS change would ship to the
 * server and sit there, because the worker looked identical.
 */
function buildVersion(env) {
  return env.CF_VERSION_METADATA?.id || 'dev';
}

async function serviceWorker(response, env) {
  const source = (await response.text()).replace('__VERSION__', buildVersion(env));
  return new Response(source, {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      // Must be revalidated on every check, or a stale worker outlives the
      // deploy that was meant to replace it.
      'cache-control': 'no-cache',
    },
  });
}

function withAssetHeaders(response, pathname) {
  const headers = new Headers(response.headers);
  // The worker script must be revalidated or a bad one sticks around; the rest
  // never changes in place, so it can be held for a year.
  headers.set(
    'cache-control',
    pathname === '/sw.js' || pathname === '/manifest.webmanifest'
      ? 'public, max-age=0, must-revalidate'
      : 'public, max-age=31536000, immutable',
  );
  return new Response(response.body, { status: response.status, headers });
}

function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function redirect(location) {
  return new Response(null, { status: 302, headers: { location, 'cache-control': 'no-store' } });
}

/**
 * Two different people read this page.
 *
 * A misconfigured Worker is for whoever is deploying it, and the reason is the
 * whole message. Everything else is a member of staff who has arrived somewhere
 * they did not mean to — usually the origin directly, bypassing the address
 * that would have signed them in — and "no Access assertion on request" tells
 * them nothing they can act on. It stays on the page, quietly, because it is
 * still the first thing worth knowing when something is wrong.
 */
function denied(error) {
  const misconfigured = /is not configured|placeholder/.test(error.message);

  const body = misconfigured
    ? `<div class="error"><p>Samson is not configured: ${escape(error.message)}.</p>
        <p>Set it in <code>wrangler.jsonc</code> and deploy again.</p></div>`
    : `<div class="error"><p>Sign in at <a href="${SAMSON}">${SAMSON.replace('https://', '')}</a>
        and you will be brought straight here.</p>
        <p class="sub">This address does not sign anyone in on its own — ${escape(error.message)}.</p></div>`;

  return html(page({ title: 'Not signed in', heading: 'Not signed in', body }), 403);
}

function badRequest(message) {
  return html(page({ title: 'Not found', heading: 'Hmm', body: `<div class="error"><p>${escape(message)}</p></div>` }), 400);
}

function refused(message) {
  return html(page({
    title: 'Refused',
    heading: 'Refused',
    body: `<div class="error"><p>${escape(message)}</p></div>`,
  }), 403);
}

function notFound() {
  return html(page({
    title: 'Not found',
    heading: 'Nothing here',
    body: '<p class="empty">That page does not exist. <a href="/">Back to the calendar</a>.</p>',
  }), 404);
}

function failed(error) {
  // The message can carry a Wix status, which is the useful part when something
  // upstream is misconfigured. The stack is not for a kitchen wall.
  return html(page({
    title: 'Something went wrong',
    heading: 'Something went wrong',
    body: `<div class="error"><p>Samson could not read from Wix just now.</p>
      <p><code>${escape(error.message || 'unknown error')}</code></p>
      <p>Try again in a moment. The Wix dashboard is unaffected.</p></div>`,
  }), 502);
}
