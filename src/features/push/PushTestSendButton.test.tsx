// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PushTestSendButton } from "./PushTestSendButton";
import { MembershipContext } from "../auth/membership-context";
import type { MembershipState } from "../auth/membership-context";

/**
 * Mirrors `PushSubscribeButton.test.tsx`'s `vi.mock("../../lib/supabase", ...)`
 * convention: a chainable stand-in for the `.from().select().eq().order()`
 * read this component issues (thenable, like the real PostgREST builder),
 * plus a `functions.invoke` mock for the `push-test` call.
 */
const { fromMock, eqMock, orderMock, invokeMock } = vi.hoisted(() => {
  const orderMock = vi.fn();
  const eqMock = vi.fn(() => ({ order: orderMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  const invokeMock = vi.fn();
  return { fromMock, eqMock, orderMock, invokeMock };
});

vi.mock("../../lib/supabase", () => ({
  supabase: { from: fromMock, functions: { invoke: invokeMock } },
}));

const loadedMember: MembershipState = {
  status: "loaded",
  membership: { memberId: "m2", householdId: "h1", role: "child", name: "Sam", status: "active" },
};

function renderButton(membership: MembershipState = loadedMember) {
  return render(
    <MembershipContext.Provider value={membership}>
      <PushTestSendButton />
    </MembershipContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("PushTestSendButton", () => {
  it("renders nothing while membership isn't loaded", () => {
    renderButton({ status: "loading" });
    expect(document.body.textContent).toBe("");
  });

  it("renders nothing when the caller has no subscriptions", async () => {
    orderMock.mockReturnValue(Promise.resolve({ data: [], error: null }));
    renderButton();

    await waitFor(() => expect(orderMock).toHaveBeenCalled());
    expect(fromMock).toHaveBeenCalledWith("push_subscriptions");
    expect(eqMock).toHaveBeenCalledWith("household_member_id", "m2");
    expect(screen.queryByText("Debug: test push delivery")).not.toBeInTheDocument();
  });

  it("shows the host's hint instead of nothing when there is no subscription to test", async () => {
    orderMock.mockReturnValue(Promise.resolve({ data: [], error: null }));
    render(
      <MembershipContext.Provider value={loadedMember}>
        <PushTestSendButton emptyHint={<p>turn reminders on first</p>} />
      </MembershipContext.Provider>,
    );

    expect(await screen.findByText("turn reminders on first")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send test push" })).not.toBeInTheDocument();
  });

  it("keeps the hint away while loading and after a failed load", async () => {
    let resolve: (value: unknown) => void = () => {};
    orderMock.mockReturnValue(new Promise((r) => (resolve = r)));
    render(
      <MembershipContext.Provider value={loadedMember}>
        <PushTestSendButton emptyHint={<p>turn reminders on first</p>} />
      </MembershipContext.Provider>,
    );

    await waitFor(() => expect(orderMock).toHaveBeenCalled());
    expect(screen.queryByText("turn reminders on first")).not.toBeInTheDocument();
    resolve({ data: null, error: { message: "boom" } });
    await waitFor(() => expect(document.body.textContent).toBe(""));
  });

  it("renders nothing when the subscription list fails to load", async () => {
    orderMock.mockReturnValue(Promise.resolve({ data: null, error: { message: "boom" } }));
    renderButton();

    await waitFor(() => expect(orderMock).toHaveBeenCalled());
    expect(screen.queryByText("Debug: test push delivery")).not.toBeInTheDocument();
  });

  it("is clearly labeled as a debug/test tool, and shows a send button per subscription", async () => {
    orderMock.mockReturnValue(
      Promise.resolve({
        data: [
          { id: "sub-1", endpoint: "https://push.example/abc123456789", created_at: "2026-01-01" },
        ],
        error: null,
      }),
    );
    renderButton();

    expect(await screen.findByText("Debug: test push delivery")).toBeInTheDocument();
    expect(
      screen.getByText(/Not a real notification feature/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send test push" })).toBeInTheDocument();
  });

  it("calls push-test with the subscription id and shows the raw returned status verbatim", async () => {
    orderMock.mockReturnValue(
      Promise.resolve({
        data: [{ id: "sub-1", endpoint: "https://push.example/abc", created_at: "2026-01-01" }],
        error: null,
      }),
    );
    invokeMock.mockResolvedValue({ data: { status: 201, ok: true }, error: null });
    const user = userEvent.setup();
    renderButton();

    await user.click(await screen.findByRole("button", { name: "Send test push" }));

    expect(invokeMock).toHaveBeenCalledWith("push-test", { body: { subscription_id: "sub-1" } });
    expect(await screen.findByText("Result: 201 OK")).toBeInTheDocument();
  });

  it("shows a non-2xx status verbatim rather than a generic success message", async () => {
    orderMock.mockReturnValue(
      Promise.resolve({
        data: [{ id: "sub-1", endpoint: "https://push.example/abc", created_at: "2026-01-01" }],
        error: null,
      }),
    );
    invokeMock.mockResolvedValue({ data: { status: 410, ok: false }, error: null });
    const user = userEvent.setup();
    renderButton();

    await user.click(await screen.findByRole("button", { name: "Send test push" }));

    expect(await screen.findByText("Result: 410 not ok")).toBeInTheDocument();
  });

  it("surfaces the function's own error message when the invoke call itself fails", async () => {
    orderMock.mockReturnValue(
      Promise.resolve({
        data: [{ id: "sub-1", endpoint: "https://push.example/abc", created_at: "2026-01-01" }],
        error: null,
      }),
    );
    invokeMock.mockResolvedValue({
      data: { error: "not authorized to send a test push for this subscription" },
      error: new Error("Edge Function returned a non-2xx status code"),
    });
    const user = userEvent.setup();
    renderButton();

    await user.click(await screen.findByRole("button", { name: "Send test push" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "not authorized to send a test push for this subscription",
    );
  });
});
