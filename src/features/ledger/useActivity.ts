import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "../../lib/supabase";
import type { ActivityTransaction, ActivityTransactionRow } from "./history";
import { toActivityTransactions } from "./history";

/** Rows fetched per page ("Load more" fetches the next this-many). */
export const ACTIVITY_PAGE_SIZE = 50;

/**
 * Which rows the Activity page shows. `voided` is any type with `voided_at`
 * set; the other kinds match `ledger_transactions.type` and include voided
 * rows of that type (a void never hides a row).
 */
export type ActivityKind = "all" | "expense" | "payment" | "adjustment" | "voided";

export type ActivityQuery = {
  householdId: string;
  /** One member's rows; omitted means every row in the household the caller can read. */
  memberId?: string;
  kind: ActivityKind;
  categoryId?: string;
  /** Inclusive `YYYY-MM-DD` bounds on `occurred_on`. */
  from?: string;
  to?: string;
};

export type ActivityState =
  | { status: "loading" }
  | { status: "error"; message: string; retry: () => void }
  | {
      status: "loaded";
      transactions: ActivityTransaction[];
      /** The last page came back full, so there may be older rows. */
      hasMore: boolean;
      loadMore: () => void;
      loadingMore: boolean;
      /** A failed "Load more"; the rows already shown stay put. */
      loadMoreError: string | null;
      /** Reload every row loaded so far (after a void), keeping the list on screen meanwhile. */
      refetch: () => void;
    };

type Loaded = {
  status: "loaded";
  transactions: ActivityTransaction[];
  hasMore: boolean;
  loadingMore: boolean;
  loadMoreError: string | null;
};
type Internal = { status: "loading" } | { status: "error"; message: string } | Loaded;

const SELECT =
  "id, member_id, description, note, amount_cents, type, occurred_on, created_at, voided_at, void_reason, " +
  "category:categories(name), " +
  "created_by_member:household_members!ledger_transactions_created_by_fkey(name), " +
  "voided_by_member:household_members!ledger_transactions_voided_by_fkey(name)";

