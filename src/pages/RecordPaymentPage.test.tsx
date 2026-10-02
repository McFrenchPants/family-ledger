// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
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

function renderPage(path = "/new/payment") {
  return render(
    <MembershipContext.Provider value={parent}>
      <MemoryRouter initialEntries={[path]}>
        <RecordPaymentPage />
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rpcMock.mockImplementation((name: string) => {
    if (name === "record_payment" || name === "record_adjustment") {
      return Promise.resolve({ data: { id: "tx-9" }, error: null });
    }
    if (name === "household_member_balances") {
      return Promise.resolve({
        data: [
          { member_id: "kid-a", balance_cents: 14732 },
          { member_id: "kid-s", balance_cents: 11240 },
        ],
        error: null,
      });
    }
    throw new Error(`Unexpected rpc ${name}`);
  });
  // No active plan: the period-effect read finds nothing.
  const builder: Record<string, unknown> = {};
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }));
  fromMock.mockImplementation(() => ({ select: vi.fn(() => builder) }));
});

const forSelect = () => screen.getByLabelText("For") as HTMLSelectElement;

describe("RecordPaymentPage ?child= prefill", () => {
  it("selects the child named in the link", () => {
    renderPage("/new/payment?child=kid-s");
    expect(forSelect().value).toBe("kid-s");
  });

  it("ignores an id that is not one of the household's children", () => {
    renderPage("/new/payment?child=p1");
    expect(forSelect().value).toBe("kid-a");
  });

  it("defaults to the first child without the parameter", () => {
    renderPage();
    expect(forSelect().value).toBe("kid-a");
  });
});

async function fillAndSave(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Payment amount"), "40");
  await user.type(screen.getByLabelText("Description"), "Cash");
  await user.click(screen.getByRole("button", { name: /Save Payment/ }));
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
    await user.click(screen.getByRole("button", { name: "Adjustment" }));
    await user.type(screen.getByLabelText("Adjustment amount"), "40");
    await user.type(screen.getByLabelText("Description"), "Fix");
    await user.click(screen.getByRole("button", { name: /Save Adjustment/ }));

    await waitFor(() => expect(screen.getByText("Adjustment recorded")).toBeInTheDocument());
    expect(screen.queryByTestId("payment-encouragement")).not.toBeInTheDocument();
  });
});
