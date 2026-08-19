import { escape } from './layout.js';
import { monthLabel, shiftMonth, localMonth, WEEKDAY_INITIALS } from '../time.js';

/** The part of the month page that needs no data — flushed while Wix answers. */
export function monthShell({ month, today }) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const thisMonth = localMonth();

  const titlebar = `<div class="titlebar">
    <a class="arrow" href="/calendar/${previous}" rel="prev" aria-label="${escape(monthLabel(previous))}">&lsaquo;</a>
    <div class="title">
      <h1>${escape(monthLabel(month))}</h1>
    </div>
    <a class="arrow" href="/calendar/${next}" rel="next" aria-label="${escape(monthLabel(next))}">&rsaquo;</a>
  </div>`;

  const nav = `<nav class="subnav">
    <a href="/day/${today}">Today's covers</a>
    ${month === thisMonth ? '' : `<a href="/calendar/${thisMonth}">This month</a>`}
  </nav>`;

  // The calendar grid wants the full width; the reading views do not.
  return { title: monthLabel(month), heading: monthLabel(month), titlebar, nav, wide: true };
}

/** The part that waits on the diary. */
export function monthBody({ month, weeks, summary, today }) {
  const stats = `<div class="stats">
    <div class="stat"><b>${summary.covers}</b><span>Guests booked</span></div>
    <div class="stat"><b>${summary.occupancy == null ? '—' : `${summary.occupancy}%`}</b><span>Of seats offered</span></div>
    ${tile(`/chase/${month}`, summary.abandoned, withGuests('Abandoned', summary.abandonedGuests), true)}
    ${tile(`/settle/${month}`, summary.toSettle, withGuests('Groups to settle', summary.toSettleGuests), false)}
    ${tile(`/called-off/${month}`, summary.offDiary, withGuests('Called off', summary.offDiaryGuests), false)}
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
      ${pills}${compact}
      <a class="open" href="/day/${cell.date}" aria-label="${escape(cell.date)}${cell.covers ? `, ${cell.covers} guests` : ', nothing booked'}"></a>
    </div>`;
  }).join('');

  return `${stats}
  <div class="grid">${header}${cells}</div>
  ${summary.sittings === 0 ? '<p class="empty">No bookings this month.</p>' : ''}`;
}

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
