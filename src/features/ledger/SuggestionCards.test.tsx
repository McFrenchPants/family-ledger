// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ChildSuggestionsCard, ParentSuggestionsCard } from "./SuggestionCards";
import type { SuggestionView } from "./payment-suggestions";
import type { PaymentSuggestionsState } from "./usePaymentSuggestions";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("../../lib/supabase", () => ({ supabase: { rpc: rpcMock } }));

let listState: PaymentSuggestionsState;
vi.mock("./usePaymentSuggestions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./usePaymentSuggestions")>()),
  useOwnPaymentSuggestions: () => listState,
  usePendingPaymentSuggestions: () => listState,
}));

const refetch = vi.fn();
const suggestion = (over: Partial<SuggestionView> = {}): SuggestionView => ({
  id: "s1",
  memberId: "kid",
  amountCents: 3000,
  suggestedOn: "2026-10-02",
  note: "from my job",
  status: "pending",
  resolutionNote: null,
  createdAt: "2026-10-02T10:00:00Z",
  parts: [
    { balanceId: "car", cents: 2000 },
    { balanceId: "every", cents: 1000 },
  ],
  ...over,
});
const balances = [
  { id: "every", name: "Everyday", isEveryday: true, active: true },
  { id: "car", name: "Car", isEveryday: false, active: true },
];

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ error: null });
  refetch.mockReset();
});

describe("ParentSuggestionsCard", () => {
  const renderCard = () =>
    render(
      <MemoryRouter>
        <ParentSuggestionsCard
          householdId="h1"
          names={new Map([["kid", "Alex"]])}
          balances={balances}
        />
      </MemoryRouter>,
    );

  it("shows the child, amount, split and note, and links to Record payment for it", () => {
    listState = { status: "loaded", suggestions: [suggestion()], refetch };
    renderCard();
    expect(screen.getByText("Alex says they paid")).toBeInTheDocument();
    expect(screen.getByText("$30.00")).toBeInTheDocument();
    expect(screen.getByText(/\$20\.00 Car/)).toBeInTheDocument();
    expect(screen.getByText(/from my job/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Record this payment/ })).toHaveAttribute(
      "href",
      "/new/payment?child=kid&suggestion=s1",
    );
  });

  it("is hidden when nothing is waiting", () => {
    listState = { status: "loaded", suggestions: [], refetch };
    const { container } = renderCard();
    expect(container).toBeEmptyDOMElement();
  });

  it("dismisses with the typed reason and refreshes the list", async () => {
    listState = { status: "loaded", suggestions: [suggestion()], refetch };
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: /^Dismiss/ }));
    await userEvent.type(screen.getByLabelText(/Reason/), "Not received");
    await userEvent.click(screen.getByRole("button", { name: "Dismiss this" }));
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(rpcMock).toHaveBeenCalledWith("dismiss_payment_suggestion", {
      p_id: "s1",
      p_reason: "Not received",
    });
  });

  it("shows a failed dismiss inline and keeps the form open to try again", async () => {
    rpcMock.mockResolvedValue({ error: { message: "nope" } });
    listState = { status: "loaded", suggestions: [suggestion()], refetch };
    renderCard();
    await userEvent.click(screen.getByRole("button", { name: /^Dismiss/ }));
    await userEvent.click(screen.getByRole("button", { name: "Dismiss this" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    expect(screen.getByRole("button", { name: "Dismiss this" })).toBeEnabled();
    expect(rpcMock).toHaveBeenCalledWith("dismiss_payment_suggestion", {
      p_id: "s1",
      p_reason: null,
    });
  });
});

describe("ChildSuggestionsCard", () => {
  it("says what happened to each note, and only waiting ones can be withdrawn", async () => {
    listState = {
      status: "loaded",
      suggestions: [
        suggestion(),
        suggestion({ id: "s2", status: "dismissed", resolutionNote: "Not received" }),
      ],
      refetch,
    };
    render(<ChildSuggestionsCard memberId="kid" balances={balances} />);
    expect(screen.getByText("Waiting for a parent")).toBeInTheDocument();
    expect(screen.getByText("A parent dismissed this: Not received")).toBeInTheDocument();
    const withdraw = screen.getAllByRole("button", { name: /Withdraw/ });
    expect(withdraw).toHaveLength(1);

    await userEvent.click(withdraw[0]!);
    await waitFor(() => expect(refetch).toHaveBeenCalled());
    expect(rpcMock).toHaveBeenCalledWith("withdraw_payment_suggestion", { p_id: "s1" });
  });
});
