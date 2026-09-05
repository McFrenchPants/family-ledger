import { useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";

import { useMembership } from "../features/auth/membership-context";
import type { Membership, MembershipRole } from "../features/auth/membership-context";
import type { HistoryTransaction } from "../features/ledger/history";
import { useHistory } from "../features/ledger/useHistory";
import { validateVoidReason } from "../features/ledger/record-transaction";
import { formatCents } from "../lib/currency";
import { supabase } from "../lib/supabase";

const TYPE_LABELS: Record<string, string> = {
  expense: "Expense",
  payment: "Payment",
  adjustment: "Adjustment",
};

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type;
}

/**
 * `/child/:memberId/history` (S2.7). Reachable from both a Parent (drilling
 * into a child's row on `ParentDashboardPage`) and a Child (their own
 * history), so like `AddExpensePage` this is not wrapped in `RequireRole` --
 * there is no single role to require -- and instead handles `useMembership()`
 * loading/signed-out/error/no-membership states directly, mirroring
 * `AddExpensePage`'s pattern.
 *
 * None of this is a security control: `ledger_transactions_select_self` /
 * `_select_parent` RLS (P1.2) independently restrict which rows the query in
 * `useHistory` can ever return for the caller's actual role. If `:memberId`
 * does not resolve to a readable row for this caller (wrong household, a
 * Child requesting a sibling with no access, a nonexistent id), Postgres
 * returns zero rows rather than an error -- rendered below as a plain
 * "no history to show" empty state, not a crash or a redirect loop.
 */
