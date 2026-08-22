/**
 * The freetobook implementation of `RoomsRepository`.
 *
 * This is the only file in Samson that knows what freetobook's availability
 * feed looks like. Everything it returns is in the vocabulary of `domain.js`.
 *
 * ## What this can and cannot know
 *
 * The feed is the public one behind the booking page: per unit, per night, a
 * flag saying the room is taken. There is no reservation in it — no guest name,
 * no arrival time, no phone number, nothing to act on but the fact that
 * somebody is in the room. That is enough for housekeeping to know a bed is
 * being slept in, and it is the whole of what this adapter promises.
 *
 * Two consequences worth knowing before trusting a number off this screen:
 *
 * 1. **Back-to-back stays read as one.** A room let on Friday to one party and
 *    on Saturday to another is indistinguishable from a two-night stay, so that
 *    Saturday changeover is not shown. Rooms that empty are always right;
 *    rooms that turn round are not always visible.
 * 2. **A cancellation simply reappears as free.** Nothing says a booking went
 *    away, so nothing can be said about it.
 *
 * 3. **It only answers for today onwards.** Ask for a night that has already
 *    happened and freetobook does not say so: it answers 200 with a handful of
 *    unrelated dates, which is a far worse failure than an error, because it
 *    looks exactly like an answer. `inRange` therefore never asks for a past
 *    night, and reports only the nights it genuinely knows rather than filling
 *    the rest in with zeroes.
 *
 * All three are properties of the feed, not of this code. Named guests need
 * freetobook's private per-booking feed, which is a different adapter behind
 * the same interface — which is the point of there being an interface.
 */

import { Freetobook } from '../freetobook.js';
import { shiftDate, localDate } from '../time.js';
import { ROOM } from '../domain.js';

// Names, photos and the unit list change rarely; who is in a room changes while
// somebody is looking at it — but not by the minute, and a stale room strip is
// a much smaller problem than a stale diary.
const UNITS_TTL = 3600;
const NIGHTS_TTL = 300;

/**
 * Exclusive use is sold as its own unit but it is not a room: it is the whole
 * house. Matched by id with a name fallback, mirroring the public site, so a
 * unit recreated in freetobook does not quietly become a twelfth bedroom.
 */
const EXCLUSIVE_USE_ID = 268597;
const EXCLUSIVE_USE_NAME = /exclusive use/i;

export class FreetobookRooms {
  constructor(env, ctx) {
    this.freetobook = new Freetobook(env, ctx);
  }

  /**
   * Every night from `from` to `to` inclusive, keyed by local date. A night
   * freetobook would not or did not answer for is absent rather than empty.
   *
   * @param {{from: string, to: string}} range local `YYYY-MM-DD` dates
   * @param {string} [today] Injected so the clamp below can be tested.
   * @returns {Promise<Map<string, import('../domain.js').RoomDay>>}
   */
  async inRange({ from, to }, today = localDate()) {
    // freetobook answers nonsense rather than an error for a past `from_date`
    // — a 200 carrying two dates that have nothing to do with the range asked
    // for. Nothing downstream could tell that from a real answer, so the guard
    // has to be here, before the question is put.
    const start = from < today ? today : from;
    if (start > to) return new Map();

    // One night of lead-in, because arriving, staying and newly empty are all
    // questions about last night. It cannot be had for today — that night is
    // in the past — so today is read without it, and says so.
    const lead = shiftDate(start, -1);
    const [widget, availability] = await Promise.all([
      this.freetobook.widget(UNITS_TTL),
      this.freetobook.availability(lead < today ? start : lead, to, NIGHTS_TTL),
    ]);

    const property = widget?.properties?.[0];
    if (!property) return new Map();

    const units = lettableUnits(property);
    const nights = withExclusiveUse(readNights(availability, property.id), property);

    const days = new Map();
    for (let date = start; date <= to; date = shiftDate(date, 1)) {
      const tonight = nights.get(date);
      // A date freetobook did not answer for is not a date with no bookings —
      // it is a date we know nothing about, and saying "0 rooms let" would be
      // a housekeeping problem rather than a display one. Left out entirely,
      // so a caller gets null for it and can say it was never told.
      if (!tonight) continue;
      const before = shiftDate(date, -1);
      days.set(date, roomDay(date, units, tonight, nights.get(before), nights.has(before)));
    }
    return days;
  }
}

/**
 * The units that can actually be let, in the order the public site lists them,
 * so the strip reads the same way round as the website the team already knows.
 * Exclusive use is left out: it is dealt with by `withExclusiveUse` instead.
 */
function lettableUnits(property) {
  const order = property.priorityOrderedUnitIds || [];
  const rank = (unit) => {
    const at = order.indexOf(unit.id);
    return at === -1 ? Number.MAX_SAFE_INTEGER : at;
  };
  return (property.units || [])
    .filter((unit) => !isExclusiveUse(unit))
    .slice()
    .sort((a, b) => rank(a) - rank(b))
    .map((unit) => ({
      id: unit.id,
      name: unit.name,
      // freetobook's own distinction: a "room" is a bedroom in the house, a
      // "unit" is one of the cottages.
      group: unit.type === 'room' ? 'rooms' : 'cottages',
    }));
}

