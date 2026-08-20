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
import { dateLabel, shiftDate, localDate } from '../time.js';
import { MAX_PARTY, OTHER } from '../draft.js';

/** How many days of chips before somebody has to open the date picker. */
const NEAR_DAYS = 7;

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

export function newBody({ date, experiences, sittings = [], values = {}, errors = [], today = null }) {
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
  ${whenChips({ date, now })}
  <form class="book" method="post" action="/new">
    <input type="hidden" name="date" value="${value('date', date)}">

    ${sittingChips({ sittings, experiences, values })}
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
function whenChips({ date, now }) {
  const days = Array.from({ length: NEAR_DAYS }, (_, step) => shiftDate(now, step));
  const listed = days.includes(date) ? days : [date, ...days.slice(0, NEAR_DAYS - 1)].sort();

  const chips = listed.map((each) => {
    const label = each === now ? 'Today'
      : each === shiftDate(now, 1) ? 'Tomorrow'
        : shortDay(each);
    return `<a class="chip${each === date ? ' on' : ''}" href="/new/${each}"
      ${each === date ? 'aria-current="true"' : ''}>${escape(label)}</a>`;
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
    <p class="chosen">${escape(dateLabel(date))}</p>
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
function sittingChips({ sittings, experiences, values }) {
  const chosen = values.sitting || (sittings.length ? sittingValue(sittings[0]) : OTHER);

  const chips = sittings.map((sitting) => {
    const left = sitting.capacity == null ? null : sitting.capacity - sitting.covers;
    const room = left == null ? '' : left <= 0 ? 'Full' : `${left} left`;
    const value = sittingValue(sitting);

    return `<label class="chip wide${left != null && left <= 0 ? ' spent' : ''}">
      <input type="radio" name="sitting" value="${escape(value)}" ${chosen === value ? 'checked' : ''}>
      <span class="chiptime">${escape(sitting.time)}</span>
      <span class="chipwhat">${escape(sitting.experience ? sitting.experience.name : 'A table')}</span>
      ${room ? `<span class="chipleft">${escape(room)}</span>` : ''}
    </label>`;
  }).join('');

  const options = experiences.map((experience) => `<option value="${escape(experience.id)}"
    ${values.experienceId === experience.id ? 'selected' : ''}>${escape(experience.name)}</option>`).join('');

  return `<fieldset class="chips">
    <legend>Sitting</legend>
    ${chips || '<p class="chosen">Nothing booked that day yet — set a time below.</p>'}
    <label class="chip ${sittings.length ? '' : 'only'}">
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

const sittingValue = (sitting) => `${sitting.time}|${sitting.experience ? sitting.experience.id : ''}`;

/** "Sat 15" — enough to pick a day out of a row without reading a date. */
function shortDay(iso) {
  const [weekday, day] = dateLabel(iso).split(' ');
  return `${weekday.slice(0, 3)} ${day}`;
}
