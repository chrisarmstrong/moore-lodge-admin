/**
 * Taking a booking over the phone.
 *
 * The screen somebody uses with a handset against their ear, so it asks for
 * things in the order they get said and nothing it can work out for itself.
 */

import { escape } from './layout.js';
import { dateLabel, localDate } from '../time.js';
import { MAX_PARTY } from '../draft.js';

export function newShell({ date }) {
  const back = `/day/${date}`;

  const titlebar = `<div class="titlebar">
    <a class="arrow" href="${back}" aria-label="Back to the day">&lsaquo;</a>
    <div class="title">
      <h1>New booking</h1>
      <p class="sub">By phone</p>
    </div>
    <span></span>
  </div>`;

  return { title: 'New booking', heading: 'New booking', titlebar, nav: '' };
}

/**
 * @param {object} options
 * @param {object[]} options.sittings  What is already on that day, so somebody
 *   can read the time back to the caller rather than looking it up elsewhere.
 */
export function newBody({ date, experiences, sittings = [], values = {}, errors = [] }) {
  const value = (name, fallback = '') => escape(values[name] ?? fallback);

  const problems = errors.length
    ? `<div class="error" role="alert"><p>${errors.length === 1 ? 'One thing to fix:' : 'A few things to fix:'}</p>
       <ul>${errors.map((error) => `<li>${escape(error)}</li>`).join('')}</ul></div>`
    : '';

  // Not a picker, deliberately: it is a reminder of what is already running
  // that day, so the time typed below is one the kitchen is expecting.
  const running = sittings.length
    ? `<p class="running"><b>Already on ${escape(dateLabel(values.date || date))}:</b>
       ${sittings.map((sitting) => {
    const of = sitting.capacity != null ? ` of ${sitting.capacity}` : '';
    return `${escape(sitting.time)} &middot; ${escape(sitting.experience ? sitting.experience.name : 'Reservations')}
            (${sitting.covers}${escape(of)})`;
  }).join(' &nbsp;·&nbsp; ')}</p>`
    : '';

  // A fresh form defaults to the experience, because that is what the lodge
  // sells; only an explicit empty string means somebody chose a plain table.
  // `??` rather than `||` is the whole distinction between the two.
  const chosen = values.experienceId ?? (experiences[0]?.id || '');
  const options = experiences.map((experience) => `<option value="${escape(experience.id)}"
    ${chosen === experience.id ? 'selected' : ''}>${escape(experience.name)}</option>`).join('');

  return `${problems}
  <form class="book" method="post" action="/new">
    ${running}

    <div class="pair">
      <p class="field"><label for="date">Date</label>
        <input id="date" name="date" type="date" value="${value('date', date)}" required></p>
      <p class="field"><label for="time">Time</label>
        <input id="time" name="time" type="time" value="${value('time')}" required></p>
    </div>

    <div class="pair">
      <p class="field"><label for="experienceId">What for</label>
        <select id="experienceId" name="experienceId">
          ${options}
          <option value="" ${chosen ? '' : 'selected'}>A table, no experience</option>
        </select></p>
      <p class="field"><label for="partySize">How many</label>
        <input id="partySize" name="partySize" type="number" inputmode="numeric"
          min="1" max="${MAX_PARTY}" value="${value('partySize')}" required></p>
    </div>

    <div class="pair">
      <p class="field"><label for="firstName">First name</label>
        <input id="firstName" name="firstName" type="text" autocomplete="off"
          value="${value('firstName')}" required></p>
      <p class="field"><label for="lastName">Last name</label>
        <input id="lastName" name="lastName" type="text" autocomplete="off" value="${value('lastName')}"></p>
    </div>

    <p class="field"><label for="phone">Phone</label>
      <input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="off"
        value="${value('phone')}" required>
      <span class="hint">Required. Wix will not take the booking without it.</span></p>

    <p class="field"><label for="email">Email</label>
      <input id="email" name="email" type="email" inputmode="email" autocomplete="off" value="${value('email')}">
      <span class="hint">Optional, but it is the only way they get a confirmation.</span></p>

    <p class="field"><label for="note">Note to team</label>
      <textarea id="note" name="note" rows="2"
        placeholder="Dietary requirements, occasion, anything else">${value('note')}</textarea></p>

    <div class="submit">
      <button type="submit" class="act primary">Take the booking</button>
      <a class="act" href="/day/${escape(values.date || date)}">Cancel</a>
    </div>
    <p class="hint">It is recorded unpaid, exactly as the Wix app records a phone booking.
      Wix may email the guest to confirm.</p>
  </form>`;
}

/** Where the header's add button points when nothing better is known. */
export function todayPath() {
  return `/new/${localDate()}`;
}
