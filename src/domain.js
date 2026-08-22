/**
 * Samson's own vocabulary.
 *
 * This file is the seam. Views and route handlers may only ever see the shapes
 * described here; the Wix response shape — `details.partySize`,
 * `reservee.customFields['0e64b271-…']` — must never reach a template.
 *
 * Hold that line and moving off Wix later is a change of adapter, made one
 * entity at a time and reversible if something surprises us. Let it slip and we
 * will have built a Wix-shaped dashboard that has to be written twice.
 *
 * @typedef {object} Booking
 * @property {string}  id
 * @property {string}  reference     Short human-quotable code, for the phone.
 * @property {Date}    startsAt
 * @property {Date}    endsAt
 * @property {number}  partySize
 * @property {string}  guestName
 * @property {?string} email
 * @property {?string} phone
 * @property {{ label: string, value: string }[]} notes  Dietary and similar.
 * @property {?string} teamMessage
 * @property {?string} experienceId
 * @property {string}  status        See STATUS.
 * @property {string}  payment       See PAYMENT.
 * @property {string}  source        'online' | 'phone' | 'walk-in'
 * @property {boolean} archived      Filed away in Wix — dealt with, stay gone.
 * @property {Date}    createdAt     When the attempt was made — decides whether
 *                                   an unfinished one is live or long dead.
 * @property {string} [disposition]  Set by the calendar. See DISPOSITION.
 * @property {string}  revision      Wix's optimistic-concurrency token.
 *
 * @typedef {object} Experience
 * @property {string}  id
 * @property {string}  name
 * @property {number}  pricePence     Per guest.
 * @property {number}  seatsPerSitting
 * @property {number}  partyMin
 * @property {number}  partyMax
 * @property {number}  durationMins
 * @property {boolean} visible
 *
 * @typedef {object} Sitting
 * @property {Date}    startsAt
 * @property {string}  time           Local `HH:MM`.
 * @property {?Experience} experience
 * @property {Booking[]} bookings     Confirmed and pending, excluding dead ones.
 * @property {number}  covers         Guests actually holding seats.
 * @property {?number} capacity       Null when the experience is unknown.
 * @property {number}  unpaidCovers   Guests on a booking that has not been paid.
 */

/**
 * The read side of the back office.
 *
 * Implemented today by `adapters/wix-bookings.js`; implemented later by a D1
 * adapter with exactly this surface. Write operations join it a phase from now
 * — `create`, `update`, `cancel`, `refund` — and the same rule applies.
 *
 * @typedef {object} BookingsRepository
 * @property {(range: {start: Date, end: Date}) => Promise<Booking[]>} inRange
 * @property {(draft: BookingDraft) => Promise<Booking>} create
 * @property {(range: {start: Date, end: Date, experienceId: ?string}) => Promise<Slot[]>} scheduledSlots
 *
 * @typedef {object} Slot
 * @property {Date}     startsAt
 * @property {?number}  minutes
 * @property {boolean}  full      No room at all — shown, never blocked on.
 *
 * @typedef {object} BookingDraft
 * @property {Date}    startsAt
 * @property {number}  partySize
 * @property {string}  firstName    Required by the API for anything but a walk-in.
 * @property {?string} lastName
 * @property {string}  phone        Likewise required — it is a phone booking.
 * @property {?string} email
 * @property {?string} experienceId
 * @property {?string} teamMessage
 * @property {() => Promise<Map<string, Experience>>} experiences
 * @property {(id: string, changes: object) => Promise<Booking>} apply
 */

/**
 * The other half of the lodge: bedrooms and cottages, which freetobook sells.
 *
 * A dining booking is a moment — a sitting at 13:30. A room is let for a
 * *night*, and the night is named by the calendar date it starts on. So this
 * side of the diary is keyed by date rather than by instant, and asks for a
 * range of dates rather than a UTC window.
 *
 * What can be known here is narrower than a booking, and deliberately so. The
 * feed behind it is freetobook's public availability, which says whether a room
 * is taken and nothing whatever about who is in it. There are no names, no
 * arrival times and no contact details to be had — see
 * `adapters/freetobook-rooms.js` for what that costs.
 *
 * @typedef {object} Room
 * @property {number} id
 * @property {string} name    As it reads on the public site — "River Room".
 * @property {string} group   'rooms' for bedrooms, 'cottages' for the cottages.
 * @property {string} state   See ROOM.
 *
 * @typedef {object} RoomDay
 * @property {string}  date         The night, as `YYYY-MM-DD`.
 * @property {Room[]}  rooms        Every lettable room, in the site's own order.
 * @property {number}  occupied     Rooms let that night.
 * @property {number}  lettable     Rooms there are to let at all.
 * @property {number}  arrivals     Rooms whose first night this is.
 * @property {number}  departures   Rooms emptied that morning — a changeover.
 * @property {boolean} wholeHouse   Exclusive use is booked, so the house is gone.
 *
 * @typedef {object} RoomsRepository
 * @property {(range: {from: string, to: string}) => Promise<Map<string, RoomDay>>} inRange
 */

/** Where a booking has got to. Mirrors what staff need to see, not Wix's enum. */
export const STATUS = {
  held: 'held',               // mid-checkout; nobody has committed to anything
  awaitingPayment: 'awaiting-payment',
  requested: 'requested',     // waiting on us to approve
  confirmed: 'confirmed',
  seated: 'seated',
  finished: 'finished',
  cancelled: 'cancelled',
  declined: 'declined',
  noShow: 'no-show',
};

