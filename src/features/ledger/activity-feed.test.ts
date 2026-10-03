import { describe, expect, it } from "vitest";

import { mergeFeed, toBalanceTransfers, type BalanceTransfer } from "./activity-feed";
import type { ActivityTransaction } from "./history";

const tx = (id: string, occurredOn: string, createdAt = `${occurredOn}T12:00:00Z`): ActivityTransaction => ({
  id,
  description: id,
  categoryName: null,
  amountCents: 100,
  type: "expense",
  occurredOn,
  isVoided: false,
  voidReason: null,
  createdByName: "Dana",
  voidedByName: null,
  memberId: "c1",
  note: null,
  createdAt,
});

const move = (id: string, occurredOn: string): BalanceTransfer => ({
  id,
  memberId: "c1",
  fromBalanceId: "e",
  toBalanceId: "car",
  amountCents: 500,
  occurredOn,
  note: null,
  createdAt: `${occurredOn}T09:00:00Z`,
  isVoided: false,
  voidReason: null,
});

const ids = (items: ReturnType<typeof mergeFeed>) =>
  items.map((item) => (item.kind === "transaction" ? item.transaction.id : item.transfer.id));

describe("mergeFeed", () => {
  it("slots moves in by date among the ledger rows, newest first", () => {
    const items = mergeFeed(
      [tx("a", "2026-09-22"), tx("b", "2026-09-20")],
      [move("m1", "2026-09-21")],
      false,
    );
    expect(ids(items)).toEqual(["a", "m1", "b"]);
  });

  it("while older ledger pages remain, leaves out moves older than the oldest loaded row", () => {
    const transfers = [move("new", "2026-09-21"), move("old", "2026-08-01")];
    const ledger = [tx("a", "2026-09-22"), tx("b", "2026-09-20")];
    expect(ids(mergeFeed(ledger, transfers, true))).toEqual(["a", "new", "b"]);
    expect(ids(mergeFeed(ledger, transfers, false))).toEqual(["a", "new", "b", "old"]);
  });

  it("with no moves, keeps the ledger rows exactly as the server ordered them", () => {
    const rows = [tx("x", "2026-09-01"), tx("y", "2026-09-05")];
    expect(ids(mergeFeed(rows, [], false))).toEqual(["x", "y"]);
  });
});

describe("toBalanceTransfers", () => {
  it("marks a move voided when it has a voided_at", () => {
    const [voided, live] = toBalanceTransfers([
      {
        id: "1",
        member_id: "c1",
        from_tracked_balance_id: "e",
        to_tracked_balance_id: "car",
        amount_cents: 100,
        occurred_on: "2026-09-01",
        note: null,
        created_at: "2026-09-01T00:00:00Z",
        voided_at: "2026-09-02T00:00:00Z",
        void_reason: "Typo",
      },
      {
        id: "2",
        member_id: "c1",
        from_tracked_balance_id: "e",
        to_tracked_balance_id: "car",
        amount_cents: 100,
        occurred_on: "2026-09-01",
        note: null,
        created_at: "2026-09-01T00:00:00Z",
        voided_at: null,
        void_reason: null,
      },
    ]);
    expect([voided!.isVoided, live!.isVoided]).toEqual([true, false]);
  });
});
