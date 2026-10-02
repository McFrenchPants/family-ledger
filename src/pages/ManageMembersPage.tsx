import { useState } from "react";
import type { FormEvent } from "react";

import { useMembership } from "../features/auth/membership-context";
import type { MembershipRole } from "../features/auth/membership-context";
import { invokeFunction, sentence } from "../features/members/function-errors";
import type { FunctionResult } from "../features/members/function-errors";
import {
  describeRoleChangeError,
  EMAIL_REFUSED_MESSAGE,
  LAST_ACTIVE_PARENT_ARCHIVE_MESSAGE,
  LINK_RATE_LIMIT_MESSAGE,
  NETWORK_MESSAGE,
  TRY_AGAIN_MESSAGE,
} from "../features/members/member-errors";
import { SetPasswordLinkDialog } from "../features/members/SetPasswordLinkDialog";
import type { SetPasswordLink } from "../features/members/SetPasswordLinkDialog";
import { useHouseholdMembers } from "../features/members/useHouseholdMembers";
import type { HouseholdMemberRow } from "../features/members/useHouseholdMembers";
import { useLoginEmails } from "../features/members/useLoginEmails";
import { supabase } from "../lib/supabase";

/**
 * `/members` (M6.4). Parent-only the same way `/export` is: gated by
 * `RequireRole role="parent"` in `router.tsx`, so this component can assume
 * `useMembership()` is already `{status: "loaded", ..., role: "parent"}` --
 * see `ExportPage`'s identical assumption and header comment for why that
 * guard is routing convenience, not the security control. Every write this
 * page makes (add / archive / restore / link / email change via Edge
 * Functions, role change via a security-definer function, rename via the
 * normal RLS-scoped client) is independently re-checked server-side: the
 * Edge Function re-derives Parent-ness from the caller's own JWT, and
 * `household_members`'s RLS policies + M6.1's archive-guard trigger enforce
 * everything else regardless of what this page renders.
 */
export function ManageMembersPage() {
  const membership = useMembership();

  if (membership.status !== "loaded") {
    // Unreachable under RequireRole; satisfies the type checker without
    // duplicating RequireRole's loading/error UI.
    return null;
  }

  return <ManageMembers householdId={membership.membership.householdId} />;
}

type AddMemberState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "done"; name: string; linkFailed: boolean };

const MANAGE = "manage-household-member";
const NOT_ARCHIVED_LAST_PARENT = /only active Parent/i;

/** Plain words for a failed Edge Function call; never shows raw internals. */
function describeFailure(result: Extract<FunctionResult<unknown>, { ok: false }>): string {
  if (result.status === 429) {
    return LINK_RATE_LIMIT_MESSAGE;
  }
  if (result.message) {
    return sentence(result.message);
  }
  return result.status === null ? NETWORK_MESSAGE : TRY_AGAIN_MESSAGE;
}

function ManageMembers({ householdId }: { householdId: string }) {
  const membersState = useHouseholdMembers(householdId);
  const { emails, refetch: refetchEmails } = useLoginEmails(householdId);
  // The one-time link lives only here, while its dialog is open.
  const [link, setLink] = useState<SetPasswordLink | null>(null);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title font-semibold">Manage Members</h2>

      {link && <SetPasswordLinkDialog link={link} onClose={() => setLink(null)} />}

      {membersState.status === "loading" && (
        <p role="status" className="text-label text-ink-subtle">
          Loading members…
        </p>
      )}

      {membersState.status === "error" && (
        <div role="alert" className="flex flex-col items-start gap-2">
          <p className="text-label text-owed">Could not load members: {membersState.message}</p>
          <button
            type="button"
            onClick={membersState.retry}
            className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Retry
          </button>
        </div>
      )}

      {membersState.status === "loaded" && (
        <MemberList
          members={membersState.members}
          emails={emails}
          refetch={membersState.refetch}
          refetchEmails={refetchEmails}
          onLink={setLink}
        />
      )}

      <AddMemberForm
        householdId={householdId}
        onAdded={(added) => {
          if (added.url) {
            setLink({
              url: added.url,
              heading: `${added.name} was added`,
              intro: `Send this link to ${added.name} so they can choose their password.`,
            });
          }
          refetchEmails();
          if (membersState.status === "loaded") {
            membersState.refetch();
          }
        }}
      />
    </section>
  );
}