/** One `range` of the filtered ledger, newest first with a stable tiebreak. */
function fetchRange(query: ActivityQuery, first: number, last: number) {
  let request = supabase
    .from("ledger_transactions")
    .select(SELECT)
    .eq("household_id", query.householdId);

  if (query.memberId !== undefined) request = request.eq("member_id", query.memberId);
  if (query.kind === "voided") request = request.not("voided_at", "is", null);
  else if (query.kind !== "all") request = request.eq("type", query.kind);
  if (query.categoryId !== undefined) request = request.eq("category_id", query.categoryId);
  if (query.from !== undefined) request = request.gte("occurred_on", query.from);
  if (query.to !== undefined) request = request.lte("occurred_on", query.to);

  return request
    .order("occurred_on", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(first, last)
    .returns<ActivityTransactionRow[]>();
}

function unreachable(caught: unknown): string {
  return caught instanceof Error
    ? `Could not reach the ledger service: ${caught.message}`
    : "Could not reach the ledger service.";
}

/**
 * The Activity page's ledger read, 50 rows at a time.
 *
 * Read-only. Which rows can come back is decided by Postgres RLS
 * (`ledger_transactions_select_parent` lets an active Parent read the whole
 * household; `_select_self` limits anyone else to their own rows); the
 * `household_id` / `member_id` / kind / category / date filters here only
 * shape the query. An id the caller cannot read simply yields no rows.
 *
 * Changing any filter starts again from the first page. Rows are ordered
 * `occurred_on` desc, `created_at` desc, `id` desc so pages never shuffle;
 * appended pages are de-duplicated by id in case a row was entered between
 * page loads and pushed an already-shown row down a page.
 *
 * No money is summed here -- rows are listed, never totalled.
 */
export function useActivity(query: ActivityQuery): ActivityState {
  const key = JSON.stringify(query);
  const [state, setState] = useState<Internal>({ status: "loading" });
  const [token, setToken] = useState(0);

  // Which request is current: bumped by every full (re)load so a stale
  // response -- an old filter's, or a "Load more" that a reload overtook --
  // is dropped rather than shown.
  const generation = useRef(0);
  const lastKey = useRef<string | null>(null);
  // Set by retry/refetch just before bumping `token`.
  const nextLoad = useRef<{ size: number; quiet: boolean }>({ size: ACTIVITY_PAGE_SIZE, quiet: false });
  const loaded = useRef<Loaded | null>(null);
  loaded.current = state.status === "loaded" ? state : null;

  useEffect(() => {
    const parsed = JSON.parse(key) as ActivityQuery;
    let { size, quiet } = nextLoad.current;
    if (lastKey.current !== key) {
      // A filter change: back to page one, with a visible loading state.
      size = ACTIVITY_PAGE_SIZE;
      quiet = false;
      lastKey.current = key;
    }
    nextLoad.current = { size: ACTIVITY_PAGE_SIZE, quiet: false };

    const id = ++generation.current;
    if (!quiet) setState({ status: "loading" });

    async function load() {
      try {
        const { data, error } = await fetchRange(parsed, 0, size - 1);
        if (generation.current !== id) return;
        if (error) {
          setState({ status: "error", message: error.message });
          return;
        }
        const rows = data ?? [];
        setState({
          status: "loaded",
          transactions: toActivityTransactions(rows),
          hasMore: rows.length === size,
          loadingMore: false,
          loadMoreError: null,
        });
      } catch (caught) {
        if (generation.current !== id) return;
        setState({ status: "error", message: unreachable(caught) });
      }
    }

    void load();
  }, [key, token]);

  useEffect(
    () => () => {
      // Unmounted: nothing in flight may set state.
      generation.current += 1;
    },
    [],
  );

  const retry = useCallback(() => {
    nextLoad.current = { size: ACTIVITY_PAGE_SIZE, quiet: false };
    setToken((value) => value + 1);
  }, []);

  const refetch = useCallback(() => {
    const count = loaded.current?.transactions.length ?? 0;
    // Round up to whole pages so `hasMore` stays meaningful afterwards.
    const pages = Math.max(1, Math.ceil(count / ACTIVITY_PAGE_SIZE));
    nextLoad.current = { size: pages * ACTIVITY_PAGE_SIZE, quiet: true };
    setToken((value) => value + 1);
  }, []);

  const loadMore = useCallback(() => {
    const current = loaded.current;
    if (!current || current.loadingMore || !current.hasMore) return;

    const parsed = JSON.parse(key) as ActivityQuery;
    const id = generation.current;
    const offset = current.transactions.length;
    setState({ ...current, loadingMore: true, loadMoreError: null });

    async function more() {
      try {
        const { data, error } = await fetchRange(parsed, offset, offset + ACTIVITY_PAGE_SIZE - 1);
        if (generation.current !== id) return;
        setState((previous) => {
          if (previous.status !== "loaded") return previous;
          if (error) return { ...previous, loadingMore: false, loadMoreError: error.message };
          const rows = data ?? [];
          const seen = new Set(previous.transactions.map((transaction) => transaction.id));
          const fresh = toActivityTransactions(rows).filter((transaction) => !seen.has(transaction.id));
          return {
            status: "loaded",
            transactions: [...previous.transactions, ...fresh],
            hasMore: rows.length === ACTIVITY_PAGE_SIZE,
            loadingMore: false,
            loadMoreError: null,
          };
        });
      } catch (caught) {
        if (generation.current !== id) return;
        setState((previous) =>
          previous.status === "loaded"
            ? { ...previous, loadingMore: false, loadMoreError: unreachable(caught) }
            : previous,
        );
      }
    }

    void more();
  }, [key]);

  switch (state.status) {
    case "loading":
      return state;
    case "error":
      return { status: "error", message: state.message, retry };
    case "loaded":
      return { ...state, loadMore, refetch };
  }
}
