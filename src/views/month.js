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
    <div class="stat${summary.unpaidCovers ? ' flag' : ''}"><b>${summary.unpaidCovers}</b><span>Guests not paid for</span></div>
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
      if (full) pillClass.push('full');
      else if (sitting.unpaidCovers) pillClass.push('unpaid');
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
