// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecordPaymentPage } from "./RecordPaymentPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { MembershipState } from "../features/auth/membership-context";
import type { AddExpenseFormDataState } from "../features/ledger/useAddExpenseFormData";
import { PAYMENT_RECORDED_MESSAGES } from "../lib/messages";

const { fromMock, rpcMock } = vi.hoisted(() => ({ fromMock: vi.fn(), rpcMock: vi.fn() }));

vi.mock("../lib/supabase", () => ({ supabase: { from: fromMock, rpc: rpcMock } }));

const formData: AddExpenseFormDataState = {
  status: "loaded",
  timezone: "America/Los_Angeles",
  childExpenseScope: "any_member",
  activeMembers: [
    { id: "p1", name: "Dana", role: "parent" },
    { id: "kid-a", name: "Alex", role: "child" },
    { id: "kid-s", name: "Sam", role: "child" },
  ],
  categories: [],
};

vi.mock("../features/ledger/useAddExpenseFormData", () => ({
  useAddExpenseFormData: () => formData,
}));

const parent: MembershipState = {
  status: "loaded",
  membership: { memberId: "p1", householdId: "h1", role: "parent", name: "Dana", status: "active" },
};

const child: MembershipState = {
  status: "loaded",
  membership: { memberId: "kid-a", householdId: "h1", role: "child", name: "Alex", status: "active" },
};

function renderPage(path = "/new/payment", membership: MembershipState = parent) {
  return render(
    <MembershipContext.Provider value={membership}>
      <MemoryRouter initialEntries={[path]}>
        <RecordPaymentPage />
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

type PeriodRow = { status: string; minimum_cents: number; paid_cents: number; remaining_cents: number };

/** Active plans by child, and each period's status (keyed by period id). */
let plans: { id: string; member_id: string; starts_on?: string }[] = [];
let periods: Record<string, PeriodRow> = {};
let balances: { member_id: string; balance_cents: number }[] = [];
/** `period_start` of the period `ensure_current_payment_period` returns. */
let currentPeriodStart = "2026-10-01";
/** Stored `payment_periods` rows (earlier, already-materialized periods). */
let storedPeriods: { id: string; payment_plan_id: string; period_start: string }[] = [];

/**
 * Stand-in for the backdated-payment lookup on `payment_periods`:
 * `.eq(plan).lte(period_start, date).order(desc).limit(1).maybeSingle()`.
 */
function periodsBuilder() {
  let planFilter: string | null = null;
  let onOrBefore: string | null = null;
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn((column: string, value: unknown) => {
    if (column === "payment_plan_id") planFilter = String(value);
    return builder;
  });
  builder.lte = vi.fn((_column: string, value: unknown) => {
    onOrBefore = String(value);
    return builder;
  });
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => {
    const latest = storedPeriods
      .filter((p) => p.payment_plan_id === planFilter && onOrBefore !== null && p.period_start <= onOrBefore)
      .sort((a, b) => (a.period_start < b.period_start ? 1 : -1))[0];
    return Promise.resolve({ data: latest ?? null, error: null });
  });
  return builder;
}

/**
 * A chainable stand-in for supabase-js's query builder covering both reads
 * this page makes on `payment_plans`: the roster's batched
 * `.in().eq().returns()` (awaited), and the post-payment
 * `.eq(member).eq(active).maybeSingle()`.
 */
function plansBuilder() {
  let memberFilter: string | null = null;
  const builder: Record<string, unknown> = {};
  builder.in = vi.fn(() => builder);
  builder.eq = vi.fn((column: string, value: unknown) => {
    if (column === "member_id") memberFilter = String(value);
    return builder;
  });
  builder.returns = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() =>
    Promise.resolve({ data: plans.find((p) => p.member_id === memberFilter) ?? null, error: null }),
  );
  builder.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: plans, error: null }).then(resolve, reject);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  plans = [];
  periods = {};
  currentPeriodStart = "2026-10-01";
  storedPeriods = [];
  balances = [
    { member_id: "kid-a", balance_cents: 14732 },
    { member_id: "kid-s", balance_cents: 11240 },
  ];
  rpcMock.mockImplementation((name: string, args: Record<string, string>) => {
    if (name === "record_payment" || name === "record_adjustment") {
      return Promise.resolve({ data: { id: "tx-9" }, error: null });
    }
    if (name === "household_member_balances") {
      return Promise.resolve({ data: balances, error: null });
    }
    if (name === "ensure_current_payment_period") {
      return Promise.resolve({
        data: { id: `period-${args.p_plan_id}`, period_start: currentPeriodStart, due_date: "2026-10-15" },
        error: null,
      });
    }
    if (name === "payment_period_status") {
      const row = periods[args.p_period_id];
      return Promise.resolve({ data: row ? [{ period_id: args.p_period_id, ...row }] : [], error: null });
    }
    throw new Error(`Unexpected rpc ${name}`);
  });
  fromMock.mockImplementation((table: string) => ({
    select: vi.fn(() => (table === "payment_periods" ? periodsBuilder() : plansBuilder())),
  }));
});

