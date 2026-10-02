import { describe, expect, it } from "vitest";

import {
  DEVICE_NUDGE_KEY,
  NO_DISMISSAL,
  NUDGE_SNOOZE_MS,
  decideDeviceNudge,
  nextDismissal,
  readNudgeDismissal,
  writeNudgeDismissal,
  type DeviceNudgeInputs,
} from "./device-nudge";

const NOW = Date.UTC(2026, 9, 2, 12);

const base: DeviceNudgeInputs = {
  pushSupported: true,
  ios: false,
  standalone: false,
  permission: "default",
  subscribed: false,
  needsAttention: false,
  dismissal: NO_DISMISSAL,
  now: NOW,
};

const decide = (over: Partial<DeviceNudgeInputs>) => decideDeviceNudge({ ...base, ...over });

describe("decideDeviceNudge", () => {
  it("offers the push nudge on a supported, unsubscribed device", () => {
    expect(decide({})).toBe("push");
    expect(decide({ permission: "granted" })).toBe("push");
  });

  it("hides when push is unsupported or permission is denied", () => {
    expect(decide({ pushSupported: false, permission: "unsupported" })).toBe("none");
    expect(decide({ permission: "denied" })).toBe("none");
  });

  it("hides when already subscribed, or while that is still unknown", () => {
    expect(decide({ subscribed: true })).toBe("none");
    expect(decide({ subscribed: null })).toBe("none");
  });

  it("iPhone not installed gets the install nudge instead (never both)", () => {
    // Non-installed iOS Safari doesn't even expose push.
    expect(decide({ ios: true, standalone: false, pushSupported: false, permission: "unsupported" })).toBe(
      "install",
    );
    expect(decide({ ios: true, standalone: false })).toBe("install");
    // Installed iPhone falls back to the normal push rules.
    expect(decide({ ios: true, standalone: true })).toBe("push");
    expect(decide({ ios: true, standalone: true, subscribed: true })).toBe("none");
  });

  it("hides while something needs attention", () => {
    expect(decide({ needsAttention: true })).toBe("none");
    expect(decide({ needsAttention: true, ios: true })).toBe("none");
  });

  it("x snoozes for 30 days", () => {
    const once = nextDismissal(NO_DISMISSAL, NOW);
    expect(once).toEqual({ count: 1, snoozedUntil: NOW + NUDGE_SNOOZE_MS });
    expect(decide({ dismissal: once, now: NOW + 1 })).toBe("none");
    expect(decide({ dismissal: once, now: NOW + NUDGE_SNOOZE_MS - 1 })).toBe("none");
    expect(decide({ dismissal: once, now: NOW + NUDGE_SNOOZE_MS })).toBe("push");
  });

  it("a second dismissal hides it for good", () => {
    const twice = nextDismissal(nextDismissal(NO_DISMISSAL, NOW), NOW + NUDGE_SNOOZE_MS);
    expect(twice.count).toBe(2);
    expect(decide({ dismissal: twice, now: NOW + 10 * NUDGE_SNOOZE_MS })).toBe("none");
  });
});

describe("nudge dismissal storage", () => {
  function memoryStorage() {
    const map = new Map<string, string>();
    return {
      map,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    };
  }

  it("round-trips the dismissal state", () => {
    const storage = memoryStorage();
    expect(readNudgeDismissal(storage)).toEqual(NO_DISMISSAL);
    writeNudgeDismissal({ count: 1, snoozedUntil: NOW }, storage);
    expect(storage.map.has(DEVICE_NUDGE_KEY)).toBe(true);
    expect(readNudgeDismissal(storage)).toEqual({ count: 1, snoozedUntil: NOW });
  });

  it("garbled storage reads as never dismissed", () => {
    const storage = memoryStorage();
    storage.map.set(DEVICE_NUDGE_KEY, "{not json");
    expect(readNudgeDismissal(storage)).toEqual(NO_DISMISSAL);
    storage.map.set(DEVICE_NUDGE_KEY, JSON.stringify({ count: "x", snoozedUntil: null }));
    expect(readNudgeDismissal(storage)).toEqual(NO_DISMISSAL);
  });

  it("storage that throws never breaks the page", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
    };
    expect(readNudgeDismissal(throwing)).toEqual(NO_DISMISSAL);
    expect(() => writeNudgeDismissal({ count: 1, snoozedUntil: NOW }, throwing)).not.toThrow();
  });
});
