/**
 * Turning a flat list of bookings into the thing staff actually picture:
 * a month of days, each holding its sittings, each sitting with covers against
 * capacity.
 *
 * Wix has no "sitting" record — a sitting only exists as the set of bookings
 * that share a start time. So it is derived here rather than fetched.
 */

import { localDate, localTime, datesInMonth, weekdayIndex } from './time.js';
import { holdsASeat, isInFlight, isDead, PAYMENT } from './domain.js';

/**
 * @param {import('./domain.js').Booking[]} bookings
 * @param {Map<string, import('./domain.js').Experience>} experiences
 * @returns {Map<string, import('./domain.js').Sitting[]>} keyed by local date
 */
export function groupIntoSittings(bookings, experiences) {
  const byDate = new Map();

  for (const booking of bookings) {
    if (isDead(booking)) continue; // cancellations shouldn't crowd the diary

    const date = localDate(booking.startsAt);
    const key = booking.startsAt.getTime();
    if (!byDate.has(date)) byDate.set(date, new Map());
    const sittings = byDate.get(date);
    if (!sittings.has(key)) {
      sittings.set(key, {
        startsAt: booking.startsAt,
        time: localTime(booking.startsAt),
        experience: null,
        bookings: [],
        covers: 0,
        capacity: null,
        toSettle: 0,
        pending: 0,
      });
    }
    sittings.get(key).bookings.push(booking);
  }

  const result = new Map();
  for (const [date, sittings] of byDate) {
    const list = [...sittings.values()].sort((a, b) => a.startsAt - b.startsAt);
    for (const sitting of list) {
      sitting.experience = dominantExperience(sitting.bookings, experiences);
      sitting.capacity = sitting.experience?.seatsPerSitting ?? null;
      for (const booking of sitting.bookings) {
        if (holdsASeat(booking)) {
          sitting.covers += booking.partySize;
          // A phone booking is unpaid by design — it settles on arrival, the
          // way it always has. Counting those as a problem would flag most of
          // the diary and train everyone to ignore the number. What is worth
          // flagging is a guest who is mid-checkout and hasn't paid.
          if (booking.payment === PAYMENT.unpaid) sitting.toSettle += booking.partySize;
        } else if (isInFlight(booking)) {
          sitting.pending += booking.partySize;
        }
      }
    }
    result.set(date, list);
  }
  return result;
}

/**
 * A sitting is normally all one experience. Where it isn't — a phone booking
 * recorded without one, say — the experience backing the most guests wins, so
 * the capacity shown is the most plausible one rather than none at all.
 */
function dominantExperience(bookings, experiences) {
  const weight = new Map();
  for (const booking of bookings) {
    if (!booking.experienceId || !experiences.has(booking.experienceId)) continue;
    weight.set(booking.experienceId, (weight.get(booking.experienceId) || 0) + booking.partySize);
  }
  let best = null;
  for (const [id, guests] of weight) {
    if (!best || guests > best.guests) best = { id, guests };
  }
  return best ? experiences.get(best.id) : null;
}

/**
 * The month laid out as whole Monday-to-Sunday weeks, with the leading and
 * trailing days of the neighbouring months included so the grid is square.
 */
export function monthGrid(isoMonth, sittingsByDate) {
  const dates = datesInMonth(isoMonth);
  const cells = [];

  const leading = weekdayIndex(dates[0]);
  for (let i = 0; i < leading; i += 1) cells.push({ date: null, outside: true });

  for (const date of dates) {
    const sittings = sittingsByDate.get(date) || [];
    cells.push({
      date,
      day: Number(date.slice(8)),
      outside: false,
      sittings,
      covers: sittings.reduce((total, sitting) => total + sitting.covers, 0),
      pending: sittings.reduce((total, sitting) => total + sitting.pending, 0),
      toSettle: sittings.reduce((total, sitting) => total + sitting.toSettle, 0),
    });
  }

  while (cells.length % 7 !== 0) cells.push({ date: null, outside: true });

  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Headline figures for the month, for the strip above the grid. */
export function monthSummary(sittingsByDate) {
  let sittings = 0;
  let covers = 0;
  let toSettle = 0;
  let pending = 0;
  let seatsOffered = 0;

  for (const list of sittingsByDate.values()) {
    for (const sitting of list) {
      sittings += 1;
      covers += sitting.covers;
      toSettle += sitting.toSettle;
      pending += sitting.pending;
      if (sitting.capacity != null) seatsOffered += sitting.capacity;
    }
  }

  return {
    sittings,
    covers,
    toSettle,
    pending,
    seatsOffered,
    occupancy: seatsOffered ? Math.round((covers / seatsOffered) * 100) : null,
  };
}
