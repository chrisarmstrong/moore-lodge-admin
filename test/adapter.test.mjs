// Integration test: real adapter + calendar + views, against a stubbed transport
// carrying reservation shapes copied from the live site (names changed).
import { WixBookings } from '../src/adapters/wix-bookings.js';
import { groupIntoSittings, monthGrid, monthSummary } from '../src/calendar.js';
import { monthShell, monthBody } from '../src/views/month.js';
import { dayShell, dayBody } from '../src/views/day.js';
import { listBody } from '../src/views/list.js';
import { STATUS, PAYMENT } from '../src/domain.js';
import { pageHead, pageTail } from '../src/views/layout.js';

const TEA = 'e0f47a7c-4768-4d6c-89df-d5db219a82da';
const DIETARY = '0e64b271-61cb-4457-8760-8fb3e26accdf';   // experience-level field
const ALLERGY = '6c380298-aa0a-4da9-803a-749aea40995d';   // location-level field

const RESERVATIONS = [
  // phone booking, no email, no custom fields, empty teamMessage
  { id:'8fecbe44-1090-4a42-a0eb-f4831b99cc91', status:'RESERVED', source:'OFFLINE', paymentStatus:'NOT_PAID',
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:3, experienceId:TEA },
    reservee:{ firstName:'Nessy', lastName:'Blair', customFields:{} }, teamMessage:'' },
  // online, paid, real dietary note
  { id:'006abfa7-e990-41dd-af31-b4574c1b8a55', status:'RESERVED', source:'ONLINE', paymentStatus:'PAID',
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:4, experienceId:TEA },
    reservee:{ firstName:'Lorna', lastName:'Dunlop', email:'l@example.com', phone:'+442827666470',
      customFields:{ [DIETARY]:"2 people can't eat egg in sandwiches but it's ok in anything else." } } },
  // HELD with NO reservee object at all — must not throw
  { id:'275bdd0d-ca78-420a-8335-2b629b402744', status:'HELD', source:'ONLINE', paymentStatus:'NOT_PAID',
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:2, experienceId:TEA } },
  // awaiting payment, custom field present but EMPTY string — must be dropped
  { id:'64810a35-9753-494a-882e-b0bcc3ff59a2', status:'PAYMENT_INFORMATION_PENDING', source:'ONLINE', paymentStatus:'NOT_PAID',
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:2, experienceId:TEA },
    reservee:{ firstName:'Coare', lastName:'McNicholl ', email:'p@example.com', customFields:{ [DIETARY]:'' } } },
  // cancelled + archived — must not appear at all
  { id:'073b9ffb-35d5-4ecf-8e76-88fddd9c34b0', status:'CANCELED', source:'OFFLINE', paymentStatus:'NOT_PAID', archived:true,
    details:{ startDate:'2026-08-06T11:30:00Z', endDate:'2026-08-06T13:30:00Z', partySize:3, experienceId:TEA },
    reservee:{ firstName:'Mrs Moore', customFields:{} } },
  // NO experienceId — location-level allergy field, plain reservation
  { id:'5768de91-3a77-4eb0-82f8-818e7cb3391f', status:'RESERVED', source:'ONLINE', paymentStatus:'PAID',
    details:{ startDate:'2026-08-06T12:30:00Z', endDate:'2026-08-06T14:00:00Z', partySize:3 },
    reservee:{ firstName:'Sandra', lastName:'McIlhatton', email:'s@example.com', customFields:{ [ALLERGY]:'None' } } },
  // big party, real team message, phone booking
  { id:'5c79f8ce-faed-4094-84c6-817eb1fad546', status:'RESERVED', source:'OFFLINE', paymentStatus:'NOT_PAID',
    details:{ startDate:'2026-08-06T12:30:00Z', endDate:'2026-08-06T14:30:00Z', partySize:10, experienceId:TEA },
    reservee:{ firstName:'Erin', lastName:'Hen Party', phone:'+447961705118', customFields:{} },
    teamMessage:'using thermal afterwards from 3:30pm - 5pm - they are paying £50pp' },
  // a different day, so the grid has more than one busy cell
  { id:'336635e6-fbf2-4e52-898b-b7c9e0d33ae2', status:'RESERVED', source:'ONLINE', paymentStatus:'PAID',
    details:{ startDate:'2026-08-28T13:30:00Z', endDate:'2026-08-28T15:30:00Z', partySize:2, experienceId:TEA },
    reservee:{ firstName:'Cathy', lastName:'Glass', email:'c@example.com', customFields:{ [DIETARY]:'None' } } },
];

const EXPERIENCES = [{ id:TEA, archived:false, configuration:{
  displayInfo:{ name:'Afternoon Tea' },
  paymentPolicy:{ paymentPolicyType:'PER_GUEST', perGuestOptions:{ price:'40' } },
  onlineReservations:{ maxGuests:{ number:15 }, partySize:{ min:2, max:6 }, businessSchedule:{ durationInMinutes:120 } },
  reservationForm:{ customFieldDefinitions:[{ id:DIETARY, name:'Dietary requirements' }] },
  visible:true } }];

