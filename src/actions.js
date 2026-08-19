/**
 * The things staff can change about a booking.
 *
 * This is the first code in Samson that writes anything. Three consequences
 * worth holding on to:
 *
 * 1. **Wix sends emails.** Updating a reservation can trigger the site's own
 *    automations, so cancelling may tell the guest so. Anything destructive
 *    says as much before it is confirmed.
 * 2. **"Paid" here is a flag, not money.** Wix sets `PAID` when the matching
 *    eCommerce order is settled. Setting it by hand records that cash changed
 *    hands in the room; it does not take a payment, and it does not reconcile
 *    against the order.
 * 3. **Every change is somebody else's too.** The revision is read fresh
 *    immediately before writing, so two phones acting at once can't silently
 *    overwrite each other.
 */

import { PAYMENT, STATUS, holdsASeat } from './domain.js';

/** @typedef {{ label: string, done: string, changes: object, confirm?: string, when?: (b) => boolean }} Action */

/** @type {Record<string, Action>} */
export const ACTIONS = {
  paid: {
    label: 'Mark paid',
    done: 'Marked as paid.',
    changes: { paymentStatus: 'PAID' },
    when: (booking) => booking.payment !== PAYMENT.paid,
  },
  unpaid: {
    label: 'Not paid after all',
    done: 'Set back to unpaid.',
    changes: { paymentStatus: 'NOT_PAID' },
    when: (booking) => booking.payment === PAYMENT.paid,
  },
  seated: {
    label: 'Seated',
    done: 'Marked as seated.',
    changes: { status: 'SEATED' },
    when: (booking) => booking.status === STATUS.confirmed,
  },
  finished: {
    label: 'Finished',
    done: 'Marked as finished.',
    changes: { status: 'FINISHED' },
    when: (booking) => booking.status === STATUS.seated,
  },
  noshow: {
    label: 'No show',
    done: 'Marked as a no show.',
    changes: { status: 'NO_SHOW' },
    confirm: 'Mark this booking as a no show? It leaves the diary.',
    when: (booking) => booking.status === STATUS.confirmed || booking.status === STATUS.seated,
  },
  cancel: {
    label: 'Cancel booking',
    done: 'Booking cancelled.',
    changes: { status: 'CANCELED' },
    confirm: 'Cancel this booking? Wix may email the guest to tell them, and it cannot be undone here.',
    when: (booking) => booking.status === STATUS.confirmed
      || booking.status === STATUS.requested
      || booking.status === STATUS.seated,
  },
};

/**
 * The actions that make sense for a booking as it stands right now.
 *
 * Only a booking that actually holds a seat gets any. Offering "mark paid" on
 * an attempt still in checkout, or on one abandoned last week, invites somebody
 * to record a payment against a booking that was never made — and the contact
 * details, which are the useful part of those rows, are there either way.
 */
export function availableFor(booking) {
  if (!holdsASeat(booking)) return [];
  return Object.entries(ACTIONS)
    .filter(([, action]) => !action.when || action.when(booking))
    .map(([name, action]) => ({ name, ...action }));
}
