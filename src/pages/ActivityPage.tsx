import { useId, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AmountText } from "../components/ui/AmountText";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { ChoiceChips } from "../components/ui/ChoiceChips";
import { cx } from "../components/ui/cx";
import { EmptyState } from "../components/ui/EmptyState";
import { Field } from "../components/ui/Field";
import { Icon } from "../components/ui/Icon";
import type { IconName } from "../components/ui/icon-paths";
import { Segmented } from "../components/ui/Segmented";
import { Sheet, SheetClose } from "../components/ui/Sheet";
import { TONE_CLASSES } from "../components/ui/status";
import { MembershipGate } from "../features/auth/MembershipGate";
import type { Membership } from "../features/auth/membership-context";
import type { ChildBalance } from "../features/ledger/household-balances";
import type { ActivityTransaction } from "../features/ledger/history";
import { validateVoidReason } from "../features/ledger/record-transaction";
import { useActivity } from "../features/ledger/useActivity";
import type { ActivityKind } from "../features/ledger/useActivity";
import { useHouseholdBalances } from "../features/ledger/useHouseholdBalances";
import type { HouseholdBalancesState } from "../features/ledger/useHouseholdBalances";
import { useHouseholdCategories } from "../features/ledger/useHouseholdCategories";
import { useHouseholdTimezone } from "../features/ledger/useHouseholdTimezone";
import { addDays, formatCalendarDate, todayInZone } from "../lib/dates";
import type { CalendarDate } from "../lib/dates";
import { NO_ACTIVITY_HINT, NO_ACTIVITY_TITLE } from "../lib/messages";
import { supabase } from "../lib/supabase";

/**
 * `/activity`: the ledger, newest first, 50 rows at a time.
 *
 * A Parent sees the whole household ("Everyone") or one child, picked with
 * chips that mirror `?child=<memberId>` in the address. A Child always sees
 * their own rows: any `?child=` is ignored, so a Child cannot even ask the
 * UI for a sibling's history.
 *
 * None of this is a security control. `ledger_transactions` RLS decides
 * which rows any caller can read, and `void_ledger_transaction` re-checks
 * that the caller is an active Parent; hiding the void control from a Child
 * is decoration.
 */
export function ActivityPage() {
  return (
    <MembershipGate>
      {(membership) =>
        membership.role === "parent" ? (
          <ParentActivity membership={membership} />
        ) : (
          <Activity key={membership.memberId} membership={membership} memberId={membership.memberId} />
        )
      }
    </MembershipGate>
  );
}

const EVERYONE = "everyone";

function ParentActivity({ membership }: { membership: Membership }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const child = searchParams.get("child") || null;
  const balances = useHouseholdBalances(membership.householdId);

  function chooseChild(next: string) {
    setSearchParams(next === EVERYONE ? {} : { child: next }, { replace: true });
  }

  return (
    <Activity
      membership={membership}
      memberId={child ?? undefined}
      roster={balances.status === "loaded" ? balances.children : null}
      childChips={<ChildChips balances={balances} value={child ?? EVERYONE} onChange={chooseChild} />}
      onShowEveryone={child ? () => chooseChild(EVERYONE) : undefined}
    />
  );
}

function ChildChips({
  balances,
  value,
  onChange,
}: {
  balances: HouseholdBalancesState;
  value: string;
  onChange: (value: string) => void;
}) {
  if (balances.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2">
        <p className="text-label text-danger">Could not load children: {balances.message}</p>
        <Button size="sm" onClick={balances.retry}>
          Retry
        </Button>
      </div>
    );
  }
  const options = [
    { value: EVERYONE, label: "Everyone" },
    ...(balances.status === "loaded"
      ? balances.children.map((child) => ({ value: child.memberId, label: child.name }))
      : []),
  ];
  return (
    <ChoiceChips
      label="Child"
      options={options}
      value={value}
      onValueChange={(next) => {
        if (next) onChange(next);
      }}
    />
  );
}

const KIND_OPTIONS = [
  { value: "all", label: "All" },
  { value: "expense", label: "Expenses" },
  { value: "payment", label: "Payments" },
  { value: "voided", label: "Voided" },
] as const;

type SegmentKind = (typeof KIND_OPTIONS)[number]["value"];

