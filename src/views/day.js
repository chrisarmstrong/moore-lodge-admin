import { page, escape } from './layout.js';
import { dateLabel, shiftDate, localDate, localMonth } from '../time.js';
import { statusLabel, paymentLabel, PAYMENT, STATUS, DISPOSITION } from '../domain.js';

export function dayView({ date, sittings }) {
  const previous = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  const today = localDate();

  const nav = `<nav class="nav">
    <a href="/day/${previous}" rel="prev" aria-label="Previous day">&larr;<span class="long"> Previous day</span></a>
    ${date === today ? '<span class="here">Today</span>' : `<a href="/day/${today}">Today</a>`}
    <a href="/day/${next}" rel="next" aria-label="Next day"><span class="long">Next day </span>&rarr;</a>
    <span class="spacer"></span>
    <a href="/calendar/${localMonth(new Date(`${date}T12:00:00Z`))}">Month</a>
  </nav>`;

  if (sittings.length === 0) {
    return page({
      title: dateLabel(date),
      heading: dateLabel(date),
      nav,
      body: '<p class="empty">Nothing booked for this day.</p>',
    });
  }

  const totalCovers = sittings.reduce((total, sitting) => total + sitting.covers, 0);

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

  return page({
    title: dateLabel(date),
    heading: dateLabel(date),
    sub: `${totalCovers} ${totalCovers === 1 ? 'guest' : 'guests'} across ${sittings.length} ${sittings.length === 1 ? 'sitting' : 'sittings'}.`,
    nav,
    body,
  });
}

function bookingRow(booking) {
  const abandoned = booking.disposition === DISPOSITION.abandoned;
  const inProgress = booking.disposition === DISPOSITION.inProgress;

  const tags = [];
  if (abandoned) tags.push('<span class="tag warn">Abandoned &middot; chase</span>');
  else if (inProgress) tags.push('<span class="tag">In checkout now</span>');
  else if (booking.status !== STATUS.confirmed) {
    tags.push(`<span class="tag">${escape(statusLabel(booking.status))}</span>`);
  }

  // An abandoned attempt was never paid for by definition; saying so twice adds
  // nothing next to the label that already explains it.
  if (!abandoned && !inProgress) {
    if (booking.payment === PAYMENT.paid) tags.push('<span class="tag ok">Paid</span>');
    else tags.push(`<span class="tag warn">${escape(paymentLabel(booking.payment))}</span>`);
  }
  if (booking.source !== 'online') tags.push(`<span class="tag">${escape(booking.source)}</span>`);

  // Only things worth aiming a thumb at become chips. The reference and the
  // absence of an email are facts to read, not buttons to press, so they sit
  // with the tags rather than taking a row each.
  const contact = [];
  if (booking.phone) contact.push(`<a href="tel:${escape(booking.phone)}">${escape(booking.phone)}</a>`);
  if (booking.email) contact.push(`<a href="mailto:${escape(booking.email)}">${escape(booking.email)}</a>`);
  if (!booking.email) tags.push('<span class="tag">No email</span>');
  tags.push(`<span class="ref">${escape(booking.reference)}</span>`);

  const notes = booking.notes
    .map((note) => `<p class="note"><b>${escape(note.label)}:</b> ${escape(note.value)}</p>`)
    .join('');

  const teamMessage = booking.teamMessage
    ? `<p class="note"><b>Note to team:</b> ${escape(booking.teamMessage)}</p>`
    : '';

  return `<div class="booking${inProgress ? ' dim' : ''}${abandoned ? ' chase' : ''}">
    <div class="party">${booking.partySize}</div>
    <div class="who">${escape(booking.guestName)}</div>
    ${contact.length ? `<div class="contacts">${contact.join('')}</div>` : ''}
    <div class="tags">${tags.join('')}</div>
    ${notes}${teamMessage}
  </div>`;
}
