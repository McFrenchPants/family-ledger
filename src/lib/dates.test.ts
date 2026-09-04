import { describe, expect, it } from "vitest";

import {
  TimeZoneError,
  addDays,
  calendarDateInZone,
  compareCalendarDates,
  isDueToday,
  isOverdue,
  isValidCalendarDate,
  isValidTimeZone,
  todayInZone,
} from "./dates";

/**
 * The load-bearing property of this whole module: the calendar date depends on
 * the household's configured zone and NOTHING else. Every test below pins the
 * instant explicitly and asserts against at least two zones, so none of them
 * can pass merely because the machine running them happens to sit in a
 * convenient offset.
 */
describe("calendarDateInZone — zone, not host locale", () => {
  it("gives different dates for the same instant in different zones", () => {
    // 03:30 UTC on New Year's Day.
    const instant = new Date("2026-01-01T03:30:00Z");

    // Paris is UTC+1 in January: already 04:30 on the 1st.
    expect(calendarDateInZone(instant, "Europe/Paris")).toBe("2026-01-01");
    // Los Angeles is UTC-8: still 19:30 on New Year's Eve.
    expect(calendarDateInZone(instant, "America/Los_Angeles")).toBe("2025-12-31");
    // Chicago (the household default in the spec's example) is UTC-6: 21:30 on the 31st.
    expect(calendarDateInZone(instant, "America/Chicago")).toBe("2025-12-31");
    // Auckland is UTC+13 in January: already the afternoon of the 1st.
    expect(calendarDateInZone(instant, "Pacific/Auckland")).toBe("2026-01-01");
    expect(calendarDateInZone(instant, "UTC")).toBe("2026-01-01");
  });

  it("would fail if the implementation used host-local time", () => {
    // A single instant mapped across a spread of zones wide enough that no
    // single host offset can satisfy all of these assertions at once. If
    // calendarDateInZone ignored its timeZone argument and used the host clock,
    // every value here would be identical and at least three would be wrong.
    const instant = new Date("2026-06-15T23:15:00Z");
    const seen = [
      calendarDateInZone(instant, "Pacific/Kiritimati"), // UTC+14
      calendarDateInZone(instant, "Asia/Tokyo"), // UTC+9
      calendarDateInZone(instant, "UTC"),
      calendarDateInZone(instant, "America/New_York"), // UTC-4 (DST)
      calendarDateInZone(instant, "Pacific/Honolulu"), // UTC-10
    ];
    expect(seen).toEqual([
      "2026-06-16",
      "2026-06-16",
      "2026-06-15",
      "2026-06-15",
      "2026-06-15",
    ]);
    expect(new Set(seen).size).toBe(2);
  });

  it("handles the midnight boundary exactly", () => {
    // 04:59:59 UTC is 23:59:59 on the previous day in Chicago (CDT, UTC-5);
    // one second later it rolls over.
    expect(calendarDateInZone(new Date("2026-07-04T04:59:59Z"), "America/Chicago")).toBe(
      "2026-07-03",
    );
    expect(calendarDateInZone(new Date("2026-07-04T05:00:00Z"), "America/Chicago")).toBe(
      "2026-07-04",
    );
  });

  it("applies the zone's DST rules, not a fixed offset", () => {
    // US DST began 2026-03-08. At 07:30 UTC Chicago is UTC-6 (CST) on 03-07
    // but UTC-5 (CDT) later in March — the date boundary moves with it.
    expect(calendarDateInZone(new Date("2026-03-01T05:30:00Z"), "America/Chicago")).toBe(
      "2026-02-28",
    );
    expect(calendarDateInZone(new Date("2026-03-15T05:30:00Z"), "America/Chicago")).toBe(
      "2026-03-15",
    );
    // Same wall-clock UTC time, different side of the DST switch, different date.
  });

  it("handles half-hour and 45-minute offsets", () => {
    const instant = new Date("2026-01-01T18:45:00Z");
    expect(calendarDateInZone(instant, "Asia/Kolkata")).toBe("2026-01-02"); // UTC+5:30 -> 00:15
    expect(calendarDateInZone(instant, "Asia/Kathmandu")).toBe("2026-01-02"); // UTC+5:45 -> 00:30
    expect(calendarDateInZone(instant, "UTC")).toBe("2026-01-01");
  });

  it("zero-pads month and day", () => {
    expect(calendarDateInZone(new Date("2026-02-03T12:00:00Z"), "UTC")).toBe("2026-02-03");
  });

  it("rejects an unknown time zone", () => {
    expect(() => calendarDateInZone(new Date(), "Mars/Olympus_Mons")).toThrow(TimeZoneError);
    expect(() => calendarDateInZone(new Date(), "not a zone")).toThrow(TimeZoneError);
  });

  it("rejects an Invalid Date", () => {
    expect(() => calendarDateInZone(new Date("nonsense"), "UTC")).toThrow(RangeError);
  });
});

describe("isValidTimeZone", () => {
  it.each(["UTC", "America/Chicago", "Europe/Paris", "Asia/Kathmandu", "Pacific/Auckland"])(
    "accepts %s",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(true);
    },
  );

  it.each(["", "Mars/Olympus_Mons", "America/Nowhere", "not a zone"])(
    "rejects %j",
    (zone) => {
      expect(isValidTimeZone(zone)).toBe(false);
    },
  );
});

