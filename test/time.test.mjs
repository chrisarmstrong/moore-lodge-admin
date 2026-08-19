import { localDate, localMonth, localTime, dayWindow, monthWindow, datesInMonth,
         weekdayIndex, shiftMonth, shiftDate, dateLabel } from '../src/time.js';
import { groupIntoSittings, monthGrid, monthSummary } from '../src/calendar.js';
import { STATUS, PAYMENT } from '../src/domain.js';

let fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}  ${JSON.stringify(got)}`);
};
const iso = (d) => d.toISOString();

console.log('--- local time rendering (BST vs GMT) ---');
is('Aug sitting 12:30Z reads as 13:30 local', localTime(new Date('2026-08-28T12:30:00Z')), '13:30');
is('Dec sitting 12:30Z reads as 12:30 local', localTime(new Date('2026-12-11T12:30:00Z')), '12:30');
is('local date near midnight BST', localDate(new Date('2026-08-28T23:30:00Z')), '2026-08-29');
is('local month near midnight BST', localMonth(new Date('2026-08-31T23:30:00Z')), '2026-09');

console.log('--- day windows ---');
const aug = dayWindow('2026-08-28');
is('BST day starts 23:00Z prior', iso(aug.start), '2026-08-27T23:00:00.000Z');
is('BST day ends 23:00Z',         iso(aug.end),   '2026-08-28T23:00:00.000Z');
const dec = dayWindow('2026-12-11');
is('GMT day starts 00:00Z', iso(dec.start), '2026-12-11T00:00:00.000Z');
is('GMT day ends 00:00Z',   iso(dec.end),   '2026-12-12T00:00:00.000Z');

console.log('--- month window spanning the clock change (Oct 2026) ---');
const oct = monthWindow('2026-10');
is('Oct starts in BST', iso(oct.start), '2026-09-30T23:00:00.000Z');
is('Oct ends in GMT',   iso(oct.end),   '2026-11-01T00:00:00.000Z');
const mar = monthWindow('2026-03');
is('Mar starts in GMT', iso(mar.start), '2026-03-01T00:00:00.000Z');
is('Mar ends in BST',   iso(mar.end),   '2026-03-31T23:00:00.000Z');

console.log('--- clock-change days themselves ---');
is('spring forward day is 23h', (dayWindow('2026-03-29').end - dayWindow('2026-03-29').start)/3600000, 23);
is('autumn back day is 25h',    (dayWindow('2026-10-25').end - dayWindow('2026-10-25').start)/3600000, 25);

console.log('--- calendar maths ---');
is('Aug 2026 has 31 days', datesInMonth('2026-08').length, 31);
is('Feb 2028 leap year',   datesInMonth('2028-02').length, 29);
is('2026-08-28 is a Friday (idx 4)', weekdayIndex('2026-08-28'), 4);
is('shiftMonth wraps year', shiftMonth('2026-12', 1), '2027-01');
is('shiftDate wraps month', shiftDate('2026-08-31', 1), '2026-09-01');
is('dateLabel', dateLabel('2026-08-28'), 'Friday 28 August 2026');

console.log('--- grouping real-shaped bookings into sittings ---');
const exp = new Map([['tea', { id:'tea', name:'Afternoon Tea', seatsPerSitting:15, pricePence:4000 }]]);
const b = (t, party, status, payment, expId='tea') => ({
  id:'x'+Math.random(), reference:'ABC123', startsAt:new Date(t), endsAt:new Date(t),
  partySize:party, guestName:'Guest', email:null, phone:null, notes:[], teamMessage:null,
  experienceId:expId, status, payment, source:'online',
});
const bookings = [
  b('2026-08-28T11:30:00Z', 4, STATUS.confirmed, PAYMENT.paid),
  b('2026-08-28T11:30:00Z', 2, STATUS.confirmed, PAYMENT.unpaid),
  b('2026-08-28T11:30:00Z', 2, STATUS.awaitingPayment, PAYMENT.unpaid),  // in flight: shown, not counted
  b('2026-08-28T11:30:00Z', 6, STATUS.cancelled, PAYMENT.unpaid),        // dead: dropped entirely
  b('2026-08-28T13:30:00Z', 3, STATUS.confirmed, PAYMENT.paid),
];
const byDate = groupIntoSittings(bookings, exp);
const day = byDate.get('2026-08-28');
is('two sittings on the day', day.length, 2);
is('first sitting is 12:30 local', day[0].time, '12:30');
is('covers exclude in-flight and cancelled', day[0].covers, 6);
is('in-flight booking still listed', day[0].bookings.length, 3);
is('capacity from experience', day[0].capacity, 15);
is('unpaid covers counted', day[0].toSettle, 2);

const summary = monthSummary(byDate);
is('month covers', summary.covers, 9);
is('month sittings', summary.sittings, 2);
is('occupancy 9/30', summary.occupancy, 30);

const weeks = monthGrid('2026-08', byDate);
is('grid is whole weeks', weeks.every(w => w.length === 7), true);
is('grid covers all days', weeks.flat().filter(c => !c.outside).length, 31);
is('Aug 2026 needs 6 rows', weeks.length, 6);
const cell28 = weeks.flat().find(c => c.date === '2026-08-28');
is('cell 28 covers', cell28.covers, 9);
is('cell 28 counts in-checkout guests', cell28.inProgress, 2);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
