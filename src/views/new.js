/**
 * Taking a booking over the phone.
 *
 * The screen somebody uses one-handed with a handset against their ear, so the
 * three things a caller leads with — when, which sitting, how many — are taps
 * rather than pickers, and the only typing is the two things that genuinely
 * have to be typed. What is left fits on one screen, which is what makes it
 * possible to read the booking back before hanging up.
 */

import { escape } from './layout.js';
import { dateLabel, shiftDate, localDate, localTime } from '../time.js';
import { MAX_PARTY, OTHER } from '../draft.js';

/** How many days of chips before somebody has to open the date picker. */
export const NEAR_DAYS = 7;

/** Enough to be one row on a phone. Seven and up is a hen party, and typed. */
const COMMON_PARTIES = [1, 2, 3, 4, 5, 6];

export function newShell({ date }) {
  const titlebar = `<div class="titlebar">
    <a class="arrow" href="/day/${date}" aria-label="Back to the day">&lsaquo;</a>
    <div class="title">
      <h1>New booking</h1>
      <p class="sub">By phone</p>
    </div>
    <span></span>
  </div>`;

  return { title: 'New booking', heading: 'New booking', titlebar, nav: '' };
}

export function newBody({
  date, experiences, experience = null, slots = [], running = null,
  sittings = [], values = {}, errors = [], today = null,
}) {
  const value = (name, fallback = '') => escape(values[name] ?? fallback);
  const now = today || localDate();

  const problems = errors.length
    ? `<div class="error" role="alert"><p>${errors.length === 1 ? 'One thing to fix:' : 'A few things to fix:'}</p>
       <ul>${errors.map((error) => `<li>${escape(error)}</li>`).join('')}</ul></div>`
    : '';

  // The date is chosen by navigation, so its picker is a GET form of its own —
  // and a form inside a form is invalid, which the parser resolves by closing
  // the outer one early and putting the rest of the booking outside it.
  return `${problems}
  ${experienceChips({ experiences, experience, date })}
  ${whenChips({ date, now, running, experience })}
  <form class="book" method="post" action="/new">
    <input type="hidden" name="date" value="${value('date', date)}">

    ${sittingChips({ slots, sittings, experiences, experience, values })}
    ${partyChips({ values })}

    <p class="field"><label for="name">Name</label>
      <input id="name" name="name" type="text" autocomplete="off" autocapitalize="words"
        enterkeyhint="next" value="${value('name')}" required></p>

    <p class="field"><label for="phone">Phone</label>
      <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="off"
        enterkeyhint="done" value="${value('phone')}" required>
      <span class="hint">Wix will not take the booking without it.</span></p>

    <details class="more" ${values.email || values.note ? 'open' : ''}>
      <summary>Email and notes</summary>
      <p class="field"><label for="email">Email</label>
        <input id="email" name="email" type="email" inputmode="email" autocomplete="off" value="${value('email')}">
        <span class="hint">The only way they get a confirmation.</span></p>
      <p class="field"><label for="note">Note to team</label>
        <textarea id="note" name="note" rows="2"
          placeholder="Dietary requirements, occasion, anything else">${value('note')}</textarea></p>
    </details>

    <div class="submit">
      <a class="giveup" href="/day/${escape(values.date || date)}">Leave without booking</a>
      <button type="submit" class="act primary" data-busy="Taking the booking…">Take the booking</button>
    </div>
    <p class="hint">Recorded unpaid, as the Wix app records a phone booking. Wix may email the guest.</p>
  </form>`;
}

/**
 * The next week as taps, and a picker for everything else.
 *
 * These are links rather than fields, so the sittings below always belong to
 * the date above them — a chip that only changed a hidden value would leave
 * yesterday's sittings on screen with today's date, which is worse than a
 * reload. The cost is that changing the date after typing loses the typing,
 * which is why the date is the first thing on the page.
 */
/**
 * Which experience is being sold.
 *
 * Absent entirely when the lodge runs one, because choosing from a list of one
 * is a decision nobody should be asked to make. It appears the day a second is
 * added, and until then the single experience is simply what a booking is for.
 */
function experienceChips({ experiences, experience, date }) {
  if (experiences.length < 2) return '';

  const chips = experiences.map((each) => `<a class="chip${each.id === (experience && experience.id) ? ' on' : ''}"
    href="/new/${date}?experience=${encodeURIComponent(each.id)}">${escape(each.name)}</a>`).join('');

  return `<section class="chips when" aria-label="What for">
    <p class="legend">What for</p>
    <div class="chiprow">${chips}</div>
  </section>`;
}

