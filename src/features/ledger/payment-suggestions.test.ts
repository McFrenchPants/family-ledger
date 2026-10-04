import { describe, expect, it } from "vitest";

import {
  buildSuggestionRequest,
  childSuggestionList,
  recordFromSuggestionPath,
  suggestionOutcome,
  toSuggestionView,
} from "./payment-suggestions";
import type { SuggestionView } from "./payment-suggestions";

describe("buildSuggestionRequest", () => {
  const base = {
    memberId: "kid",
    amountInput: "12.50",
    occurredOn: "2026-10-03",
    note: "  ",
    splitRows: null,
  };

  it("sends integer cents and no parts (all Everyday) when the split was not opened", () => {
    expect(buildSuggestionRequest(base)).toEqual({
      ok: true,
      rpcArgs: {
        p_member_id: "kid",
        p_amount_cents: 1250,
        p_suggested_on: "2026-10-03",
        p_note: null,
        p_parts: null,
      },
    });
  });

  it("sends the split as exact cents and rejects one that does not add up", () => {
    const rows = [
      { key: "a", balanceId: "car", amountInput: "10.00" },
      { key: "b", balanceId: "every", amountInput: "2.50" },
    ];
    const good = buildSuggestionRequest({ ...base, splitRows: rows });
    expect(good.ok && good.rpcArgs.p_parts).toEqual([
      { tracked_balance_id: "car", amount_cents: 1000 },
      { tracked_balance_id: "every", amount_cents: 250 },
    ]);

    expect(buildSuggestionRequest({ ...base, splitRows: [rows[0]!] }).ok).toBe(false);
  });

  it("rejects zero, a bad amount and a missing date", () => {
    for (const amountInput of ["0", "abc", ""]) {
      expect(buildSuggestionRequest({ ...base, amountInput }).ok).toBe(false);
    }
    expect(buildSuggestionRequest({ ...base, occurredOn: "" }).ok).toBe(false);
  });
});

describe("suggestion wording and ordering", () => {
  const row = (
    id: string,
    status: string,
    createdAt: string,
    resolutionNote: string | null = null,
  ): SuggestionView =>
    toSuggestionView({
      id,
      member_id: "kid",
      amount_cents: 500,
      suggested_on: "2026-10-01",
      note: null,
      status,
      resolution_note: resolutionNote,
      created_at: createdAt,
      payment_suggestion_parts: [{ tracked_balance_id: "car", amount_cents: 500 }],
    });

  it("says what happened in plain words, including the parent's reason", () => {
    expect(suggestionOutcome(row("a", "pending", "1"))).toBe("Waiting for a parent");
    expect(suggestionOutcome(row("a", "converted", "1"))).toBe("Recorded by a parent");
    expect(suggestionOutcome(row("a", "withdrawn", "1"))).toBe("You withdrew this");
    expect(suggestionOutcome(row("a", "dismissed", "1"))).toBe("A parent dismissed this");
    expect(suggestionOutcome(row("a", "dismissed", "1", "Not received"))).toBe(
      "A parent dismissed this: Not received",
    );
  });

  it("lists waiting ones first, then only the latest few finished ones", () => {
    const list = childSuggestionList(
      [
        row("old1", "converted", "2026-01"),
        row("p", "pending", "2026-02"),
        row("old2", "dismissed", "2026-03"),
        row("old3", "withdrawn", "2026-04"),
        row("old4", "converted", "2026-05"),
      ],
      3,
    );
    expect(list.map((item) => item.id)).toEqual(["p", "old4", "old3", "old2"]);
  });

  it("opens Record payment for that child with the suggestion id", () => {
    expect(recordFromSuggestionPath({ id: "s 1", memberId: "kid" })).toBe(
      "/new/payment?child=kid&suggestion=s%201",
    );
  });
});
