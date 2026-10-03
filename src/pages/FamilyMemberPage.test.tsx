// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FamilyMemberPage } from "./FamilyMemberPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import type { RecentTransaction } from "../features/ledger/recent-activity";
import type { HouseholdBalancesState } from "../features/ledger/useHouseholdBalances";
import type { HouseholdTimezoneState } from "../features/ledger/useHouseholdTimezone";
import type { RecentActivityState } from "../features/ledger/useRecentActivity";
import type { MemberPushStatusState } from "../features/members/useMemberPushStatus";
import type { PaymentPlanRow } from "../features/payment-plans/payment-plans";
import type {
  ChildPaymentProgress,
  ChildPaymentProgressState,
} from "../features/payment-plans/useChildPaymentProgress";
import type { PaymentPlanState } from "../features/payment-plans/usePaymentPlan";

type QueryResult<T> = {
  data: T | null;
  error: { message: string; code?: string } | null;
};

/**
 * Chainable stand-in for supabase-js's thenable query builder (see
 * FamilyPage.test.tsx). The roster, login emails and every write (Edge
 * Functions, role/plan functions, the rename update) go through the mocked
 * client; balances, plan, period progress, recent activity, time zone and
 * reminders are swapped for plain state each test sets.
 */
function makeBuilder<T>(result: () => QueryResult<T>) {
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.returns = vi.fn(() => builder);
  builder.then = (
    resolve: (value: QueryResult<T>) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result()).then(resolve, reject);
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
let updateResult: QueryResult<null>;

const { fromMock, invokeMock, rpcMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  invokeMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("../lib/supabase", () => ({
  supabase: { from: fromMock, functions: { invoke: invokeMock }, rpc: rpcMock },
}));

let balances: HouseholdBalancesState;
let planState: PaymentPlanState;
let progressState: ChildPaymentProgressState;
let activity: RecentActivityState;
let zone: HouseholdTimezoneState;
let push: MemberPushStatusState;

vi.mock("../features/ledger/useHouseholdBalances", () => ({ useHouseholdBalances: () => balances }));
vi.mock("../features/payment-plans/usePaymentPlan", () => ({ usePaymentPlan: () => planState }));
vi.mock("../features/payment-plans/useChildPaymentProgress", () => ({
  useChildPaymentProgress: () => progressState,
}));
vi.mock("../features/ledger/useRecentActivity", () => ({ useRecentActivity: () => activity }));
vi.mock("../features/ledger/useHouseholdTimezone", () => ({ useHouseholdTimezone: () => zone }));
vi.mock("../features/members/useMemberPushStatus", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../features/members/useMemberPushStatus")>()),
  useMemberPushStatus: () => push,
}));

let tableMock: { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };

const emailsBody = {
  emails: { m1: "alex@example.com", m2: "sam@example.com", m3: "jamie@example.com" },
};