function selectedChild(): HTMLElement {
  const group = screen.getByRole("radiogroup", { name: "Who paid?" });
  const selected = within(group)
    .getAllByRole("radio")
    .filter((radio) => radio.getAttribute("aria-checked") === "true");
  expect(selected).toHaveLength(1);
  return selected[0]!;
}

describe("RecordPaymentPage ?child= prefill", () => {
  it("selects the child named in the link", () => {
    renderPage("/new/payment?child=kid-s");
    expect(selectedChild()).toHaveTextContent(/^S?Sam/);
  });

  it("ignores an id that is not one of the household's children", () => {
    renderPage("/new/payment?child=p1");
    expect(selectedChild()).toHaveTextContent("Alex");
  });

  it("defaults to the first child without the parameter", () => {
    renderPage();
    expect(selectedChild()).toHaveTextContent("Alex");
  });
});

describe("RecordPaymentPage is Parent-only", () => {
  it("shows a Child the Parents-only message and no form", () => {
    renderPage("/new/payment", child);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Only a parent can record a payment or adjustment.",
    );
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Record/ })).not.toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

async function fillAndSave(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Payment amount"), "40");
  await user.type(screen.getByLabelText("Description"), "Cash");
  await user.click(screen.getByRole("button", { name: /Record \$40\.00 from Alex/ }));
}

describe("RecordPaymentPage encouragement", () => {
  it("adds a polite, child-named line after a payment", async () => {
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await fillAndSave(user);

    await waitFor(() => expect(screen.getByText("Payment recorded")).toBeInTheDocument());
    const line = screen.getByTestId("payment-encouragement");
    expect(line).toHaveAttribute("role", "status");
    expect(line).toHaveAttribute("aria-live", "polite");
    expect(line).toHaveTextContent("Alex");
    expect(line).toHaveTextContent("$40.00");
    const variants = PAYMENT_RECORDED_MESSAGES.map((t) => t({ name: "Alex", amount: "$40.00" }));
    expect(variants).toContain(line.textContent?.trim());
    expect(rpcMock).toHaveBeenCalledWith("record_payment", expect.objectContaining({ p_member_id: "kid-a", p_amount_cents: -4000 }));
  });

  it("shows no encouragement for an adjustment", async () => {
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await user.click(screen.getByRole("radio", { name: "Adjustment" }));
    await user.type(screen.getByLabelText("Adjustment amount"), "40");
    await user.type(screen.getByLabelText("Description"), "Fix");
    await user.click(screen.getByRole("button", { name: /Record \$40\.00 adjustment for Alex/ }));

    await waitFor(() => expect(screen.getByText("Adjustment recorded")).toBeInTheDocument());
    expect(screen.queryByTestId("payment-encouragement")).not.toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith("record_adjustment", expect.objectContaining({ p_amount_cents: -4000 }));
    expect(rpcMock).not.toHaveBeenCalledWith("ensure_current_payment_period", expect.anything());
    expect(rpcMock).not.toHaveBeenCalledWith("payment_period_status", expect.anything());
  });
});

