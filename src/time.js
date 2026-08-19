/**
 * Everything here exists because the lodge thinks in Europe/London and the API
 * answers in UTC.
 *
 * A 13:30 sitting in August is stored as 12:30Z. Deriving "today" from
 * `new Date().toISOString()` would therefore show tomorrow's covers from 11pm
 * on a summer evening, and a month grid built the same way would drop or
 * duplicate a sitting at each end. So local dates are computed through Intl,
 * which knows when the clocks change, rather than by adding a fixed offset.
 */

export const ZONE = 'Europe/London';

const PARTS = new Intl.DateTimeFormat('en-GB', {
  timeZone: ZONE,
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

function zonedParts(instant) {
  const parts = Object.fromEntries(
    PARTS.formatToParts(instant)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  // en-GB renders midnight as hour 24 rather than 0.
  parts.hour %= 24;
  return parts;
}

/** Milliseconds to add to a UTC instant to read it as local wall-clock time. */
function offsetAt(instant) {
  const p = zonedParts(instant);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - instant.getTime();
}

/**
 * The UTC instant of a local wall-clock time.
 *
 * Applied twice: the first pass uses the offset in force at roughly the right
 * moment, the second corrects it for the case where that guess landed on the
 * far side of a clock change.
 */
function toInstant(year, month, day, hour = 0, minute = 0) {
  const target = Date.UTC(year, month - 1, day, hour, minute, 0);
  let instant = new Date(target - offsetAt(new Date(target)));
  instant = new Date(target - offsetAt(instant));
  return instant;
}

/** Local calendar date, as `YYYY-MM-DD`. */
export function localDate(instant = new Date()) {
  const p = zonedParts(instant);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local month, as `YYYY-MM`. */
export function localMonth(instant = new Date()) {
  return localDate(instant).slice(0, 7);
}

/** Local clock time of a UTC instant, as `HH:MM`. */
export function localTime(instant) {
  const p = zonedParts(instant instanceof Date ? instant : new Date(instant));
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** The half-open UTC window `[start, end)` covering a local calendar day. */
export function dayWindow(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return { start: toInstant(year, month, day), end: toInstant(year, month, day + 1) };
}

/** The half-open UTC window `[start, end)` covering a local calendar month. */
export function monthWindow(isoMonth) {
  const [year, month] = isoMonth.split('-').map(Number);
  return { start: toInstant(year, month, 1), end: toInstant(year, month + 1, 1) };
}

/** Every local date in a month, as `YYYY-MM-DD`. */
export function datesInMonth(isoMonth) {
  const [year, month] = isoMonth.split('-').map(Number);
  const dates = [];
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (let day = 1; day <= lastDay; day += 1) dates.push(`${year}-${pad(month)}-${pad(day)}`);
  return dates;
}

/** Monday-based weekday index (0–6) for a local date. */
export function weekdayIndex(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}

export function shiftMonth(isoMonth, delta) {
  const [year, month] = isoMonth.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`;
}

export function shiftDate(isoDate, delta) {
  const [year, month, day] = isoDate.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + delta));
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function monthLabel(isoMonth) {
  const [year, month] = isoMonth.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function dateLabel(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return `${DAY_NAMES[weekdayIndex(isoDate)]} ${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function isValidMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}

export function isValidDate(value) {
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value);
}

function pad(n) {
  return String(n).padStart(2, '0');
}
