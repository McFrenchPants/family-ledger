import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { useMembership } from "../auth/membership-context";
import { supabase } from "../../lib/supabase";

/**
 * N4.5 -- a dev/debug-only "send me a test push" trigger. This is a Phase 4
 * spike affordance, NOT a production notification feature, and its
 * placement/labeling is deliberately not-normal-UI-shaped so a future
 * session doesn't mistake it for one and leave it behind as a real feature:
 * dashed border, uppercase "Debug" label, muted styling distinct from
 * `PushSubscribeButton`'s primary-accent button just above it.
 *
 * Rendered from `RootLayout` next to `PushSubscribeButton` so any signed-in
 * member -- Parent or Child -- can trigger a test send to their OWN
 * subscription(s), matching push-test's case (a) authorization (any member
 * may test their own subscription; only a Parent may additionally test
 * another member's, which is push-test's case (b) and is NOT built here --
 * see this task's final report for the scope call).
 *
 * `PushSubscribeButton` does not surface the row id it upserts, so this
 * component fetches the caller's own `push_subscriptions` rows directly.
 * RLS (`push_subscriptions_select_own`, from N4.1) already scopes this
 * query to the caller's own rows -- no new authorization logic here, this
 * component only decides what to render and which existing, already-
 * authorized Edge Function call to make.
 */

type SubscriptionRow = { id: string; endpoint: string; created_at: string };

type RowsState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; rows: SubscriptionRow[] };

export function PushTestSendButton({
  emptyHint = null,
}: {
  /**
   * Shown instead of nothing once the list has loaded and the member has no
   * subscription to test yet, so a host section (Settings > Advanced) does
   * not look empty. A failed load still renders nothing.
   */
  emptyHint?: ReactNode;
} = {}) {
  const membership = useMembership();
  const memberId = membership.status === "loaded" ? membership.membership.memberId : null;
  const [rowsState, setRowsState] = useState<RowsState>({ status: "loading" });

  useEffect(() => {
    if (!memberId) {
      return;
    }

    let cancelled = false;
    setRowsState({ status: "loading" });

    void supabase
      .from("push_subscriptions")
      .select("id, endpoint, created_at")
      .eq("household_member_id", memberId)
      .order("created_at", { ascending: false })
      .then(({ data, error }: { data: SubscriptionRow[] | null; error: { message: string } | null }) => {
        if (cancelled) {
          return;
        }
        if (error) {
          setRowsState({ status: "error" });
          return;
        }
        setRowsState({ status: "loaded", rows: data ?? [] });
      });

    return () => {
      cancelled = true;
    };
  }, [memberId]);

  // Unreachable in practice (RootLayout renders unconditionally, but only
  // signed-in routes reach a "loaded" membership) -- mirrors
  // PushSubscribeButton's own guard rather than assuming call order.
  if (membership.status !== "loaded") {
    return null;
  }

  // A debug affordance failing to load its own list, or finding nothing to
  // test yet, is not worth surfacing as an error to the member -- it simply
  // doesn't render, leaving the real UI (PushSubscribeButton, the rest of
  // the page) undisturbed.
  if (rowsState.status !== "loaded") {
    return null;
  }

  if (rowsState.rows.length === 0) {
    return <>{emptyHint}</>;
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-dashed border-ink-subtle/40 bg-surface-sunken/60 p-3">
      <p className="text-label font-semibold uppercase tracking-wide text-ink-subtle">
        Debug: test push delivery
      </p>
      <p className="text-label text-ink-muted">
        Not a real notification feature. Sends one throwaway test push to a subscription below and
        shows the raw delivery result.
      </p>
      <ul className="flex flex-col gap-2">
        {rowsState.rows.map((row) => (
          <SubscriptionTestRow key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}

type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

function SubscriptionTestRow({ row }: { row: SubscriptionRow }) {
  const [state, setState] = useState<SendState>({ status: "idle" });

  async function handleSendClick() {
    setState({ status: "sending" });

    try {
      const { data, error } = await supabase.functions.invoke("push-test", {
        body: { subscription_id: row.id },
      });

      if (error) {
        // Mirrors AddMemberForm's `add-household-member` handling: a
        // non-2xx Edge Function response surfaces as `error` here, and the
        // function's own `{ error }` body may or may not have already been
        // consumed into `data` depending on client version -- so prefer
        // `data.error` when present, falling back to the error's own
        // message rather than assuming either shape.
        const message =
          (data as { error?: string } | null)?.error ??
          (error instanceof Error ? error.message : "Could not reach the push-test function.");
        setState({ status: "error", message });
        return;
      }

      // Show the push service's raw response verbatim -- this project's
      // "don't overstate success" norm means the actual status/ok, not a
      // generic "sent!" message, and including any error string push-test
      // returned alongside a 200 (e.g. the endpoint being unreachable).
      const result = data as { status?: number; ok?: boolean; error?: string } | null;
      if (typeof result?.status !== "number") {
        setState({ status: "error", message: "push-test returned an unexpected response." });
        return;
      }

      const okLabel = result.ok ? "OK" : "not ok";
      const errorSuffix = result.error ? ` -- ${result.error}` : "";
      setState({ status: "done", message: `${result.status} ${okLabel}${errorSuffix}` });
    } catch (caught) {
      setState({
        status: "error",
        message: caught instanceof Error ? caught.message : "Could not reach the ledger service.",
      });
    }
  }

  return (
    <li className="flex flex-col gap-1 rounded-card border border-surface-border bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-label text-ink-muted" title={row.endpoint}>
          {shortenEndpoint(row.endpoint)}
        </span>
        <button
          type="button"
          onClick={() => void handleSendClick()}
          disabled={state.status === "sending"}
          className="inline-flex min-h-touch shrink-0 items-center justify-center rounded-card border border-ink-subtle/40 px-3 text-label font-medium text-ink-muted disabled:opacity-60"
        >
          {state.status === "sending" ? "Sending…" : "Send test push"}
        </button>
      </div>

      {state.status === "done" && (
        <p role="status" className="text-label text-ink-muted">
          Result: {state.message}
        </p>
      )}

      {state.status === "error" && (
        <p role="alert" className="text-label text-owed">
          {state.message}
        </p>
      )}
    </li>
  );
}

/** Shortens a push endpoint URL to something short enough to fit a row, keeping the host (the most identifying part for telling multiple devices apart) and dropping most of the opaque path. */
function shortenEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    return `${url.host}${url.pathname.slice(0, 12)}…`;
  } catch {
    return endpoint.slice(0, 40);
  }
}
