// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChildDashboardPage } from "./ChildDashboardPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import { SEEN_ACTIVITY_KEY_PREFIX, resetSessionAnnouncements } from "../features/home/child-home";
import type { RecentTransaction } from "../features/ledger/recent-activity";
import type { HouseholdTimezoneState } from "../features/ledger/useHouseholdTimezone";
import type { OwnBalanceState } from "../features/ledger/useOwnBalance";
import type { RecentActivityState } from "../features/ledger/useRecentActivity";
import type {
  ChildPaymentProgress,
  ChildPaymentProgressState,
} from "../features/payment-plans/useChildPaymentProgress";

vi.mock("../lib/supabase", () => ({ supabase: {} }));

let balance: OwnBalanceState;
let progress: ChildPaymentProgressState;
let activity: RecentActivityState;
let zone: HouseholdTimezoneState;

vi.mock("../features/ledger/useOwnBalance", () => ({ useOwnBalance: () => balance }));
vi.mock("../features/payment-plans/useChildPaymentProgress", () => ({
  useChildPaymentProgress: () => progress,
}));
let recentActivityArgs: unknown[] = [];
vi.mock("../features/ledger/useRecentActivity", () => ({
  useRecentActivity: (...args: unknown[]) => {
    recentActivityArgs = args;
    return activity;
  },
}));
vi.mock("../features/ledger/useHouseholdTimezone", () => ({ useHouseholdTimezone: () => zone }));
// The nudge's own rules are unit-tested in device-nudge.test.ts; here we
// only check what Home tells it.
vi.mock("../features/push/DeviceNudge", () => ({
  DeviceNudge: ({ needsAttention }: { needsAttention: boolean }) => (
    <p data-testid="nudge">{needsAttention ? "nudge hidden" : "nudge allowed"}</p>
  ),
}));

const MEMBER = "kid-1";
const membership: MembershipState = {
  status: "loaded",
  membership: { memberId: MEMBER, householdId: "h1", role: "child", name: "Alex", status: "active" },
};

const plan = (over: Partial<ChildPaymentProgress>): ChildPaymentProgressState => ({
  status: "loaded",
  progress: {
    periodStatus: "due",
    minimumCents: 4000,
    paidCents: 0,
    remainingCents: 4000,
    dueDate: "2026-10-15",
    ...over,
  },
});

const tx = (over: Partial<RecentTransaction> & { id: string }): RecentTransaction => ({
  description: "Gas",
  categoryName: "Gas",
  amountCents: 4217,
  type: "expense",
  occurredOn: "2026-09-30",
  ...over,
});

const SOME_ACTIVITY: RecentActivityState = {
  status: "loaded",
  transactions: [
    tx({ id: "e1" }),
    tx({ id: "p1", description: "Payment", categoryName: null, type: "payment", amountCents: -2500, occurredOn: "2026-09-28" }),
    tx({ id: "e2", description: "Phone bill", categoryName: "Phone", amountCents: 6000, occurredOn: "2026-09-24" }),
  ],
};

function renderHome() {
  return render(
    <MembershipContext.Provider value={membership}>
      <MemoryRouter initialEntries={["/home"]}>
        <ChildDashboardPage />
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

const retry = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 16:00 UTC = noon in New York on Friday, October 2.
  vi.setSystemTime(new Date("2026-10-02T16:00:00Z"));
  window.localStorage.clear();
  resetSessionAnnouncements();
  retry.mockReset();
  balance = { status: "loaded", balanceCents: 18732 };
  progress = plan({});
  activity = SOME_ACTIVITY;
  zone = { status: "loaded", timezone: "America/New_York" };
});

afterEach(() => {
  vi.useRealTimers();
});

const oweCard = () => screen.getByRole("region", { name: "You owe" });