export function HistoryPage() {
  const membership = useMembership();
  const { memberId } = useParams<{ memberId: string }>();

  switch (membership.status) {
    case "loading":
      return (
        <p role="status" className="text-label text-ink-subtle">
          Loading your account…
        </p>
      );

    case "signed-out":
      return <Navigate to="/sign-in" replace />;

    case "error":
      return (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">
            Could not load your account: {membership.message}
          </p>
          <button
            type="button"
            onClick={membership.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      );

    case "no-membership":
      return (
        <p role="alert" className="text-label text-owed">
          Your account is not linked to a household yet. Ask a parent in your household to invite
          you.
        </p>
      );

    case "loaded":
      if (!memberId) {
        // Unreachable via the registered route (which always supplies the
        // param), but keeps this exhaustive without a non-null assertion.
        return <p className="text-label text-ink-subtle">No history to show.</p>;
      }
      return <History membership={membership.membership} memberId={memberId} />;
  }
}

function History({ membership, memberId }: { membership: Membership; memberId: string }) {
  const history = useHistory(memberId);
  const isOwnHistory = membership.memberId === memberId;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-title font-semibold">{isOwnHistory ? "Your History" : "History"}</h2>

        {/*
          Visible only to a Parent, never to a Child viewing their own or a
          sibling's history -- `membership.role` comes from this viewer's own
          `useMembership()` result, mirroring `VoidControl`'s
          `viewerRole === "parent"` gate above.
        */}
        {membership.role === "parent" && (
          <Link
            to={`/child/${memberId}/payment-plan`}
            className="min-h-touch inline-flex items-center rounded-card border border-surface-border px-3 text-label font-medium text-ink-muted"
          >
            Manage payment plan
          </Link>
        )}
      </div>

      {history.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading history…
        </p>
      )}

      {history.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">Could not load history: {history.message}</p>
          <button
            type="button"
            onClick={history.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      )}

      {history.status === "loaded" && (
        <>
          {history.transactions.length === 0 ? (
            <p className="text-label text-ink-subtle">No history to show.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {history.transactions.map((transaction) => (
                <HistoryRow
                  key={transaction.id}
                  transaction={transaction}
                  viewerRole={membership.role}
                  onVoided={history.refetch}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function HistoryRow({
  transaction,
  viewerRole,
  onVoided,
}: {
  transaction: HistoryTransaction;
  viewerRole: MembershipRole;
  onVoided: () => void;
}) {
  const sign = transaction.amountCents > 0 ? "+" : "";

  return (
    <li
      className={`flex flex-col gap-1 rounded-card border border-surface-border px-4 py-3 ${
        transaction.isVoided ? "bg-surface-sunken" : ""
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-label text-ink-subtle">{typeLabel(transaction.type)}</span>
        <span className="text-label text-ink-subtle">{transaction.occurredOn}</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-body font-medium">
          {transaction.description}
          {transaction.categoryName && (
            <span className="ml-2 text-label text-ink-subtle">{transaction.categoryName}</span>
          )}
        </span>
        <span
          className={`text-body ${
            transaction.isVoided ? "text-ink-subtle line-through" : "text-ink-muted"
          }`}
        >
          {sign}
          {formatCents(transaction.amountCents)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <span className="text-label text-ink-subtle">Recorded by {transaction.createdByName}</span>

        {transaction.isVoided && (
          <span className="rounded-card bg-owed/10 px-2 py-0.5 text-label font-medium text-owed">
            Voided{transaction.voidedByName ? ` by ${transaction.voidedByName}` : ""}
          </span>
        )}
      </div>

      {transaction.isVoided && transaction.voidReason && (
        <p className="text-label text-ink-subtle">Reason: {transaction.voidReason}</p>
      )}

      {/*
        S2.6's void action: only rendered for a Parent viewing a non-voided
        row. `viewerRole` comes from this caller's own `useMembership()`
        result, not from anything about the transaction, and a Child must
        never see this control regardless of whose history they are
        viewing -- verified against the rendered DOM as a Child session, not
        just relying on the RPC's own Parent-only rejection.
      */}
      {!transaction.isVoided && viewerRole === "parent" && (
        <VoidControl transactionId={transaction.id} onVoided={onVoided} />
      )}
    </li>
  );
}

type VoidState =
  | { status: "collapsed" }
  | { status: "confirming"; reason: string; reasonError: string | null }
  | { status: "submitting"; reason: string }
  | { status: "error"; reason: string; message: string };

/**
 * A Parent-only void trigger for one active ledger row. Deliberately styled
 * to look nothing like `AddExpensePage`'s (or `RecordPaymentPage`'s) primary
 * actions -- a small outlined `owed`-red control, not a filled button -- per
 * this task's requirement that every balance-decreasing/destructive action
 * stay visually distinct from ordinary entry, including from each other's
 * "this is destructive" signal being reserved for void alone.
 *
 * Expands inline into a reason field plus a second, explicit confirm step
 * (`public.void_ledger_transaction` looks irreversible from the UI's
 * perspective even though the row is only soft-voided), rather than a
 * `window.confirm` -- an inline form can also require the non-empty reason
 * before the confirm control is even enabled, per the acceptance criteria.
 *
 * On success, calls `onVoided` (`useHistory`'s `refetch`) rather than
 * optimistically patching local state -- the row's `isVoided`/`voidedByName`
 * fields come from a join this component has no independent copy of, and a
 * refetch is one round-trip against data that is already cheap to reload.
 *
 * A rejection surfaces the RPC's own `error.message` verbatim (e.g. the
 * already-voided race: two parents voiding the same row near-simultaneously,
 * or a stale page) rather than a generic "something went wrong", per the
 * acceptance criteria.
 */
function VoidControl({
  transactionId,
  onVoided,
}: {
  transactionId: string;
  onVoided: () => void;
}) {
  const [state, setState] = useState<VoidState>({ status: "collapsed" });

  if (state.status === "collapsed") {
    return (
      <button
        type="button"
        onClick={() => setState({ status: "confirming", reason: "", reasonError: null })}
        className="min-h-touch self-start rounded-card border border-owed px-3 text-label font-medium text-owed"
      >
        Void
      </button>
    );
  }

  const reason = state.reason;

  async function handleConfirm(event: FormEvent) {
    event.preventDefault();

    const validation = validateVoidReason(reason);
    if (!validation.ok) {
      setState({ status: "confirming", reason, reasonError: validation.error });
      return;
    }

    setState({ status: "submitting", reason });

    try {
      const { error } = await supabase.rpc("void_ledger_transaction", {
        p_transaction_id: transactionId,
        p_void_reason: validation.reason,
      });

      if (error) {
        // Surfaces the RPC's own rejection verbatim -- e.g. "ledger
        // transaction ... is already voided" for the race-condition case, or
        // "only an active Parent ... may void it" for a stale/downgraded
        // session. Never a generic failure message.
        setState({ status: "error", reason, message: error.message });
        return;
      }

      onVoided();
    } catch (caught) {
      setState({
        status: "error",
        reason,
        message:
          caught instanceof Error
            ? `Could not reach the ledger service: ${caught.message}`
            : "Could not reach the ledger service.",
      });
    }
  }

  return (
    <form
      className="flex flex-col gap-2 rounded-card border border-owed/60 bg-owed/5 p-3"
      onSubmit={(event) => void handleConfirm(event)}
    >
      <label htmlFor={`void-reason-${transactionId}`} className="text-label font-medium text-owed">
        Reason for voiding (required)
      </label>
      <input
        id={`void-reason-${transactionId}`}
        type="text"
        value={reason}
        onChange={(event) =>
          setState({ status: "confirming", reason: event.target.value, reasonError: null })
        }
        className="min-h-touch rounded-card border border-surface-border px-3 text-body"
      />
      {state.status === "confirming" && state.reasonError && (
        <p role="alert" className="text-label text-owed">
          {state.reasonError}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-label text-owed">
          Could not void this transaction: {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={state.status === "submitting" || reason.trim() === ""}
          className="inline-flex min-h-touch flex-1 items-center justify-center rounded-card bg-owed px-3 text-label font-medium text-white disabled:opacity-60"
        >
          {state.status === "submitting" ? "Voiding…" : "Confirm void"}
        </button>
        <button
          type="button"
          onClick={() => setState({ status: "collapsed" })}
          disabled={state.status === "submitting"}
          className="min-h-touch flex-1 rounded-card border border-surface-border px-3 text-label text-ink-muted disabled:opacity-60"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
