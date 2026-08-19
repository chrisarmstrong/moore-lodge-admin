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
    // Reads the diary: these are real bookings that owe money.
    from: (sitting) => sitting.bookings,
    keep: (booking) => holdsASeat(booking) && booking.payment === PAYMENT.unpaid,
  },
  chase: {
    title: 'Abandoned bookings',
    blurb: 'Reached the payment step, gave up, and never came back. They left a way to reach them, '
      + 'and they are deliberately kept off the diary — nobody is expecting them.',
    empty: 'Nothing abandoned.',
    // The only view that reads the attempts that never became bookings.
    from: (sitting) => sitting.unfinished,
    keep: (booking) => booking.disposition === DISPOSITION.abandoned,
  },
  'called-off': {
    title: 'Called off',
    blurb: 'Cancelled, declined or marked a no show. They are off the diary and out of the counts — '
      + 'put one back if the tap was a mistake.',
    empty: 'Nothing called off.',
    // The bookings a person took off the diary, kept where they can be found.
    from: (sitting) => sitting.calledOff,
    keep: () => true,
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

export function listBody({ kind, period, sittings, back = '/' }) {
  const { keep, from, blurb, empty } = KINDS[kind];

  const groups = [];
  for (const sitting of sittings) {
    const matched = from(sitting).filter(keep);
    if (matched.length) groups.push({ sitting, matched });
  }

  // Superseded and stale attempts are dropped everywhere. Saying how many keeps
  // this page honest about being a filtered view rather than the whole truth.
  const dropped = sittings.reduce((total, sitting) => total + sitting.hidden, 0);
  const footnote = kind === 'chase' && dropped
    ? `<p class="swallowed">${dropped} further ${dropped === 1 ? 'attempt is' : 'attempts are'} not listed:
       they were retried successfully, or never got as far as a name.</p>`
    : '';

  if (groups.length === 0) return `<p class="empty">${escape(empty)}</p>`;

  const guests = groups.reduce(
    (total, group) => total + group.matched.reduce((n, booking) => n + booking.partySize, 0), 0,
  );

  // On a single day the date is in the subtitle already, so repeating it on
  // every heading just pushes the names down. Over a month it is the only thing
  // that says which day a 12:30 sitting is — and asking the rows how many days
  // they cover gets that wrong the moment a month happens to have one busy day.
  const dated = isValidMonth(period);

  // Two sittings on the same afternoon under two identical date headings reads
  // as two days. The date is a rule over the day's sittings, written once; the
  // sitting heading stays the time, exactly as it is on the day page.
  let written = null;

  return `<p class="daysum">${guests} ${guests === 1 ? 'guest' : 'guests'} across
    ${groups.length} ${groups.length === 1 ? 'sitting' : 'sittings'}. ${escape(blurb)}</p>
    ${groups.map(({ sitting, matched }) => {
    const day = localDate(sitting.startsAt);
    const rule = dated && day !== written ? `<h2 class="dayrule">${escape(withoutYear(dateLabel(day)))}</h2>` : '';
    written = day;

    return `${rule}<section class="sitting">
      <h2><span>${escape(localTime(sitting.startsAt))}</span></h2>
      ${matched.map((booking) => bookingRow(booking, back)).join('')}
    </section>`;
  }).join('')}
    ${footnote}`;
}

/** The year is already in the subtitle; a month list never crosses one. */
function withoutYear(label) {
  return label.split(' ').slice(0, 3).join(' ');
}
