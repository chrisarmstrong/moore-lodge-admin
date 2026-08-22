import { escape, ahead, BED } from './layout.js';
import { monthLabel, shiftMonth, localMonth, WEEKDAY_INITIALS } from '../time.js';

/** The part of the month page that needs no data — flushed while Wix answers. */
export function monthShell({ month, today }) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const thisMonth = localMonth();
  // The month either side of the one an arrow leads to: it is that page's own
  // pair of arrows, so a tap can put a working title bar up straight away
  // rather than leaving the header dead until Cloudflare answers.
  const before = shiftMonth(month, -2);
  const after = shiftMonth(month, 2);

  const titlebar = `<div class="titlebar">
    <a class="arrow" href="/calendar/${previous}" rel="prev" aria-label="${escape(monthLabel(previous))}"
      ${ahead({ title: monthLabel(previous), prev: `/calendar/${before}`, next: `/calendar/${month}` })}>&lsaquo;</a>
    <div class="title">
      <h1>${escape(monthLabel(month))}</h1>
    </div>
    <a class="arrow" href="/calendar/${next}" rel="next" aria-label="${escape(monthLabel(next))}"
      ${ahead({ title: monthLabel(next), prev: `/calendar/${month}`, next: `/calendar/${after}` })}>&rsaquo;</a>
  </div>`;

  const nav = `<nav class="subnav">
    <a href="/day/${today}">Today's covers</a>
    ${month === thisMonth ? '' : `<a href="/calendar/${thisMonth}">This month</a>`}
  </nav>`;

  // The calendar grid wants the full width; the reading views do not.
  return { title: monthLabel(month), heading: monthLabel(month), titlebar, nav, wide: true, add: today };
}

/** The part that waits on the diary. */
export function monthBody({ month, weeks, summary, rooms = null, today }) {
  const stats = `<div class="stats">
    <div class="stat"><b>${summary.covers}</b><span>Guests booked</span></div>
    <div class="stat"><b>${summary.occupancy == null ? '—' : `${summary.occupancy}%`}</b><span>Of seats offered</span></div>
    ${tile(`/chase/${month}`, summary.abandoned, withGuests('Abandoned', summary.abandonedGuests), true)}
    ${tile(`/settle/${month}`, summary.toSettle, withGuests('Groups to settle', summary.toSettleGuests), false)}
    ${tile(`/called-off/${month}`, summary.offDiary, withGuests('Called off', summary.offDiaryGuests), false)}
    ${roomsTile(rooms, month)}
  </div>`;

  const header = WEEKDAY_INITIALS.map((initial) => `<div class="dow">${initial}</div>`).join('');

  const cells = weeks.flat().map((cell) => {
    if (cell.outside) return '<div class="cell outside"></div>';

    // Same rule as the day: a sitting nobody actually booked is not a sitting.
    const real = cell.sittings.filter((sitting) => sitting.bookings.length > 0);

    const classes = ['cell'];
    if (cell.covers > 0) classes.push('busy');
    if (cell.date === today) classes.push('today');

    const pills = real.map((sitting) => {
      const pillClass = ['pill'];
      if (sitting.covers === 0) {
        pillClass.push('pending');
        const waiting = sitting.abandoned ? `${sitting.abandoned} lost`
          : sitting.inProgress ? `${sitting.inProgress} in checkout` : 'nothing held';
        return `<span class="${pillClass.join(' ')}">${escape(sitting.time)} <b>${escape(waiting)}</b></span>`;
      }
      if (sitting.capacity != null && sitting.covers > sitting.capacity) pillClass.push('over');
      else if (sitting.capacity != null && sitting.covers >= sitting.capacity) pillClass.push('full');
      else if (sitting.abandoned) pillClass.push('unpaid');
      const of = sitting.capacity != null ? `/${sitting.capacity}` : '';
      return `<span class="${pillClass.join(' ')}">${escape(sitting.time)} <b>${sitting.covers}${of}</b></span>`;
    }).join('');

    // On a phone the day carries one filled badge — how many people — rather
    // than a second bare number that reads like another date.
    const compact = real.length
      ? `<span class="compact"><span class="covers ${dayState(real, cell.covers)}">${cell.covers}</span></span>`
      : '';

    return `<div class="${classes.join(' ')}">
      <span class="n">${cell.day}</span>
      ${beds(cell.rooms)}
      ${pills}${compact}
      <a class="open" href="/day/${cell.date}" aria-label="${escape(cell.date)}${cell.covers ? `, ${cell.covers} guests` : ', nothing booked'}${roomsSaid(cell.rooms)}"></a>
    </div>`;
  }).join('');

  return `${stats}
  <div class="grid">${header}${cells}</div>
  ${summary.sittings === 0 ? '<p class="empty">No bookings this month.</p>' : ''}`;
}