function whenChips({ date, now, running, experience }) {
  const days = Array.from({ length: NEAR_DAYS }, (_, step) => shiftDate(now, step));
  const listed = days.includes(date) ? days : [date, ...days.slice(0, NEAR_DAYS - 1)].sort();

  const carried = experience ? `?experience=${encodeURIComponent(experience.id)}` : '';
  const what = experience ? experience.name : 'The lodge';

  const chips = listed.map((each) => {
    const label = each === now ? 'Today'
      : each === shiftDate(now, 1) ? 'Tomorrow'
        : shortDay(each);
    // Marked, never disabled. "We don't do tea on a Tuesday" is something to be
    // able to say from the screen, and a day off is still a day somebody may
    // decide to open — that call is theirs, not the form's.
    const shut = running && !running.has(each);
    return `<a class="chip${each === date ? ' on' : ''}${shut ? ' shut' : ''}" href="/new/${each}${carried}"
      ${each === date ? 'aria-current="true"' : ''}
      ${shut ? `title="${escape(what)} does not run this day"` : ''}>${escape(label)}</a>`;
  }).join('');

  return `<section class="chips when" aria-label="When">
    <p class="legend">When</p>
    <div class="chiprow">${chips}
      <details class="datepick" ${listed.includes(date) ? '' : 'open'}>
        <summary class="chip">Other&hellip;</summary>
        <form class="jump" method="get" action="/new">
          <input type="date" name="date" value="${escape(date)}" aria-label="Another date">
          <button type="submit" class="act">Go</button>
        </form>
      </details>
    </div>
    <p class="chosen">${escape(dateLabel(date))}${running && !running.has(date)
    ? ` &middot; <b>${escape(what)} does not run this day</b>` : ''}</p>
  </section>`;
}

/**
 * What is already running that day, as the thing you tap.
 *
 * The seats remaining are the point: mid-call somebody needs to be able to say
 * "12:30 is full, I can do you 13:30" without leaving the screen. A sitting
 * that cannot take the party is still shown — the answer to "is there anything
 * at half twelve" is yes-but-full, not silence.
 */
function sittingChips({ slots, sittings, experiences, experience, values }) {
  // The schedule says which sittings exist; the diary only says how full they
  // are. Reading it the other way round — which is what this did — makes a day
  // nobody has booked yet look like a day nothing runs.
  const booked = new Map(sittings.map((sitting) => [localTime(sitting.startsAt), sitting]));

  const offered = slots.map((slot) => {
    const time = localTime(slot.startsAt);
    const sitting = booked.get(time) || null;
    const capacity = sitting ? sitting.capacity : (experience ? experience.seatsPerSitting : null);
    const covers = sitting ? sitting.covers : 0;
    const left = capacity == null ? null : capacity - covers;

    return {
      time,
      value: `${time}|${experience ? experience.id : ''}`,
      name: experience ? experience.name : 'A table',
      room: slot.full || (left != null && left <= 0) ? 'Full'
        : left == null ? '' : `${left} left`,
      spent: slot.full || (left != null && left <= 0),
    };
  });

  const chosen = values.sitting || (offered.length ? offered[0].value : OTHER);

  const chips = offered.map((slot) => `<label class="chip wide${slot.spent ? ' spent' : ''}">
    <input type="radio" name="sitting" value="${escape(slot.value)}" ${chosen === slot.value ? 'checked' : ''}>
    <span class="chiptime">${escape(slot.time)}</span>
    <span class="chipwhat">${escape(slot.name)}</span>
    ${slot.room ? `<span class="chipleft">${escape(slot.room)}</span>` : ''}
  </label>`).join('');

  const options = experiences.map((each) => `<option value="${escape(each.id)}"
    ${values.experienceId === each.id ? 'selected' : ''}>${escape(each.name)}</option>`).join('');

  // "Full" is a fact, not a refusal. Somebody on the phone can decide to seat
  // eleven at a table for ten, and the form's job is to tell them what they are
  // deciding rather than to decide it.
  return `<fieldset class="chips">
    <legend>Sitting</legend>
    ${chips || `<p class="chosen">Nothing runs that day — set a time below to book anyway.</p>`}
    <label class="chip ${offered.length ? '' : 'only'}">
      <input type="radio" name="sitting" value="${OTHER}" ${chosen === OTHER ? 'checked' : ''}>
      <span>Another time</span>
    </label>
    <div class="reveals pair">
      <p class="field"><label for="time">Time</label>
        <input id="time" name="time" type="time" value="${escape(values.time || '')}"></p>
      <p class="field"><label for="experienceId">What for</label>
        <select id="experienceId" name="experienceId">
          ${options}
          <option value="" ${values.experienceId ? '' : 'selected'}>A table, no experience</option>
        </select></p>
    </div>
  </fieldset>`;
}

function partyChips({ values }) {
  const chosen = values.party || (values.partySize && !COMMON_PARTIES.includes(Number(values.partySize))
    ? OTHER
    : values.partySize || '');

  const chips = COMMON_PARTIES.map((size) => `<label class="chip num">
    <input type="radio" name="party" value="${size}" ${String(chosen) === String(size) ? 'checked' : ''}>
    <span>${size}</span>
  </label>`).join('');

  return `<fieldset class="chips">
    <legend>How many</legend>
    <div class="chiprow">${chips}
      <label class="chip num wider">
        <input type="radio" name="party" value="${OTHER}" ${chosen === OTHER ? 'checked' : ''}>
        <span>More</span>
      </label>
    </div>
    <p class="field reveals"><label for="partySize">How many</label>
      <input id="partySize" name="partySize" type="number" inputmode="numeric"
        min="1" max="${MAX_PARTY}" value="${escape(values.partySize || '')}"></p>
  </fieldset>`;
}

/** "Sat 15" — enough to pick a day out of a row without reading a date. */
function shortDay(iso) {
  const [weekday, day] = dateLabel(iso).split(' ');
  return `${weekday.slice(0, 3)} ${day}`;
}
