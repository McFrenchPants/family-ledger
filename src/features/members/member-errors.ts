export const LAST_ACTIVE_PARENT_DEMOTE_MESSAGE =
  "You can't demote the household's only active Parent. Make another member a Parent first.";

export const TRY_AGAIN_MESSAGE = "Something went wrong. Please try again.";
export const NETWORK_MESSAGE =
  "Could not reach the ledger service. Check your connection and try again.";
export const LINK_RATE_LIMIT_MESSAGE =
  "You have created a lot of links recently. Please try again in a little while.";
export const EMAIL_REFUSED_MESSAGE = "That email can't be used.";

/** Plain-words text for a failed `change_household_member_role` call. */
export function describeRoleChangeError(
  error: { code?: string; message?: string } | null | undefined,
): string {
  const message = error?.message ?? "";

  if (/only active Parent/i.test(message)) {
    return LAST_ACTIVE_PARENT_DEMOTE_MESSAGE;
  }
  if (/already has role/i.test(message)) {
    return "That member already has that role.";
  }
  if (/archived member/i.test(message)) {
    return "Restore this member before changing their role.";
  }
  if (error?.code === "42501") {
    return "Only a Parent of this household can change roles.";
  }
  return TRY_AGAIN_MESSAGE;
}

export const LAST_ACTIVE_PARENT_ARCHIVE_MESSAGE =
  "You can't archive the household's only active Parent. Make another member an active Parent first.";