function Activity({
  membership,
  memberId,
  roster = null,
  childChips,
  onShowEveryone,
}: {
  membership: Membership;
  /** One member's rows, or undefined for the whole household (Parent "Everyone"). */
  memberId: string | undefined;
  /** Active children, for naming rows in the Everyone view. */
  roster?: readonly ChildBalance[] | null;
  childChips?: ReactNode;
  onShowEveryone?: () => void;
}) {
  const isParent = membership.role === "parent";
  const [kind, setKind] = useState<ActivityKind>("all");
  const [categoryId, setCategoryId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const activity = useActivity({
    householdId: membership.householdId,
    memberId,
    kind,
    categoryId: categoryId || undefined,
    from: from || undefined,
    to: to || undefined,
  });
  const zoneState = useHouseholdTimezone(membership.householdId);
  const zone = zoneState.status === "loaded" ? zoneState.timezone : null;

  const sheetFilterCount = [categoryId, from, to].filter(Boolean).length + (kind === "adjustment" ? 1 : 0);
  const anyFilter = kind !== "all" || sheetFilterCount > 0;

  function clearFilters() {
    setKind("all");
    setCategoryId("");
    setFrom("");
    setTo("");
  }

  // Each row names its child only when several children are in view.
  const nameOf =
    isParent && memberId === undefined
      ? new Map((roster ?? []).map((child) => [child.memberId, child.name]))
      : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-title">Activity</h1>
        <Sheet
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          title="Filters"
          trigger={
            <Button size="sm" icon="filter">
              Filters
              {sheetFilterCount > 0 && (
                <span className={cx("rounded-full px-2 text-caption font-semibold", TONE_CLASSES.info)}>
                  {sheetFilterCount}
                  <span className="sr-only"> active</span>
                </span>
              )}
            </Button>
          }
        >
          <FiltersForm
            householdId={membership.householdId}
            kind={kind}
            setKind={setKind}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            from={from}
            setFrom={setFrom}
            to={to}
            setTo={setTo}
            onClear={clearFilters}
          />
        </Sheet>
      </header>

      {childChips}

      <Segmented<SegmentKind | "adjustment">
        label="Type"
        options={KIND_OPTIONS}
        value={kind}
        onValueChange={(next) => setKind(next)}
      />

      {activity.status === "loading" && (
        <p role="status" className="text-label text-subtle">
          Loading activity…
        </p>
      )}

      {activity.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-danger">Could not load activity: {activity.message}</p>
          <Button size="sm" onClick={activity.retry}>
            Retry
          </Button>
        </div>
      )}

      {activity.status === "loaded" && (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-label text-muted">
            <span data-testid="activity-count">
              Showing {activity.transactions.length}
              {activity.hasMore ? " — load more for older entries" : ""}
            </span>
            {isParent && memberId !== undefined && (
              <Link
                to={`/family/${encodeURIComponent(memberId)}`}
                className="inline-flex min-h-touch items-center gap-1 rounded-control font-semibold text-accent-text"
              >
                <Icon name="cal" size={18} />
                Payment plan
              </Link>
            )}
            {isParent && (
              <Link
                to="/settings/export"
                className="inline-flex min-h-touch items-center gap-1 rounded-control font-semibold text-accent-text"
              >
                <Icon name="download" size={18} />
                Export
              </Link>
            )}
          </div>

          {activity.transactions.length === 0 ? (
            <Card>
              {anyFilter ? (
                <EmptyState
                  icon="filter"
                  title="Nothing matches these filters"
                  action={<Button onClick={clearFilters}>Clear filters</Button>}
                >
                  Try a different type, category or date range.
                </EmptyState>
              ) : (
                <EmptyState
                  icon="list"
                  title={NO_ACTIVITY_TITLE}
                  action={
                    onShowEveryone ? <Button onClick={onShowEveryone}>Show everyone</Button> : undefined
                  }
                >
                  {isParent
                    ? "Expenses and payments show up here as soon as anyone records them."
                    : NO_ACTIVITY_HINT}
                </EmptyState>
              )}
            </Card>
          ) : (
            <Card className="px-4 py-1">
              {groupByDay(activity.transactions).map((group) => (
                <section key={group.date} aria-label={dayLabel(group.date, zone)}>
                  <h2 className="pt-3 text-caption uppercase text-subtle">{dayLabel(group.date, zone)}</h2>
                  <ul>
                    {group.transactions.map((transaction) => (
                      <ActivityItem
                        key={transaction.id}
                        transaction={transaction}
                        childName={nameOf ? (nameOf.get(transaction.memberId) ?? null) : null}
                        isParent={isParent}
                        zone={zone}
                        onVoided={activity.refetch}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </Card>
          )}

          {activity.loadMoreError && (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-label text-danger">Could not load more: {activity.loadMoreError}</p>
              <Button size="sm" onClick={activity.loadMore}>
                Try again
              </Button>
            </div>
          )}

          {activity.hasMore && !activity.loadMoreError && (
            <Button fullWidth onClick={activity.loadMore} loading={activity.loadingMore}>
              {activity.loadingMore ? "Loading…" : "Load more"}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filters sheet                                                        */
/* ------------------------------------------------------------------ */

function FiltersForm({
  householdId,
  kind,
  setKind,
  categoryId,
  setCategoryId,
  from,
  setFrom,
  to,
  setTo,
  onClear,
}: {
  householdId: string;
  kind: ActivityKind;
  setKind: (kind: ActivityKind) => void;
  categoryId: string;
  setCategoryId: (value: string) => void;
  from: string;
  setFrom: (value: string) => void;
  to: string;
  setTo: (value: string) => void;
  onClear: () => void;
}) {
  const categories = useHouseholdCategories(householdId);
  const categoryFieldId = useId();
  const adjustmentsId = useId();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={categoryFieldId} className="text-label font-semibold text-ink">
          Category
        </label>
        <select
          id={categoryFieldId}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          disabled={categories.status !== "loaded"}
          className="min-h-touch-lg rounded-control border border-border-strong bg-surface px-3 text-body text-ink disabled:opacity-60"
        >
          <option value="">All categories</option>
          {categories.status === "loaded" &&
            categories.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
        </select>
        {categories.status === "error" && (
          <p className="text-label text-danger">Could not load categories: {categories.message}</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="From" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <Field label="To" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
      </div>

      <label htmlFor={adjustmentsId} className="flex min-h-touch items-center gap-3 text-body text-ink">
        <input
          id={adjustmentsId}
          type="checkbox"
          checked={kind === "adjustment"}
          onChange={(event) => setKind(event.target.checked ? "adjustment" : "all")}
          className="h-5 w-5 accent-accent"
        />
        Only adjustments
      </label>

      <div className="flex gap-2">
        <Button className="flex-1" onClick={onClear}>
          Clear filters
        </Button>
        <SheetClose asChild>
          <Button variant="primary" className="flex-1">
            Done
          </Button>
        </SheetClose>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Rows                                                                 */
/* ------------------------------------------------------------------ */

type DayGroup = { date: CalendarDate; transactions: ActivityTransaction[] };

/** Consecutive rows sharing an `occurred_on`, in the order the server sent them. */
function groupByDay(transactions: readonly ActivityTransaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const transaction of transactions) {
    const last = groups[groups.length - 1];
    if (last && last.date === transaction.occurredOn) last.transactions.push(transaction);
    else groups.push({ date: transaction.occurredOn, transactions: [transaction] });
  }
  return groups;
}

/** "Today" / "Yesterday" by the household's zone, else "Wednesday, September 30" (plus year if not this year). */
function dayLabel(date: CalendarDate, zone: string | null): string {
  const today = zone ? todayInZone(zone) : null;
  if (today === date) return "Today";
  if (today && addDays(today, -1) === date) return "Yesterday";
  const label = formatCalendarDate(date, "long");
  return today && today.slice(0, 4) !== date.slice(0, 4) ? `${label}, ${date.slice(0, 4)}` : label;
}

/** When a row was entered, in the household's zone (never the browser's). */
function enteredAt(instant: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(instant));
}

const TYPE_LOOK: Record<string, { icon: IconName; box: string; label: string }> = {
  payment: { icon: "check", box: "bg-ok-soft text-ok", label: "Payment" },
  adjustment: { icon: "edit", box: "bg-accent-soft text-accent-text", label: "Adjustment" },
  expense: { icon: "tag", box: "bg-sunken text-muted", label: "Expense" },
};

function ActivityItem({
  transaction,
  childName,
  isParent,
  zone,
  onVoided,
}: {
  transaction: ActivityTransaction;
  childName: string | null;
  isParent: boolean;
  zone: string | null;
  onVoided: () => void;
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const look = TYPE_LOOK[transaction.type] ?? TYPE_LOOK.expense!;
  const detail =
    transaction.type === "expense" ? (transaction.categoryName ?? "Expense") : look.label;
  const subline = [
    childName,
    detail,
    `${transaction.type === "expense" ? "added" : "recorded"} by ${transaction.createdByName}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const voided = transaction.isVoided;

  return (
    <li data-voided={voided ? "true" : undefined} className="border-t border-border first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-[60px] w-full items-center gap-3 rounded-control py-2.5 text-left"
      >
        <span className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-control", look.box)}>
          <Icon name={look.icon} />
        </span>
        <span className="min-w-0 grow">
          <span className={cx("block truncate font-semibold", voided && "text-subtle line-through")}>
            {transaction.description}
          </span>
          <span className="block text-label text-subtle">{subline}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          {/* Sign follows the stored amount: expenses +, payments and adjustments −. */}
          <AmountText
            cents={transaction.amountCents}
            kind={transaction.amountCents > 0 ? "expense" : "payment"}
            tone={voided ? "inherit" : transaction.type === "payment" ? "ok" : "ink"}
            srContext={voided ? "voided" : undefined}
            className={cx(voided && "text-subtle line-through")}
          />
          {voided && (
            <span
              className={cx(
                "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-caption font-semibold",
                TONE_CLASSES.neutral,
              )}
            >
              <Icon name="ban" size={14} />
              Voided
            </span>
          )}
        </span>
      </button>

      {open && (
        <div id={panelId} className="flex flex-col gap-1 pb-3 pl-[52px] text-label text-muted">
          {zone && <p>Entered {enteredAt(transaction.createdAt, zone)}</p>}
          {transaction.note && <p>Note: {transaction.note}</p>}
          {voided && (
            <p>
              Voided by {transaction.voidedByName}
              {transaction.voidReason ? ` · Reason: ${transaction.voidReason}` : ""}
            </p>
          )}
          {/* Parent-only, and never for a voided row. The RPC re-checks both. */}
          {isParent && !voided && <VoidControl transactionId={transaction.id} onVoided={onVoided} />}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Void                                                                 */
/* ------------------------------------------------------------------ */

type VoidState =
  | { status: "collapsed" }
  | { status: "confirming"; reason: string; reasonError: string | null }
  | { status: "submitting"; reason: string }
  | { status: "error"; reason: string; message: string };

/**
 * A Parent's void for one active row: a destructive-looking trigger that
 * opens an inline reason form with an explicit confirm step.
 *
 * On success it calls `onVoided` (the list's refetch) rather than patching
 * the row locally: the voided-by name comes from a join this component has
 * no copy of. A rejection shows the RPC's own message verbatim (e.g. the
 * row was voided by someone else a moment ago), never a generic failure.
 */
function VoidControl({ transactionId, onVoided }: { transactionId: string; onVoided: () => void }) {
  const [state, setState] = useState<VoidState>({ status: "collapsed" });

  if (state.status === "collapsed") {
    return (
      <div className="mt-2 flex flex-col items-start gap-1">
        <button
          type="button"
          onClick={() => setState({ status: "confirming", reason: "", reasonError: null })}
          className="inline-flex min-h-touch items-center gap-2 rounded-control border border-danger bg-surface px-3.5 text-label font-semibold text-danger"
        >
          <Icon name="ban" />
          Void this entry…
        </button>
        <p className="text-caption text-subtle">Voiding keeps the entry visible and asks for a reason.</p>
      </div>
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
      className="mt-2 flex flex-col gap-2 rounded-control border border-danger/60 bg-danger-soft p-3"
      onSubmit={(event) => void handleConfirm(event)}
    >
      <label htmlFor={`void-reason-${transactionId}`} className="text-label font-semibold text-danger">
        Reason for voiding (required)
      </label>
      <input
        id={`void-reason-${transactionId}`}
        type="text"
        value={reason}
        onChange={(event) =>
          setState({ status: "confirming", reason: event.target.value, reasonError: null })
        }
        className="min-h-touch-lg rounded-control border border-border-strong bg-surface px-3 text-body text-ink"
      />
      {state.status === "confirming" && state.reasonError && (
        <p role="alert" className="text-label text-danger">
          {state.reasonError}
        </p>
      )}
      {state.status === "error" && (
        <p role="alert" className="text-label text-danger">
          Could not void this transaction: {state.message}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="danger"
          size="sm"
          className="flex-1"
          loading={state.status === "submitting"}
          disabled={reason.trim() === ""}
        >
          {state.status === "submitting" ? "Voiding…" : "Confirm void"}
        </Button>
        <Button
          size="sm"
          className="flex-1"
          onClick={() => setState({ status: "collapsed" })}
          disabled={state.status === "submitting"}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}