describe("todayInZone", () => {
  it("uses the supplied instant and the supplied zone", () => {
    const now = new Date("2026-01-01T03:30:00Z");
    expect(todayInZone("Europe/Paris", now)).toBe("2026-01-01");
    expect(todayInZone("America/Los_Angeles", now)).toBe("2025-12-31");
  });

  it("defaults the instant to now but never the zone", () => {
    // Both calls use the real clock; asserting they agree with an explicit
    // conversion of the same moment proves the zone argument is honoured.
    const before = calendarDateInZone(new Date(), "Asia/Tokyo");
    const today = todayInZone("Asia/Tokyo");
    const after = calendarDateInZone(new Date(), "Asia/Tokyo");
    expect([before, after]).toContain(today);
  });
});

describe("isValidCalendarDate", () => {
  it.each(["2026-01-01", "2024-02-29", "1999-12-31", "2026-12-31"])(
    "accepts %s",
    (value) => {
      expect(isValidCalendarDate(value)).toBe(true);
    },
  );

  it.each([
    "",
    "2026-1-1",
    "26-01-01",
    "2026/01/01",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-01-32",
    "2026-02-30",
    "2025-02-29", // not a leap year
    "2026-01-01T00:00:00Z",
    "today",
  ])("rejects %j", (value) => {
    expect(isValidCalendarDate(value)).toBe(false);
  });
});

describe("compareCalendarDates", () => {
  it("orders dates correctly", () => {
    expect(compareCalendarDates("2026-01-01", "2026-01-02")).toBeLessThan(0);
    expect(compareCalendarDates("2026-01-02", "2026-01-01")).toBeGreaterThan(0);
    expect(compareCalendarDates("2026-01-01", "2026-01-01")).toBe(0);
    expect(compareCalendarDates("2025-12-31", "2026-01-01")).toBeLessThan(0);
    expect(compareCalendarDates("2026-09-30", "2026-10-01")).toBeLessThan(0);
  });

  it("rejects malformed dates rather than comparing garbage", () => {
    expect(() => compareCalendarDates("2026-1-1", "2026-01-01")).toThrow(RangeError);
    expect(() => compareCalendarDates("2026-01-01", "2026-02-30")).toThrow(RangeError);
  });
});

describe("addDays", () => {
  it.each([
    ["2026-01-01", 1, "2026-01-02"],
    ["2026-01-31", 1, "2026-02-01"],
    ["2026-12-31", 1, "2027-01-01"],
    ["2026-01-01", -1, "2025-12-31"],
    ["2024-02-28", 1, "2024-02-29"], // leap year
    ["2025-02-28", 1, "2025-03-01"], // non-leap year
    ["2026-01-01", 0, "2026-01-01"],
    ["2026-01-01", 365, "2027-01-01"],
  ])("addDays(%s, %i) === %s", (date, days, expected) => {
    expect(addDays(date, days)).toBe(expected);
  });

  it("is unaffected by DST transitions in any zone", () => {
    // 2026-03-08 is a 23-hour day in US zones. Adding a day to a calendar label
    // must still land on the next label, not skip or repeat one.
    expect(addDays("2026-03-07", 1)).toBe("2026-03-08");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09");
    // ...and the same across a 25-hour autumn day.
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
  });

  it("rejects fractional day counts", () => {
    expect(() => addDays("2026-01-01", 1.5)).toThrow(TypeError);
  });
});

describe("isDueToday / isOverdue — evaluated in the household zone", () => {
  // The same instant, the same due date, opposite answers in two zones. This is
  // the behaviour that a host-local implementation gets wrong.
  const instant = new Date("2026-01-01T03:30:00Z");
  const due = "2026-01-01";

  it("is due today in Paris but not yet in Los Angeles", () => {
    expect(isDueToday(due, "Europe/Paris", instant)).toBe(true);
    expect(isDueToday(due, "America/Los_Angeles", instant)).toBe(false);
  });

  it("something due today is not overdue", () => {
    expect(isOverdue(due, "Europe/Paris", instant)).toBe(false);
    // In LA it is still 2025-12-31, so a 2026-01-01 due date is in the future.
    expect(isOverdue(due, "America/Los_Angeles", instant)).toBe(false);
  });

  it("becomes overdue a day later in Paris while LA is only just due", () => {
    const nextDay = new Date("2026-01-02T03:30:00Z");
    expect(isOverdue(due, "Europe/Paris", nextDay)).toBe(true);
    expect(isOverdue(due, "America/Los_Angeles", nextDay)).toBe(false);
    expect(isDueToday(due, "America/Los_Angeles", nextDay)).toBe(true);
  });

  it("a past due date is overdue in every zone", () => {
    for (const zone of ["Europe/Paris", "America/Los_Angeles", "UTC", "Pacific/Auckland"]) {
      expect(isOverdue("2020-01-01", zone, instant)).toBe(true);
    }
  });

  it("a far-future due date is overdue in no zone", () => {
    for (const zone of ["Europe/Paris", "America/Los_Angeles", "UTC", "Pacific/Auckland"]) {
      expect(isOverdue("2099-01-01", zone, instant)).toBe(false);
    }
  });
});
