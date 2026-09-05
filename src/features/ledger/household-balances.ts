import type { Cents } from "../../lib/currency";

/**
 * Row shape returned by
 * `select("id, name, role, status").eq("household_id", ...).eq("status", "active")`
 * against `household_members` (the S2.1 Parent-listing RLS policy). `role`
 * and `status` are `text` columns in Postgres (constrained by CHECKs, not a
 * Postgres enum), so they arrive as plain strings here too.
 */
export type HouseholdMemberRow = {
  id: string;
  name: string;
  role: string;
  status: string;
};

/** Row shape returned by the `household_member_balances` RPC. */
export type MemberBalanceRow = {
  member_id: string;
  balance_cents: number;
};

/** A single active Child, joined with their current balance. */
export type ChildBalance = {
  memberId: string;
  name: string;
  balanceCents: Cents;
};

/**
 * Join active `household_members` rows with the `household_member_balances`
 * RPC result, client-side, keeping only Children.
 *
 * A Parent's own row is deliberately excluded here (not just filtered later
 * by the caller) -- the dashboard design shows only Children as cards, and
 * keeping that decision in one pure/testable place avoids re-deriving it
 * differently in a future screen.
 *
 * A member with no transactions still appears: `household_member_balances`
 * already coalesces to 0 server-side, and any member row absent from the
 * balances result (should not happen, but the join must not assume it can't)
 * is defaulted to 0 here too, rather than dropped or rendered blank.
 */
export function joinChildBalances(
  members: readonly HouseholdMemberRow[],
  balances: readonly MemberBalanceRow[],
): ChildBalance[] {
  const balanceByMemberId = new Map<string, number>();
  for (const row of balances) {
    balanceByMemberId.set(row.member_id, row.balance_cents);
  }

  return members
    .filter((member) => member.role === "child")
    .map((member) => ({
      memberId: member.id,
      name: member.name,
      balanceCents: balanceByMemberId.get(member.id) ?? 0,
    }));
}
