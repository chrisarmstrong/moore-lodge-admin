import { escape } from './layout.js';
import { dateLabel, shiftDate, localDate, localMonth } from '../time.js';
import { statusLabel, paymentLabel, PAYMENT, STATUS, DISPOSITION } from '../domain.js';

/** The part of the day page that needs no data — flushed while Wix answers. */
export function dayShell({ date }) {
  const previous = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  const today = localDate();
  const month = localMonth(new Date(`${date}T12:00:00Z`));

  const titlebar = `<div class="titlebar">
    <a class="arrow" href="/day/${previous}" rel="prev" aria-label="Previous day">&lsaquo;</a>
    <div class="title">
      <h1>${escape(shortDate(date))}</h1>
      <p class="sub">${date === today ? 'Today' : escape(weekday(date))}</p>
    </div>
    <a class="arrow" href="/day/${next}" rel="next" aria-label="Next day">&rsaquo;</a>
  </div>`;

  // Actions live here rather than as inline text in the subtitle: a link inside
  // a sentence cannot be a 44px target without wrecking the line it sits in.
  const nav = `<nav class="subnav">
    <a href="/calendar/${month}">Month view</a>
    ${date === today ? '' : `<a href="/day/${today}">Jump to today</a>`}
  </nav>`;

  return { title: dateLabel(date), heading: dateLabel(date), titlebar, nav };
}

export function dayBody({ date, sittings }) {
  if (sittings.length === 0) return '<p class="empty">Nothing booked for this day.</p>';

  const totalCovers = sittings.reduce((total, sitting) => total + sitting.covers, 0);
  const toSettle = sittings.reduce((total, sitting) => total + sitting.toSettle, 0);

  const summary = `<p class="daysum">${totalCovers} ${totalCovers === 1 ? 'guest' : 'guests'} across
    ${sittings.length} ${sittings.length === 1 ? 'sitting' : 'sittings'}.</p>
    ${toSettle ? `<a class="cue" href="/settle/${date}">${toSettle} to settle on arrival <span>&rsaquo;</span></a>` : ''}`;

  const body = sittings.map((sitting) => {
    const over = sitting.capacity != null && sitting.covers > sitting.capacity;
    const full = sitting.capacity != null && sitting.covers === sitting.capacity;
    const of = sitting.capacity != null ? ` of ${sitting.capacity}` : '';
    const name = sitting.experience ? sitting.experience.name : 'Reservations';

    return `<section class="sitting">
      <h2>
        <span>${escape(sitting.time)} &middot; ${escape(name)}</span>
        <span class="count${over ? ' over' : full ? ' full' : ''}">${sitting.covers}${escape(of)} guests${over ? ' &middot; over capacity' : ''}</span>
      </h2>
      ${sitting.bookings.map(bookingRow).join('')}
      ${sitting.hidden ? `<p class="swallowed">${sitting.hidden} expired ${sitting.hidden === 1 ? 'attempt' : 'attempts'} not shown — retried successfully, or never named.</p>` : ''}
    </section>`;
  }).join('');

  return summary + body;
}

export function bookingRow(booking) {
  const abandoned = booking.disposition === DISPOSITION.abandoned;
  const inProgress = booking.disposition === DISPOSITION.inProgress;

  const tags = [];
  if (abandoned) tags.push('<span class="tag warn">Abandoned &middot; chase</span>');
  else if (inProgress) tags.push('<span class="tag">In checkout now</span>');
  else if (booking.status !== STATUS.confirmed) {
    tags.push(`<span class="tag">${escape(statusLabel(booking.status))}</span>`);
  }

  if (!abandoned && !inProgress) {
    if (booking.payment === PAYMENT.paid) tags.push('<span class="tag ok">Paid</span>');
    else tags.push(`<span class="tag warn">${escape(paymentLabel(booking.payment))}</span>`);
  }
  if (booking.source !== 'online') tags.push(`<span class="tag">${escape(booking.source)}</span>`);
  if (!booking.email) tags.push('<span class="tag">No email</span>');

  const contact = [];
  if (booking.phone) contact.push(`<a href="tel:${escape(booking.phone)}">${escape(booking.phone)}</a>`);
  if (booking.email) contact.push(`<a href="mailto:${escape(booking.email)}">${escape(booking.email)}</a>`);
  contact.push(`<span class="ref">${escape(booking.reference)}</span>`);

  const notes = booking.notes
    .map((note) => `<p class="note"><b>${escape(note.label)}:</b> ${escape(note.value)}</p>`)
    .join('');

  const teamMessage = booking.teamMessage
    ? `<p class="note"><b>Note to team:</b> ${escape(booking.teamMessage)}</p>`
    : '';

  return `<div class="booking${inProgress ? ' dim' : ''}${abandoned ? ' chase' : ''}">
    <div class="party">${booking.partySize}</div>
    <div class="who">${escape(booking.guestName)}</div>
    <div class="tags">${tags.join('')}</div>
    <details class="reveal">
      <summary>${booking.phone || booking.email ? 'Contact details' : 'Reference'}</summary>
      <div class="contacts">${contact.join('')}</div>
    </details>
    ${notes}${teamMessage}
  </div>`;
}

function weekday(iso) {
  return dateLabel(iso).split(' ')[0];
}

/**
 * "6 August", or "6 August 2025" when the year isn't the obvious one. The
 * weekday sits underneath, so repeating it in the title said the same thing
 * twice in a row that has to fit between two arrows.
 */
function shortDate(iso) {
  const [, day, month, year] = dateLabel(iso).split(' ');
  const thisYear = String(new Date().getFullYear());
  return year === thisYear ? `${day} ${month}` : `${day} ${month} ${year}`;
}
