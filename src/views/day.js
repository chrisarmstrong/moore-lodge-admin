import { escape } from './layout.js';
import { dateLabel, shiftDate, localDate, localMonth } from '../time.js';
import { statusLabel, paymentLabel, PAYMENT, STATUS, DISPOSITION } from '../domain.js';
import { availableFor } from '../actions.js';

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

export function dayBody({ date, sittings, back = `/day/${date}` }) {
  // A sitting only exists because something had that start time. If everything
  // at it was abandoned, there is no sitting to run and an empty card saying so
  // is just noise — the abandoned cue below already accounts for them.
  const real = sittings.filter((sitting) => sitting.bookings.length > 0);
  const abandonedAll = sittings.reduce((total, sitting) => total + sitting.abandoned, 0);
  const offDiary = sittings.reduce((total, sitting) => total + sitting.offDiary, 0);

  if (real.length === 0) {
    const cues = `${abandonedAll ? chaseCue(date, abandonedAll) : ''}${offDiary ? offDiaryCue(date, offDiary) : ''}`;
    return `<p class="empty">Nothing booked for this day.</p>
      ${cues ? `<div class="cues">${cues}</div>` : ''}`;
  }

  const totalCovers = real.reduce((total, sitting) => total + sitting.covers, 0);
  const toSettle = real.reduce((total, sitting) => total + sitting.toSettle, 0);
  const toSettleGuests = real.reduce((total, sitting) => total + sitting.toSettleGuests, 0);

  const summary = `<p class="daysum">${totalCovers} ${totalCovers === 1 ? 'guest' : 'guests'} across
    ${real.length} ${real.length === 1 ? 'sitting' : 'sittings'}.</p>
    ${toSettle || abandonedAll || offDiary ? `<div class="cues">
      ${toSettle ? `<a class="cue" href="/settle/${date}">${toSettle === 1 ? '1 group' : `${toSettle} groups`} to settle
        <span class="cue-sub">${toSettleGuests} ${toSettleGuests === 1 ? 'guest' : 'guests'} &rsaquo;</span></a>` : ''}
      ${abandonedAll ? chaseCue(date, abandonedAll) : ''}
      ${offDiary ? offDiaryCue(date, offDiary) : ''}
    </div>` : ''}`;

  const body = real.map((sitting) => {
    const over = sitting.capacity != null && sitting.covers > sitting.capacity;
    const full = sitting.capacity != null && sitting.covers === sitting.capacity;
    const of = sitting.capacity != null ? ` of ${sitting.capacity}` : '';
    const name = sitting.experience ? sitting.experience.name : 'Reservations';

    return `<section class="sitting">
      <h2>
        <span>${escape(sitting.time)} &middot; ${escape(name)}</span>
        <span class="count${over ? ' over' : full ? ' full' : ''}">${sitting.covers}${escape(of)} guests${over ? ' &middot; over capacity' : ''}</span>
      </h2>
      ${sitting.bookings.map((booking) => bookingRow(booking, back)).join('')}
    </section>`;
  }).join('');

  return summary + body;
}

export function bookingRow(booking, back = '/') {
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
  // How the booking arrived changes nothing anybody does about it, and it was
  // a third chip on most rows. Whether they can be emailed does matter.
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
    <div class="line">
      <span class="who">${escape(booking.guestName)}</span>
      <span class="tags">${tags.join('')}</span>
    </div>
    <details class="reveal">
      <summary>Details</summary>
      <div class="contacts">${contact.join('')}</div>
      ${actions(booking, back)}
    </details>
    ${notes}${teamMessage}
  </div>`;
}

/**
 * The way back from a mis-tapped "No show". It is quiet because on most days it
 * is a footnote, and it is always there when the count isn't zero because the
 * booking it leads to appears nowhere else at all.
 */
function offDiaryCue(date, count) {
  return `<a class="cue quiet" href="/called-off/${date}">${count === 1 ? '1 called off' : `${count} called off`}
    <span class="cue-sub">cancelled or a no show &rsaquo;</span></a>`;
}

function chaseCue(date, count) {
  return `<a class="cue quiet" href="/chase/${date}">${count === 1 ? '1 abandoned' : `${count} abandoned`}
    <span class="cue-sub">not in the diary &rsaquo;</span></a>`;
}

/**
 * Anything that changes a booking lives behind the same tap as the contact
 * details, so a pocket cannot reach it, and anything with consequences asks
 * once more before it happens.
 */
function actions(booking, back) {
  const available = availableFor(booking);
  if (available.length === 0) return '';

  return `<div class="actions">${available.map((action) => {
    const form = `<form method="post" action="/booking/${escape(booking.id)}/${escape(action.name)}">
      <input type="hidden" name="back" value="${escape(back)}">
      <button type="submit" class="act${action.confirm ? ' grave' : ''}">${escape(action.label)}</button>
    </form>`;

    if (!action.confirm) return form;
    return `<details class="ask">
      <summary>${escape(action.label)}</summary>
      <p>${escape(action.confirm)}</p>
      ${form}
    </details>`;
  }).join('')}</div>`;
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
