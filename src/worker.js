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
import { monthView } from './views/month.js';
import { dayView } from './views/day.js';
import { page, escape } from './views/layout.js';
import {
  localDate, localMonth, monthWindow, dayWindow, isValidMonth, isValidDate,
} from './time.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Fonts and the like are public; everything else needs a person behind it.
    if (url.pathname.startsWith('/fonts/')) {
      return env.ASSETS ? env.ASSETS.fetch(request) : notFound();
    }

    let staff;
    try {
      staff = await authenticate(request, env);
    } catch (error) {
      if (error instanceof AccessError) return denied(error);
      throw error;
    }

    try {
      return await route(url, env, staff);
    } catch (error) {
      console.error(error);
      return failed(error);
    }
  },
};

async function route(url, env, staff) {
  const bookings = new WixBookings(env);

  if (url.pathname === '/' || url.pathname === '') {
    return redirect(`/calendar/${localMonth()}`);
  }

  const monthMatch = url.pathname.match(/^\/calendar\/(\d{4}-\d{2})\/?$/);
  if (monthMatch) {
    const month = monthMatch[1];
    if (!isValidMonth(month)) return badRequest('That is not a month.');
    return html(await renderMonth(bookings, month));
  }

  const dayMatch = url.pathname.match(/^\/day\/(\d{4}-\d{2}-\d{2})\/?$/);
  if (dayMatch) {
    const date = dayMatch[1];
    if (!isValidDate(date)) return badRequest('That is not a date.');
    return html(await renderDay(bookings, date));
  }

  // Handy while setting Access up: confirms who the edge thinks you are.
  if (url.pathname === '/whoami') {
    return json({ email: staff.email, expiresAt: staff.expiresAt.toISOString() });
  }

  return notFound();
}

async function renderMonth(bookings, month) {
  const [reservations, experiences] = await Promise.all([
    bookings.inRange(monthWindow(month)),
    bookings.experiences(),
  ]);

  const sittingsByDate = groupIntoSittings(reservations, experiences);
  return monthView({
    month,
    weeks: monthGrid(month, sittingsByDate),
    summary: monthSummary(sittingsByDate),
    today: localDate(),
  });
}

async function renderDay(bookings, date) {
  const [reservations, experiences] = await Promise.all([
    bookings.inRange(dayWindow(date)),
    bookings.experiences(),
  ]);

  const sittingsByDate = groupIntoSittings(reservations, experiences);
  return dayView({ date, sittings: sittingsByDate.get(date) || [] });
}

function html(markup, status = 200) {
  return new Response(markup, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
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

function denied(error) {
  return html(page({
    title: 'Not signed in',
    heading: 'Not signed in',
    body: `<div class="error"><p>${escape(error.message)}.</p>
      <p>Samson sits behind Cloudflare Access. Open it at its own address and sign in with your Moore Lodge email.</p></div>`,
  }), 403);
}

function badRequest(message) {
  return html(page({ title: 'Not found', heading: 'Hmm', body: `<div class="error"><p>${escape(message)}</p></div>` }), 400);
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
