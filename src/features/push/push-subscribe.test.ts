import { describe, expect, it } from "vitest";

import { base64UrlToUint8Array, decideInitialPushState } from "./push-subscribe";

describe("decideInitialPushState", () => {
  it("is unsupported when the required APIs are missing outside an iOS Safari tab", () => {
    expect(
      decideInitialPushState({ supported: false, ios: false, standalone: false }),
    ).toBe("unsupported");
    // Installed on an iOS version too old for web push.
    expect(
      decideInitialPushState({ supported: false, ios: true, standalone: true }),
    ).toBe("unsupported");
  });

  it("asks for home-screen install in an iOS Safari tab, where PushManager is hidden", () => {
    expect(
      decideInitialPushState({ supported: false, ios: true, standalone: false }),
    ).toBe("ios-install-required");
  });

  it("requires home-screen install first on iOS Safari not running standalone", () => {
    expect(
      decideInitialPushState({ supported: true, ios: true, standalone: false }),
    ).toBe("ios-install-required");
  });

  it("is idle (ready to subscribe) on iOS running standalone", () => {
    expect(decideInitialPushState({ supported: true, ios: true, standalone: true })).toBe(
      "idle",
    );
  });

  it("is idle on any non-iOS supported browser", () => {
    expect(
      decideInitialPushState({ supported: true, ios: false, standalone: false }),
    ).toBe("idle");
    expect(
      decideInitialPushState({ supported: true, ios: false, standalone: true }),
    ).toBe("idle");
  });
});

describe("base64UrlToUint8Array", () => {
  it("decodes a base64url string with no padding needed", () => {
    // "BBtP" base64-decodes to bytes [4, 27, 79].
    expect(Array.from(base64UrlToUint8Array("BBtP"))).toEqual([4, 27, 79]);
  });

  it("decodes base64url characters ('-' and '_') that plain base64 does not use", () => {
    // base64url "-_" corresponds to base64 "+/" -- decode both and confirm
    // they produce the same bytes, proving the '-'/'_' substitution ran.
    const viaUrl = base64UrlToUint8Array("--__");
    const viaStandard = Uint8Array.from(atob("++//"), (c) => c.charCodeAt(0));
    expect(Array.from(viaUrl)).toEqual(Array.from(viaStandard));
  });

  it("restores padding for lengths not a multiple of 4", () => {
    // A 5-character base64url input (no trailing '=') needs 3 '=' restored.
    const decoded = base64UrlToUint8Array("QUJDRA");
    expect(new TextDecoder().decode(decoded)).toBe("ABCD");
  });
});
