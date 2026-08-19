import { page, escape } from './layout.js';
import { dateLabel, shiftDate, localDate, localMonth } from '../time.js';
import { statusLabel, paymentLabel, isInFlight, PAYMENT, STATUS } from '../domain.js';

export function dayView({ date, sittings }) {
  const previous = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  const today = localDate();

  const nav = `<nav class="nav">
    <a href="/day/${previous}" rel="prev">&larr; Previous day</a>
    ${date === today ? '<span class="here">Today</span>' : `<a href="/day/${today}">Today</a>`}
    <a href="/day/${next}" rel="next">Next day &rarr;</a>
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
    const full = sitting.capacity != null && sitting.covers >= sitting.capacity;
    const of = sitting.capacity != null ? ` of ${sitting.capacity}` : '';
    const name = sitting.experience ? sitting.experience.name : 'Reservations';

    return `<section class="sitting">
      <h2>
        <span>${escape(sitting.time)} &middot; ${escape(name)}</span>
        <span class="count${full ? ' full' : ''}">${sitting.covers}${escape(of)} guests</span>
      </h2>
      ${sitting.bookings.map(bookingRow).join('')}
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
  const tags = [];
  if (booking.status !== STATUS.confirmed) {
    tags.push(`<span class="tag${isInFlight(booking) ? ' warn' : ''}">${escape(statusLabel(booking.status))}</span>`);
  }
  if (booking.payment === PAYMENT.paid) tags.push('<span class="tag ok">Paid</span>');
  else tags.push(`<span class="tag warn">${escape(paymentLabel(booking.payment))}</span>`);
  if (booking.source !== 'online') tags.push(`<span class="tag">${escape(booking.source)}</span>`);

  const contact = [];
  if (booking.phone) contact.push(`<a href="tel:${escape(booking.phone)}">${escape(booking.phone)}</a>`);
  if (booking.email) contact.push(`<a href="mailto:${escape(booking.email)}">${escape(booking.email)}</a>`);
  else contact.push('<span>No email</span>');
  contact.push(`<span>${escape(booking.reference)}</span>`);

  const notes = booking.notes
    .map((note) => `<p class="note"><b>${escape(note.label)}:</b> ${escape(note.value)}</p>`)
    .join('');

  const teamMessage = booking.teamMessage
    ? `<p class="note"><b>Note to team:</b> ${escape(booking.teamMessage)}</p>`
    : '';

  return `<div class="booking${isInFlight(booking) ? ' dim' : ''}">
    <div class="party">${booking.partySize}</div>
    <div class="who">${escape(booking.guestName)}</div>
    <div class="meta">${contact.join('')}${tags.join('')}</div>
    ${notes}${teamMessage}
  </div>`;
}
