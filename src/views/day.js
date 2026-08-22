import { escape, ahead, BED } from './layout.js';
import { dateLabel, shiftDate, localDate, localMonth, WEEKDAY_INITIALS } from '../time.js';
import {
  statusLabel, paymentLabel, roomStateLabel, needsAttention,
  PAYMENT, STATUS, DISPOSITION, ROOM,
} from '../domain.js';
import { availableFor, permits, NOTE_LIMIT } from '../actions.js';

/** The part of the day page that needs no data — flushed while Wix answers. */
export function dayShell({ date }) {
  const previous = shiftDate(date, -1);
  const next = shiftDate(date, 1);
  const today = localDate();
  const month = localMonth(new Date(`${date}T12:00:00Z`));
  // The day beyond each arrow, which is that page's own far arrow — the near
  // one is this page. Between them a tap paints a working title bar at once,
  // so a thumb held on "next" walks the dates instead of waiting on each one.
  const before = shiftDate(date, -2);
  const after = shiftDate(date, 2);

  const titlebar = `<div class="titlebar">
    <a class="arrow" href="/day/${previous}" rel="prev" aria-label="Previous day"
      ${ahead({
    title: shortDate(previous), sub: previous === today ? 'Today' : weekday(previous),
    prev: `/day/${before}`, next: `/day/${date}`,
  })}>&lsaquo;</a>
    <div class="title">
      <h1>${escape(shortDate(date))}</h1>
      <p class="sub">${date === today ? 'Today' : escape(weekday(date))}</p>
    </div>
    <a class="arrow" href="/day/${next}" rel="next" aria-label="Next day"
      ${ahead({
    title: shortDate(next), sub: next === today ? 'Today' : weekday(next),
    prev: `/day/${date}`, next: `/day/${after}`,
  })}>&rsaquo;</a>
  </div>`;

  // Actions live here rather than as inline text in the subtitle: a link inside
  // a sentence cannot be a 44px target without wrecking the line it sits in.
  const nav = `<nav class="subnav">
    <a href="/calendar/${month}">Month view</a>
    ${date === today ? '' : `<a href="/day/${today}">Jump to today</a>`}
  </nav>`;

  // The day carries a month beside it on a wide screen, so it wants the room.
  return { title: dateLabel(date), heading: dateLabel(date), titlebar, nav, wide: true, split: true, add: date };
}

export function dayBody({ date, sittings, rooms = null, weeks = null, month = null, today = null, back = `/day/${date}` }) {
  // Siblings of the titlebar rather than wrapped in it: `main` is the grid, so
  // the date and its arrows land in the same column as the calendar they drive
  // — and they still go out with the first flush, long before Wix answers.
  const now = today || localDate();
  const planner = weeks ? plannerColumn({ weeks, month, date, today: now }) : '';
  return `${planner}<div class="detail">${dayDetail({ date, sittings, rooms, now, back })}</div>`;
}

/**
 * The month, beside the day, on a screen with room for both.
 *
 * It is navigation first: at this size a cell is about 40px, so it carries the
 * date and a hint of how loaded the day is, and the month view proper is still
 * where the numbers are read. CSS decides whether it appears — the server
 * cannot know the viewport, and the markup is small enough that sending it to a
 * phone that will not show it costs less than a second request would.
 */
function plannerColumn({ weeks, month, date, today }) {
  const header = WEEKDAY_INITIALS.map((initial) => `<div class="pdow">${initial}</div>`).join('');

  const cells = weeks.flat().map((cell) => {
    if (cell.outside) return '<div class="pcell outside"></div>';

    const classes = ['pcell'];
    if (cell.date === date) classes.push('here');
    if (cell.date === today) classes.push('now');
    if (cell.covers > 0) classes.push('busy');

    const load = cell.covers > 0 ? `<span class="pcovers">${cell.covers}</span>` : '';
    const label = `${dateLabel(cell.date)}${cell.covers ? `, ${cell.covers} guests` : ', nothing booked'}`;

    // Named, like the arrows: on a landscape tablet this grid is how a date is
    // usually changed, and a shimmering title beside a live one reads as a
    // fault. Its arrows are left to the shell — a cell is not a step along a
    // line, and naming both ends of every one of them is 35 days of attributes
    // for the tenth of a second before the real bar lands.
    return `<a class="${classes.join(' ')}" href="/day/${cell.date}" aria-label="${escape(label)}"
      ${ahead({ title: shortDate(cell.date), sub: cell.date === today ? 'Today' : weekday(cell.date) })}
      ${cell.date === date ? 'aria-current="page"' : ''}><span class="pn">${cell.day}</span>${load}</a>`;
  }).join('');

  return `<aside class="planner" aria-label="This month">
    <div class="pgrid">${header}${cells}</div>
    <a class="pall" href="/calendar/${month}">Whole month &rsaquo;</a>
  </aside>`;
}

