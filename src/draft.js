/**
 * Reading a phone booking off a form.
 *
 * Kept apart from the view and the adapter because it is the part with rules,
 * and rules want testing without a browser or a network. Everything here is
 * domain vocabulary: what comes out is a BookingDraft, and what it knows about
 * Wix is nothing.
 */

import { isValidDate, localDate, localTime } from './time.js';
import { NOTE_LIMIT } from './actions.js';

export const MAX_PARTY = 60;

/**
 * @returns {{ draft: import('./domain.js').BookingDraft|null, errors: string[], values: object }}
 *
 * `values` comes back whatever happens, so a rejected form can be handed
 * straight back with what somebody typed still in it. Retyping a booking
 * because one field was wrong is how a phone call goes badly.
 */
export function readDraft(form, { experiences = new Map() } = {}) {
  const get = (name) => String(form.get(name) ?? '').trim();

  const values = {
    date: get('date'),
    time: get('time'),
    partySize: get('partySize'),
    firstName: get('firstName'),
    lastName: get('lastName'),
    phone: get('phone'),
    email: get('email'),
    experienceId: get('experienceId'),
    note: get('note').slice(0, NOTE_LIMIT),
  };

  const errors = [];

  if (!isValidDate(values.date)) errors.push('Pick a date.');
  if (!/^\d{2}:\d{2}$/.test(values.time)) errors.push('Give a time, like 12:30.');

  const partySize = Number(values.partySize);
  if (!Number.isInteger(partySize) || partySize < 1) errors.push('How many people?');
  else if (partySize > MAX_PARTY) errors.push(`${partySize} is more people than the lodge seats.`);

  // Both are required by the API for anything that is not a walk-in, so it is
  // better to say so here than to let Wix say it in its own words.
  if (!values.firstName) errors.push('A first name is needed.');
  if (!values.phone) errors.push('A phone number is needed — it is how the booking is confirmed.');
  else if (values.phone.replace(/\D/g, '').length < 7) errors.push('That phone number looks too short.');

  if (values.email && !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(values.email)) {
    errors.push('That email address does not look right.');
  }

  if (values.experienceId && !experiences.has(values.experienceId)) {
    errors.push('That experience is not one we run.');
  }

  if (errors.length) return { draft: null, errors, values };

  return {
    draft: {
      startsAt: localToInstant(values.date, values.time),
      partySize,
      firstName: values.firstName,
      lastName: values.lastName || null,
      phone: values.phone,
      email: values.email || null,
      experienceId: values.experienceId || null,
      teamMessage: values.note || null,
    },
    errors,
    values,
  };
}

/**
 * "2026-08-06" and "12:30" in Ballymoney to the instant it actually is.
 *
 * The lodge says half twelve; Wix stores 11:30Z in summer and 12:30Z in winter,
 * so guessing the offset puts a booking an hour out for half the year. It is
 * measured instead: read the candidate back in local time, and shift it by
 * however far off it reads. Twice, because the shift can itself cross a
 * changeover — and the loop stops when the reading matches, not when some
 * offset is zero, which is the version of this that walks an hour further away
 * on every pass.
 */
function localToInstant(date, time) {
  const wanted = `${date}T${time}`;
  let guess = new Date(`${wanted}:00Z`);

  for (let pass = 0; pass < 2; pass += 1) {
    const reads = `${localDate(guess)}T${localTime(guess)}`;
    if (reads === wanted) break;
    guess = new Date(guess.getTime() - (new Date(`${reads}:00Z`) - new Date(`${wanted}:00Z`)));
  }

  return guess;
}
