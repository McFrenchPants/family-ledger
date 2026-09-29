// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SessionProvider } from "./SessionProvider";
import { useSession } from "./session-context";

const { getSessionMock, onAuthStateChangeMock, unsubscribeMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  onAuthStateChangeMock: vi.fn(),
  unsubscribeMock: vi.fn(),
}));

vi.mock("../../lib/supabase", () => ({
  supabase: {
    auth: {
      getSession: getSessionMock,
      onAuthStateChange: onAuthStateChangeMock,
    },
  },
}));

/** Minimal fixture -- only the fields SessionProvider/consumers touch matter. */
function makeSession(userId: string): Session {
  return {
    access_token: "token",
    refresh_token: "refresh",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: userId } as Session["user"],
  } as Session;
}

/** Reads the context and renders enough to assert on from the outside. */
function Consumer() {
  const { session, loading } = useSession();
  return (
    <div>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user-id">{session ? session.user.id : "none"}</span>
    </div>
  );
}

let authStateCallback: ((event: string, session: Session | null) => void) | undefined;

beforeEach(() => {
  vi.clearAllMocks();
  authStateCallback = undefined;
  onAuthStateChangeMock.mockImplementation(
    (callback: (event: string, session: Session | null) => void) => {
      authStateCallback = callback;
      return { data: { subscription: { unsubscribe: unsubscribeMock } } };
    },
  );
});

afterEach(() => {
  authStateCallback = undefined;
});

describe("SessionProvider", () => {
  it("calls getSession() on mount and renders children with the resolved session", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    );

    expect(getSessionMock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("false")).toBeInTheDocument();
    expect(screen.getByTestId("user-id")).toHaveTextContent("none");
  });

  it("reflects a persisted/restored session once getSession() resolves", async () => {
    getSessionMock.mockResolvedValue({ data: { session: makeSession("user-1") } });

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    );

    await screen.findByText("false");
    expect(screen.getByTestId("user-id")).toHaveTextContent("user-1");
  });

  it("updates the context session when onAuthStateChange's callback fires", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    );

    await screen.findByText("false");
    expect(screen.getByTestId("user-id")).toHaveTextContent("none");

    expect(authStateCallback).toBeDefined();
    act(() => {
      authStateCallback?.("SIGNED_IN", makeSession("user-2"));
    });

    expect(screen.getByTestId("user-id")).toHaveTextContent("user-2");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  it("calls the subscription's unsubscribe() on unmount", async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });

    const { unmount } = render(
      <SessionProvider>
        <Consumer />
      </SessionProvider>,
    );

    await screen.findByText("false");
    expect(unsubscribeMock).not.toHaveBeenCalled();

    unmount();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });
});
