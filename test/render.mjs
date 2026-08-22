// Renders every page from the fixture to standalone HTML, for eyeballing.
import { writeFileSync, mkdirSync } from 'node:fs';
import { WixBookings } from '../src/adapters/wix-bookings.js';
import { groupIntoSittings, monthGrid, monthSummary, roomsSummary } from '../src/calendar.js';
import { monthShell, monthBody } from '../src/views/month.js';
import { dayShell, dayBody } from '../src/views/day.js';
import { listShell, listBody } from '../src/views/list.js';
import { pageHead, pageTail } from '../src/views/layout.js';
import { RESERVATIONS, EXPERIENCES, LOCATIONS, ROOM_NIGHTS } from './fixture.mjs';

const out = process.argv[2];
mkdirSync(out, { recursive: true });

const env = { WIX_API_KEY: 'k', WIX_SITE_ID: 's' };
const transport = async (url, init) => {
  const path = new URL(url).pathname;
  const body = { data: {} };
  if (path.includes('reservations/query')) body.data = { reservations: RESERVATIONS };
  else if (path.includes('experiences')) body.data = { experiences: EXPERIENCES };
  else if (path.includes('locations')) body.data = { reservationLocations: LOCATIONS };
  return new Response(JSON.stringify(body.data), { status: 200, headers: { 'content-type': 'application/json' } });
};
globalThis.fetch = transport;

const month = '2026-08';
const today = '2026-08-06';
const repo = new WixBookings(env);
const [reservations, experiences] = await Promise.all([
  repo.inRange({ start: new Date('2026-07-31T23:00:00Z'), end: new Date('2026-08-31T23:00:00Z') }),
  repo.experiences(),
]);
const byDate = groupIntoSittings(reservations, experiences);
const roomsByDate = ROOM_NIGHTS(month);
const daySittings = byDate.get(today) || [];
const all = [...byDate.values()].flat().sort((a, b) => a.startsAt - b.startsAt);

const write = (name, shell, body) =>
  writeFileSync(`${out}/${name}.html`, pageHead({ ...shell, version: 'dev' }) + body + pageTail());

write('month', monthShell({ month, today }),
  monthBody({ month, weeks: monthGrid(month, byDate, roomsByDate),
    summary: monthSummary(byDate), rooms: roomsSummary(roomsByDate), today }));
write('day', dayShell({ date: today }),
  dayBody({
    date: today, sittings: daySittings, back: `/day/${today}`,
    rooms: roomsByDate.get(today), weeks: monthGrid(month, byDate, roomsByDate), month, today,
  }));
// The two screens that are only about upstairs: a changeover morning, and the
// night the whole house goes out as one.
write('day-changeover', dayShell({ date: '2026-08-13' }),
  dayBody({ date: '2026-08-13', sittings: [], rooms: roomsByDate.get('2026-08-13'),
    weeks: monthGrid(month, byDate, roomsByDate), month: '2026-08', today }));
write('day-wholehouse', dayShell({ date: '2026-08-21' }),
  dayBody({ date: '2026-08-21', sittings: [], rooms: roomsByDate.get('2026-08-21'),
    weeks: monthGrid(month, byDate, roomsByDate), month: '2026-08', today }));
write('settle', listShell({ kind: 'settle', period: today }),
  listBody({ kind: 'settle', period: today, sittings: daySittings, back: `/settle/${today}` }));
write('settle-month', listShell({ kind: 'settle', period: month }),
  listBody({ kind: 'settle', period: month, sittings: all, back: `/settle/${month}` }));
write('chase', listShell({ kind: 'chase', period: month }),
  listBody({ kind: 'chase', period: month, sittings: all, back: `/chase/${month}` }));
write('called-off', listShell({ kind: 'called-off', period: today }),
  listBody({ kind: 'called-off', period: today, sittings: daySittings, back: `/called-off/${today}` }));
const { newShell, newBody } = await import('../src/views/new.js');
const visible = [...experiences.values()].filter((e) => e.visible);
// Two sittings the lodge runs, one of which nobody has booked into yet — the
// case the old form could not show at all.
const SLOTS = [
  { startsAt: new Date('2026-08-06T11:30:00Z'), minutes: 120, full: false },
  { startsAt: new Date('2026-08-06T12:30:00Z'), minutes: 120, full: false },
  { startsAt: new Date('2026-08-06T13:30:00Z'), minutes: 120, full: false },
];
const RUNNING = new Set([today, '2026-08-08', '2026-08-09']);
write('new', newShell({ date: today }),
  newBody({
    date: today, today, experiences: visible, experience: visible[0],
    slots: SLOTS, running: RUNNING, sittings: daySittings,
  }));
write('new-errors', newShell({ date: today }),
  newBody({
    date: today, today, experiences: visible, experience: visible[0],
    slots: SLOTS, running: RUNNING, sittings: daySittings,
    values: { date: today, sitting: 'other', time: '', party: 'other', partySize: '0', name: '', phone: '', email: 'nope@' },
    errors: ['Give a time, like 12:30.', 'How many people?', 'A name is needed.',
      'A phone number is needed — it is how the booking is confirmed.', 'That email address does not look right.'],
  }));

console.log('wrote', out);
