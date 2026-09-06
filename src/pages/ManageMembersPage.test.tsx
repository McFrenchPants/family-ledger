// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ManageMembersPage } from "./ManageMembersPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";

type QueryResult<T> = { data: T | null; error: { message: string; code?: string } | null };

/**
 * A minimal chainable stand-in for supabase-js's `PostgrestFilterBuilder`:
 * every filter/order method returns the same object, and it resolves via
 * `.then` the way the real (thenable) builder does when `await`ed. Mirrors
 * `SignInForm.test.tsx`'s `vi.mock("../../lib/supabase", ...)` convention,
 * extended to cover `.from()` chains and `functions.invoke` since this page
 * (unlike SignInForm) reads/writes a table and calls an Edge Function.
 */
function makeSelectBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.returns = vi.fn(() => builder);
  builder.then = (resolve: (value: QueryResult<T>) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
}

function makeUpdateBuilder(resultRef: { current: { error: { message: string; code?: string } | null } }) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.then = (
    resolve: (value: { error: { message: string; code?: string } | null }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(resultRef.current).then(resolve, reject);
  return builder;
}

const membersResult: QueryResult<
  { id: string; name: string; role: string; status: string; created_at: string; archived_at: string | null }[]
> = {
  data: [
    { id: "m1", name: "Alex", role: "parent", status: "active", created_at: "2026-01-01", archived_at: null },
    { id: "m2", name: "Sam", role: "child", status: "active", created_at: "2026-01-01", archived_at: null },
    {
      id: "m3",
      name: "Jamie",
      role: "child",
      status: "archived",
      created_at: "2026-01-01",
      archived_at: "2026-02-01",
    },
  ],
  error: null,
};

const updateResultRef: { current: { error: { message: string; code?: string } | null } } = {
  current: { error: null },
};

const { fromMock, invokeMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: {
    from: fromMock,
    functions: { invoke: invokeMock },
  },
}));

let tableMock: { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  updateResultRef.current = { error: null };
  tableMock = {
    select: vi.fn(() => makeSelectBuilder(membersResult)),
    update: vi.fn(() => makeUpdateBuilder(updateResultRef)),
  };
  fromMock.mockReturnValue(tableMock);
});

const loadedParent: MembershipState = {
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role: "parent", name: "Alex", status: "active" },
};

function renderPage() {
  return render(
    <MembershipContext.Provider value={loadedParent}>
      <ManageMembersPage />
    </MembershipContext.Provider>,
  );
}

describe("ManageMembersPage", () => {
  it("renders the member list with role and status, never relying on color alone", async () => {
    renderPage();

    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByText("Jamie")).toBeInTheDocument();

    const jamieRow = screen.getByText("Jamie").closest("li")!;
    expect(within(jamieRow).getByText("Archived")).toBeInTheDocument();

    const alexRow = screen.getByText("Alex").closest("li")!;
    expect(within(alexRow).getByText("Active")).toBeInTheDocument();
    expect(within(alexRow).getByText("Parent")).toBeInTheDocument();
  });

  it("submits the add-member form to the Edge Function and shows the returned password", async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValue({ data: { id: "new-1", user_id: "u-1", initial_password: "s3cret-pass" }, error: null });
    renderPage();

    await screen.findByText("Alex");

    await user.type(screen.getByLabelText("Name"), "Riley");
    await user.selectOptions(screen.getByLabelText("Role"), "child");
    await user.type(screen.getByLabelText("Email"), "riley@example.com");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(invokeMock).toHaveBeenCalledWith("add-household-member", {
      body: { household_id: "h1", name: "Riley", role: "child", email: "riley@example.com" },
    });

    expect(await screen.findByText("s3cret-pass")).toBeInTheDocument();
  });

  it("shows the Edge Function's error message on failure and allows retry", async () => {
    const user = userEvent.setup();
    invokeMock.mockResolvedValue({
      data: { error: "only an active Parent of this household may add a member" },
      error: new Error("Edge Function returned a non-2xx status code"),
    });
    renderPage();

    await screen.findByText("Alex");

    await user.type(screen.getByLabelText("Name"), "Riley");
    await user.type(screen.getByLabelText("Email"), "riley@example.com");
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "only an active Parent of this household may add a member",
    );

    // The form is still present (not replaced by a done panel) so the Parent
    // can correct and retry -- no silent queueing, per ADR-007.
    expect(screen.getByRole("button", { name: "Add member" })).toBeInTheDocument();
  });

  it("requires a confirm step before archiving, and archives on confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Alex");
    const samRow = screen.getByText("Sam").closest("li")!;

    await user.click(within(samRow).getByRole("button", { name: "Archive" }));

    expect(within(samRow).getByText(/Archive this member\?/)).toBeInTheDocument();
    expect(within(samRow).getByText(/archived members can be restored/i)).toBeInTheDocument();

    await user.click(within(samRow).getByRole("button", { name: "Confirm archive" }));

    await waitFor(() => {
      expect(tableMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "archived" }),
      );
    });
  });

  it("maps the last-active-Parent archive rejection to a friendly message", async () => {
    const user = userEvent.setup();
    updateResultRef.current = {
      error: {
        message: "cannot archive the household's only active Parent",
        code: "42501",
      },
    };
    renderPage();

    await screen.findByText("Alex");
    const alexRow = screen.getByText("Alex").closest("li")!;

    await user.click(within(alexRow).getByRole("button", { name: "Archive" }));
    await user.click(within(alexRow).getByRole("button", { name: "Confirm archive" }));

    expect(await within(alexRow).findByRole("alert")).toHaveTextContent(
      "You can't archive the household's only active Parent.",
    );
  });
});