const ROLE_LABELS: Record<MembershipRole, string> = {
  parent: "Parent",
  child: "Child",
};

function MemberList({
  members,
  emails,
  refetch,
  refetchEmails,
  onLink,
}: {
  members: HouseholdMemberRow[];
  emails: Record<string, string | null>;
  refetch: () => void;
  refetchEmails: () => void;
  onLink: (link: SetPasswordLink) => void;
}) {
  if (members.length === 0) {
    return <p className="text-label text-ink-subtle">No members yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {members.map((member) => (
        <MemberRow
          key={member.id}
          member={member}
          email={emails[member.id] ?? null}
          refetch={refetch}
          refetchEmails={refetchEmails}
          onLink={onLink}
        />
      ))}
    </ul>
  );
}

type RowAction =
  | { kind: "none" }
  | { kind: "confirm-archive" }
  | { kind: "rename"; draftName: string }
  | { kind: "confirm-role" }
  | { kind: "change-email"; draftEmail: string };

const smallButton =
  "min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted disabled:opacity-60";

function MemberRow({
  member,
  email,
  refetch,
  refetchEmails,
  onLink,
}: {
  member: HouseholdMemberRow;
  email: string | null;
  refetch: () => void;
  refetchEmails: () => void;
  onLink: (link: SetPasswordLink) => void;
}) {
  const [action, setAction] = useState<RowAction>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isArchived = member.status === "archived";
  const otherRole: MembershipRole = member.role === "parent" ? "child" : "parent";

  function begin() {
    setBusy(true);
    setError(null);
    setNotice(null);
  }

  async function runStatusChange(kind: "archive" | "restore") {
    begin();
    const result = await invokeFunction(MANAGE, { action: kind, member_id: member.id });
    setBusy(false);
    setAction({ kind: "none" });

    if (!result.ok) {
      setError(
        result.message && NOT_ARCHIVED_LAST_PARENT.test(result.message)
          ? LAST_ACTIVE_PARENT_ARCHIVE_MESSAGE
          : describeFailure(result),
      );
      return;
    }

    refetch();
  }

  async function handleRoleConfirmed() {
    begin();

    let failure: string | null = null;
    try {
      const { error: rpcError } = await supabase.rpc("change_household_member_role", {
        p_member_id: member.id,
        p_new_role: otherRole,
      });
      if (rpcError) {
        failure = describeRoleChangeError(rpcError);
      }
    } catch {
      failure = NETWORK_MESSAGE;
    }

    setBusy(false);
    setAction({ kind: "none" });

    if (failure) {
      setError(failure);
      return;
    }

    refetch();
  }

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault();
    if (action.kind !== "change-email") {
      return;
    }

    const newEmail = action.draftEmail.trim();
    if (newEmail.length === 0) {
      setError("Enter the new email address.");
      return;
    }

    begin();
    const result = await invokeFunction<{ email?: string }>(MANAGE, {
      action: "change_email",
      member_id: member.id,
      email: newEmail,
    });
    setBusy(false);

    if (!result.ok) {
      // The function deliberately answers one generic way for a taken or
      // unusable address; say that plainly rather than guessing why.
      setError(
        result.message && /can't be used/i.test(result.message)
          ? EMAIL_REFUSED_MESSAGE
          : describeFailure(result),
      );
      return;
    }

    setAction({ kind: "none" });
    setNotice(
      `Login email changed to ${result.data?.email ?? newEmail}. ${member.name} must sign in with the new email from now on.`,
    );
    refetchEmails();
  }

  async function handleCreateLink() {
    begin();
    const result = await invokeFunction<{ url?: string }>(MANAGE, {
      action: "create_link",
      member_id: member.id,
    });
    setBusy(false);

    if (!result.ok) {
      setError(describeFailure(result));
      return;
    }

    if (!result.data?.url) {
      setError(TRY_AGAIN_MESSAGE);
      return;
    }

    onLink({
      url: result.data.url,
      heading: `Set-password link for ${member.name}`,
      intro: `Send this link to ${member.name} so they can choose a new password.`,
    });
  }

  async function handleRenameSubmit(event: FormEvent) {
    event.preventDefault();
    if (action.kind !== "rename") {
      return;
    }

    const trimmed = action.draftName.trim();
    if (trimmed.length === 0) {
      setError("Name can't be empty.");
      return;
    }

    begin();

    const { error: updateError } = await supabase
      .from("household_members")
      .update({ name: trimmed })
      .eq("id", member.id);

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setAction({ kind: "none" });
    refetch();
  }

  return (
    <li className="flex flex-col gap-2 rounded-card border border-surface-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {action.kind === "rename" ? (
          <form className="flex flex-1 items-center gap-2" onSubmit={(event) => void handleRenameSubmit(event)}>
            <label htmlFor={`rename-${member.id}`} className="sr-only">
              Name
            </label>
            <input
              id={`rename-${member.id}`}
              type="text"
              value={action.draftName}
              onChange={(event) => setAction({ kind: "rename", draftName: event.target.value })}
              className="min-h-touch flex-1 rounded-card border border-surface-border px-3 text-body"
            />
            <button
              type="submit"
              disabled={busy}
              className="min-h-touch rounded-card bg-accent px-3 text-label font-medium text-on-accent disabled:opacity-60"
            >
              Save
            </button>
            <button type="button" onClick={() => setAction({ kind: "none" })} className={smallButton}>
              Cancel
            </button>
          </form>
        ) : (
          <span className="flex flex-col gap-1">
            <span className="text-body font-medium">{member.name}</span>
            {email && <span className="break-all text-label text-ink-subtle">{email}</span>}
            <span className="flex items-center gap-2 text-label text-ink-subtle">
              <span>{ROLE_LABELS[member.role]}</span>
              {/*
                Status is never color-only, per this project's §17
                accessibility rule (see ParentDashboardPage's plan-status
                chips for the same pattern) -- "Archived" is always plain
                text here, with the badge as a visual accent alongside it.
              */}
              {isArchived ? (
                <span className="inline-flex w-fit rounded-card bg-surface-sunken px-2 py-0.5 text-label font-medium text-ink-muted">
                  Archived
                </span>
              ) : (
                <span className="inline-flex w-fit rounded-card bg-settled/10 px-2 py-0.5 text-label font-medium text-settled">
                  Active
                </span>
              )}
            </span>
          </span>
        )}

        {action.kind !== "rename" && (
          <div className="flex flex-wrap gap-2">
            {/*
              Hiding actions that make no sense (an archived member can only
              be restored) is convenience. The server refuses them anyway.
            */}
            {!isArchived && (
              <>
                <button
                  type="button"
                  onClick={() => setAction({ kind: "rename", draftName: member.name })}
                  className={smallButton}
                >
                  Rename
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setAction({ kind: "confirm-role" })}
                  className={smallButton}
                >
                  Change role
                </button>
                {email && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setAction({ kind: "change-email", draftEmail: "" })}
                    className={smallButton}
                  >
                    Change email
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleCreateLink()}
                  className={smallButton}
                >
                  Create set-password link
                </button>
              </>
            )}

            {isArchived ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void runStatusChange("restore")}
                className={smallButton}
              >
                Restore
              </button>
            ) : action.kind === "confirm-archive" ? (
              <span className="flex items-center gap-2">
                <span className="text-label text-ink-subtle">Archive this member?</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runStatusChange("archive")}
                  className="min-h-touch rounded-card bg-owed px-3 text-label font-medium text-on-danger disabled:opacity-60"
                >
                  Confirm archive
                </button>
                <button type="button" onClick={() => setAction({ kind: "none" })} className={smallButton}>
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setAction({ kind: "confirm-archive" })}
                className={smallButton}
              >
                Archive
              </button>
            )}
          </div>
        )}
      </div>

      {/*
        Archiving is reversible -- this copy says so explicitly rather than
        implying deletion, per this project's rule that a Parent should
        never be misled into thinking "Archive" is permanent.
      */}
      {action.kind === "confirm-archive" && (
        <p className="text-label text-ink-subtle">
          Archived members can be restored at any time. This does not delete their history.
          Archiving also stops them signing in.
        </p>
      )}

      {action.kind === "confirm-role" && (
        <div className="flex flex-col gap-2 rounded-card bg-surface-sunken p-3">
          <p className="text-label text-ink">
            Make {member.name} a {ROLE_LABELS[otherRole]}? A Parent can manage everyone and record
            payments; a Child can only add expenses.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRoleConfirmed()}
              className="min-h-touch rounded-card bg-accent px-3 text-label font-medium text-on-accent disabled:opacity-60"
            >
              Confirm role change
            </button>
            <button type="button" onClick={() => setAction({ kind: "none" })} className={smallButton}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {action.kind === "change-email" && (
        <form
          className="flex flex-col gap-2 rounded-card bg-surface-sunken p-3"
          onSubmit={(event) => void handleEmailSubmit(event)}
        >
          <label htmlFor={`email-${member.id}`} className="text-label font-medium text-ink">
            New login email for {member.name}
          </label>
          <input
            id={`email-${member.id}`}
            type="email"
            autoComplete="off"
            value={action.draftEmail}
            onChange={(event) => setAction({ kind: "change-email", draftEmail: event.target.value })}
            className="min-h-touch rounded-card border border-surface-border bg-surface px-3 text-body"
          />
          <p className="text-label text-ink-subtle">
            {member.name} will need to sign in with the new email. Their password stays the same.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-touch rounded-card bg-accent px-3 text-label font-medium text-on-accent disabled:opacity-60"
            >
              Save email
            </button>
            <button type="button" onClick={() => setAction({ kind: "none" })} className={smallButton}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {notice && (
        <p role="status" className="text-label text-settled">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="text-label text-owed">
          {error}
        </p>
      )}
    </li>
  );
}

function AddMemberForm({
  householdId,
  onAdded,
}: {
  householdId: string;
  onAdded: (added: { name: string; url: string | null }) => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<MembershipRole>("child");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<AddMemberState>({ status: "idle" });

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (name.trim().length === 0 || email.trim().length === 0) {
      setState({ status: "error", message: "Name and email are required." });
      return;
    }

    setState({ status: "submitting" });
    const addedName = name.trim();

    const result = await invokeFunction<{
      id?: string;
      set_password_url?: string | null;
      set_password_link_failed?: boolean;
    }>("add-household-member", {
      household_id: householdId,
      name: addedName,
      role,
      email: email.trim(),
    });

    if (!result.ok) {
      setState({
        status: "error",
        message:
          result.message ??
          (result.status === null ? NETWORK_MESSAGE : "Could not add this member."),
      });
      return;
    }

    if (!result.data) {
      setState({ status: "error", message: "Could not add this member." });
      return;
    }

    // The member exists once the function answers 2xx. If the link could not
    // be minted (null URL), the Parent can make one from the member's row.
    const url = result.data.set_password_url || null;
    setState({ status: "done", name: addedName, linkFailed: url === null });
    setName("");
    setEmail("");
    setRole("child");
    onAdded({ name: addedName, url });
  }

  return (
    <div className="flex flex-col gap-4 rounded-card border border-surface-border p-4">
      <h3 className="text-body font-semibold">Add a member</h3>

      {state.status === "done" && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-card border border-settled/40 bg-settled/5 p-3"
        >
          <p className="text-body font-medium text-settled">{state.name} was added.</p>
          {state.linkFailed && (
            <p className="text-label text-ink">
              {state.name} was added, but the link could not be created. Use &quot;Create
              set-password link&quot; on their row.
            </p>
          )}
          <button
            type="button"
            onClick={() => setState({ status: "idle" })}
            className="min-h-touch w-fit rounded-card border border-surface-border px-3 text-label text-ink-muted"
          >
            Dismiss
          </button>
        </div>
      )}

      {state.status !== "done" && (
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-member-name" className="text-label text-ink-muted">
              Name
            </label>
            <input
              id="new-member-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="min-h-touch rounded-card border border-surface-border px-3 text-body"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="new-member-role" className="text-label text-ink-muted">
              Role
            </label>
            <select
              id="new-member-role"
              value={role}
              onChange={(event) => setRole(event.target.value as MembershipRole)}
              className="min-h-touch rounded-card border border-surface-border px-3 text-body"
            >
              <option value="child">Child</option>
              <option value="parent">Parent</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="new-member-email" className="text-label text-ink-muted">
              Email
            </label>
            <input
              id="new-member-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="min-h-touch rounded-card border border-surface-border px-3 text-body"
            />
          </div>

          {state.status === "error" && (
            <p role="alert" className="text-label text-owed">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={state.status === "submitting"}
            className="inline-flex min-h-touch w-fit items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-on-accent disabled:opacity-60"
          >
            {state.status === "submitting" ? "Adding…" : "Add member"}
          </button>
        </form>
      )}
    </div>
  );
}
