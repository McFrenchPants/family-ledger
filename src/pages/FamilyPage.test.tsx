// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FamilyPage } from "./FamilyPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import type { HouseholdBalancesState } from "../features/ledger/useHouseholdBalances";
import type { HouseholdTimezoneState } from "../features/ledger/useHouseholdTimezone";
import type { MemberPushStatusState } from "../features/members/useMemberPushStatus";
import type { ChildPaymentProgress } from "../features/payment-plans/useChildPaymentProgress";
import type { HouseholdPaymentProgressState } from "../features/payment-plans/useHouseholdPaymentProgress";

type QueryResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

/**
 * A minimal chainable stand-in for supabase-js's `PostgrestFilterBuilder`:
 * every filter/order method returns the same object, and it resolves via
 * `.then` the way the real (thenable) builder does when `await`ed. The
 * member roster and login emails go through this real path; the balance,
 * plan-status, time-zone and reminder hooks are swapped for plain state so
 * each test can set them directly.
 */
function makeSelectBuilder<T>(result: QueryResult<T>) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.returns = vi.fn(() => builder);
  builder.then = (
    resolve: (value: QueryResult<T>) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject);
  return builder;
}

type MemberRow = {
  id: string;
  name: string;
  role: string;
  status: string;
  created_at: string;
  archived_at: string | null;
};

const row = (id: string, name: string, role: string, status = "active"): MemberRow => ({
  id,
  name,
  role,
  status,
  created_at: "2026-01-01",
  archived_at: status === "archived" ? "2026-02-01" : null,
});

let membersResult: QueryResult<MemberRow[]>;

const { fromMock, invokeMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { from: fromMock, functions: { invoke: invokeMock } },
}));

let balances: HouseholdBalancesState;
let progress: HouseholdPaymentProgressState;
let zone: HouseholdTimezoneState;
let push: MemberPushStatusState;

vi.mock("../features/ledger/useHouseholdBalances", () => ({ useHouseholdBalances: () => balances }));
vi.mock("../features/payment-plans/useHouseholdPaymentProgress", () => ({
  useHouseholdPaymentProgress: () => progress,
}));
vi.mock("../features/ledger/useHouseholdTimezone", () => ({ useHouseholdTimezone: () => zone }));
vi.mock("../features/members/useMemberPushStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/members/useMemberPushStatus")>()),
  useMemberPushStatus: () => push,
}));

let tableMock: { select: ReturnType<typeof vi.fn> };

const emailsBody = {
  emails: { m1: "alex@example.com", m2: "sam@example.com", m3: "jamie@example.com" },
};

/** Routes the shared Edge Function mock by `action`, defaulting to success. */
function mockFunctions(overrides: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((name: string, options: { body: { action?: string } }) => {
    const key = name === "add-household-member" ? name : (options.body.action ?? "");
    if (key in overrides) {
      return Promise.resolve(overrides[key]);
    }
    if (key === "get_login_emails") {
      return Promise.resolve({ data: emailsBody, error: null });
    }
    return Promise.resolve({ data: {}, error: null });
  });
}

function httpError(status: number, message: string) {
  return {
    data: null,
    error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: { status, json: () => Promise.resolve({ error: message }) },
    }),
  };
}

function callsFor(action: string) {
  return invokeMock.mock.calls.filter(
    ([name, options]) => name === "manage-household-member" && options.body.action === action,
  );
}

const plan = (over: Partial<ChildPaymentProgress> = {}): ChildPaymentProgress => ({
  periodStatus: "overdue",
  minimumCents: 4000,
  paidCents: 2500,
  remainingCents: 1500,
  dueDate: "2026-09-15",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  membersResult = {
    data: [
      row("m2", "Sam", "child"),
      row("m4", "Riley", "child"),
      row("m1", "Alex", "parent"),
      row("m3", "Jamie", "child", "archived"),
    ],
    error: null,
  };
  tableMock = { select: vi.fn(() => makeSelectBuilder(membersResult)) };
  fromMock.mockReturnValue(tableMock);
  mockFunctions();
  balances = {
    status: "loaded",
    children: [
      { memberId: "m2", name: "Sam", balanceCents: 18732 },
      { memberId: "m4", name: "Riley", balanceCents: 500 },
    ],
  };
  progress = {
    status: "loaded",
    progressByMemberId: new Map<string, ChildPaymentProgress | null>([
      ["m2", plan()],
      ["m4", null],
    ]),
  };
  zone = { status: "loaded", timezone: "America/New_York" };
  push = {
    status: "loaded",
    remindersOn: new Map([
      ["m1", true],
      ["m2", false],
      ["m4", true],
    ]),
  };
});