const LOCATIONS = [{ id:'19e73162', configuration:{ reservationForm:{
  customFieldDefinitions:[{ id:ALLERGY, name:'Please confirm any allergies.' }] } } }];

let calls = [];
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  calls.push({ url, auth: init.headers.authorization, site: init.headers['wix-site-id'], body });
  const pick = url.includes('/experiences/') ? { experiences: EXPERIENCES }
             : url.includes('/reservation-locations/') ? { reservationLocations: LOCATIONS }
             : { reservations: RESERVATIONS };
  return { ok:true, status:200, text: async () => JSON.stringify(pick) };
};

const render = (shell, body) => pageHead(shell) + body + pageTail();

let fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}  ${JSON.stringify(got)}`);
};

const repo = new WixBookings({ WIX_API_KEY:'test-key', WIX_SITE_ID:'site-123' });
const range = { start:new Date('2026-07-31T23:00:00Z'), end:new Date('2026-08-31T23:00:00Z') };
const bookings = await repo.inRange(range);
const experiences = await repo.experiences();

console.log('--- transport ---');
is('auth header is the raw key', calls[0].auth, 'test-key');
is('site header sent', calls[0].site, 'site-123');
is('range uses $and, not a merged object', Object.keys(calls[0].body.query.filter), ['$and']);
is('sort uses the full path', calls[0].body.query.sort[0].fieldName, 'details.startDate');

console.log('--- normalisation ---');
is('all reservations mapped', bookings.length, 8);
const held = bookings.find(b => b.id.startsWith('275bdd0d'));
is('missing reservee does not crash', held.guestName, 'No name given');
is('missing reservee gives null email', held.email, null);
const lorna = bookings.find(b => b.id.startsWith('006abfa7'));
is('dietary note labelled from experience form', lorna.notes[0].label, 'Dietary requirements');
is('status mapped to our vocabulary', lorna.status, 'confirmed');
is('payment mapped', lorna.payment, 'paid');
is('reference is quotable', lorna.reference, '1B8A55');
const coare = bookings.find(b => b.id.startsWith('64810a35'));
is('empty custom field dropped', coare.notes.length, 0);
is('awaiting payment mapped', coare.status, 'awaiting-payment');
const sandra = bookings.find(b => b.id.startsWith('5768de91'));
is('trailing punctuation stripped from label', sandra.notes[0].label, 'Please confirm any allergies');
const nessy = bookings.find(b => b.id.startsWith('8fecbe44'));
is('empty teamMessage becomes null', nessy.teamMessage, null);
is('OFFLINE maps to phone', nessy.source, 'phone');

console.log('--- experiences ---');
is('price in pence', experiences.get(TEA).pricePence, 4000);
is('seats per sitting', experiences.get(TEA).seatsPerSitting, 15);

console.log('--- sittings ---');
const byDate = groupIntoSittings(bookings, experiences);
const aug6 = byDate.get('2026-08-06');
is('two sittings on 6 Aug', aug6.length, 2);
is('cancelled booking excluded entirely', aug6.flatMap(s => s.bookings).some(b => b.id.startsWith('073b9ffb')), false);
is('12:30 sitting covers exclude in-flight', aug6[0].covers, 7);
is('12:30 diary holds only real bookings', aug6[0].bookings.length, 2);
is('and keeps the unfinished ones aside', aug6[0].unfinished.length, 2);
is('one unpaid booking is one bill', aug6[0].toSettle, 1);
is('its three guests counted separately', aug6[0].toSettleGuests, 3);
is('mid-checkout guests counted separately', aug6[0].inProgress, 4);
is('13:30 sitting has mixed experience, dominant wins', aug6[1].experience.name, 'Afternoon Tea');
is('13:30 covers include the no-experience booking', aug6[1].covers, 13);
is('13:30 over capacity (15 seats, 13 booked)', aug6[1].covers <= aug6[1].capacity, true);

console.log('--- render ---');
const summary = monthSummary(byDate);
const html = render(monthShell({ month:'2026-08', today:'2026-08-06' }), monthBody({ month:'2026-08', weeks:monthGrid('2026-08', byDate), summary, today:'2026-08-06' }));
is('month html is a document', html.startsWith('<!doctype html>'), true);
is('month marks today', html.includes('cell busy today'), true);
is('month shows a sitting pill', html.includes('12:30'), true);
const dhtml = render(dayShell({ date:'2026-08-06' }), dayBody({ date:'2026-08-06', sittings:aug6 }));
is('day shows the big party', dhtml.includes('Erin Hen Party'), true);
is('day shows the team message', dhtml.includes('Note to team'), true);
is('day escapes the apostrophe in the note', dhtml.includes('can&#39;t eat egg'), true);
is('day shows No email for phone bookings', dhtml.includes('No email'), true);
is('no cancelled guest leaks into the day', dhtml.includes('Mrs Moore'), false);



console.log('--- superseded, abandoned, stale ---');
const T = '2026-08-06T11:30:00Z';
const NOW = new Date('2026-08-05T12:00:00Z');
const old = new Date('2026-08-01T09:00:00Z');          // days before NOW: expired
const justNow = new Date('2026-08-05T11:56:00Z');      // 4 min before NOW: still live
const mk = (over) => ({
  id:'id-'+Math.random(), reference:'R', startsAt:new Date(T), endsAt:new Date(T),
  partySize:2, guestName:'G', email:null, phone:null, notes:[], teamMessage:null,
  experienceId:TEA, status:STATUS.confirmed, payment:PAYMENT.paid, source:'online',
  createdAt: old, ...over,
});

const cases = [
  mk({ guestName:'Julie Johnston', email:'julie@example.com', status:STATUS.confirmed, payment:PAYMENT.paid, partySize:3 }),
  // same guest, earlier failed attempt, different party size and casing
  mk({ guestName:'julie johnston', email:'JULIE@example.com ', status:STATUS.awaitingPayment, payment:PAYMENT.unpaid, partySize:4 }),
  // same person recognised by phone in a different format, also superseded
  mk({ guestName:'Martyn Tuttey', phone:'+447845381048', status:STATUS.confirmed, payment:PAYMENT.paid }),
  mk({ guestName:'Martyn tuttey', phone:'07845381048', status:STATUS.awaitingPayment, payment:PAYMENT.unpaid }),
  // genuinely abandoned: reachable, never came back
  mk({ guestName:'Lost Soul', email:'lost@example.com', status:STATUS.awaitingPayment, payment:PAYMENT.unpaid, partySize:5 }),
  // stale: a held browser session that never left a name
  mk({ guestName:'No name given', status:STATUS.held, payment:PAYMENT.unpaid, partySize:2 }),
  // still in checkout right now
  mk({ guestName:'Live One', email:'live@example.com', status:STATUS.awaitingPayment, payment:PAYMENT.unpaid, partySize:2, createdAt:justNow }),
];

const grouped = groupIntoSittings(cases, experiences, NOW);
const sit = grouped.get('2026-08-06')[0];
const names = sit.bookings.map(b => b.guestName);

const aside = sit.unfinished.map(b => b.guestName);
is('superseded attempts hidden everywhere', [...names, ...aside].includes('julie johnston'), false);
is('phone-matched duplicate hidden everywhere', [...names, ...aside].includes('Martyn tuttey'), false);
is('nameless expired hold hidden everywhere', [...names, ...aside].includes('No name given'), false);
is('abandoned is off the diary', names.includes('Lost Soul'), false);
is('but kept for the chase list', aside.includes('Lost Soul'), true);
is('in-checkout is off the diary too', names.includes('Live One'), false);
is('and kept aside as well', aside.includes('Live One'), true);
is('the diary is only successful bookings', sit.bookings.every(b => b.disposition === 'live'), true);
is('two of them', sit.bookings.length, 2);
is('three hidden: two duplicates and a nameless hold', sit.hidden, 3);
is('abandoned counts groups to ring', sit.abandoned, 1);
is('and the guests behind them', sit.abandonedGuests, 5);
is('in-progress counted apart', sit.inProgress, 2);
is('covers unaffected by any of it', sit.covers, 5);

const sum = monthSummary(grouped);
is('month abandoned is only the lost one', sum.abandoned, 1);
is('month abandoned guests', sum.abandonedGuests, 5);
is('month hidden tracked', sum.hidden, 3);

const dayHtml = render(dayShell({ date:'2026-08-06' }), dayBody({ date:'2026-08-06', sittings:[sit] }));
is('the day never names an abandoned guest', dayHtml.includes('Lost Soul'), false);
is('but points at where they are', dayHtml.includes('/chase/2026-08-06'), true);
is('the day does not show the duplicate', dayHtml.includes('julie johnston'), false);

const chaseHtml = listBody({ kind:'chase', period:'2026-08-06', sittings:[sit], back:'/chase/2026-08-06' });
is('the chase list names them', chaseHtml.includes('Lost Soul'), true);
is('and owns up to what it dropped', chaseHtml.includes('further'), true);
is('the settle list stays on the diary', listBody({ kind:'settle', period:'2026-08-06', sittings:[sit] }).includes('Lost Soul'), false);

// A month list must say which day a 12:30 sitting is, even when every match
// happens to fall on one day — the period decides that, not the rows.
const monthChase = listBody({ kind:'chase', period:'2026-08', sittings:[sit, sit], back:'/chase/2026-08' });
is('a month list rules off the day', monthChase.includes('Thursday 6 August<'), true);
is('and writes that date once, not per sitting', monthChase.split('dayrule').length - 1, 1);
is('a day list does not repeat the date', chaseHtml.includes('dayrule'), false);

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
