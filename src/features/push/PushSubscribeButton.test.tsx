// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PushSubscribeButton } from "./PushSubscribeButton";
import { MembershipContext } from "../auth/membership-context";
import type { MembershipState } from "../auth/membership-context";

/**
 * Mirrors `FamilyPage.test.tsx`'s `vi.mock("../lib/supabase", ...)`
 * convention: a chainable stand-in for the query builder, extended to cover
 * the `.upsert(values, { onConflict }).select()`-shaped chain this
 * component calls (only `.upsert()` is actually awaited here -- `.select()`
 * isn't used, so the mock only needs to resolve `.upsert()`'s own promise).
 */
const { fromMock, upsertMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  upsertMock: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: { from: fromMock },
}));

vi.mock("../pwa/install-prompt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../pwa/install-prompt")>();
  return {
    ...actual,
    isIOS: () => mockIsIOS(),
    isStandalone: () => mockIsStandalone(),
  };
});

let mockIsIOS = () => false;
let mockIsStandalone = () => false;

const loadedChild: MembershipState = {
  status: "loaded",
  membership: { memberId: "m2", householdId: "h1", role: "child", name: "Sam", status: "active" },
};

function renderButton() {
  return render(
    <MembershipContext.Provider value={loadedChild}>
      <PushSubscribeButton />
    </MembershipContext.Provider>,
  );
}

/** Installs the ambient Notification/PushManager/serviceWorker globals this component checks for support and calls during the subscribe flow. */
function installPushGlobals(options: {
  permission: "granted" | "denied";
  subscribeResult?: { endpoint: string; keys: { p256dh: string; auth: string } } | Error;
}) {
  const requestPermission = vi.fn().mockResolvedValue(options.permission);
  (window as unknown as { Notification: unknown }).Notification = { requestPermission };
  (window as unknown as { PushManager: unknown }).PushManager = class {};

  const subscribe = vi.fn().mockImplementation(() => {
    if (!options.subscribeResult) {
      throw new Error("no subscribeResult configured");
    }
    if (options.subscribeResult instanceof Error) {
      return Promise.reject(options.subscribeResult);
    }
    const result = options.subscribeResult;
    return Promise.resolve({
      toJSON: () => ({ endpoint: result.endpoint, keys: result.keys }),
    });
  });

  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      ready: Promise.resolve({ pushManager: { subscribe } }),
    },
  });

  return { requestPermission, subscribe };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsIOS = () => false;
  mockIsStandalone = () => false;
  upsertMock.mockReturnValue(Promise.resolve({ data: null, error: null }));
  fromMock.mockReturnValue({ upsert: upsertMock });
});

afterEach(() => {
  delete (window as unknown as { Notification?: unknown }).Notification;
  delete (window as unknown as { PushManager?: unknown }).PushManager;
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
  vi.unstubAllEnvs();
});

describe("PushSubscribeButton", () => {
  it("shows a plain informational state when the browser lacks push support", () => {
    delete (window as unknown as { Notification?: unknown }).Notification;
    renderButton();

    expect(
      screen.getByText("This browser does not support push notifications."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("explains the home-screen install requirement on iOS Safari not running standalone, instead of a button that can only fail", () => {
    installPushGlobals({ permission: "granted" });
    mockIsIOS = () => true;
    mockIsStandalone = () => false;
    renderButton();

    expect(screen.getByText(/install Family Ledger to your Home Screen/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows a clear denied state (not a silent no-op) when permission is denied", async () => {
    installPushGlobals({ permission: "denied" });
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "Enable notifications" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Notification permission was denied",
    );
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("subscribes and upserts endpoint/keys/household_member_id with onConflict: 'endpoint' on success", async () => {
    installPushGlobals({
      permission: "granted",
      subscribeResult: {
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      },
    });
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "Enable notifications" }));

    expect(await screen.findByText("Notifications enabled on this device.")).toBeInTheDocument();

    expect(fromMock).toHaveBeenCalledWith("push_subscriptions");
    expect(upsertMock).toHaveBeenCalledWith(
      {
        household_member_id: "m2",
        endpoint: "https://push.example/abc",
        p256dh: "p256dh-key",
        auth: "auth-key",
      },
      { onConflict: "endpoint" },
    );
  });

  it("shows a retry-able error state (not a silent queue) when the upsert fails", async () => {
    installPushGlobals({
      permission: "granted",
      subscribeResult: {
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p256dh-key", auth: "auth-key" },
      },
    });
    upsertMock.mockReturnValue(
      Promise.resolve({ data: null, error: { message: "network error" } }),
    );
    const user = userEvent.setup();
    renderButton();

    await user.click(screen.getByRole("button", { name: "Enable notifications" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("network error");
    // The button is still present so the member can retry, matching this
    // codebase's "no offline write queue -- show retry/error" rule.
    expect(screen.getByRole("button", { name: "Enable notifications" })).toBeInTheDocument();
  });
});
