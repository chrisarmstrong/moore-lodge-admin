/**
 * The two lists you reach by tapping a number on the month or day.
 *
 * A count on a tile is only useful if it leads to the people behind it — "99 to
 * settle on arrival" is a fact, "here they are, with their phone numbers" is
 * something somebody can act on before service.
 */

import { escape } from './layout.js';
import { dateLabel, monthLabel, localTime, localDate, isValidMonth } from '../time.js';
import { PAYMENT, DISPOSITION, holdsASeat } from '../domain.js';
import { bookingRow } from './day.js';

export const KINDS = {
  settle: {
    title: 'To settle on arrival',
    blurb: 'Booked and unpaid — most of these are phone bookings that pay on the day.',
    empty: 'Everybody has paid.',
    keep: (booking) => holdsASeat(booking) && booking.payment === PAYMENT.unpaid,
  },
  chase: {
    title: 'Abandoned bookings',
    blurb: 'Reached the payment step, gave up, and never came back. They left a way to reach them.',
    empty: 'Nothing abandoned.',
    keep: (booking) => booking.disposition === DISPOSITION.abandoned,
  },
};

export function listShell({ kind, period }) {
  const { title } = KINDS[kind];
  const label = isValidMonth(period) ? monthLabel(period) : dateLabel(period);
  const back = isValidMonth(period) ? `/calendar/${period}` : `/day/${period}`;

  const titlebar = `<div class="titlebar">
    <a class="arrow" href="${back}" aria-label="Back">&lsaquo;</a>
    <div class="title">
      <h1>${escape(title)}</h1>
      <p class="sub">${escape(label)}</p>
    </div>
    <span></span>
  </div>`;

  return { title: `${title} · ${label}`, heading: title, titlebar, nav: '' };
}

export function listBody({ kind, sittings }) {
  const { keep, blurb, empty } = KINDS[kind];

  const groups = [];
  for (const sitting of sittings) {
    const matched = sitting.bookings.filter(keep);
    if (matched.length) groups.push({ sitting, matched });
  }

  if (groups.length === 0) return `<p class="empty">${escape(empty)}</p>`;

  const guests = groups.reduce(
    (total, group) => total + group.matched.reduce((n, booking) => n + booking.partySize, 0), 0,
  );

  return `<p class="daysum">${guests} ${guests === 1 ? 'guest' : 'guests'} across
    ${groups.length} ${groups.length === 1 ? 'sitting' : 'sittings'}. ${escape(blurb)}</p>
    ${groups.map(({ sitting, matched }) => `<section class="sitting">
      <h2>
        <span>${escape(dateLabel(localDate(sitting.startsAt)))}</span>
        <span class="count">${escape(localTime(sitting.startsAt))}</span>
      </h2>
      ${matched.map(bookingRow).join('')}
    </section>`).join('')}`;
}
