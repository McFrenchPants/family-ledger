// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ParentDashboardPage } from "./ParentDashboardPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import type { HouseholdRecentTransaction } from "../features/ledger/recent-activity";
import type { HouseholdBalancesState } from "../features/ledger/useHouseholdBalances";
import type { HouseholdRecentActivityState } from "../features/ledger/useHouseholdRecentActivity";
import type { HouseholdTimezoneState } from "../features/ledger/useHouseholdTimezone";
import type { ChildPaymentProgress } from "../features/payment-plans/useChildPaymentProgress";
import type { HouseholdPaymentProgressState } from "../features/payment-plans/useHouseholdPaymentProgress";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

let balances: HouseholdBalancesState;
let progress: HouseholdPaymentProgressState;
let activity: HouseholdRecentActivityState;
let zone: HouseholdTimezoneState;

vi.mock("../features/ledger/useHouseholdBalances", () => ({ useHouseholdBalances: () => balances }));
vi.mock("../features/payment-plans/useHouseholdPaymentProgress", () => ({
  useHouseholdPaymentProgress: () => progress,
}));
vi.mock("../features/ledger/useHouseholdRecentActivity", () => ({
  useHouseholdRecentActivity: () => activity,
}));
vi.mock("../features/ledger/useHouseholdTimezone", () => ({ useHouseholdTimezone: () => zone }));
// The nudge's own rules are unit-tested in device-nudge.test.ts; here we
// only check what Home tells it.
vi.mock("../features/push/DeviceNudge", () => ({
  DeviceNudge: ({ needsAttention }: { needsAttention: boolean }) => (
    <p data-testid="nudge">{needsAttention ? "nudge hidden" : "nudge allowed"}</p>
  ),
}));

const membership: MembershipState = {
  status: "loaded",
  membership: { memberId: "p1", householdId: "h1", role: "parent", name: "Dana Smith", status: "active" },
};

const plan = (over: Partial<ChildPaymentProgress> = {}): ChildPaymentProgress => ({
  periodStatus: "due",
  minimumCents: 4000,
  paidCents: 0,
  remainingCents: 4000,
  dueDate: "2026-10-15",
  ...over,
});

const ROSTER: HouseholdBalancesState = {
  status: "loaded",
  children: [
    { memberId: "ryan", name: "Ryan", balanceCents: 0 },
    { memberId: "katie", name: "Katie", balanceCents: 6381 },
    { memberId: "sam", name: "Sam", balanceCents: 11240 },
    { memberId: "alex", name: "Alex", balanceCents: 18732 },
    { memberId: "jo", name: "Jo", balanceCents: 2500 },
  ],
};

const PROBLEMS: HouseholdPaymentProgressState = {
  status: "loaded",
  progressByMemberId: new Map<string, ChildPaymentProgress | null>([
    ["ryan", null],
    ["katie", plan({ periodStatus: "satisfied", minimumCents: 2000, paidCents: 2000, remainingCents: 0 })],
    ["sam", plan({ minimumCents: 3000, remainingCents: 3000, dueDate: "2026-10-05" })],
    ["alex", plan({ periodStatus: "overdue", paidCents: 2500, remainingCents: 1500, dueDate: "2026-09-15" })],
    ["jo", null],
  ]),
};

const CALM: HouseholdPaymentProgressState = {
  status: "loaded",
  progressByMemberId: new Map<string, ChildPaymentProgress | null>([
    ["ryan", null],
    ["katie", plan({ periodStatus: "satisfied", minimumCents: 2000, paidCents: 2000, remainingCents: 0 })],
    ["sam", plan({ periodStatus: "upcoming", dueDate: "2026-10-20" })],
    ["alex", plan({ periodStatus: "waived" })],
    ["jo", null],
  ]),
};

const tx = (over: Partial<HouseholdRecentTransaction> & { id: string }): HouseholdRecentTransaction => ({
  memberId: "alex",
  description: "Gas",
  categoryName: "Gas",
  amountCents: 4217,
  type: "expense",
  occurredOn: "2026-10-01",
  ...over,
});

const SOME_ACTIVITY: HouseholdRecentActivityState = {
  status: "loaded",
  transactions: [
    tx({ id: "e1" }),
    tx({ id: "p1", memberId: "katie", description: "Payment", categoryName: null, type: "payment", amountCents: -2000 }),
    tx({ id: "p2", memberId: "sam", description: "Cash", categoryName: null, type: "payment", amountCents: -500, isVoided: true }),
    tx({ id: "e2", memberId: "sam", description: "Phone bill", categoryName: "Phone", amountCents: 6000 }),
  ],
};

function renderHome() {
  return render(
    <MembershipContext.Provider value={membership}>
      <MemoryRouter initialEntries={["/home"]}>
        <ParentDashboardPage />
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

const retry = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 16:00 UTC = noon in New York on Friday, October 2.
  vi.setSystemTime(new Date("2026-10-02T16:00:00Z"));
  retry.mockReset();
  balances = ROSTER;
  progress = PROBLEMS;
  activity = SOME_ACTIVITY;
  zone = { status: "loaded", timezone: "America/New_York" };
});

