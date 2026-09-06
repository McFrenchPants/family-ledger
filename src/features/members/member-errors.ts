/**
 * M6.1's `household_members` UPDATE trigger rejects archiving a household's
 * only active Parent with a Postgres error raised as errcode `42501` and
 * message `'cannot archive the household''s only active Parent'` (see
 * CLAUDE.md / the M6.1 migration). `42501` on its own is not unique to this
 * trigger -- it is also Postgres's generic "insufficient privilege" code, the
 * same one an RLS policy violation surfaces as -- so this checks the
 * message text too before mapping to the friendly, specific copy. Any other
 * `42501` (or any other error entirely) falls through to the caller's own
 * generic error message.
 */
export function isLastActiveParentArchiveError(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) {
    return false;
  }

  return Boolean(error.message && error.message.includes("only active Parent"));
}

export const LAST_ACTIVE_PARENT_ARCHIVE_MESSAGE =
  "You can't archive the household's only active Parent. Make another member an active Parent first.";
