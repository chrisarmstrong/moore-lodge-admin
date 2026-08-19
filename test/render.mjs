// Renders every page from the fixture to standalone HTML, for eyeballing.
import { writeFileSync, mkdirSync } from 'node:fs';
import { WixBookings } from '../src/adapters/wix-bookings.js';
import { groupIntoSittings, monthGrid, monthSummary } from '../src/calendar.js';
import { monthShell, monthBody } from '../src/views/month.js';
import { dayShell, dayBody } from '../src/views/day.js';
import { listShell, listBody } from '../src/views/list.js';
import { pageHead, pageTail } from '../src/views/layout.js';
import { RESERVATIONS, EXPERIENCES, LOCATIONS } from './fixture.mjs';

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
const daySittings = byDate.get(today) || [];
const all = [...byDate.values()].flat().sort((a, b) => a.startsAt - b.startsAt);

const write = (name, shell, body) =>
  writeFileSync(`${out}/${name}.html`, pageHead({ ...shell, version: 'dev' }) + body + pageTail());

write('month', monthShell({ month, today }),
  monthBody({ month, weeks: monthGrid(month, byDate), summary: monthSummary(byDate), today }));
write('day', dayShell({ date: today }),
  dayBody({ date: today, sittings: daySittings, back: `/day/${today}` }));
write('settle', listShell({ kind: 'settle', period: today }),
  listBody({ kind: 'settle', period: today, sittings: daySittings, back: `/settle/${today}` }));
write('settle-month', listShell({ kind: 'settle', period: month }),
  listBody({ kind: 'settle', period: month, sittings: all, back: `/settle/${month}` }));
write('chase', listShell({ kind: 'chase', period: month }),
  listBody({ kind: 'chase', period: month, sittings: all, back: `/chase/${month}` }));
write('called-off', listShell({ kind: 'called-off', period: today }),
  listBody({ kind: 'called-off', period: today, sittings: daySittings, back: `/called-off/${today}` }));
console.log('wrote', out);