describe("ChildDashboardPage", () => {
  it("greets the child with one h1 and the household's date", () => {
    renderHome();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hi, Alex");
    expect(screen.getByText("Friday, October 2")).toBeInTheDocument();
  });

  it("uses the household zone for today, not UTC", () => {
    // 01:00 UTC on Oct 3 is still Oct 2 in New York. Due Oct 10 is 8 days
    // out there (neutral); by the UTC date it would be 7 (due soon).
    vi.setSystemTime(new Date("2026-10-03T01:00:00Z"));
    progress = plan({ dueDate: "2026-10-10" });
    renderHome();
    expect(screen.getByText("Friday, October 2")).toBeInTheDocument();
    expect(within(oweCard()).getByText("Due Oct 10").closest("[data-status]")).toHaveAttribute(
      "data-status",
      "upcoming",
    );
  });

  it("shows loading states for each read", () => {
    balance = { status: "loading" };
    activity = { status: "loading" };
    renderHome();
    expect(screen.getByText("Loading your balance…")).toBeInTheDocument();
    expect(screen.getByText("Loading recent activity…")).toBeInTheDocument();
  });

  it("shows the plan loading while the plan or the time zone is in flight", () => {
    zone = { status: "loading" };
    renderHome();
    expect(screen.getByText("Loading your payment plan…")).toBeInTheDocument();
    expect(screen.getByTestId("nudge")).toHaveTextContent("nudge allowed");
  });

  it("shows an error with retry for each read", async () => {
    const user = userEvent.setup();
    balance = { status: "error", message: "boom", retry };
    activity = { status: "error", message: "nope", retry };
    renderHome();
    expect(screen.getByText("Could not load your balance: boom")).toBeInTheDocument();
    expect(screen.getByText("Could not load recent activity: nope")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: "Retry" })) {
      await user.click(button);
    }
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it("shows plan and time-zone errors with retry", async () => {
    const user = userEvent.setup();
    progress = { status: "error", message: "plan down", retry };
    renderHome();
    expect(screen.getByText("Could not load your payment plan: plan down")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledTimes(1);
    // Plan unknown: the nudge stays out of the way.
    expect(screen.getByTestId("nudge")).toHaveTextContent("nudge hidden");
  });

  it("shows a household-settings error with retry", () => {
    zone = { status: "error", message: "tz", retry };
    renderHome();
    expect(screen.getByText("Could not load your household settings: tz")).toBeInTheDocument();
  });

  it("empty: a brand-new child sees $0.00, All caught up, and a teaching activity card", () => {
    balance = { status: "loaded", balanceCents: 0 };
    progress = { status: "loaded", progress: null };
    activity = { status: "loaded", transactions: [] };
    renderHome();
    const card = oweCard();
    expect(within(card).getByRole("img", { name: /^0 dollars/ })).toBeInTheDocument();
    expect(within(card).getByText("All caught up")).toBeInTheDocument();
    expect(within(card).getByText(/If a parent covers something for you/)).toBeInTheDocument();
    expect(within(card).queryByText(/Paid off/)).not.toBeInTheDocument();
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "See all" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add an expense" })).toHaveAttribute("href", "/new/expense");
  });

  it("owes: hero amount, progress, next minimum, recent rows and See all", () => {
    renderHome();
    const card = oweCard();
    expect(within(card).getByRole("img", { name: /187 dollars and 32 cents owed/ })).toBeInTheDocument();
    expect(within(card).getByText("Due Oct 15")).toBeInTheDocument();
    expect(within(card).getByRole("progressbar", { name: "Paid this month" })).toHaveAttribute(
      "aria-valuetext",
      "$0.00 of $40.00 paid this month",
    );
    expect(within(card).getByText("Next minimum: $40.00 due Oct 15.")).toBeInTheDocument();
    expect(card.querySelector("[data-callout]")).toBeNull();

    const recent = screen.getByRole("region", { name: "Recent activity" });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(3);
    // A payment titled "Payment" doesn't say it twice: the subtitle is just the date.
    const payment = within(recent).getAllByRole("listitem")[1]!;
    expect(payment.textContent?.match(/Payment/g)).toHaveLength(1);
    expect(within(payment).getByText("Sep 28")).toBeInTheDocument();
    // Same for a category the title already names ("Phone bill" / Phone).
    expect(within(recent).getByText("Sep 24")).toBeInTheDocument();
    expect(within(recent).getByRole("link", { name: "See all" })).toHaveAttribute("href", "/activity");
    expect(screen.getByTestId("nudge")).toHaveTextContent("nudge allowed");
  });

  it("asks for live rows only: voided entries stay off Home", () => {
    renderHome();
    expect(recentActivityArgs).toEqual([MEMBER, { excludeVoided: true }]);
  });

  it("shows at most five recent rows", () => {
    activity = {
      status: "loaded",
      transactions: Array.from({ length: 8 }, (_, i) => tx({ id: `t${i}` })),
    };
    renderHome();
    const recent = screen.getByRole("region", { name: "Recent activity" });
    expect(within(recent).getAllByRole("listitem")).toHaveLength(5);
  });

  it("due soon: warn chip and a light reminder with amount and date", () => {
    progress = plan({ dueDate: "2026-10-05" });
    renderHome();
    const card = oweCard();
    expect(within(card).getByText("Due Oct 5").closest("[data-status]")).toHaveAttribute("data-status", "due");
    const callout = card.querySelector('[data-callout="warn"]');
    expect(callout).toHaveAttribute("role", "status");
    expect(callout).toHaveTextContent("$40.00");
    expect(callout).toHaveTextContent("Oct 5");
  });

  it("partially paid: info chip", () => {
    progress = plan({ periodStatus: "partially_paid", paidCents: 2500, remainingCents: 1500 });
    renderHome();
    expect(within(oweCard()).getByText("$25.00 of $40.00 paid")).toBeInTheDocument();
  });

  it("overdue: a polite callout with amount and due date, and no nudge", () => {
    progress = plan({ periodStatus: "overdue", dueDate: "2026-09-15", paidCents: 2500, remainingCents: 1500 });
    renderHome();
    const card = oweCard();
    const callout = card.querySelector('[data-callout="danger"]') as HTMLElement;
    expect(callout).toHaveAttribute("role", "status");
    expect(callout).toHaveTextContent("$15.00");
    expect(callout).toHaveTextContent("Sep 15");
    expect(within(callout).getByText("Overdue")).toBeInTheDocument();
    expect(within(callout).getByText(/recorded by a parent/)).toBeInTheDocument();
    expect(screen.getByTestId("nudge")).toHaveTextContent("nudge hidden");
  });

  it("satisfied: Paid for October and a paid-on-time note", () => {
    progress = plan({ periodStatus: "satisfied", paidCents: 4000, remainingCents: 0 });
    renderHome();
    const card = oweCard();
    expect(within(card).getByText("Paid for October")).toBeInTheDocument();
    expect(card.querySelector('[data-callout="ok"]')).toHaveTextContent(/on time/);
  });

  it("no plan: nothing plan-related", () => {
    progress = { status: "loaded", progress: null };
    renderHome();
    const card = oweCard();
    expect(within(card).queryByRole("progressbar")).not.toBeInTheDocument();
    expect(within(card).queryByText(/Due|minimum|Paid for/)).not.toBeInTheDocument();
  });

  it("paid off: a celebratory state in place of the plan", () => {
    balance = { status: "loaded", balanceCents: 0 };
    progress = plan({ periodStatus: "satisfied", paidCents: 4000, remainingCents: 0 });
    renderHome();
    const card = oweCard();
    expect(within(card).getByRole("heading", { name: "Paid off!" })).toBeInTheDocument();
    expect(within(card).getByText("All caught up")).toBeInTheDocument();
    expect(within(card).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  describe("payment received since last visit", () => {
    const key = SEEN_ACTIVITY_KEY_PREFIX + MEMBER;

    it("is not shown on a first-ever visit, but records what was seen", () => {
      renderHome();
      expect(screen.queryByTestId("payment-received")).not.toBeInTheDocument();
      expect(JSON.parse(window.localStorage.getItem(key) ?? "null")).toEqual(["e1", "p1", "e2"]);
    });

    it("is shown once for a new payment, politely, then not again", () => {
      window.localStorage.setItem(key, JSON.stringify(["e1", "e2"]));
      const { unmount } = renderHome();
      const card = screen.getByTestId("payment-received");
      expect(card).toHaveTextContent("Payment received: $25.00");
      expect(card.closest("[aria-live=polite]")).not.toBeNull();
      unmount();

      // Remounting during the same page load keeps the card until dismissed...
      const second = renderHome();
      expect(screen.getByTestId("payment-received")).toBeInTheDocument();
      second.unmount();

      // ...but the next app load doesn't announce it again.
      resetSessionAnnouncements();
      renderHome();
      expect(screen.queryByTestId("payment-received")).not.toBeInTheDocument();
    });

    it("can be dismissed", async () => {
      const user = userEvent.setup();
      window.localStorage.setItem(key, JSON.stringify(["e1", "e2"]));
      const { unmount } = renderHome();
      await user.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByTestId("payment-received")).not.toBeInTheDocument();
      unmount();
      renderHome();
      expect(screen.queryByTestId("payment-received")).not.toBeInTheDocument();
    });

    it("ignores voided payments", () => {
      window.localStorage.setItem(key, JSON.stringify(["e1", "e2"]));
      activity = {
        status: "loaded",
        transactions: [
          tx({ id: "e1" }),
          tx({ id: "p1", type: "payment", amountCents: -2500, isVoided: true }),
          tx({ id: "e2" }),
        ],
      };
      renderHome();
      expect(screen.queryByTestId("payment-received")).not.toBeInTheDocument();
      expect(screen.getByText(/· Voided/)).toBeInTheDocument();
    });

    it("works when storage throws", () => {
      const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("denied");
      });
      renderHome();
      expect(screen.queryByTestId("payment-received")).not.toBeInTheDocument();
      expect(oweCard()).toBeInTheDocument();
      spy.mockRestore();
    });
  });

  it("has no control that could lower a balance, and no member links", () => {
    progress = plan({ periodStatus: "overdue", dueDate: "2026-09-15", remainingCents: 4000 });
    window.localStorage.setItem(SEEN_ACTIVITY_KEY_PREFIX + MEMBER, JSON.stringify(["e1"]));
    renderHome();

    const allowedHrefs = new Set(["/new/expense", "/activity", "/settings"]);
    for (const link of screen.getAllByRole("link")) {
      expect(allowedHrefs).toContain(link.getAttribute("href"));
      expect(link).not.toHaveAccessibleName(/pay|void|adjust|record|member|family/i);
    }
    for (const button of screen.queryAllByRole("button")) {
      expect(button).toHaveAccessibleName(/^(Retry|Dismiss)$/);
    }
    expect(document.querySelector("form, input, select, textarea")).toBeNull();
  });
});
