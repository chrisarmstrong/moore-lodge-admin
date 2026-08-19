/**
 * Turning a flat list of bookings into the thing staff actually picture:
 * a month of days, each holding its sittings, each sitting with covers against
 * capacity.
 *
 * Wix has no "sitting" record — a sitting only exists as the set of bookings
 * that share a start time. So it is derived here rather than fetched.
 */

import { localDate, localTime, datesInMonth, weekdayIndex } from './time.js';
import {
  holdsASeat, isInFlight, isDead, isHidden, contactKeys,
  PAYMENT, DISPOSITION, HOLD_MINUTES,
} from './domain.js';

/**
 * Works out what each unfinished attempt in a sitting really is.
 *
 * A guest who abandons the payment step and then books again successfully
 * leaves two records behind. Wix keeps both, so the diary shows the same person
 * twice and the "unpaid" count doubles. Worse, a held reservation from last
 * week still says `HELD`, as though somebody were choosing a table right now.
 *
 * Two questions sort it out. Is the attempt still within its ten-minute life?
 * And did the same person go on to book this sitting successfully?
 */
function classify(bookings, now) {
  const settled = new Set();
  for (const booking of bookings) {
    if (holdsASeat(booking)) for (const key of contactKeys(booking)) settled.add(key);
  }

  for (const booking of bookings) {
    if (holdsASeat(booking)) {
      booking.disposition = DISPOSITION.live;
      continue;
    }

    // No usable creation date means we cannot tell a live checkout from a dead
    // one. Err towards showing it: a stray visible row is a much smaller
    // problem than a booking quietly vanishing off the diary.
    const age = now - booking.createdAt;
    if (!Number.isFinite(age) || age < HOLD_MINUTES * 60_000) {
      booking.disposition = DISPOSITION.inProgress;
      continue;
    }

    const keys = contactKeys(booking);
    if (keys.some((key) => settled.has(key))) booking.disposition = DISPOSITION.superseded;
    else if (keys.length === 0) booking.disposition = DISPOSITION.stale;
    else booking.disposition = DISPOSITION.abandoned;
  }
}

/**
 * @param {import('./domain.js').Booking[]} bookings
 * @param {Map<string, import('./domain.js').Experience>} experiences
 * @param {Date} [now] Injected so the classification can be tested.
 * @returns {Map<string, import('./domain.js').Sitting[]>} keyed by local date
 */
export function groupIntoSittings(bookings, experiences, now = new Date()) {
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
        toSettle: 0,        // groups, not heads — one bill each
        toSettleGuests: 0,
        inProgress: 0,
        abandoned: 0,       // groups again: one phone call each
        abandonedGuests: 0,
        hidden: 0,
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

      classify(sitting.bookings, now);

      for (const booking of sitting.bookings) {
        if (booking.disposition === DISPOSITION.live) {
          sitting.covers += booking.partySize;
          // A phone booking is unpaid by design — it settles on arrival, the
          // way it always has. Counting those as a problem would flag most of
          // the diary and train everyone to ignore the number.
          if (booking.payment === PAYMENT.unpaid) {
            // A party settles one bill between them, so what front of house
            // needs to know is how many bills — not how many mouths.
            sitting.toSettle += 1;
            sitting.toSettleGuests += booking.partySize;
          }
        } else if (booking.disposition === DISPOSITION.inProgress) {
          sitting.inProgress += booking.partySize;
        } else if (booking.disposition === DISPOSITION.abandoned) {
          // Likewise one phone call each, whatever the party size.
          sitting.abandoned += 1;
          sitting.abandonedGuests += booking.partySize;
        } else {
          sitting.hidden += 1;
        }
      }

      // Superseded and stale attempts stay out of the diary entirely. They are
      // counted above so the day can say how many it swallowed, rather than
      // quietly losing records.
      sitting.bookings = sitting.bookings.filter((booking) => !isHidden(booking));
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
      abandoned: sittings.reduce((total, sitting) => total + sitting.abandoned, 0),
      inProgress: sittings.reduce((total, sitting) => total + sitting.inProgress, 0),
      toSettle: sittings.reduce((total, sitting) => total + sitting.toSettle, 0),
      toSettleGuests: sittings.reduce((total, sitting) => total + sitting.toSettleGuests, 0),
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
  let toSettleGuests = 0;
  let abandoned = 0;
  let abandonedGuests = 0;
  let inProgress = 0;
  let hidden = 0;
  let seatsOffered = 0;

  for (const list of sittingsByDate.values()) {
    for (const sitting of list) {
      sittings += 1;
      covers += sitting.covers;
      toSettle += sitting.toSettle;
      toSettleGuests += sitting.toSettleGuests;
      abandoned += sitting.abandoned;
      abandonedGuests += sitting.abandonedGuests;
      inProgress += sitting.inProgress;
      hidden += sitting.hidden;
      if (sitting.capacity != null) seatsOffered += sitting.capacity;
    }
  }

  return {
    sittings,
    covers,
    toSettle,
    toSettleGuests,
    abandoned,
    abandonedGuests,
    inProgress,
    hidden,
    seatsOffered,
    occupancy: seatsOffered ? Math.round((covers / seatsOffered) * 100) : null,
  };
}
