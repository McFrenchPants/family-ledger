/**
 * Household-timezone-aware calendar dates for Family Ledger.
 *
 * STANDING PROJECT RULE: every household has a configured IANA time zone, and
 * `today`, `due`, and `overdue` are determined against *that* zone -- never the
 * browser's, the database server's, or the edge runtime's implicit local time.
 * Getting this wrong makes an allowance look overdue a day early for a family
 * that happens to be east of the deploy region, which is exactly the class of
 * bug that erodes trust in a ledger.
 *
 * Conventions, matching the database:
 *   - A *moment* is a `timestamptz` in PostgreSQL and a `Date` here. A `Date`
 *     is an instant on the timeline; it has no zone of its own.
 *   - A *calendar date* is a `date` in PostgreSQL and a `"YYYY-MM-DD"` string
 *     here. It is a label on a wall calendar, not an instant, and it is only
 *     meaningful once you say which zone produced it.
 *
 * Everything below is a pure function of its arguments. In particular nothing
 * calls `new Date()` implicitly: `todayInZone` takes the current instant as a
 * parameter (defaulted) so that tests can pin it, and so that no code path can
 * accidentally depend on the host clock's *zone*.
 *
 * Implementation note: the conversion goes through `Intl.DateTimeFormat`'s
 * `formatToParts` with an explicit `timeZone`, which is the only mechanism in
 * the platform that applies the IANA database (including historical DST rules)
 * without going through host-local time. `Date.prototype.getFullYear()` and
 * friends are host-local and are never used here.
 */

/** A calendar day in `YYYY-MM-DD` form, matching PostgreSQL `date`. */
export type CalendarDate = string;

/** Thrown when a time zone or calendar date argument is not usable. */
export class TimeZoneError extends Error {
  readonly timeZone: string;

  constructor(message: string, timeZone: string) {
    super(message);
    this.name = "TimeZoneError";
    this.timeZone = timeZone;
  }
}

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Formatter construction is not free and these are reused constantly (one per
 * render of a ledger list), so cache per zone.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached !== undefined) {
    return cached;
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      // Force the proleptic Gregorian calendar regardless of locale defaults.
      calendar: "gregory",
      // Pin the numbering system so `Number()` on the parts is always safe --
      // some locales would otherwise emit non-ASCII digits.
      numberingSystem: "latn",
      era: "short",
    });
  } catch {
    throw new TimeZoneError(`Unknown IANA time zone: ${timeZone}`, timeZone);
  }
  formatterCache.set(timeZone, formatter);
  return formatter;
}

/**
 * True if `timeZone` is an IANA zone this runtime recognises.
 * Useful for validating a household's configured zone at the edge of the app.
 */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The calendar date that `instant` falls on **in `timeZone`**.
 *
 * This is the core primitive of this module. The same instant yields different
 * dates in different zones, which is the entire point:
 *
 * @example
 * const instant = new Date("2026-01-01T03:30:00Z");
 * calendarDateInZone(instant, "Europe/Paris");       // "2026-01-01"
 * calendarDateInZone(instant, "America/Los_Angeles");// "2025-12-31"
 *
 * @throws {TimeZoneError} if `timeZone` is not a recognised IANA zone.
 * @throws {RangeError} if `instant` is an Invalid Date.
 */
export function calendarDateInZone(instant: Date, timeZone: string): CalendarDate {
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError("Cannot take the calendar date of an Invalid Date.");
  }

  const parts = formatterFor(timeZone).formatToParts(instant);

  let year = "";
  let month = "";
  let day = "";
  let isBce = false;

  for (const part of parts) {
    if (part.type === "year") {
      year = part.value;
    } else if (part.type === "month") {
      month = part.value;
    } else if (part.type === "day") {
      day = part.value;
    } else if (part.type === "era") {
      isBce = part.value !== "AD";
    }
  }

  if (year === "" || month === "" || day === "") {
    throw new TimeZoneError(`Could not resolve a calendar date in ${timeZone}.`, timeZone);
  }
  if (isBce) {
    // Not representable as a PostgreSQL-style ISO `date` string here, and
    // certainly not a real ledger value. Fail loudly rather than emit garbage.
    throw new RangeError("Calendar dates before 1 CE are not supported.");
  }

  return `${year.padStart(4, "0")}-${month}-${day}`;
}

/**
 * Today's calendar date in the household's zone.
 *
 * `now` is a parameter (not an implicit `new Date()` deep inside) so callers
 * and tests control the instant. The *zone* is never implicit.
 */
export function todayInZone(timeZone: string, now: Date = new Date()): CalendarDate {
  return calendarDateInZone(now, timeZone);
}

/** True if `value` is a syntactically and calendrically valid `YYYY-MM-DD`. */
export function isValidCalendarDate(value: string): value is CalendarDate {
  const match = CALENDAR_DATE_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  // Round-trip through a UTC instant to reject 2026-02-30 and friends. UTC is
  // safe here because a `YYYY-MM-DD` label carries no zone; we are only using
  // Date as a calendar calculator, never as a moment.
  const asUtc = new Date(Date.UTC(year, month - 1, day));
  return (
    asUtc.getUTCFullYear() === year &&
    asUtc.getUTCMonth() === month - 1 &&
    asUtc.getUTCDate() === day
  );
}

function assertCalendarDate(value: string, label: string): void {
  if (!isValidCalendarDate(value)) {
    throw new RangeError(`${label} must be a valid YYYY-MM-DD date, received "${value}".`);
  }
}

/**
 * Compare two calendar dates: negative if `a` is earlier, 0 if equal, positive
 * if `a` is later. Zero-padded ISO dates sort lexicographically, so this is
 * exact -- no Date object, no zone, no DST edge case.
 */
export function compareCalendarDates(a: CalendarDate, b: CalendarDate): number {
  assertCalendarDate(a, "First date");
  assertCalendarDate(b, "Second date");
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** Add (or, with a negative `days`, subtract) whole days from a calendar date. */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  assertCalendarDate(date, "Date");
  if (!Number.isInteger(days)) {
    throw new TypeError(`days must be a whole number, received ${String(days)}.`);
  }
  const match = CALENDAR_DATE_PATTERN.exec(date);
  // Non-null: assertCalendarDate above already matched this pattern.
  const [, year, month, day] = match as RegExpExecArray;
  // UTC arithmetic on a zone-less label. Every UTC day is exactly 24h, so this
  // cannot be skewed by a DST transition in the household's zone -- which is
  // correct: "3 days after the 1st" is the 4th regardless of clock changes.
  const shifted = new Date(
    Date.UTC(Number(year), Number(month) - 1, Number(day)) + days * 86_400_000,
  );
  const y = shifted.getUTCFullYear().toString().padStart(4, "0");
  const m = (shifted.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = shifted.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** True if `due` is today in the household's zone. */
export function isDueToday(
  due: CalendarDate,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  return compareCalendarDates(due, todayInZone(timeZone, now)) === 0;
}

/**
 * True if `due` is strictly before today in the household's zone.
 *
 * Something due *today* is not yet overdue -- the family has until the end of
 * their own day. That boundary is the reason this must use the household zone.
 */
export function isOverdue(
  due: CalendarDate,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  return compareCalendarDates(due, todayInZone(timeZone, now)) < 0;
}