function dayDetail({ date, sittings, rooms, now, back }) {
  // A sitting only exists because something had that start time. If everything
  // at it was abandoned, there is no sitting to run and an empty card saying so
  // is just noise — the abandoned cue below already accounts for them.
  const real = sittings.filter((sitting) => sitting.bookings.length > 0);
  const abandonedAll = sittings.reduce((total, sitting) => total + sitting.abandoned, 0);
  const offDiary = sittings.reduce((total, sitting) => total + sitting.offDiary, 0);

  if (real.length === 0) {
    const cues = `${abandonedAll ? chaseCue(date, abandonedAll) : ''}${offDiary ? offDiaryCue(date, offDiary) : ''}`;
    // A day with no sittings is not an empty day. Somebody may still be asleep
    // upstairs, and the room strip is the whole reason they would find out.
    return `<p class="empty">Nothing booked in for tea or dinner.</p>
      ${cues ? `<div class="cues">${cues}</div>` : ''}
      ${roomsPanel(rooms, date, now)}`;
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

  // Upstairs comes before the sittings: it is short, and it is what somebody
  // opening this page at seven in the morning came to read.
  return summary + roomsPanel(rooms, date, now) + body;
}

/**
 * The rooms, for the person who has to make them up.
 *
 * Only rows worth a morning are listed. A free room needs nobody, and eleven
 * lines of "Free" would bury the three that matter — but a room emptied this
 * morning is listed even though nobody is in it tonight, because stripping it
 * is exactly the job.
 *
 * The note at the bottom is not decoration. This is availability, not a booking
 * list: two stays back to back in one room look like one stay, so a changeover
 * can be real and invisible here. Anyone planning a day off the screen has to
 * know that, and the place to tell them is the screen.
 */
function roomsPanel(rooms, date, now) {
  if (!rooms) {
    // A night already behind us and a freetobook that fell over are not the
    // same absence, and telling somebody the system is broken when it simply
    // cannot look backwards would send them off to fix nothing.
    const why = date < now
      ? `freetobook's availability only looks forward, so who was in which room that
         night is not something it will say.`
      : `freetobook did not answer, so tonight's rooms are not shown.
         The diary above is unaffected.`;
    return `<section class="rooms">
      <h2><span>Rooms</span></h2>
      <p class="fineprint">${why}</p>
    </section>`;
  }

  const listed = rooms.rooms.filter(needsAttention);

  const house = rooms.wholeHouse
    ? `<p class="wholehouse">${BED} <span><b>Whole house</b> &mdash; exclusive use is booked,
       so every bedroom is in play.</span></p>`
    : '';

  // A night the lodge has taken off sale entirely comes back as every room
  // closed out, one row each. Eleven identical lines say the same thing eleven
  // times and bury the one fact worth reading, which is that it is shut.
  const shut = rooms.rooms.length > 0
    && listed.length === rooms.rooms.length
    && listed.every((room) => room.state === ROOM.closed);

  const body = shut
    ? '<p class="wholehouse"><span>Closed out &mdash; nothing upstairs is on sale for this night.</span></p>'
    : listed.length
      ? listed.map(roomRow).join('')
      : '<p class="empty">Nobody staying, nothing to turn round.</p>';

  // The one gap worth interrupting for. Today is the first night the feed
  // covers, so last night is not in it — and a room emptied this morning is
  // therefore indistinguishable from one nobody had booked at all.
  const blindSpot = rooms.priorKnown ? '' : `<p class="fineprint">The feed starts tonight,
    so this morning's changeovers are not in it: a room emptied today reads as free, and
    a guest arriving today reads the same as one already here.</p>`;

  return `<section class="rooms">
    <h2>
      <span>Rooms</span>
      <span class="count">${rooms.occupied} of ${rooms.lettable} let${rooms.departures
        ? ` &middot; ${rooms.departures} to turn round` : ''}</span>
    </h2>
    ${house}${body}${blindSpot}
    <p class="fineprint">From freetobook's availability, which shows whether a room is
      taken and not who is in it. Two stays back to back in the same room read as one,
      so a changeover can be missed &mdash; check freetobook before stripping a bed.</p>
  </section>`;
}

function roomRow(room) {
  const tone = room.state === ROOM.arriving ? ' arriving'
    : room.state === ROOM.departed ? ' departed'
    : room.state === ROOM.maintenance || room.state === ROOM.closed ? ' blocked'
    : '';
  const said = room.state === ROOM.departed ? 'Departed this morning'
    : room.state === ROOM.arriving ? 'Arriving today'
    : room.state === ROOM.staying ? 'Staying tonight'
    : roomStateLabel(room.state);

  return `<div class="roomrow">
    <span class="rname">${escape(room.name)}
      <span class="rgroup">${room.group === 'cottages' ? 'Cottage' : 'Bedroom'}</span>
    </span>
    <span class="rtag${tone}">${escape(said)}</span>
  </div>`;
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

  // Notes come before the disclosure, not after it. They are the reason somebody
  // opens this page in a kitchen, so they stay in the open and stay put; a
  // control that pushed them down the card every time it was opened made the
  // one thing that must not move the one thing that moved.
  return `<div class="booking${inProgress ? ' dim' : ''}${abandoned ? ' chase' : ''}">
    <div class="party">${booking.partySize}</div>
    <div class="line">
      <span class="who">${escape(booking.guestName)}</span>
      <span class="tags">${tags.join('')}</span>
    </div>
    ${notes}${teamMessage}
    <details class="reveal">
      <summary>Details</summary>
      <div class="contacts">${contact.join('')}</div>
      ${actions(booking, back)}
      ${noteField(booking, back)}
    </details>
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

/**
 * The team's own note, and the only writing here that is prose.
 *
 * It is deliberately not the guest's answers above it. Those are what the guest
 * said about their own allergies, and a back office that can quietly rewrite
 * them is a back office that can put words in a guest's mouth about something
 * that matters. A change phoned in later belongs here, beside what they
 * originally said, not on top of it.
 */
function noteField(booking, back) {
  if (!permits(booking, 'note')) return '';
  const id = `note-${escape(booking.id)}`;

  return `<form class="notefield" method="post" action="/booking/${escape(booking.id)}/note">
    <label for="${id}">Note to team</label>
    <textarea id="${id}" name="note" rows="2" maxlength="${NOTE_LIMIT}"
      placeholder="Anything the team should know">${escape(booking.teamMessage || '')}</textarea>
    <input type="hidden" name="back" value="${escape(back)}">
    <button type="submit" class="act">Save note</button>
  </form>`;
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
