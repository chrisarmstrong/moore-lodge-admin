// The freetobook adapter, against a stubbed transport carrying the availability
// shape the live feed answers with. The unit ids and names are the real ones.
import { FreetobookRooms } from '../src/adapters/freetobook-rooms.js';
import { roomsSummary } from '../src/calendar.js';
import { dayBody } from '../src/views/day.js';
import { monthBody } from '../src/views/month.js';
import { monthGrid } from '../src/calendar.js';

const RIVER = 265847;
const GARDEN = 265842;
const BANN = 265840;
const CARSON = 265846;
const CHERRY = 266620;
const EXCLUSIVE = 268597;

const UNITS = [
  { id: RIVER, name: 'River Room', type: 'room', occupancyLimits: { maximumNumberOfAdults: 2 } },
  { id: GARDEN, name: 'Garden Room', type: 'room', occupancyLimits: { maximumNumberOfAdults: 2 } },
  { id: BANN, name: 'Bann Suite w/ Rolltop bath', type: 'room', occupancyLimits: { maximumNumberOfAdults: 2 } },
  { id: CARSON, name: 'Carson Room', type: 'room', occupancyLimits: { maximumNumberOfAdults: 2 } },
  { id: EXCLUSIVE, name: 'Moore Lodge Country House Exclusive Use', type: 'unit', occupancyLimits: { maximumNumberOfAdults: 18 } },
  { id: CHERRY, name: 'Cherry Cottage', type: 'unit', occupancyLimits: { maximumNumberOfAdults: 6 } },
];

// The site lists the cottage before the bedrooms; the strip should agree.
const ORDER = [CHERRY, RIVER, GARDEN, BANN, CARSON, EXCLUSIVE];

/**
 * `book` is keyed by date. Anything not named is free.
 *   b  booked        m  under maintenance        c  closed out
 *   x  absent from the feed entirely
 */
const NIGHTS = {
  // lead-in night: the range asked for starts on the 2nd
  '2026-08-01': { [RIVER]: 'b', [CHERRY]: 'b' },
  '2026-08-02': { [RIVER]: 'b', [CHERRY]: 'b', [GARDEN]: 'b' },
  '2026-08-03': { [CHERRY]: 'b', [BANN]: 'm' },
  '2026-08-04': { [CARSON]: 'c' },
  '2026-08-05': { [EXCLUSIVE]: 'b' },
  '2026-08-06': { [EXCLUSIVE]: 'b' },
  '2026-08-07': {},
  '2026-08-08': { [RIVER]: 'x' },
};

function availabilityFor(from, to) {
  const days = [];
  for (let date = from; date <= to; date = next(date)) {
    const marks = NIGHTS[date];
    if (!marks) continue;
    days.push({
      date,
      unitAvailabilities: UNITS.filter((u) => marks[u.id] !== 'x').map((u) => ({
        unitId: u.id,
        isClosedOut: marks[u.id] === 'c',
        minimumStay: 1,
        allocation: 1,
        rate: '199',
        pseudoUnitAvailabilities: [{
          pseudoUnitId: u.id + 69000,
          isBooked: marks[u.id] === 'b',
          isUnderMaintenance: marks[u.id] === 'm',
        }],
      })),
    });
  }
  return [{ propertyId: 55682, datedPropertyAvailabilities: days }];
}

function next(date) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: String(url), agent: init?.headers?.['user-agent'] });
  const u = new URL(url);
  const body = u.searchParams.has('from_date')
    ? availabilityFor(u.searchParams.get('from_date'), u.searchParams.get('to_date'))
    : { properties: [{ id: 55682, name: 'Moore Lodge', priorityOrderedUnitIds: ORDER, units: UNITS }] };
  return { ok: true, status: 200, text: async () => JSON.stringify(body) };
};

let fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}  ${JSON.stringify(got)}`);
};

// Today is pinned so the clamp below is exercised rather than dodged. The
// range asked for starts tomorrow, so the lead-in night is available.
const TODAY = '2026-08-01';
const rooms = new FreetobookRooms({});
const days = await rooms.inRange({ from: '2026-08-02', to: '2026-08-08' }, TODAY);
const state = (date, id) => days.get(date)?.rooms.find((r) => r.id === id)?.state;

console.log('--- transport ---');
is('the WAF wants a browser-shaped agent', calls.every((c) => /^Mozilla\/5\.0/.test(c.agent)), true);
is('two calls, not one per night', calls.length, 2);
is('the fetch reaches a night further back than the range',
  new URL(calls.find((c) => c.url.includes('from_date')).url).searchParams.get('from_date'), '2026-08-01');

console.log('--- what a night is doing ---');
is('a stay running in from before the range is not an arrival', state('2026-08-02', RIVER), 'staying');
is('a first night is an arrival', state('2026-08-02', GARDEN), 'arriving');
is('a room emptied that morning is a changeover', state('2026-08-03', RIVER), 'departed');
is('and so is the one that emptied the day after', state('2026-08-03', GARDEN), 'departed');
is('a room nobody has touched is free', state('2026-08-04', GARDEN), 'free');
is('maintenance is not a guest', state('2026-08-03', BANN), 'maintenance');
is('closed out is not a guest either', state('2026-08-04', CARSON), 'closed');
is('a four-night cottage stay is one arrival', state('2026-08-02', CHERRY), 'staying');
is('and one departure at the end of it', state('2026-08-04', CHERRY), 'departed');

console.log('--- the whole house ---');
const fifth = days.get('2026-08-05');
is('exclusive use is not itself a room in the list', fifth.rooms.some((r) => r.id === EXCLUSIVE), false);
is('but it fills every bedroom', fifth.rooms.filter((r) => r.group === 'rooms').map((r) => r.state),
  ['arriving', 'arriving', 'arriving', 'arriving']);
is('it does not take the cottage with it', state('2026-08-05', CHERRY), 'free');
is('the night is flagged for the view to say why', fifth.wholeHouse, true);
is('a takeover continuing is not four more arrivals', state('2026-08-06', RIVER), 'staying');
is('and it ends as four changeovers', days.get('2026-08-07').departures, 4);
is('the night after is not flagged', days.get('2026-08-07').wholeHouse, false);

console.log('--- counting ---');
is('rooms let, not rows shown', days.get('2026-08-02').occupied, 3);
is('lettable excludes exclusive use', days.get('2026-08-02').lettable, 5);
is('arrivals counted', days.get('2026-08-02').arrivals, 1);
is('departures counted', days.get('2026-08-03').departures, 2);
is('a unit that vanished from the feed is dropped, not shown free',
  days.get('2026-08-08').rooms.some((r) => r.id === RIVER), false);
is('and the denominator drops with it', days.get('2026-08-08').lettable, 4);

console.log('--- the month, in one figure ---');
const summary = roomsSummary(days);
// 3 let on the 2nd, the cottage alone on the 3rd, nothing on the 4th, then the
// house taken for two nights — maintenance and closed-out are not guests.
is('room nights add up', summary.roomNights, 3 + 1 + 0 + 4 + 4 + 0 + 0);
is('whole-house nights counted separately', summary.wholeHouseNights, 2);
// Five lettable rooms for six of the seven nights, four on the night a unit
// dropped out of the feed: 12 of 34.
is('lettable nights count what there was to let', summary.lettableNights, 34);
is('occupancy is a percentage of that', summary.occupancy, 35);
is('nothing to say says nothing', roomsSummary(new Map()), null);

console.log('--- a date freetobook did not answer for ---');
const gap = await rooms.inRange({ from: '2026-08-02', to: '2026-08-12' }, TODAY);
is('is absent rather than empty', gap.has('2026-08-10'), false);

console.log('--- nights freetobook will not discuss ---');
// A past from_date does not fail: it comes back 200 carrying two unrelated
// dates. Asking at all is the bug, so the clamp is what is tested.
calls = [];
const clamped = await rooms.inRange({ from: '2026-07-20', to: '2026-08-04' }, TODAY);
is('the past is never asked for',
  new URL(calls.find((c) => c.url.includes('from_date')).url).searchParams.get('from_date'), TODAY);
is('and is simply not in the answer', clamped.has('2026-07-25'), false);
is('what is left still arrives', clamped.has('2026-08-03'), true);

const over = await rooms.inRange({ from: '2026-07-01', to: '2026-07-31' }, TODAY);
is('a range wholly behind us asks nothing at all', over.size, 0);

// Today has no night before it to compare against: the feed starts here.
const first = await rooms.inRange({ from: TODAY, to: '2026-08-03' }, TODAY);
is("today's occupied rooms are not claimed to be arrivals",
  first.get(TODAY).rooms.find((r) => r.id === RIVER).state, 'let');
is('and are still counted as let', first.get(TODAY).occupied, 2);
is("this morning's changeovers cannot be seen", first.get(TODAY).departures, 0);
is('the day says which it is', first.get(TODAY).priorKnown, false);
is('tomorrow has last night and is sure again', first.get('2026-08-02').priorKnown, true);
is('so it can tell an arrival', first.get('2026-08-02').rooms.find((r) => r.id === GARDEN).state, 'arriving');

const today = dayBody({ date: TODAY, sittings: [], rooms: first.get(TODAY) });
is('an in-use room reads as in use', today.includes('In use'), true);
is('and the page owns up to the blind spot', today.includes('starts tonight'), true);

console.log('--- on the page ---');
const html = dayBody({ date: '2026-08-03', sittings: [], rooms: days.get('2026-08-03') });
is('the changeover is named as one', html.includes('Departed this morning'), true);
is('a free room is not eleven lines of noise', html.includes('>Free<'), false);
is('the day says what the feed cannot see', html.includes('back to back'), true);
is('a day with no sittings still shows the rooms', html.includes('class="rooms"'), true);

const down = dayBody({ date: '2026-08-03', sittings: [], rooms: null, today: TODAY });
is('a feed that did not answer says so', down.includes('did not answer'), true);
is('and never says the house is empty', down.includes('0 of'), false);

// A night already gone is a different absence, and saying "did not answer"
// would send somebody off to fix a system that is working as designed.
const past = dayBody({ date: '2026-07-20', sittings: [], rooms: null, today: TODAY });
is('a night behind us is explained, not reported as a fault', past.includes('only looks forward'), true);
is('and is not dressed up as a breakage', past.includes('did not answer'), false);

// The lodge takes whole nights off sale, and the feed then answers with every
// room closed out — eleven identical rows saying one thing.
const allShut = { date: '2026-08-09', lettable: 5, occupied: 0, arrivals: 0, departures: 0,
  wholeHouse: false, priorKnown: true,
  rooms: [RIVER, GARDEN, BANN, CARSON, CHERRY].map((id) => ({ id, name: `R${id}`, group: 'rooms', state: 'closed' })) };
const closed = dayBody({ date: '2026-08-09', sittings: [], rooms: allShut, today: TODAY });
is('a night off sale is said once, not once per room', (closed.match(/roomrow/g) || []).length, 0);
is('and is said', closed.includes('nothing upstairs is on sale'), true);

const grid = monthGrid('2026-08', new Map(), days);
const month = monthBody({ month: '2026-08', weeks: grid, summary: emptySummary(), rooms: summary, today: '2026-08-03' });
is('a busy night carries a bed count', month.includes('class="beds"'), true);
is('the whole house is marked differently', month.includes('class="beds whole"'), true);
// Four nights had somebody in a bed; the other three show no badge at all.
is('a quiet night carries nothing', (month.match(/class="beds/g) || []).length, 4);
is('the month tile counts room nights', month.includes(`<b>${summary.roomNights}</b>`), true);

const unlit = monthBody({ month: '2026-08', weeks: monthGrid('2026-08', new Map(), null), summary: emptySummary(), rooms: null, today: '2026-08-03' });
is('no feed means a dash, never a nought', unlit.includes('<b>&mdash;</b>'), true);

function emptySummary() {
  return { sittings: 0, covers: 0, toSettle: 0, toSettleGuests: 0, abandoned: 0, abandonedGuests: 0,
    inProgress: 0, hidden: 0, offDiary: 0, offDiaryGuests: 0, seatsOffered: 0, occupancy: null };
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
