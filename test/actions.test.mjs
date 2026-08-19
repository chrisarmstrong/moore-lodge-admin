// The write path. This is the first code in Samson that changes real data, so
// the tests care less about the happy case than about who is allowed to fire
// it and what happens when two people act at once.
import { WixBookings } from '../src/adapters/wix-bookings.js';
import { ACTIONS, availableFor } from '../src/actions.js';
import { STATUS, PAYMENT } from '../src/domain.js';

let fail = 0;
const is = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}\n  got  ${JSON.stringify(got)}\n  want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label}  ${JSON.stringify(got)}`);
};

console.log('--- which actions a booking offers ---');
const booking = (over) => ({ status: STATUS.confirmed, payment: PAYMENT.unpaid, ...over });
const names = (b) => availableFor(b).map((a) => a.name);

is('an unpaid confirmed booking', names(booking()), ['paid', 'seated', 'noshow', 'cancel']);
is('a paid one offers the undo, not the mark', names(booking({ payment: PAYMENT.paid })),
  ['unpaid', 'seated', 'noshow', 'cancel']);
is('a seated one can finish', names(booking({ status: STATUS.seated })), ['paid', 'finished', 'noshow', 'cancel']);
// The way back from a mis-tap. Only the way back: a cancelled booking is unpaid
// by any reading, and "mark paid" reaching it would record money against
// somebody who is not coming.
is('a cancelled one offers only the way back', names(booking({ status: STATUS.cancelled })), ['restore']);
is('so does a no show', names(booking({ status: STATUS.noShow })), ['restore']);
is('and a declined request', names(booking({ status: STATUS.declined })), ['restore']);
is('one still in checkout offers nothing', names(booking({ status: STATUS.awaitingPayment })), []);
is('nor does one abandoned', names(booking({ status: STATUS.held })), []);
is('a live booking is never offered the way back',
  names(booking()).includes('restore'), false);
is('putting one back does not ask first', ACTIONS.restore.confirm, undefined);
is('destructive actions ask first',
  Object.entries(ACTIONS).filter(([, a]) => a.confirm).map(([n]) => n), ['noshow', 'cancel']);
is('cancel warns that Wix may email the guest', /email the guest/.test(ACTIONS.cancel.confirm), true);
// Both say where the booking went, because both used to be a one-way door.
is('cancel says where to find it again', /Called off/.test(ACTIONS.cancel.confirm), true);
is('no show says where to find it again', /Called off/.test(ACTIONS.noshow.confirm), true);

console.log('--- the revision is read fresh, not trusted from the page ---');
{
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ method: init.method, url: String(url), body: init.body ? JSON.parse(init.body) : null });
    if (init.method === 'GET') {
      return { ok: true, status: 200, text: async () => JSON.stringify({
        reservation: { id: 'r1', revision: '9', status: 'RESERVED', paymentStatus: 'NOT_PAID',
          details: { startDate: '2026-08-06T11:30:00Z', partySize: 2 }, reservee: { firstName: 'A' },
          createdDate: '2026-08-01T09:00:00Z' } }) };
    }
    if (init.method === 'PATCH') {
      return { ok: true, status: 200, text: async () => JSON.stringify({
        reservation: { id: 'r1', revision: '10', status: 'RESERVED', paymentStatus: 'PAID',
          details: { startDate: '2026-08-06T11:30:00Z', partySize: 2 }, reservee: { firstName: 'A' },
          createdDate: '2026-08-01T09:00:00Z' } }) };
    }
    // the label lookups
    return { ok: true, status: 200, text: async () => JSON.stringify({ experiences: [], reservationLocations: [] }) };
  };

  const repo = new WixBookings({ WIX_API_KEY: 'k', WIX_SITE_ID: 's' });
  const updated = await repo.apply('r1', ACTIONS.paid.changes);

  const read = calls.find((c) => c.method === 'GET');
  const write = calls.find((c) => c.method === 'PATCH');
  is('reads the booking before writing', !!read && read.url.includes('/reservations/r1'), true);
  is('sends the revision it just read', write.body.reservation.revision, '9');
  is('sends only the change asked for', write.body.reservation.paymentStatus, 'PAID');
  is('does not touch the party or the guest',
    [write.body.reservation.details, write.body.reservation.reservee], [undefined, undefined]);
  is('returns the booking in our own vocabulary', updated.payment, PAYMENT.paid);
}

console.log('--- a booking that has gone ---');
{
  globalThis.fetch = async (url, init) => (init.method === 'GET'
    ? { ok: true, status: 200, text: async () => JSON.stringify({}) }
    : { ok: true, status: 200, text: async () => JSON.stringify({ experiences: [], reservationLocations: [] }) });
  const repo = new WixBookings({ WIX_API_KEY: 'k', WIX_SITE_ID: 's' });
  let message = '';
  try { await repo.apply('gone', ACTIONS.paid.changes); } catch (error) { message = error.message; }
  is('says so plainly', message, 'That booking no longer exists.');
}

console.log(fail ? `\n${fail} FAILED` : '\nall passed');
process.exit(fail ? 1 : 0);
