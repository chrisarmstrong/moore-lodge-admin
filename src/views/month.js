import { page, escape } from './layout.js';
import { monthLabel, shiftMonth, localMonth, localDate, WEEKDAY_INITIALS } from '../time.js';

export function monthView({ month, weeks, summary, today }) {
  const previous = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  const thisMonth = localMonth();

  const nav = `<nav class="nav">
    <a href="/calendar/${previous}" rel="prev">&larr; ${escape(monthLabel(previous))}</a>
    ${month === thisMonth ? '<span class="here">This month</span>' : `<a href="/calendar/${thisMonth}">This month</a>`}
    <a href="/calendar/${next}" rel="next">${escape(monthLabel(next))} &rarr;</a>
    <span class="spacer"></span>
    <a href="/day/${today}">Today's covers</a>
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

    return `<div class="${classes.join(' ')}">
      <span class="n">${cell.day}</span>
      ${pills}
      ${cell.sittings.length ? `<a class="open" href="/day/${cell.date}" aria-label="${escape(cell.date)}, ${cell.covers} guests"></a>` : ''}
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
