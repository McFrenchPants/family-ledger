import { AmountText } from "../../components/ui/AmountText";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { StatusChip } from "../../components/ui/StatusChip";
import type { CalendarDate } from "../../lib/dates";
import { childCardView } from "../home/parent-home";
import { planOnBalance } from "../payment-plans/plan-selection";
import type { ChildPaymentProgress } from "../payment-plans/useChildPaymentProgress";
import type { BreakdownLine } from "./balance-breakdown";

/** "$12.00 owed" / "$5.00 in credit" / "Nothing owed", sized for a list line. */
export function BalanceOwed({ cents }: { cents: number }) {
  if (cents === 0) return <span className="text-subtle">Nothing owed</span>;
  const credit = cents < 0;
  return (
    <span className="flex items-baseline gap-1 text-muted">
      <AmountText
        cents={Math.abs(cents)}
        srContext={credit ? "in credit" : "owed"}
        className="!text-label"
      />
      <span aria-hidden="true">{credit ? "in credit" : "owed"}</span>
    </span>
  );
}

/**
 * A child's total split by balance, for a Parent's Home and Family screens:
 * each balance's name and what it owes (credit reads "in credit"), and under
 * a balance that has a payment plan, that plan's status chip and this
 * month's progress bar.
 *
 * `lines` comes from `breakdownLines`, which already hides empty balances
 * and returns nothing for a household with only Everyday -- callers render
 * this only when there are lines. `plans` is undefined while plan status is
 * still unknown, in which case no plan chips are drawn.
 */
export function BalanceBreakdownList({
  lines,
  plans,
  today,
  childName,
}: {
  lines: readonly BreakdownLine[];
  plans: readonly ChildPaymentProgress[] | undefined;
  today: CalendarDate | null;
  childName: string;
}) {
  return (
    <ul
      aria-label={`${childName}'s balances`}
      className="mt-2 flex flex-col gap-2 border-t border-border pt-2"
    >
      {lines.map((line) => {
        const plan = planOnBalance(plans, line.balanceId);
        const view = plan ? childCardView(line.cents, plan, today) : null;
        return (
          <li key={line.balanceId} data-balance={line.name}>
            <div className="flex items-baseline justify-between gap-2 text-label">
              <span className="font-semibold text-ink">{line.name}</span>
              <BalanceOwed cents={line.cents} />
            </div>
            {view && (view.chip || view.progress) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                {view.chip && (
                  <StatusChip kind={view.chip.kind} label={view.chip.label} className="!py-0.5" />
                )}
                {view.progress && (
                  <ProgressBar
                    className="grow basis-12"
                    value={view.progress.paidCents}
                    max={view.progress.minimumCents}
                    label={`${childName}: ${line.name} paid this month`}
                    valueText={view.progress.text}
                    tone={view.progress.tone}
                  />
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