export const PAYMENT = {
  paid: 'paid',
  partial: 'partial',
  unpaid: 'unpaid',
  refunded: 'refunded',
};

/**
 * What is happening to a room on a given night, in the vocabulary of the person
 * who has to make the bed.
 *
 * `departed` is the one that is about the morning rather than the night: the
 * room is empty tonight because the guests left today, which is the whole
 * reason it needs stripping.
 */
export const ROOM = {
  arriving: 'arriving',       // first night of a stay — must be ready
  staying: 'staying',         // stay continues — service, don't strip
  let: 'let',                 // in use, with no way to tell which of those two
  departed: 'departed',       // emptied this morning — full changeover
  free: 'free',
  maintenance: 'maintenance', // blocked in freetobook as under maintenance
  closed: 'closed',           // closed out — not for sale, not a guest either
};

export function roomStateLabel(state) {
  return {
    [ROOM.arriving]: 'Arriving',
    [ROOM.staying]: 'Staying',
    [ROOM.let]: 'In use',
    [ROOM.departed]: 'Departed',
    [ROOM.free]: 'Free',
    [ROOM.maintenance]: 'Maintenance',
    [ROOM.closed]: 'Closed out',
  }[state] || state;
}

/** Rooms with something to do about them. A free room needs no one's morning. */
export function needsAttention(room) {
  return room.state !== ROOM.free;
}

/** Rooms with a guest in them tonight. */
export function isLet(room) {
  return room.state === ROOM.arriving
    || room.state === ROOM.staying
    || room.state === ROOM.let;
}

/**
 * Wix expires a held or awaiting-payment reservation after ten minutes, but it
 * leaves the record behind. So `HELD` on a booking made last Tuesday does not
 * mean somebody is choosing a table right now — it means somebody didn't
 * finish, days ago. Age is what separates the two.
 */
export const HOLD_MINUTES = 10;

/**
 * What an unfinished attempt actually is, once age and the rest of the sitting
 * are taken into account. `status` says where Wix left it; this says what to do
 * about it.
 */
export const DISPOSITION = {
  live: 'live',                 // holds a seat
  inProgress: 'in-progress',    // genuinely mid-checkout, this minute
  abandoned: 'abandoned',       // gave up, reachable, never came back — chase it
  superseded: 'superseded',     // gave up, then booked again successfully — noise
  stale: 'stale',               // gave up before leaving a name — unreachable
};

/** Statuses that occupy a seat and belong on the diary. */
const LIVE = new Set([STATUS.requested, STATUS.confirmed, STATUS.seated, STATUS.finished]);

/** Statuses that are mid-flight — worth showing, but greyed and not counted. */
const IN_FLIGHT = new Set([STATUS.held, STATUS.awaitingPayment]);

/**
 * Statuses a person put there. Somebody cancelled, declined or marked a no
 * show; nobody gave up half way through a checkout.
 *
 * The distinction earns its keep because these are the only dead bookings that
 * can be put back. An abandoned attempt has nothing to restore it to — it never
 * became a booking. A no show does, and the tap that made it one is easy to
 * make by accident on a phone.
 */
const CALLED_OFF = new Set([STATUS.cancelled, STATUS.declined, STATUS.noShow]);

/**
 * How we recognise the same person across two attempts at the same sitting.
 *
 * Names are unreliable — the live diary has one guest booking as both "Jacqui
 * Halliday" and "Bridget Halliday" on the same email, and another as "Martyn
 * tuttey" and "Martyn Tuttey". Email and phone are what actually identify them.
 */
export function contactKeys(booking) {
  const keys = [];
  if (booking.email) keys.push(`e:${booking.email.trim().toLowerCase()}`);
  if (booking.phone) {
    const digits = booking.phone.replace(/\D/g, '');
    // +447961705118 and 07961705118 are the same phone; the last nine digits
    // are the part that doesn't move.
    if (digits.length >= 9) keys.push(`p:${digits.slice(-9)}`);
  }
  return keys;
}

/** Attempts that shouldn't take up room on the diary. */
export function isHidden(booking) {
  return booking.disposition === DISPOSITION.superseded
    || booking.disposition === DISPOSITION.stale;
}

export function holdsASeat(booking) {
  return LIVE.has(booking.status);
}

export function isInFlight(booking) {
  return IN_FLIGHT.has(booking.status);
}

export function isCalledOff(booking) {
  return CALLED_OFF.has(booking.status);
}

export function isDead(booking) {
  return !holdsASeat(booking) && !isInFlight(booking);
}

export function statusLabel(status) {
  return {
    [STATUS.held]: 'Holding',
    [STATUS.awaitingPayment]: 'Awaiting payment',
    [STATUS.requested]: 'Requested',
    [STATUS.confirmed]: 'Confirmed',
    [STATUS.seated]: 'Seated',
    [STATUS.finished]: 'Finished',
    [STATUS.cancelled]: 'Cancelled',
    [STATUS.declined]: 'Declined',
    [STATUS.noShow]: 'No show',
  }[status] || status;
}

export function paymentLabel(payment) {
  return {
    [PAYMENT.paid]: 'Paid',
    [PAYMENT.partial]: 'Part paid',
    [PAYMENT.unpaid]: 'Unpaid',
    [PAYMENT.refunded]: 'Refunded',
  }[payment] || payment;
}

export function money(pence, currency = '£') {
  return `${currency}${(pence / 100).toFixed(2).replace(/\.00$/, '')}`;
}
