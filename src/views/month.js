import { page, escape } from './layout.js';
import { monthLabel, shiftMonth, localMonth, localDate, WEEKDAY_INITIALS } from '../time.js';

export function monthView({ month, weeks, summary, today }) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const thisMonth = localMonth();

  // Long labels wrap onto a second row of 48px buttons on a phone, which eats
  // the top of the calendar. Both are rendered and CSS picks one.
  const label = (iso) => {
    const long = monthLabel(iso);
    return `<span class="long">${escape(long)}</span><span class="short">${escape(long.slice(0, 3))}</span>`;
  };

  const nav = `<nav class="nav">
    <a href="/calendar/${previous}" rel="prev" aria-label="${escape(monthLabel(previous))}">&larr; ${label(previous)}</a>
    ${month === thisMonth
      ? '<span class="here">This month</span>'
      : `<a href="/calendar/${thisMonth}"><span class="long">This month</span><span class="short">Now</span></a>`}
    <a href="/calendar/${next}" rel="next" aria-label="${escape(monthLabel(next))}">${label(next)} &rarr;</a>
    <span class="spacer"></span>
    <a href="/day/${today}"><span class="long">Today's covers</span><span class="short">Today</span></a>
  </nav>`;

  const stats = `<div class="stats">
    <div class="stat"><b>${summary.covers}</b><span>Guests booked</span></div>
    <div class="stat"><b>${summary.sittings}</b><span>Sittings with bookings</span></div>
    <div class="stat"><b>${summary.occupancy == null ? '—' : `${summary.occupancy}%`}</b><span>Of seats offered</span></div>
    <div class="stat${summary.abandoned ? ' flag' : ''}"><b>${summary.abandoned}</b><span>Abandoned, worth chasing</span></div>
    <div class="stat"><b>${summary.toSettle}</b><span>To settle on arrival</span></div>
  </div>`;

  const header = WEEKDAY_INITIALS.map((initial) => `<div class="dow">${initial}</div>`).join('');

  const cells = weeks.flat().map((cell) => {
    if (cell.outside) return '<div class="cell outside"></div>';

    const classes = ['cell'];
    if (cell.covers > 0) classes.push('busy');
    if (cell.date === today) classes.push('today');

    const pills = cell.sittings.map((sitting) => {
      const full = sitting.capacity != null && sitting.covers >= sitting.capacity;
      const pillClass = ['pill'];

      // A sitting can exist with nobody actually in it — every booking on it is
      // still mid-checkout, or has died. Showing "0/15" there reads as an empty
      // sitting we opened, which is not what happened; show what is pending.
      if (sitting.covers === 0) {
        pillClass.push('pending');
        const waiting = sitting.abandoned ? `${sitting.abandoned} lost`
          : sitting.inProgress ? `${sitting.inProgress} in checkout` : 'nothing held';
        return `<span class="${pillClass.join(' ')}">${escape(sitting.time)} <b>${escape(waiting)}</b></span>`;
      }

      // Over capacity happens for real — phone bookings bypass the online cap,
      // so a sitting can quietly end up oversold. That needs to look different
      // from a sitting that is merely sold out.
      if (sitting.capacity != null && sitting.covers > sitting.capacity) pillClass.push('over');
      else if (full) pillClass.push('full');
      else if (sitting.abandoned) pillClass.push('unpaid');
      const of = sitting.capacity != null ? `/${sitting.capacity}` : '';
      return `<span class="${pillClass.join(' ')}">${escape(sitting.time)} <b>${sitting.covers}${of}</b></span>`;
    }).join('');

    // Seven columns on a 390px screen leaves about 45px a cell — not enough for
    // "12:30 8/15", which truncated to "12:3…" and told nobody anything. On a
    // phone the cell carries the day's total and a mark per sitting, the way a
    // native calendar collapses events to dots, and the detail is one tap away.
    const dots = cell.sittings.map((sitting) => {
      const state = sitting.capacity != null && sitting.covers > sitting.capacity ? 'over'
        : sitting.capacity != null && sitting.covers >= sitting.capacity ? 'full'
        : sitting.covers === 0 ? 'pending' : '';
      return `<i class="dot ${state}"></i>`;
    }).join('');
    const compact = cell.covers || cell.sittings.length
      ? `<span class="compact"><b>${cell.covers}</b><span class="dots">${dots}</span></span>`
      : '';

    return `<div class="${classes.join(' ')}">
      <span class="n">${cell.day}</span>
      ${pills}${compact}
      <a class="open" href="/day/${cell.date}" aria-label="${escape(cell.date)}${cell.covers ? `, ${cell.covers} guests` : ', nothing booked'}"></a>
    </div>`;
  }).join('');

  const body = `${stats}
  <div class="grid">${header}${cells}</div>
  ${summary.sittings === 0 ? '<p class="empty">No bookings this month.</p>' : ''}`;

  return page({
    title: monthLabel(month),
    heading: monthLabel(month),
    sub: 'Tap a day for its covers.',
    nav,
    body,
  });
}

export { localDate };