/**
 * How many rooms are being slept in, tucked into the corner of the cell.
 *
 * It is a badge rather than another pill because the pills are the diary and
 * this is not — and because on a phone the cell has room for one date, one
 * circle and nothing else. Positioned out of the flow, it costs no height at
 * either size, which is the only way it fits a 45px column.
 *
 * A night with nobody upstairs shows nothing at all. The absence is the number.
 */
function beds(rooms) {
  if (!rooms || rooms.occupied === 0) return '';
  const label = rooms.wholeHouse ? 'whole house' : `${rooms.occupied} of ${rooms.lettable} rooms let`;
  return `<span class="beds${rooms.wholeHouse ? ' whole' : ''}" title="${escape(label)}">${BED}${rooms.occupied}</span>`;
}

/** The same fact, for whoever is hearing the cell rather than seeing it. */
function roomsSaid(rooms) {
  if (!rooms || rooms.occupied === 0) return '';
  if (rooms.wholeHouse) return ', whole house booked';
  return `, ${rooms.occupied} ${rooms.occupied === 1 ? 'room' : 'rooms'} let`;
}

/**
 * The month upstairs, in one figure.
 *
 * A dash rather than a zero when freetobook has not answered: an empty house
 * and an unanswered question look nothing alike to anybody planning a week.
 *
 * The label stays to one line. It shared a row with five other tiles and every
 * clause that earned its place there — the percentage, and the date the count
 * really starts from — costs the tile beside it a wrap. Whole-house nights are
 * left out because the grid already fills those cells in.
 */
function roomsTile(rooms, month) {
  if (!rooms) return `<div class="stat quiet"><b>&mdash;</b><span>Room nights let</span></div>`;
  const share = rooms.occupancy == null ? '' : ` &middot; ${rooms.occupancy}%`;
  // Said out loud when the count does not cover the whole month, which it never
  // does for the month in progress: freetobook will not look backwards, so the
  // nights already gone are missing rather than empty.
  const span = rooms.from && rooms.from !== `${month}-01`
    ? ` &middot; from ${Number(rooms.from.slice(8))} ${MONTH_SHORT[Number(month.slice(5, 7)) - 1]}`
    : '';
  return `<div class="stat${rooms.roomNights ? '' : ' quiet'}">
    <b>${rooms.roomNights}</b><span>Room nights let${share}${span}</span>
  </div>`;
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The tile's number is a count of groups; the label names the unit and adds the
 * head count. It must not repeat the number — "2 / To settle on arrival · 2
 * groups, 13 guests" said the same two twice and wrapped onto a second line.
 */
function withGuests(label, guests) {
  if (!guests) return label;
  return `${label} · ${guests} ${guests === 1 ? 'guest' : 'guests'}`;
}

/** Colour carries what the row of dots used to say. */
function dayState(sittings, covers) {
  const withCapacity = sittings.filter((s) => s.capacity != null);
  if (withCapacity.some((s) => s.covers > s.capacity)) return 'over';
  if (covers === 0) return 'none';
  if (withCapacity.length && withCapacity.every((s) => s.covers >= s.capacity)) return 'full';
  return '';
}

/**
 * A number nobody can act on is just decoration. A zero is exactly that — there
 * is nobody behind it — so it stays in place for the shape of the row but drops
 * the chevron and the link colour that invite a tap onto an empty page.
 */
function tile(href, value, label, flag) {
  if (!value) return `<div class="stat quiet"><b>${value}</b><span>${escape(label)}</span></div>`;
  return `<a class="stat link${flag ? ' flag' : ''}" href="${href}">
    <b>${value}</b><span>${escape(label)} &rsaquo;</span>
  </a>`;
}