/** `Map<date, {units: Map<unitId, Night>, wholeHouse: boolean}>`. */
function readNights(availability, propertyId) {
  const property = (availability || []).find((p) => p.propertyId === propertyId)
    || (availability || [])[0];

  const nights = new Map();
  for (const day of property?.datedPropertyAvailabilities || []) {
    const units = new Map();
    for (const unit of day.unitAvailabilities || []) {
      // Every unit at Moore Lodge has an allocation of one, so this is a
      // boolean in practice. It is counted rather than tested because a unit
      // sold as several identical rooms would otherwise report one bed made
      // when four were slept in.
      const pseudo = unit.pseudoUnitAvailabilities || [];
      units.set(unit.unitId, {
        booked: pseudo.filter((p) => p.isBooked).length,
        of: pseudo.length || unit.allocation || 1,
        maintenance: pseudo.some((p) => p.isUnderMaintenance),
        closed: !!unit.isClosedOut,
      });
    }
    nights.set(day.date, { units, wholeHouse: false });
  }
  return nights;
}

/**
 * Exclusive use, spread back over the bedrooms it actually occupies.
 *
 * freetobook sells the whole house as a unit of its own, and books it without
 * touching the eight bedrooms — so a house full of one wedding party reads,
 * night after night, as eight empty bedrooms. That is the one reading of this
 * feed that could send nobody upstairs at all.
 *
 * So a booked exclusive-use night marks every bedroom let. The cottages are not
 * part of it: exclusive use is the house and its grounds, and the cottages are
 * sold alongside. Because it is applied before arrivals and departures are
 * worked out, a Friday-to-Sunday takeover produces eight arrivals on the Friday
 * and eight changeovers on the Monday, which is exactly what happens.
 */
function withExclusiveUse(nights, property) {
  const exclusive = (property.units || []).find(isExclusiveUse);
  if (!exclusive) return nights;
  const bedrooms = (property.units || [])
    .filter((unit) => unit.type === 'room' && !isExclusiveUse(unit))
    .map((unit) => unit.id);

  for (const night of nights.values()) {
    if (!(night.units.get(exclusive.id)?.booked > 0)) continue;
    night.wholeHouse = true;
    for (const id of bedrooms) {
      const bedroom = night.units.get(id);
      // A bedroom missing from that night's feed is left missing rather than
      // invented: `roomDay` knows what to do with a room it cannot see.
      if (bedroom) bedroom.booked = Math.max(bedroom.booked, 1);
    }
  }
  return nights;
}

function roomDay(date, units, tonight, lastNight, priorKnown) {
  let occupied = 0;
  let lettable = 0;
  let arrivals = 0;
  let departures = 0;

  const rooms = [];
  for (const unit of units) {
    const now = tonight.units.get(unit.id);
    // A unit freetobook stopped answering for is dropped rather than shown as
    // free: it may have been retired, and an empty row for a room that no
    // longer exists is worse than one fewer row.
    if (!now) continue;

    const before = lastNight?.units.get(unit.id);
    const state = stateOf(now, before, priorKnown);
    lettable += now.of;
    occupied += Math.min(now.booked, now.of);
    if (state === ROOM.arriving) arrivals += 1;
    if (state === ROOM.departed) departures += 1;
    rooms.push({ ...unit, state });
  }

  return {
    date, rooms, occupied, lettable, arrivals, departures,
    wholeHouse: !!tonight.wholeHouse,
    // False for the first night the feed covers, which is today. Without last
    // night there is no telling an arrival from a stay already in progress, and
    // this morning's changeovers cannot be seen at all — so the view says so
    // rather than quietly reporting none.
    priorKnown: !!priorKnown,
  };
}

/**
 * Departure outranks maintenance and closed-out deliberately. A room let last
 * night and blocked tonight still has last night's sheets on it, and stripping
 * it is the thing somebody has to do about it this morning.
 *
 * With no night before to compare against — today, whose predecessor is a date
 * freetobook will not discuss — an occupied room is reported as simply in use.
 * "Arriving" would be a claim, and about half the time the wrong one.
 */
function stateOf(now, before, priorKnown) {
  if (now.booked > 0) {
    if (!priorKnown) return ROOM.let;
    return before?.booked > 0 ? ROOM.staying : ROOM.arriving;
  }
  if (priorKnown && before?.booked > 0) return ROOM.departed;
  if (now.maintenance) return ROOM.maintenance;
  if (now.closed) return ROOM.closed;
  return ROOM.free;
}

function isExclusiveUse(unit) {
  return unit.id === EXCLUSIVE_USE_ID || EXCLUSIVE_USE_NAME.test(unit.name || '');
}
