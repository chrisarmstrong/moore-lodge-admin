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

import { PAYMENT, STATUS, holdsASeat, isCalledOff } from './domain.js';

/** Long enough for anything worth saying to the kitchen, short of an essay. */
export const NOTE_LIMIT = 1000;

/**
 * @typedef {object} Action
 * @property {string}  label
 * @property {string}  done       Said back to whoever pressed it.
 * @property {object}  changes    Wix field names — the adapter's business.
 * @property {string} [confirm]   Shown behind a second tap. Say what it costs.
 * @property {boolean} [calledOff] True for the one action that works on a
 *                                 booking already off the diary, false-y for
 *                                 the rest, which only work on a live one.
 * @property {(b) => boolean} [when]
 */

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
    confirm: 'Mark this booking as a no show? It comes off the diary and out of '
      + 'the counts. You can put it back from Called off.',
    when: (booking) => booking.status === STATUS.confirmed || booking.status === STATUS.seated,
  },
  cancel: {
    label: 'Cancel booking',
    done: 'Booking cancelled.',
    changes: { status: 'CANCELED' },
    confirm: 'Cancel this booking? Wix may email the guest to tell them. It comes '
      + 'off the diary, and you can put it back from Called off.',
    when: (booking) => booking.status === STATUS.confirmed
      || booking.status === STATUS.requested
      || booking.status === STATUS.seated,
  },
  note: {
    label: 'Save note',
    done: 'Note saved.',
    // The only action whose change comes from the page rather than from here.
    // Trimmed and capped: a note is a line for the team, and an unbounded one
    // is a paste accident that a phone then has to render on every render.
    from: (form) => ({ teamMessage: String(form.get('note') || '').trim().slice(0, NOTE_LIMIT) }),
    // Rendered as its own field rather than a button beside the others.
    standalone: true,
    // Worth writing on anything real, including a cancellation — why it was
    // called off is exactly the sort of thing somebody wants a week later.
    allow: (booking) => holdsASeat(booking) || isCalledOff(booking),
  },
  restore: {
    label: 'Put back on the diary',
    done: 'Back on the diary.',
    changes: { status: 'RESERVED' },
    calledOff: true,
    // No second tap. This is the way back from a mistake, and friction on the
    // recovery path is friction in exactly the wrong place — a booking put
    // back by accident can simply be cancelled again.
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
  const live = holdsASeat(booking);
  const calledOff = isCalledOff(booking);
  if (!live && !calledOff) return [];

  return Object.entries(ACTIONS)
    .filter(([, action]) => !action.standalone)
    // Which side of the diary an action works on is declared, never inferred.
    // "Mark paid" would otherwise match a cancelled booking through its own
    // `when` and invite recording a payment against something nobody is coming
    // to — the mirror of the bug that keeps actions off abandoned attempts.
    .filter(([, action]) => Boolean(action.calledOff) === calledOff)
    .filter(([, action]) => !action.when || action.when(booking))
    .map(([name, action]) => ({ name, ...action }));
}

/**
 * Whether an action may be applied to a booking at all — which is a different
 * question from whether a button for it is drawn.
 *
 * `availableFor` dresses a page; this is what the route asks before it writes.
 * A form post need not have come from a page we rendered, so "the button was
 * not there" is not a control, and without this a hand-made post could mark a
 * cancelled booking paid.
 */
export function permits(booking, name) {
  const action = ACTIONS[name];
  if (!action) return false;
  if (action.allow) return action.allow(booking);
  return availableFor(booking).some((available) => available.name === name);
}
