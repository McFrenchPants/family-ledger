// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SuggestPaymentPage } from "./SuggestPaymentPage";
import { MembershipContext } from "../features/auth/membership-context";
import type { TrackedBalancesState } from "../features/ledger/useBalanceSplitData";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("../lib/supabase", () => ({ supabase: { rpc: rpcMock } }));

let balancesState: TrackedBalancesState;
vi.mock("../features/ledger/useBalanceSplitData", () => ({
  useTrackedBalances: () => balancesState,
}));
vi.mock("../features/ledger/useHouseholdTimezone", () => ({
  useHouseholdTimezone: () => ({ status: "loaded", timezone: "America/Chicago" }),
}));

const EVERYDAY = { id: "every", name: "Everyday", isEveryday: true };
const CAR = { id: "car", name: "Car", isEveryday: false };

function renderPage() {
  return render(
    <MembershipContext.Provider
      value={{
        status: "loaded",
        membership: {
          memberId: "kid",
          householdId: "h1",
          role: "child",
          name: "Alex",
          status: "active",
        },
      }}
    >
      <MemoryRouter>
        <SuggestPaymentPage />
      </MemoryRouter>
    </MembershipContext.Provider>,
  );
}

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ error: null });
  balancesState = { status: "loaded", balances: [EVERYDAY] };
});

describe("SuggestPaymentPage", () => {
  it("says it changes nothing, hides the split with only Everyday, and sends cents with no parts", async () => {
    renderPage();
    expect(screen.getByText(/does not change what you owe/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Split between balances/ })).toBeNull();

    await userEvent.type(screen.getByLabelText("Amount"), "12.50");
    await userEvent.click(screen.getByRole("button", { name: "Tell a parent" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock).toHaveBeenCalledWith("create_payment_suggestion", {
      p_member_id: "kid",
      p_amount_cents: 1250,
      p_suggested_on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      p_note: null,
      p_parts: null,
    });
  });

  it("offers the split when there are tracked balances and sends the parts chosen", async () => {
    balancesState = { status: "loaded", balances: [EVERYDAY, CAR] };
    renderPage();
    await userEvent.type(screen.getByLabelText("Amount"), "30");
    await userEvent.click(screen.getByRole("button", { name: /Split between balances/ }));
    const first = screen.getByLabelText("Amount for part 1");
    await userEvent.clear(first);
    await userEvent.type(first, "10");
    await userEvent.click(screen.getByRole("button", { name: /Add another balance/ }));
    await userEvent.click(screen.getByRole("button", { name: "Tell a parent" }));

    await waitFor(() => expect(rpcMock).toHaveBeenCalledTimes(1));
    expect(rpcMock.mock.calls[0]![1].p_parts).toEqual([
      { tracked_balance_id: "every", amount_cents: 1000 },
      { tracked_balance_id: "car", amount_cents: 2000 },
    ]);
  });

  it("shows a failed send inline with a way to try again, never queued", async () => {
    rpcMock.mockResolvedValue({ error: { message: "boom" } });
    renderPage();
    await userEvent.type(screen.getByLabelText("Amount"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Tell a parent" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("button", { name: /Try again/ })).toBeEnabled();
  });
});
