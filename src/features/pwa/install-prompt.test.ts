import { describe, expect, it } from "vitest";

import { decideInstallBannerState } from "./install-prompt";
import type { BeforeInstallPromptEvent } from "./install-prompt";

function fakeInstallEvent(): BeforeInstallPromptEvent {
  return {
    platforms: ["web"],
    userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
    prompt: () => Promise.resolve(),
  } as unknown as BeforeInstallPromptEvent;
}

describe("decideInstallBannerState", () => {
  it("is hidden when already standalone, regardless of iOS or a captured event", () => {
    expect(
      decideInstallBannerState({ standalone: true, ios: false, installEvent: null }),
    ).toBe("hidden");
    expect(
      decideInstallBannerState({ standalone: true, ios: true, installEvent: null }),
    ).toBe("hidden");
    expect(
      decideInstallBannerState({ standalone: true, ios: false, installEvent: fakeInstallEvent() }),
    ).toBe("hidden");
    expect(
      decideInstallBannerState({ standalone: true, ios: true, installEvent: fakeInstallEvent() }),
    ).toBe("hidden");
  });

  it("shows iOS instructions when iOS and not standalone, regardless of installEvent", () => {
    expect(
      decideInstallBannerState({ standalone: false, ios: true, installEvent: null }),
    ).toBe("ios-instructions");
    expect(
      decideInstallBannerState({ standalone: false, ios: true, installEvent: fakeInstallEvent() }),
    ).toBe("ios-instructions");
  });

  it("is hidden when not iOS, not standalone, and no installEvent has been captured yet", () => {
    expect(
      decideInstallBannerState({ standalone: false, ios: false, installEvent: null }),
    ).toBe("hidden");
  });

  it("shows the install button when not iOS, not standalone, and installEvent is captured", () => {
    expect(
      decideInstallBannerState({
        standalone: false,
        ios: false,
        installEvent: fakeInstallEvent(),
      }),
    ).toBe("install-button");
  });
});
