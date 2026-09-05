// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MembershipProvider } from "./MembershipProvider";
import { useMembership } from "./membership-context";
import { SessionContext } from "./session-context";
import type { SessionState } from "./session-context";

const { maybeSingleMock, eqMock, selectMock, fromMock } = vi.hoisted(() => {
  const maybeSingleMock = vi.fn();
  const eqMock = vi.fn(() => ({ maybeSingle: maybeSingleMock }));
  const selectMock = vi.fn(() => ({ eq: eqMock }));
  const fromMock = vi.fn(() => ({ select: selectMock }));
  return { maybeSingleMock, eqMock, selectMock, fromMock };
});

vi.mock("../../lib/supabase", () => ({
  supabase: {
    from: fromMock,
  },
}));

function makeSession(userId: string): Session {
  return {
    access_token: "token",
    refresh_token: "refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: userId } as Session["user"],
  } as Session;
}

/** Drives MembershipProvider off a fixed SessionState, bypassing SessionProvider entirely. */
function renderWithSession(sessionState: SessionState, children: ReactNode = <Consumer />) {
  return render(
    <SessionContext.Provider value={sessionState}>
      <MembershipProvider>{children}</MembershipProvider>
    </SessionContext.Provider>,
  );
}

function Consumer() {
  const state = useMembership();
  return <pre data-testid="state">{JSON.stringify(state)}</pre>;
}

/** Like Consumer, but also renders a retry button when the state has one. */
function ConsumerWithRetry() {
  const state = useMembership();
  return (
    <div>
      <pre data-testid="state">{JSON.stringify(state)}</pre>
      {state.status === "error" ? (
        <button type="button" onClick={state.retry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

function readState() {
  return JSON.parse(screen.getByTestId("state").textContent ?? "null") as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  eqMock.mockImplementation(() => ({ maybeSingle: maybeSingleMock }));
  selectMock.mockImplementation(() => ({ eq: eqMock }));
  fromMock.mockImplementation(() => ({ select: selectMock }));
});

describe("MembershipProvider", () => {
  it("resolves to signed-out without querying the DB when there is no session", async () => {
    renderWithSession({ session: null, loading: false });

    await waitFor(() => expect(readState()).toEqual({ status: "signed-out" }));
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("does not query while the session is still resolving", () => {
    renderWithSession({ session: null, loading: true });

    expect(readState()).toEqual({ status: "loading" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps a successful row to a loaded membership", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "member-1",
        household_id: "household-1",
        role: "parent",
        name: "Alex",
        status: "active",
      },
      error: null,
    });

    renderWithSession({ session: makeSession("user-1"), loading: false });

    await waitFor(() =>
      expect(readState()).toEqual({
        status: "loaded",
        membership: {
          memberId: "member-1",
          householdId: "household-1",
          role: "parent",
          name: "Alex",
          status: "active",
        },
      }),
    );
    expect(fromMock).toHaveBeenCalledWith("household_members");
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
  });

  it("resolves to no-membership when the row lookup returns no data", async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null });

    renderWithSession({ session: makeSession("user-1"), loading: false });

    await waitFor(() => expect(readState()).toEqual({ status: "no-membership" }));
  });

  it("resolves to error with a retry on a query error, and retry() re-fetches", async () => {
    maybeSingleMock.mockResolvedValueOnce({ data: null, error: { message: "boom" } });

    render(
      <SessionContext.Provider value={{ session: makeSession("user-1"), loading: false }}>
        <MembershipProvider>
          <ConsumerWithRetry />
        </MembershipProvider>
      </SessionContext.Provider>,
    );

    await waitFor(() => {
      const state = readState();
      expect(state.status).toBe("error");
      expect(state.message).toBe("boom");
    });
    expect(fromMock).toHaveBeenCalledTimes(1);

    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "member-1",
        household_id: "household-1",
        role: "child",
        name: "Sam",
        status: "active",
      },
      error: null,
    });

    act(() => {
      screen.getByRole("button", { name: "Retry" }).click();
    });

    await waitFor(() =>
      expect(readState()).toEqual({
        status: "loaded",
        membership: {
          memberId: "member-1",
          householdId: "household-1",
          role: "child",
          name: "Sam",
          status: "active",
        },
      }),
    );
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it("re-fetches when the session's user id changes", async () => {
    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "member-1",
        household_id: "household-1",
        role: "parent",
        name: "Alex",
        status: "active",
      },
      error: null,
    });

    const { rerender } = render(
      <SessionContext.Provider value={{ session: makeSession("user-1"), loading: false }}>
        <MembershipProvider>
          <Consumer />
        </MembershipProvider>
      </SessionContext.Provider>,
    );

    await waitFor(() => expect((readState() as { status: string }).status).toBe("loaded"));
    expect(fromMock).toHaveBeenCalledTimes(1);

    maybeSingleMock.mockResolvedValueOnce({
      data: {
        id: "member-2",
        household_id: "household-1",
        role: "child",
        name: "Sam",
        status: "active",
      },
      error: null,
    });

    rerender(
      <SessionContext.Provider value={{ session: makeSession("user-2"), loading: false }}>
        <MembershipProvider>
          <Consumer />
        </MembershipProvider>
      </SessionContext.Provider>,
    );

    await waitFor(() =>
      expect((readState() as { membership?: { memberId: string } }).membership?.memberId).toBe(
        "member-2",
      ),
    );
    expect(fromMock).toHaveBeenCalledTimes(2);
  });

  it("resolves to a defensive error when role/status are not recognized values", async () => {
    maybeSingleMock.mockResolvedValue({
      data: {
        id: "member-1",
        household_id: "household-1",
        role: "grandparent",
        name: "Alex",
        status: "active",
      },
      error: null,
    });

    renderWithSession({ session: makeSession("user-1"), loading: false });

    await waitFor(() => {
      const state = readState() as { status: string; message?: string };
      expect(state.status).toBe("error");
      expect(state.message).toContain("grandparent");
    });
  });
});