afterEach(() => {
  vi.useRealTimers();
});

const attentionSection = () => screen.getByRole("region", { name: /Needs attention/ });
const childCards = () => screen.getAllByTestId("child-card");

describe("ParentDashboardPage", () => {
  it("greets the parent by first name with the household's date and time of day", () => {
    renderHome();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good afternoon, Dana");
    expect(screen.getByText("Friday, October 2")).toBeInTheDocument();
  });

  it("falls back to a neutral greeting while the household zone is unknown", () => {
    zone = { status: "loading" };
    renderHome();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi, Dana");
    expect(screen.queryByText("Friday, October 2")).not.toBeInTheDocument();
  });

  it("needs attention: overdue then due soon, each with Record payment and no Remind", () => {
    renderHome();
    const section = attentionSection();
    expect(within(section).getByRole("heading", { level: 2 })).toHaveTextContent(/Needs attentions*2 children/);

    const cards = within(section).getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-attention", "overdue");
    expect(cards[0]).toHaveTextContent("Alex is $15.00 behind");
    expect(cards[0]).toHaveTextContent("September minimum, due Sep 15 · 17 days overdue");
    expect(within(cards[0]!).getByText("Overdue").closest("[data-status]")).toHaveAttribute(
      "data-status",
      "overdue",
    );
    expect(within(cards[0]!).getByRole("link", { name: "Record payment for Alex" })).toHaveAttribute(
      "href",
      "/new/payment?child=alex",
    );

    expect(cards[1]).toHaveAttribute("data-attention", "due-soon");
    expect(cards[1]).toHaveTextContent("Sam owes $30.00 by Oct 5");
    expect(within(cards[1]!).getByText("Due in 3 days")).toBeInTheDocument();

    expect(screen.queryByText("Everyone is up to date")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remind/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /remind/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/remind/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("nudge")).toHaveTextContent("nudge hidden");
  });

  it("due today reads as Due today", () => {
    progress = {
      status: "loaded",
      progressByMemberId: new Map([
        ["ryan", null],
        ["katie", null],
        ["sam", plan({ dueDate: "2026-10-02", remainingCents: 3000 })],
        ["alex", null],
        ["jo", null],
      ]),
    };
    renderHome();
    expect(within(attentionSection()).getByText("Due today")).toBeInTheDocument();
    expect(attentionSection()).toHaveTextContent("Sam owes $30.00 today");
  });

  it("everyone up to date: no attention section, one calm line, nudge allowed", () => {
    progress = CALM;
    renderHome();
    expect(screen.queryByRole("region", { name: /Needs attention/ })).not.toBeInTheDocument();
    expect(screen.getByText("Everyone is up to date")).toBeInTheDocument();
    expect(screen.getByTestId("nudge")).toHaveTextContent("nudge allowed");
  });

  it("follows the household date just across midnight in a non-UTC zone", () => {
    // 06:30 UTC on Oct 3 is 23:30 on Oct 2 in Los Angeles.
    vi.setSystemTime(new Date("2026-10-03T06:30:00Z"));
    zone = { status: "loaded", timezone: "America/Los_Angeles" };
    balances = {
      status: "loaded",
      children: [
        { memberId: "a", name: "Ann", balanceCents: 5000 },
        { memberId: "b", name: "Bo", balanceCents: 5000 },
      ],
    };
    progress = {
      status: "loaded",
      progressByMemberId: new Map([
        // 8 days out in LA (not due soon); 7 by the UTC date.
        ["a", plan({ dueDate: "2026-10-10" })],
        // 2 days overdue in LA; 3 by the UTC date.
        ["b", plan({ periodStatus: "overdue", dueDate: "2026-09-30" })],
      ]),
    };
    renderHome();
    expect(screen.getByText("Friday, October 2")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Good evening, Dana");
    const cards = within(attentionSection()).getAllByRole("listitem");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveTextContent("2 days overdue");
    const ann = childCards().find((card) => card.getAttribute("aria-label") === "Ann")!;
    expect(within(ann).getByText("Due Oct 10").closest("[data-status]")).toHaveAttribute(
      "data-status",
      "upcoming",
    );
  });

  it("household total with the still-due line", () => {
    renderHome();
    const total = screen.getByRole("region", { name: "Owed to the family" });
    expect(within(total).getByRole("img", { name: /388 dollars and 53 cents owed to the family/ })).toBeInTheDocument();
    expect(total).toHaveTextContent("across 5 children · $45.00 due by Oct 5");
  });

  it("children: ordered overdue, due soonest, paid up, no plan, with Parent chips and buttons", () => {
    renderHome();
    expect(childCards().map((card) => card.getAttribute("aria-label"))).toEqual([
      "Alex",
      "Sam",
      "Ryan",
      "Katie",
      "Jo",
    ]);

    const [alex, sam, ryan, katie, jo] = childCards() as [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(within(alex).getByText("$15.00 overdue")).toBeInTheDocument();
    expect(within(alex).getByRole("img", { name: /187 dollars and 32 cents owed/ })).toBeInTheDocument();
    expect(within(alex).getByRole("progressbar", { name: "Alex: paid this month" })).toHaveAttribute(
      "aria-valuetext",
      "$25.00 of $40.00 paid",
    );
    expect(within(alex).getByRole("link", { name: "Alex" })).toHaveAttribute("href", "/family/alex");
    expect(within(alex).getByRole("link", { name: "Expense for Alex" })).toHaveAttribute(
      "href",
      "/new/expense?child=alex",
    );
    expect(within(alex).getByRole("link", { name: "Payment from Alex" })).toHaveAttribute(
      "href",
      "/new/payment?child=alex",
    );

    expect(within(sam).getByText("$30.00 due Oct 5")).toBeInTheDocument();
    // Zero balance: All caught up, no progress bar.
    expect(within(ryan).getByText("All caught up")).toBeInTheDocument();
    expect(within(ryan).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(katie).getByText("October paid")).toBeInTheDocument();
    // No plan.
    expect(within(jo).getByText("No plan")).toBeInTheDocument();
    expect(within(jo).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows Waived and Due <date> chips", () => {
    progress = CALM;
    renderHome();
    expect(screen.getByText("Waived")).toBeInTheDocument();
    expect(screen.getByText("Due Oct 20")).toBeInTheDocument();
  });

  it("recent activity: 4 rows with child names, voided marked, See all", () => {
    renderHome();
    const recent = screen.getByRole("region", { name: "Recent activity" });
    const rows = within(recent).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Gas");
    expect(rows[0]).toHaveTextContent("Alex");
    expect(rows[1]).toHaveTextContent("Katie");
    expect(within(rows[1]!).getByRole("img", { name: /minus 20 dollars/ })).toBeInTheDocument();
    expect(rows[2]).toHaveAttribute("data-voided", "true");
    expect(rows[2]).toHaveTextContent("Voided");
    expect(within(rows[2]!).getByRole("img", { name: /voided/ })).toBeInTheDocument();
    expect(within(recent).getByRole("link", { name: "See all" })).toHaveAttribute("href", "/activity");
  });

  it("loading: each section says so on its own", () => {
    balances = { status: "loading" };
    activity = { status: "loading" };
    renderHome();
    expect(screen.getByText("Loading balances…")).toBeInTheDocument();
    expect(screen.getByText("Loading recent activity…")).toBeInTheDocument();
    expect(screen.queryByText("Everyone is up to date")).not.toBeInTheDocument();
    expect(screen.getByTestId("nudge")).toHaveTextContent("nudge hidden");
  });

  it("plan status still loading does not block the balances list", () => {
    progress = { status: "loading" };
    renderHome();
    expect(screen.getByText("Checking payment plans…")).toBeInTheDocument();
    expect(childCards()).toHaveLength(5);
    expect(screen.queryByText("No plan")).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Owed to the family" })).toHaveTextContent("across 5 children");
  });

  it("does not flash 'No plan' while plan status still covers the empty pre-roster list", () => {
    progress = { status: "loaded", progressByMemberId: new Map() };
    renderHome();
    expect(screen.queryByText("No plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Everyone is up to date")).not.toBeInTheDocument();
  });

  it("errors: balances, plans, settings and activity each fail independently with retry", async () => {
    const user = userEvent.setup();
    progress = { status: "error", message: "plans down", retry };
    activity = { status: "error", message: "nope", retry };
    renderHome();
    expect(screen.getByText("Could not load payment plans: plans down")).toBeInTheDocument();
    expect(screen.getByText("Could not load recent activity: nope")).toBeInTheDocument();
    // Balances still render.
    expect(childCards()).toHaveLength(5);
    for (const button of screen.getAllByRole("button", { name: "Retry" })) {
      await user.click(button);
    }
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("balances error shows retry and no children", async () => {
    const user = userEvent.setup();
    balances = { status: "error", message: "boom", retry };
    renderHome();
    expect(screen.getByText("Could not load balances: boom")).toBeInTheDocument();
    expect(screen.queryAllByTestId("child-card")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("household settings error shows retry", () => {
    zone = { status: "error", message: "tz", retry };
    renderHome();
    expect(screen.getByText("Could not load your household settings: tz")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi, Dana");
  });

  it("no children yet: a pointer to Family, no total, no attention line", () => {
    balances = { status: "loaded", children: [] };
    progress = { status: "loaded", progressByMemberId: new Map() };
    activity = { status: "loaded", transactions: [] };
    renderHome();
    expect(screen.getByText("No children yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a child in Family" })).toHaveAttribute("href", "/family");
    expect(screen.queryByRole("region", { name: "Owed to the family" })).not.toBeInTheDocument();
    expect(screen.queryByText("Everyone is up to date")).not.toBeInTheDocument();
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
  });

  it("leaves household tools to Settings and drops the old big buttons", () => {
    renderHome();
    expect(screen.queryByRole("navigation", { name: "Household tools" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Export ledger" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/family");
    expect(screen.queryByRole("link", { name: "+ Expense" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Manage members" })).not.toBeInTheDocument();
  });
});
