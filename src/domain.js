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
 * @property {() => Promise<Map<string, Experience>>} experiences
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

/** Statuses that occupy a seat and belong on the diary. */
const LIVE = new Set([STATUS.requested, STATUS.confirmed, STATUS.seated, STATUS.finished]);

/** Statuses that are mid-flight — worth showing, but greyed and not counted. */
const IN_FLIGHT = new Set([STATUS.held, STATUS.awaitingPayment]);

export function holdsASeat(booking) {
  return LIVE.has(booking.status);
}

export function isInFlight(booking) {
  return IN_FLIGHT.has(booking.status);
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