/** Routes the shared Edge Function mock by `action`, defaulting to success. */
function mockFunctions(overrides: Record<string, unknown> = {}) {
  invokeMock.mockImplementation((_name: string, options: { body: { action?: string } }) => {
    const key = options.body.action ?? "";
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

const ACTIVE_PLAN: PaymentPlanRow = {
  id: "plan-1",
  minimumCents: 4000,
  dueDay: 15,
  startsOn: "2026-06-15",
  endsOn: null,
  active: true,
};

const progress = (over: Partial<ChildPaymentProgress> = {}): ChildPaymentProgress => ({
  periodStatus: "overdue",
  minimumCents: 4000,
  paidCents: 2500,
  remainingCents: 1500,
  dueDate: "2026-09-15",
  ...over,
});

const tx = (over: Partial<RecentTransaction> & { id: string }): RecentTransaction => ({
  description: "Gas",
  categoryName: "Gas",
  amountCents: 4217,
  type: "expense",
  occurredOn: "2026-10-01",
  ...over,
});

const planRefetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  membersResult = {
    data: [
      row("m2", "Sam", "child"),
      row("m1", "Alex", "parent"),
      row("m3", "Jamie", "child", "archived"),
    ],
    error: null,
  };
  updateResult = { data: null, error: null };
  const updateBuilder = makeBuilder(() => updateResult);
  tableMock = {
    select: vi.fn(() => makeBuilder(() => membersResult)),
    update: vi.fn(() => updateBuilder),
  };
  fromMock.mockReturnValue(tableMock);
  rpcMock.mockResolvedValue({ data: {}, error: null });
  mockFunctions();

  balances = {
    status: "loaded",
    children: [{ memberId: "m2", name: "Sam", balanceCents: 18732 }],
  };
  planState = { status: "loaded", plan: ACTIVE_PLAN, refetch: planRefetch };
  progressState = { status: "loaded", progress: progress() };
  activity = {
    status: "loaded",
    transactions: [
      tx({ id: "t1" }),
      tx({ id: "t2", description: "Cash", type: "payment", categoryName: null, amountCents: -2500, isVoided: true }),
      tx({ id: "t3", description: "Phone bill", amountCents: 6000 }),
      tx({ id: "t4", description: "Dinner", amountCents: 1835 }),
      tx({ id: "t5", description: "Movie", amountCents: 1200 }),
      tx({ id: "t6", description: "Sixth row", amountCents: 100 }),
    ],
  };
  zone = { status: "loaded", timezone: "America/New_York" };
  push = {
    status: "loaded",
    remindersOn: new Map([
      ["m1", true],
      ["m2", false],
    ]),
  };
});

const loadedParent: MembershipState = {
  status: "loaded",
  membership: { memberId: "m1", householdId: "h1", role: "parent", name: "Alex", status: "active" },
};

function renderPage(memberId = "m2") {
  return render(
    <MembershipContext.Provider value={loadedParent}>
      <MemoryRouter initialEntries={[`/family/${memberId}`]}>
        <Routes>
          <Route path="/family/:memberId" element={<FamilyMemberPage />} />
        </Routes>
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

const heading = () => screen.findByRole("heading", { level: 1 });
const manage = () => screen.getByRole("region", { name: "Manage" });

describe("FamilyMemberPage: an active child", () => {
  it("shows name, role, reminder line and a link back to Family", async () => {
    renderPage();

    expect(await heading()).toHaveTextContent("Sam");
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Child")).toBeInTheDocument();
    expect(screen.getByTestId("reminder-line")).toHaveTextContent("Reminders off");
    expect(screen.getByRole("link", { name: "Family" })).toHaveAttribute("href", "/family");
  });

  it("omits the reminder line while reminder state is unknown", async () => {
    push = { status: "error", message: "x", retry: () => {} };
    renderPage();

    await heading();
    expect(screen.queryByTestId("reminder-line")).not.toBeInTheDocument();
    expect(screen.queryByText(/Reminders/)).not.toBeInTheDocument();
  });

  it("shows the balance with Expense and Payment links for this child", async () => {
    renderPage();

    await heading();
    expect(screen.getByRole("img", { name: /187 dollars and 32 cents owed/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Expense for Sam" })).toHaveAttribute(
      "href",
      "/new/expense?child=m2",
    );
    expect(screen.getByRole("link", { name: "Payment from Sam" })).toHaveAttribute(
      "href",
      "/new/payment?child=m2",
    );
  });

  it("never shows a $0 stand-in when the balance failed, and offers a retry", async () => {
    const retry = vi.fn();
    balances = { status: "error", message: "nope", retry };
    const user = userEvent.setup();
    renderPage();

    await heading();
    const card = screen.getByRole("region", { name: "Owes" });
    expect(within(card).queryByText(/\$0/)).not.toBeInTheDocument();
    expect(within(card).getByRole("alert")).toHaveTextContent("Could not load the balance: nope");
    await user.click(within(card).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("shows the plan terms, current status chip and this period's progress", async () => {
    renderPage();

    await heading();
    const card = screen.getByRole("region", { name: /Payment plan/ });
    expect(within(card).getByText("$40.00")).toBeInTheDocument();
    expect(within(card).getByText("Due on day 15 each month · since Jun 15")).toBeInTheDocument();
    expect(within(card).getByText("$15.00 overdue")).toHaveAttribute("data-status", "overdue");
    expect(within(card).getByText("September: $25.00 of $40.00")).toBeInTheDocument();
    expect(within(card).getByText("$15.00 left · Due Sep 15")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: "Paid this period" })).toHaveAttribute(
      "aria-valuenow",
      "2500",
    );
  });

  it("shows a progress error with retry without hiding the plan", async () => {
    const retry = vi.fn();
    progressState = { status: "error", message: "rpc down", retry };
    renderPage();

    await heading();
    const card = screen.getByRole("region", { name: /Payment plan/ });
    expect(within(card).getByText("$40.00")).toBeInTheDocument();
    expect(within(card).getByRole("alert")).toHaveTextContent(
      "Could not load this month's progress: rpc down",
    );
    expect(within(card).queryByText(/overdue/)).not.toBeInTheDocument();
  });

  it("shows a plan load error with retry", async () => {
    const retry = vi.fn();
    planState = { status: "error", message: "denied", retry };
    const user = userEvent.setup();
    renderPage();

    await heading();
    expect(screen.getByText("Could not load this plan: denied")).toBeInTheDocument();
    const card = screen.getByRole("region", { name: /Payment plan/ });
    await user.click(within(card).getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalled();
  });

  it("lists up to five recent rows, marks voided ones, and links to all of this child's activity", async () => {
    renderPage();

    await heading();
    const recent = screen.getByRole("region", { name: "Recent" });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(5);
    expect(within(recent).queryByText("Sixth row")).not.toBeInTheDocument();
    const voided = within(recent).getByText("Cash").closest("li")!;
    expect(voided).toHaveAttribute("data-voided", "true");
    expect(within(voided).getByText(/Voided/)).toBeInTheDocument();
    expect(within(recent).getByRole("link", { name: /See all/ })).toHaveAttribute(
      "href",
      "/activity?child=m2",
    );
  });
});

describe("FamilyMemberPage: payment plan editing", () => {
  it("treats no active plan as its own state and creates one directly", async () => {
    planState = { status: "loaded", plan: null, refetch: planRefetch };
    progressState = { status: "loaded", progress: null };
    const user = userEvent.setup();
    renderPage();

    await heading();
    const card = screen.getByRole("region", { name: /Payment plan/ });
    expect(within(card).getByText("No active plan")).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: "Edit plan" })).not.toBeInTheDocument();

    await user.type(within(card).getByLabelText("Minimum amount"), "25.50");
    await user.type(within(card).getByLabelText("Due day (1-28)"), "10");
    fireEvent.change(within(card).getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    await user.click(within(card).getByRole("button", { name: "Create plan" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("create_payment_plan", {
        p_member_id: "m2",
        p_minimum_cents: 2550,
        p_due_day: 10,
        p_starts_on: "2026-10-01",
        p_ends_on: null,
      }),
    );
    expect(planRefetch).toHaveBeenCalled();
  });

  it("shows field errors and makes no call for an invalid plan", async () => {
    planState = { status: "loaded", plan: null, refetch: planRefetch };
    const user = userEvent.setup();
    renderPage();

    await heading();
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    expect(screen.getByText("Enter a due day between 1 and 28.")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid start date.")).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("shows the function's error when creating fails, and keeps the form", async () => {
    planState = { status: "loaded", plan: null, refetch: planRefetch };
    rpcMock.mockResolvedValue({ data: null, error: { message: "only a Parent may do that" } });
    const user = userEvent.setup();
    renderPage();

    await heading();
    await user.type(screen.getByLabelText("Minimum amount"), "25");
    await user.type(screen.getByLabelText("Due day (1-28)"), "10");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    await user.click(screen.getByRole("button", { name: "Create plan" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save this plan: only a Parent may do that",
    );
    expect(screen.getByRole("button", { name: "Create plan" })).toBeInTheDocument();
    expect(planRefetch).not.toHaveBeenCalled();
  });

  it("edits a plan only after an explicit 'this will replace the current plan' confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await heading();
    await user.click(screen.getByRole("button", { name: "Edit plan" }));
    const amount = screen.getByLabelText("Minimum amount");
    expect(amount).toHaveValue("40.00");
    await user.clear(amount);
    await user.type(amount, "50");
    await user.click(screen.getByRole("button", { name: "Review changes" }));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "This will replace the current plan of $40.00/month due on day 15 -- the old plan will be deactivated.",
    );
    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm replace" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Confirm replace" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("create_payment_plan", {
        p_member_id: "m2",
        p_minimum_cents: 5000,
        p_due_day: 15,
        p_starts_on: "2026-06-15",
        p_ends_on: null,
      }),
    );
    expect(planRefetch).toHaveBeenCalled();
  });

  it("cancelling the replacement makes no call", async () => {
    const user = userEvent.setup();
    renderPage();

    await heading();
    await user.click(screen.getByRole("button", { name: "Edit plan" }));
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    const card = screen.getByRole("region", { name: /Payment plan/ });
    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.queryByText(/This will replace/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit plan" })).toBeInTheDocument();
  });

  it("shows the replacement error and lets the Parent try again", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "due day out of range" } });
    const user = userEvent.setup();
    renderPage();

    await heading();
    await user.click(screen.getByRole("button", { name: "Edit plan" }));
    await user.click(screen.getByRole("button", { name: "Review changes" }));
    await user.click(screen.getByRole("button", { name: "Confirm replace" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not save this plan: due day out of range",
    );
    expect(screen.getByRole("button", { name: "Review changes" })).toBeInTheDocument();
    expect(planRefetch).not.toHaveBeenCalled();
  });

  it("deactivates only after confirmation", async () => {
    const user = userEvent.setup();
    renderPage();

    await heading();
    await user.click(screen.getByRole("button", { name: "Deactivate plan" }));
    expect(
      screen.getByText("Deactivate this plan? The child will have no active plan afterward."),
    ).toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Confirm deactivate" }));

    await waitFor(() =>
      expect(rpcMock).toHaveBeenCalledWith("deactivate_payment_plan", { p_plan_id: "plan-1" }),
    );
    expect(planRefetch).toHaveBeenCalled();
  });

  it("cancelling deactivation makes no call", async () => {
    const user = userEvent.setup();
    renderPage();

    await heading();
    await user.click(screen.getByRole("button", { name: "Deactivate plan" }));
    const card = screen.getByRole("region", { name: /Payment plan/ });
    await user.click(within(card).getByRole("button", { name: "Cancel" }));

    expect(rpcMock).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Deactivate plan" })).toBeInTheDocument();
  });

  it("shows the deactivation error and keeps the confirmation open", async () => {
    rpcMock.mockRejectedValue(new Error("offline"));
    const user = userEvent.setup();
    renderPage();

    await heading();
    await user.click(screen.getByRole("button", { name: "Deactivate plan" }));
    await user.click(screen.getByRole("button", { name: "Confirm deactivate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not deactivate this plan: Could not reach the ledger service: offline",
    );
    expect(screen.getByRole("button", { name: "Confirm deactivate" })).toBeEnabled();
  });
});

describe("FamilyMemberPage: other kinds of member", () => {
  it("shows a Parent no balance, plan, recent list or Expense/Payment links", async () => {
    renderPage("m1");

    expect(await heading()).toHaveTextContent("Alex");
    expect(screen.getByText("Parent · You")).toBeInTheDocument();
    expect(screen.getByTestId("reminder-line")).toHaveTextContent("Reminders on");
    expect(screen.queryByRole("region", { name: "Owes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Payment plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recent" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Expense|Payment/ })).not.toBeInTheDocument();
    expect(within(manage()).getByRole("button", { name: "Change role" })).toBeInTheDocument();
  });

  it("shows an archived member's history link and only Restore", async () => {
    renderPage("m3");

    expect(await heading()).toHaveTextContent("Jamie");
    expect(screen.getAllByText("Archived").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "See their history" })).toHaveAttribute(
      "href",
      "/activity?child=m3",
    );
    expect(screen.queryByRole("region", { name: /Payment plan/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Expense|Payment/ })).not.toBeInTheDocument();
    expect(within(manage()).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    for (const name of ["Rename", "Change role", "Change email", "Create set-password link", "Archive"]) {
      expect(within(manage()).queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("says plainly when the person is not in this household", async () => {
    renderPage("someone-else");

    expect(await heading()).toHaveTextContent("We couldn't find this person");
    expect(screen.getByRole("link", { name: "Back to Family" })).toHaveAttribute("href", "/family");
    expect(screen.queryByRole("region", { name: "Manage" })).not.toBeInTheDocument();
  });

  it("shows loading, then an error with a working retry", async () => {
    membersResult = { data: null, error: { message: "db down" } };
    const user = userEvent.setup();
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load this person: db down");

    membersResult = { data: [row("m2", "Sam", "child")], error: null };
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await heading()).toHaveTextContent("Sam");
  });
});

describe("FamilyMemberPage: managing a member", () => {
  it("hides Change email when the login email is unknown, but links still work", async () => {
    mockFunctions({ get_login_emails: httpError(500, "something went wrong, please try again") });
    renderPage();

    await heading();
    await waitFor(() => expect(callsFor("get_login_emails")).toHaveLength(1));
    expect(within(manage()).queryByRole("button", { name: "Change email" })).not.toBeInTheDocument();
    expect(
      within(manage()).getByRole("button", { name: "Create set-password link" }),
    ).toBeInTheDocument();
  });

  describe("rename", () => {
    it("saves the trimmed name and refreshes", async () => {
      const user = userEvent.setup();
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Rename" }));
      const field = within(manage()).getByLabelText("Name");
      expect(field).toHaveValue("Sam");
      await user.clear(field);
      await user.type(field, "  Samantha ");
      await user.click(within(manage()).getByRole("button", { name: "Save" }));

      await waitFor(() => expect(tableMock.update).toHaveBeenCalledWith({ name: "Samantha" }));
      await waitFor(() => expect(tableMock.select).toHaveBeenCalledTimes(2));
    });

    it("keeps the page, with a retry, when the re-read after a rename fails", async () => {
      const user = userEvent.setup();
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Rename" }));
      const field = within(manage()).getByLabelText("Name");
      await user.clear(field);
      await user.type(field, "Samantha");
      membersResult = { data: null, error: { message: "db down" } };
      await user.click(within(manage()).getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Could not refresh this person's details: db down")).toBeInTheDocument();
      // Still the person's page, not a full-page load error.
      expect(manage()).toBeInTheDocument();
      expect(screen.queryByText(/Could not load this person/)).not.toBeInTheDocument();

      membersResult = { data: [row("m2", "Samantha", "child")], error: null };
      await user.click(screen.getByRole("button", { name: "Retry" }));
      expect(await screen.findByRole("heading", { level: 1, name: "Samantha" })).toBeInTheDocument();
      expect(screen.queryByText(/Could not refresh/)).not.toBeInTheDocument();
    });

    it("refuses an empty name without calling the server", async () => {
      const user = userEvent.setup();
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Rename" }));
      await user.clear(within(manage()).getByLabelText("Name"));
      await user.click(within(manage()).getByRole("button", { name: "Save" }));

      expect(within(manage()).getByRole("alert")).toHaveTextContent("Name can't be empty.");
      expect(tableMock.update).not.toHaveBeenCalled();
    });

    it("shows the server's refusal", async () => {
      updateResult = { data: null, error: { message: "permission denied" } };
      const user = userEvent.setup();
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Rename" }));
      await user.click(within(manage()).getByRole("button", { name: "Save" }));

      expect(await within(manage()).findByRole("alert")).toHaveTextContent("permission denied");
    });
  });

  describe("archive and restore", () => {
    it("requires a confirm step, then archives through the function (not a table update)", async () => {
      const user = userEvent.setup();
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Archive" }));

      expect(within(manage()).getByText(/Archive this member\?/)).toBeInTheDocument();
      expect(within(manage()).getByText(/archived members can be restored/i)).toBeInTheDocument();
      expect(within(manage()).getByText(/does not delete their history/i)).toBeInTheDocument();
      expect(callsFor("archive")).toHaveLength(0);

      await user.click(within(manage()).getByRole("button", { name: "Confirm archive" }));

      await waitFor(() => expect(callsFor("archive")).toHaveLength(1));
      expect(callsFor("archive")[0][1]).toEqual({ body: { action: "archive", member_id: "m2" } });
      expect(tableMock.update).not.toHaveBeenCalled();
      // The page re-reads its own data afterwards.
      await waitFor(() => expect(tableMock.select).toHaveBeenCalledTimes(2));
    });

    it("maps the last-active-Parent refusal to a friendly message", async () => {
      const user = userEvent.setup();
      mockFunctions({
        archive: httpError(
          409,
          "the household's only active Parent can't be archived; make another person a Parent first",
        ),
      });
      renderPage("m1");

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Archive" }));
      await user.click(within(manage()).getByRole("button", { name: "Confirm archive" }));

      expect(await within(manage()).findByRole("alert")).toHaveTextContent(
        "You can't archive the household's only active Parent.",
      );
    });

    it("shows a retryable message for a generic failure, and the button works again", async () => {
      const user = userEvent.setup();
      mockFunctions({ archive: httpError(500, "something went wrong, please try again") });
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Archive" }));
      await user.click(within(manage()).getByRole("button", { name: "Confirm archive" }));

      expect(await within(manage()).findByRole("alert")).toHaveTextContent(
        "Something went wrong, please try again.",
      );
      expect(within(manage()).getByRole("button", { name: "Archive" })).toBeEnabled();
    });

    it("restores through the function and refreshes", async () => {
      const user = userEvent.setup();
      renderPage("m3");

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Restore" }));

      await waitFor(() => expect(callsFor("restore")).toHaveLength(1));
      expect(callsFor("restore")[0][1]).toEqual({ body: { action: "restore", member_id: "m3" } });
      await waitFor(() => expect(tableMock.select).toHaveBeenCalledTimes(2));
    });

    it("says it could not reach the service when the call never arrives", async () => {
      const user = userEvent.setup();
      invokeMock.mockImplementation((_name: string, options: { body: { action?: string } }) =>
        options.body.action === "restore"
          ? Promise.reject(new Error("network down"))
          : Promise.resolve({ data: emailsBody, error: null }),
      );
      renderPage("m3");

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Restore" }));

      expect(await within(manage()).findByRole("alert")).toHaveTextContent(/could not reach/i);
    });
  });

  describe("changing a role", () => {
    it("confirms with consequences, then calls the role function and refreshes", async () => {
      const user = userEvent.setup();
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Change role" }));

      expect(within(manage()).getByText(/Make Sam a Parent\?/)).toBeInTheDocument();
      expect(
        within(manage()).getByText(
          /A Parent can manage everyone and record payments; a Child can only add expenses\./,
        ),
      ).toBeInTheDocument();
      expect(rpcMock).not.toHaveBeenCalled();

      await user.click(within(manage()).getByRole("button", { name: "Confirm role change" }));

      await waitFor(() =>
        expect(rpcMock).toHaveBeenCalledWith("change_household_member_role", {
          p_member_id: "m2",
          p_new_role: "parent",
        }),
      );
      await waitFor(() => expect(tableMock.select).toHaveBeenCalledTimes(2));
    });

    it("proposes Child for a Parent", async () => {
      const user = userEvent.setup();
      renderPage("m1");

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Change role" }));
      await user.click(within(manage()).getByRole("button", { name: "Confirm role change" }));

      await waitFor(() =>
        expect(rpcMock).toHaveBeenCalledWith("change_household_member_role", {
          p_member_id: "m1",
          p_new_role: "child",
        }),
      );
    });

    it("cancel makes no call", async () => {
      const user = userEvent.setup();
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Change role" }));
      await user.click(within(manage()).getByRole("button", { name: "Cancel" }));

      expect(rpcMock).not.toHaveBeenCalled();
      expect(within(manage()).queryByText(/Make Sam/)).not.toBeInTheDocument();
    });

    it("explains the last-Parent refusal in plain words", async () => {
      const user = userEvent.setup();
      rpcMock.mockResolvedValue({
        data: null,
        error: { code: "P0001", message: "cannot archive or demote the household's only active Parent" },
      });
      renderPage("m1");

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Change role" }));
      await user.click(within(manage()).getByRole("button", { name: "Confirm role change" }));

      expect(await within(manage()).findByRole("alert")).toHaveTextContent(
        "You can't demote the household's only active Parent. Make another member a Parent first.",
      );
    });

    it("shows a generic retry message for unexpected errors", async () => {
      const user = userEvent.setup();
      rpcMock.mockResolvedValue({ data: null, error: { code: "XX000", message: "internal detail" } });
      renderPage();

      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Change role" }));
      await user.click(within(manage()).getByRole("button", { name: "Confirm role change" }));

      const alert = await within(manage()).findByRole("alert");
      expect(alert).toHaveTextContent("Something went wrong. Please try again.");
      expect(alert).not.toHaveTextContent("internal detail");
    });
  });

  describe("changing a login email", () => {
    async function openEmailForm(user: ReturnType<typeof userEvent.setup>) {
      await heading();
      await waitFor(() =>
        expect(within(manage()).getByRole("button", { name: "Change email" })).toBeInTheDocument(),
      );
      await user.click(within(manage()).getByRole("button", { name: "Change email" }));
    }

    it("warns about signing in with the new email, calls the function and refreshes emails", async () => {
      const user = userEvent.setup();
      renderPage();

      await openEmailForm(user);
      expect(within(manage()).getByText(/will need to sign in with the new email/i)).toBeInTheDocument();

      await user.type(within(manage()).getByLabelText(/New login email for Sam/), " sam.new@example.com ");
      await user.click(within(manage()).getByRole("button", { name: "Save email" }));

      await waitFor(() => expect(callsFor("change_email")).toHaveLength(1));
      expect(callsFor("change_email")[0][1]).toEqual({
        body: { action: "change_email", member_id: "m2", email: "sam.new@example.com" },
      });
      expect(await within(manage()).findByRole("status")).toHaveTextContent(
        "Login email changed to sam.new@example.com.",
      );
      await waitFor(() => expect(callsFor("get_login_emails")).toHaveLength(2));
    });

    it("shows a plain refusal for an unusable email and keeps the form open", async () => {
      const user = userEvent.setup();
      mockFunctions({ change_email: httpError(400, "that email can't be used") });
      renderPage();

      await openEmailForm(user);
      await user.type(within(manage()).getByLabelText(/New login email for Sam/), "taken@example.com");
      await user.click(within(manage()).getByRole("button", { name: "Save email" }));

      expect(await within(manage()).findByRole("alert")).toHaveTextContent("That email can't be used.");
      expect(within(manage()).getByLabelText(/New login email for Sam/)).toBeInTheDocument();
    });
  });

  describe("set-password link", () => {
    const url = "https://app.example/set-password#token_hash=secrettoken&type=recovery";

    async function createLink(user: ReturnType<typeof userEvent.setup>) {
      await heading();
      await user.click(within(manage()).getByRole("button", { name: "Create set-password link" }));
    }

    it("shows the link once in a dialog with notes, and drops it when closed", async () => {
      const user = userEvent.setup();
      mockFunctions({ create_link: { data: { url, expires_in_hours: 24 }, error: null } });
      renderPage();

      await createLink(user);

      expect(callsFor("create_link")[0][1]).toEqual({
        body: { action: "create_link", member_id: "m2" },
      });

      const dialog = await screen.findByRole("dialog", { name: /Set-password link for Sam/ });
      expect(within(dialog).getByLabelText("Set-password link")).toHaveValue(url);
      expect(within(dialog).getByLabelText("Set-password link")).toHaveAttribute("readonly");
      expect(within(dialog).getByText(/valid for 24 hours and works only once/i)).toBeInTheDocument();
      expect(
        within(dialog).getByText(/Anyone who has this link can set that person's password/),
      ).toBeInTheDocument();
      expect(within(dialog).getByText(/cancels any older link/i)).toBeInTheDocument();
      expect(dialog.contains(document.activeElement)).toBe(true);

      await user.click(within(dialog).getByRole("button", { name: "Close" }));

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(document.body.innerHTML).not.toContain("secrettoken");
    });

    it("copies the link to the clipboard", async () => {
      const user = userEvent.setup();
      mockFunctions({ create_link: { data: { url, expires_in_hours: 24 }, error: null } });
      renderPage();

      await createLink(user);
      const dialog = await screen.findByRole("dialog");
      await user.click(within(dialog).getByRole("button", { name: "Copy link" }));

      expect(await within(dialog).findByText("Copied.")).toBeInTheDocument();
      expect(await navigator.clipboard.readText()).toBe(url);
    });

    it("falls back to selecting the text when copying is not allowed", async () => {
      const user = userEvent.setup();
      mockFunctions({ create_link: { data: { url, expires_in_hours: 24 }, error: null } });
      renderPage();

      await createLink(user);
      const dialog = await screen.findByRole("dialog");
      const writeText = vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
      await user.click(within(dialog).getByRole("button", { name: "Copy link" }));

      expect(await within(dialog).findByText(/Could not copy automatically/)).toBeInTheDocument();
      expect(within(dialog).getByLabelText("Set-password link")).toHaveFocus();
      writeText.mockRestore();
    });

    it("closes on Escape", async () => {
      const user = userEvent.setup();
      mockFunctions({ create_link: { data: { url, expires_in_hours: 24 }, error: null } });
      renderPage();

      await createLink(user);
      await screen.findByRole("dialog");
      await user.keyboard("{Escape}");

      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("explains the rate limit", async () => {
      const user = userEvent.setup();
      mockFunctions({
        create_link: httpError(429, "too many links created recently; please try again later"),
      });
      renderPage();

      await createLink(user);

      expect(await within(manage()).findByRole("alert")).toHaveTextContent(
        /created a lot of links recently/i,
      );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("shows a generic error when the link cannot be made", async () => {
      const user = userEvent.setup();
      mockFunctions({ create_link: httpError(502, "unable to create the link") });
      renderPage();

      await createLink(user);

      expect(await within(manage()).findByRole("alert")).toHaveTextContent("Unable to create the link.");
    });
  });
});