describe("RecordPaymentPage success panel", () => {
  it("shows the server-fetched balance and period effect, not the preview", async () => {
    plans = [{ id: "plan-a", member_id: "kid-a" }];
    periods = {
      "period-plan-a": { status: "overdue", minimum_cents: 4000, paid_cents: 2500, remaining_cents: 1500 },
    };
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await screen.findByRole("button", { name: "Catch up $15.00" });

    await user.click(screen.getByRole("button", { name: "Catch up $15.00" }));
    await user.type(screen.getByLabelText("Description"), "Cash");
    // After the write the server reports its own numbers.
    balances = [{ member_id: "kid-a", balance_cents: 13232 }];
    periods["period-plan-a"] = { status: "satisfied", minimum_cents: 4000, paid_cents: 4000, remaining_cents: 0 };
    await user.click(screen.getByRole("button", { name: /Record \$15\.00 from Alex/ }));

    await waitFor(() => expect(screen.getByText("Payment recorded")).toBeInTheDocument());
    expect(screen.getByText(/New balance:/)).toHaveTextContent("New balance: $132.32");
    expect(screen.getByText("Fully paid for this period.")).toBeInTheDocument();
    expect(screen.getByText("$40.00 of $40.00 paid")).toBeInTheDocument();
  });
});

describe("RecordPaymentPage period panel follows the payment's date", () => {
  async function saveDatedPayment(user: ReturnType<typeof userEvent.setup>, date?: string) {
    renderPage("/new/payment?child=kid-a");
    await user.type(screen.getByLabelText("Payment amount"), "40");
    await user.type(screen.getByLabelText("Description"), "Cash");
    if (date) {
      await user.click(screen.getByRole("radio", { name: /Pick date/ }));
      fireEvent.change(screen.getByLabelText("Pick a date"), { target: { value: date } });
    }
    // The child rows' progress reads hit the same RPCs on load; only the
    // calls made after Save are about the confirmation panel.
    rpcMock.mockClear();
    await user.click(screen.getByRole("button", { name: /Record \$40\.00 from Alex/ }));
    await waitFor(() => expect(screen.getByText("Payment recorded")).toBeInTheDocument());
  }

  beforeEach(() => {
    plans = [{ id: "plan-a", member_id: "kid-a", starts_on: "2026-06-01" }];
    periods = {
      "period-plan-a": { status: "due", minimum_cents: 4000, paid_cents: 1000, remaining_cents: 3000 },
      "p-sep": { status: "satisfied", minimum_cents: 4000, paid_cents: 4000, remaining_cents: 0 },
    };
  });

  it("shows the current period, named by month, for a payment dated in it", async () => {
    await saveDatedPayment(userEvent.setup());
    expect(screen.getByRole("heading", { name: "October payment period" })).toBeInTheDocument();
    expect(screen.getByText("$10.00 of $40.00 paid")).toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith("payment_period_status", { p_period_id: "period-plan-a" });
    expect(fromMock).not.toHaveBeenCalledWith("payment_periods");
  });

  it("shows the stored earlier period whose month holds a backdated payment", async () => {
    storedPeriods = [
      { id: "p-aug", payment_plan_id: "plan-a", period_start: "2026-08-01" },
      { id: "p-sep", payment_plan_id: "plan-a", period_start: "2026-09-01" },
    ];
    await saveDatedPayment(userEvent.setup(), "2026-09-10");
    expect(rpcMock).toHaveBeenCalledWith("record_payment", expect.objectContaining({ p_occurred_on: "2026-09-10" }));
    expect(screen.getByRole("heading", { name: "September payment period" })).toBeInTheDocument();
    expect(screen.getByText("Fully paid for this period.")).toBeInTheDocument();
    expect(screen.getByText("$40.00 of $40.00 paid")).toBeInTheDocument();
    expect(rpcMock).toHaveBeenCalledWith("payment_period_status", { p_period_id: "p-sep" });
    expect(rpcMock).not.toHaveBeenCalledWith("payment_period_status", { p_period_id: "period-plan-a" });
  });

  it.each([
    ["the month was never stored", [{ id: "p-aug", payment_plan_id: "plan-a", period_start: "2026-08-01" }], "2026-09-10"],
    ["the date is before any stored period", [{ id: "p-sep", payment_plan_id: "plan-a", period_start: "2026-09-01" }], "2026-05-20"],
  ])("shows no period panel when %s", async (_case, stored, date) => {
    storedPeriods = stored;
    await saveDatedPayment(userEvent.setup(), date);
    expect(screen.getByText(/New balance:/)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /payment period/ })).not.toBeInTheDocument();
    expect(rpcMock).not.toHaveBeenCalledWith("payment_period_status", expect.anything());
  });
});