const loadedParent: MembershipState = {
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role: "parent", name: "Alex", status: "active" },
};

function renderPage() {
  return render(
    <MembershipContext.Provider value={loadedParent}>
      <MemoryRouter initialEntries={["/family"]}>
        <FamilyPage />
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

const rowOf = (name: string) => screen.getByText(name).closest("li")!;

describe("FamilyPage list", () => {
  it("has one page heading and lists active people with role, You marker and a link to their page", async () => {
    renderPage();

    expect(await screen.findByText("Alex")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: "Family" })).toBeInTheDocument();

    const alexRow = rowOf("Alex");
    expect(within(alexRow).getByText("Parent")).toBeInTheDocument();
    expect(within(alexRow).getByText("You")).toBeInTheDocument();
    expect(within(alexRow).getByRole("link")).toHaveAttribute("href", "/family/m1");

    const samRow = rowOf("Sam");
    expect(within(samRow).getByText("Child")).toBeInTheDocument();
    expect(within(samRow).queryByText("You")).not.toBeInTheDocument();
    expect(within(samRow).getByRole("link")).toHaveAttribute("href", "/family/m2");
  });

  it("shows each member's login email under their name", async () => {
    renderPage();

    expect(await screen.findByText("alex@example.com")).toBeInTheDocument();
    expect(within(rowOf("Sam")).getByText("sam@example.com")).toBeInTheDocument();
    expect(callsFor("get_login_emails")[0][1]).toEqual({
      body: { action: "get_login_emails", household_id: "h1" },
    });
  });

  it("silently omits emails when the lookup fails, and the page still works", async () => {
    mockFunctions({
      get_login_emails: httpError(500, "something went wrong, please try again"),
    });
    renderPage();

    expect(await screen.findByText("Sam")).toBeInTheDocument();
    await waitFor(() => expect(callsFor("get_login_emails")).toHaveLength(1));
    expect(screen.queryByText(/@example\.com/)).not.toBeInTheDocument();
    // No error banner for a non-critical lookup.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows each child's plan status chip in words, with an icon", async () => {
    renderPage();

    await screen.findByText("Sam");
    const samChip = within(rowOf("Sam")).getByText("$15.00 overdue");
    expect(samChip).toHaveAttribute("data-status", "overdue");
    expect(samChip.querySelector("svg")).not.toBeNull();
    expect(within(rowOf("Riley")).getByText("No plan")).toBeInTheDocument();
    // Parents have no plan chip.
    expect(within(rowOf("Alex")).queryByText(/plan|overdue|due/i)).not.toBeInTheDocument();
  });

  it("leaves the chip out while plan status is unknown, never guessing", async () => {
    progress = { status: "loading" };
    renderPage();

    await screen.findByText("Sam");
    expect(within(rowOf("Sam")).queryByText(/overdue/)).not.toBeInTheDocument();
    expect(within(rowOf("Riley")).queryByText("No plan")).not.toBeInTheDocument();
  });

  it("leaves the chip out while the balance is unknown", async () => {
    balances = { status: "loading" };
    renderPage();

    await screen.findByText("Sam");
    expect(document.querySelector("[data-status]")).toBeNull();
  });

  it("says plan status failed, with a retry, while the list keeps working", async () => {
    const retry = vi.fn();
    progress = { status: "error", message: "boom", retry };
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Sam");
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load payment plan status: boom");
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
    expect(within(rowOf("Sam")).getByRole("link")).toBeInTheDocument();
  });

  it("shows reminders on or off as a labelled icon", async () => {
    renderPage();

    await screen.findByText("Sam");
    expect(within(rowOf("Alex")).getByRole("img", { name: "Reminders on" })).toBeInTheDocument();
    expect(within(rowOf("Sam")).getByRole("img", { name: "Reminders off" })).toBeInTheDocument();
  });

  it.each([
    ["loading", { status: "loading" } as MemberPushStatusState],
    ["failed", { status: "error", message: "x", retry: () => {} } as MemberPushStatusState],
  ])("shows no reminder icon at all while reminder state is %s", async (_label, state) => {
    push = state;
    renderPage();

    await screen.findByText("Sam");
    expect(screen.queryByRole("img", { name: /Reminders/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("lists archived people in their own section, still linking to their page", async () => {
    renderPage();

    await screen.findByText("Jamie");
    const archived = screen.getByRole("region", { name: "Archived" });
    const jamieRow = within(archived).getByText("Jamie").closest("li")!;
    expect(within(jamieRow).getByText("Archived")).toBeInTheDocument();
    expect(within(jamieRow).getByRole("link")).toHaveAttribute("href", "/family/m3");
    expect(within(jamieRow).queryByRole("img", { name: /Reminders/ })).not.toBeInTheDocument();
    // Active people are not in the archived section.
    expect(within(archived).queryByText("Sam")).not.toBeInTheDocument();
  });

  it("shows loading, then an error with a working retry", async () => {
    membersResult = { data: null, error: { message: "db down" } };
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading members…");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load members: db down");

    membersResult = { data: [row("m1", "Alex", "parent")], error: null };
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Alex")).toBeInTheDocument();
  });

  it("shows an empty state when nobody is active", async () => {
    membersResult = { data: [], error: null };
    renderPage();

    expect(await screen.findByText("No members yet")).toBeInTheDocument();
  });
});

describe("adding a member", () => {
  async function openAndSubmit(user: ReturnType<typeof userEvent.setup>) {
    await screen.findByText("Alex");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    await user.type(screen.getByLabelText("Name"), "Riley");
    await user.selectOptions(screen.getByLabelText("Role"), "child");
    await user.type(screen.getByLabelText("Email"), "riley@example.com");
    await user.click(screen.getByRole("button", { name: "Add member" }));
  }

  it("opens the form from the Add member button and closes it on Cancel", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Alex");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add member" }));
    expect(screen.getByLabelText("Name")).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add member" })).toHaveFocus();
  });

  it("requires a name and an email", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByText("Alex");
    await user.click(screen.getByRole("button", { name: "Add member" }));
    await user.click(screen.getByRole("button", { name: "Add member" }));

    expect(screen.getByRole("alert")).toHaveTextContent("Name and email are required.");
    expect(invokeMock).not.toHaveBeenCalledWith("add-household-member", expect.anything());
  });

  it("sends no password, shows the returned set-password link in a dialog, and refreshes", async () => {
    const user = userEvent.setup();
    mockFunctions({
      "add-household-member": {
        data: {
          id: "new-1",
          user_id: "u-1",
          set_password_url: "https://app.example/set-password#token_hash=tok&type=recovery",
          expires_in_hours: 24,
        },
        error: null,
      },
    });
    renderPage();

    await openAndSubmit(user);

    expect(invokeMock).toHaveBeenCalledWith("add-household-member", {
      body: {
        household_id: "h1",
        name: "Riley",
        role: "child",
        email: "riley@example.com",
      },
    });

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText("Send this link to Riley so they can choose their password."),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Set-password link")).toHaveValue(
      "https://app.example/set-password#token_hash=tok&type=recovery",
    );
    expect(screen.queryByText(/initial password/i)).not.toBeInTheDocument();
    expect(screen.getByText("Riley was added.")).toBeInTheDocument();
    // The roster and login emails are read again.
    await waitFor(() => expect(tableMock.select).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(callsFor("get_login_emails")).toHaveLength(2));
  });

  it("explains how to recover when the link could not be created", async () => {
    const user = userEvent.setup();
    mockFunctions({
      "add-household-member": {
        data: { id: "new-1", user_id: "u-1", set_password_url: null, set_password_link_failed: true },
        error: null,
      },
    });
    renderPage();

    await openAndSubmit(user);

    expect(
      await screen.findByText(
        /Riley was added, but the link could not be created\. Use "Create set-password link" on their page\./,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the Edge Function's error message on failure and allows retry", async () => {
    const user = userEvent.setup();
    mockFunctions({
      "add-household-member": {
        data: { error: "only an active Parent of this household may add a member" },
        error: new Error("Edge Function returned a non-2xx status code"),
      },
    });
    renderPage();

    await openAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "only an active Parent of this household may add a member",
    );
    // The form is still present so the Parent can correct and retry --
    // no silent queueing, per ADR-007.
    expect(screen.getByRole("button", { name: "Add member" })).toBeInTheDocument();
  });
});
