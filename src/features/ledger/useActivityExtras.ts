import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { AllocationPart } from "./balance-breakdown";
import { toBalanceTransfers, type BalanceTransfer, type BalanceTransferRow } from "./activity-feed";

/** Most balance moves read at once; far more than a household makes in a long while. */
const TRANSFER_LIMIT = 200;
/** Ids per `payment_allocations` request, so the address stays short. */
const ALLOCATION_CHUNK = 100;

export type BalanceTransfersState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | { status: "loaded"; transfers: BalanceTransfer[] };

/**
 * The household's balance moves for the Activity page, newest first,
 * narrowed the same way the ledger list is (one child, a date range). Which
 * rows come back is decided by RLS: a Parent reads the household's, a Child
 * only their own. `enabled` false skips the read entirely (used when the
 * chosen filters cannot include moves).
 */
export function useBalanceTransfers(query: {
  householdId: string;
  memberId?: string;
  from?: string;
  to?: string;
  enabled: boolean;
}): BalanceTransfersState {
  const { householdId, memberId, from, to, enabled } = query;
  const [state, setState] = useState<BalanceTransfersState>({ status: "loading" });
  const [token, setToken] = useState(0);
  const retry = useCallback(() => setToken((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: "loaded", transfers: [] });
      return;
    }
    let active = true;
    setState({ status: "loading" });

    async function load() {
      try {
        let request = supabase
          .from("balance_transfers")
          .select(
            "id, member_id, from_tracked_balance_id, to_tracked_balance_id, amount_cents, occurred_on, note, created_at, voided_at, void_reason",
          )
          .eq("household_id", householdId);
        if (memberId !== undefined) request = request.eq("member_id", memberId);
        if (from !== undefined) request = request.gte("occurred_on", from);
        if (to !== undefined) request = request.lte("occurred_on", to);
        const { data, error } = await request
          .order("occurred_on", { ascending: false })
          .order("created_at", { ascending: false })
          .limit(TRANSFER_LIMIT)
          .returns<BalanceTransferRow[]>();
        if (!active) return;
        if (error) {
          setState({ status: "error", message: error.message, retry });
          return;
        }
        setState({ status: "loaded", transfers: toBalanceTransfers(data ?? []) });
      } catch (caught) {
        if (!active) return;
        setState({
          status: "error",
          message:
            caught instanceof Error
              ? `Could not reach the ledger service: ${caught.message}`
              : "Could not reach the ledger service.",
          retry,
        });
      }
    }

    void load();
    return () => {
      active = false;
    };
  }, [householdId, memberId, from, to, enabled, token, retry]);

  return state;
}

type AllocationRow = { transaction_id: string; tracked_balance_id: string; amount_cents: number };

/**
 * The parts of the given payments/adjustments (which balance each went
 * toward), keyed by transaction id. Best effort: a failed read just leaves
 * those rows without a split line. Ids already read are not asked for again.
 */
export function usePaymentAllocations(
  transactionIds: readonly string[],
): ReadonlyMap<string, readonly AllocationPart[]> {
  const [parts, setParts] = useState<ReadonlyMap<string, readonly AllocationPart[]>>(new Map());
  const requested = useRef(new Set<string>());
  const key = transactionIds.join(",");

  useEffect(() => {
    const missing = transactionIds.filter((id) => !requested.current.has(id));
    if (missing.length === 0) return;
    for (const id of missing) requested.current.add(id);

    async function load() {
      for (let start = 0; start < missing.length; start += ALLOCATION_CHUNK) {
        const chunk = missing.slice(start, start + ALLOCATION_CHUNK);
        try {
          const { data, error } = await supabase
            .from("payment_allocations")
            .select("transaction_id, tracked_balance_id, amount_cents")
            .in("transaction_id", chunk)
            .returns<AllocationRow[]>();
          if (error) {
            for (const id of chunk) requested.current.delete(id);
            continue;
          }
          setParts((previous) => {
            const next = new Map(previous);
            for (const row of data ?? []) {
              next.set(row.transaction_id, [
                ...(next.get(row.transaction_id) ?? []),
                { balanceId: row.tracked_balance_id, cents: row.amount_cents },
              ]);
            }
            return next;
          });
        } catch {
          for (const id of chunk) requested.current.delete(id);
        }
      }
    }

    void load();
    // Keyed on the id list's content, not the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return parts;
}