describe("RecordPaymentPage child rows", () => {
  it("shows each child's status and what they owe", async () => {
    plans = [{ id: "plan-a", member_id: "kid-a" }];
    periods = {
      "period-plan-a": { status: "overdue", minimum_cents: 4000, paid_cents: 2500, remaining_cents: 1500 },
    };
    renderPage();
    const alex = await screen.findByRole("radio", { name: /^A?Alex/ });
    await waitFor(() => expect(alex).toHaveTextContent("$15.00 overdue"));
    expect(alex).toHaveTextContent("$147.32owed");
    const sam = screen.getByRole("radio", { name: /Sam/ });
    expect(sam).toHaveTextContent("No plan");
  });
});

describe("RecordPaymentPage amount shortcuts", () => {
  it("offers Catch up and Pay in full for an overdue child; tapping fills, never submits", async () => {
    plans = [{ id: "plan-a", member_id: "kid-a" }];
    periods = {
      "period-plan-a": { status: "overdue", minimum_cents: 4000, paid_cents: 2500, remaining_cents: 1500 },
    };
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");

    const catchUp = await screen.findByRole("button", { name: "Catch up $15.00" });
    expect(screen.getByRole("button", { name: "Pay in full $147.32" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Minimum/ })).not.toBeInTheDocument();

    await user.click(catchUp);
    expect((screen.getByLabelText("Payment amount") as HTMLInputElement).value).toBe("15.00");
    expect(catchUp).toHaveAttribute("aria-pressed", "true");
    expect(rpcMock).not.toHaveBeenCalledWith("record_payment", expect.anything());

    await user.click(screen.getByRole("button", { name: "Pay in full $147.32" }));
    expect((screen.getByLabelText("Payment amount") as HTMLInputElement).value).toBe("147.32");
  });

  it("offers Minimum for a child with something due", async () => {
    plans = [{ id: "plan-s", member_id: "kid-s" }];
    periods = {
      "period-plan-s": { status: "due", minimum_cents: 4000, paid_cents: 1000, remaining_cents: 3000 },
    };
    renderPage("/new/payment?child=kid-s");
    expect(await screen.findByRole("button", { name: "Minimum $30.00" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay in full $112.40" })).toBeInTheDocument();
  });

  it("offers only Pay in full when there is no plan", async () => {
    renderPage("/new/payment?child=kid-s");
    expect(await screen.findByRole("button", { name: "Pay in full $112.40" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^(Catch up|Minimum|Pay in full)/ })).toHaveLength(1);
  });

  it("offers none when nothing is owed", async () => {
    balances = [{ member_id: "kid-a", balance_cents: 0 }];
    renderPage("/new/payment?child=kid-a");
    await screen.findByText("Nothing owed");
    expect(screen.queryByRole("group", { name: "Amount shortcuts" })).not.toBeInTheDocument();
  });

  it("hides shortcuts for an adjustment", async () => {
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await screen.findByRole("button", { name: "Pay in full $147.32" });
    await user.click(screen.getByRole("radio", { name: "Adjustment" }));
    expect(screen.queryByRole("button", { name: /Pay in full/ })).not.toBeInTheDocument();
  });
});

describe("RecordPaymentPage balance-after preview", () => {
  it("shows the new balance from what the page read", async () => {
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await screen.findByRole("button", { name: "Pay in full $147.32" });
    await user.type(screen.getByLabelText("Payment amount"), "15");
    expect(screen.getByTestId("record-preview")).toHaveTextContent(
      "Alex’s balance goes from $147.32 to $132.32",
    );
  });

  it("shows credit and a gentle note for more than owed, without blocking", async () => {
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await screen.findByRole("button", { name: "Pay in full $147.32" });
    await user.type(screen.getByLabelText("Payment amount"), "150");
    const preview = screen.getByTestId("record-preview");
    expect(preview).toHaveTextContent("Alex’s balance goes from $147.32 to −$2.68");
    expect(preview).toHaveTextContent("Alex will be $2.68 in credit.");
    expect(preview).toHaveTextContent("This is more than Alex owes.");

    await user.type(screen.getByLabelText("Description"), "Cash");
    const submit = screen.getByRole("button", { name: /Record \$150\.00 from Alex/ });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(rpcMock).toHaveBeenCalledWith("record_payment", expect.objectContaining({ p_amount_cents: -15000 }));
  });

  it("shows no preview when balances could not be loaded, and the form still works", async () => {
    rpcMock.mockImplementation((name: string) => {
      if (name === "household_member_balances") {
        return Promise.resolve({ data: null, error: { message: "nope" } });
      }
      if (name === "record_payment") return Promise.resolve({ data: { id: "tx" }, error: null });
      throw new Error(`Unexpected rpc ${name}`);
    });
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await fillAndSave(user);
    expect(screen.queryByTestId("record-preview")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Payment recorded")).toBeInTheDocument());
    expect(screen.getByText(/New balance:/)).toHaveTextContent("New balance: unavailable");
  });
});

describe("RecordPaymentPage failures", () => {
  it("shows a retry state on a failed write and never queues it", async () => {
    let calls = 0;
    const base = rpcMock.getMockImplementation()!;
    rpcMock.mockImplementation((name: string, args: Record<string, string>) => {
      if (name === "record_payment") {
        calls += 1;
        return Promise.resolve({ data: null, error: { message: "network down" } });
      }
      return base(name, args);
    });
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await fillAndSave(user);

    const alert = await screen.findByText(/Could not save this payment: network down/);
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(calls).toBe(1);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls).toBe(2));
  });

  it("disables the button while saving so a double tap records once", async () => {
    let resolveWrite: (value: unknown) => void = () => {};
    const base = rpcMock.getMockImplementation()!;
    rpcMock.mockImplementation((name: string, args: Record<string, string>) => {
      if (name === "record_payment") {
        return new Promise((resolve) => {
          resolveWrite = resolve;
        });
      }
      return base(name, args);
    });
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await fillAndSave(user);

    const saving = screen.getByRole("button", { name: /Saving/ });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(rpcMock.mock.calls.filter(([name]) => name === "record_payment")).toHaveLength(1);
    resolveWrite({ data: { id: "tx" }, error: null });
    await waitFor(() => expect(screen.getByText("Payment recorded")).toBeInTheDocument());
  });

  it("lists what to fix in an announced summary", async () => {
    const user = userEvent.setup();
    renderPage("/new/payment?child=kid-a");
    await user.click(screen.getByRole("button", { name: /Record payment/ }));
    const summary = screen.getAllByRole("alert")[0]!;
    expect(summary).toHaveTextContent("Enter a description.");
    expect(screen.getByLabelText("Payment amount")).toHaveAttribute("aria-invalid", "true");
    expect(rpcMock).not.toHaveBeenCalledWith("record_payment", expect.anything());
  });
});
