import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import { supabase } from "../../lib/supabase";
import type { MembershipRole } from "../auth/membership-context";
import { invokeFunction, sentence } from "../members/function-errors";
import type { FunctionResult } from "../members/function-errors";
import {
  describeRoleChangeError,
  EMAIL_REFUSED_MESSAGE,
  LAST_ACTIVE_PARENT_ARCHIVE_MESSAGE,
  LINK_RATE_LIMIT_MESSAGE,
  NETWORK_MESSAGE,
  TRY_AGAIN_MESSAGE,
} from "../members/member-errors";
import { SetPasswordLinkDialog } from "../members/SetPasswordLinkDialog";
import type { SetPasswordLink } from "../members/SetPasswordLinkDialog";
import type { HouseholdMemberRow } from "../members/useHouseholdMembers";
import { ROLE_LABELS } from "./family-view";

/**
 * The "Manage" section of a member's page: rename, change role, change
 * login email, create a set-password link, archive / restore. Moved
 * unchanged in behaviour from the old Manage Members list.
 *
 * Every write is re-checked server-side: the `manage-household-member` Edge
 * Function re-derives Parent-ness from the caller's own session, role
 * changes go through the `change_household_member_role` security-definer
 * function, and a rename is an ordinary RLS-scoped update. Hiding a button
 * (an archived member only offers Restore) is convenience; the server
 * refuses the rest anyway.
 */

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

type Action =
  | { kind: "none" }
  | { kind: "rename"; draftName: string }
  | { kind: "confirm-role" }
  | { kind: "change-email"; draftEmail: string }
  | { kind: "confirm-archive" };

export function MemberManageSection({
  member,
  email,
  onMemberChanged,
  onEmailChanged,
}: {
  member: HouseholdMemberRow;
  /** Known login email, or null when unknown (lookup failed or still loading). */
  email: string | null;
  /** Re-read the member after a rename, role change, archive or restore. */
  onMemberChanged: () => void;
  /** Re-read login emails after an email change. */
  onEmailChanged: () => void;
}) {
  const [action, setAction] = useState<Action>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The one-time link lives only here, while its dialog is open.
  const [link, setLink] = useState<SetPasswordLink | null>(null);

  const isArchived = member.status === "archived";
  const otherRole: MembershipRole = member.role === "parent" ? "child" : "parent";

  function begin() {
    setBusy(true);
    setError(null);
    setNotice(null);
  }

  function toggle(next: Action) {
    setError(null);
    setNotice(null);
    setAction((current) => (current.kind === next.kind ? { kind: "none" } : next));
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

    onMemberChanged();
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

    onMemberChanged();
  }

  async function handleEmailSubmit(event: FormEvent) {
    event.preventDefault();
    if (action.kind !== "change-email") return;

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
    onEmailChanged();
  }

  async function handleCreateLink() {
    setAction({ kind: "none" });
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

    setLink({
      url: result.data.url,
      heading: `Set-password link for ${member.name}`,
      intro: `Send this link to ${member.name} so they can choose a new password.`,
    });
  }

  async function handleRenameSubmit(event: FormEvent) {
    event.preventDefault();
    if (action.kind !== "rename") return;

    const trimmed = action.draftName.trim();
    if (trimmed.length === 0) {
      setError("Name can't be empty.");
      return;
    }

    begin();

    let failure: string | null = null;
    try {
      const { error: updateError } = await supabase
        .from("household_members")
        .update({ name: trimmed })
        .eq("id", member.id);
      if (updateError) failure = updateError.message;
    } catch {
      failure = NETWORK_MESSAGE;
    }

    setBusy(false);

    if (failure) {
      setError(failure);
      return;
    }

    setAction({ kind: "none" });
    onMemberChanged();
  }

  return (
    <Card as="section" aria-labelledby="manage-heading" className="flex flex-col gap-3">
      <h2 id="manage-heading" className="text-head">
        Manage
      </h2>

      {link && <SetPasswordLinkDialog link={link} onClose={() => setLink(null)} />}

      <div className="flex flex-wrap gap-2">
        {isArchived ? (
          <Button size="sm" icon="undo" loading={busy} onClick={() => void runStatusChange("restore")}>
            Restore
          </Button>
        ) : (
          <>
            <Button
              size="sm"
              icon="edit"
              disabled={busy}
              aria-expanded={action.kind === "rename"}
              onClick={() => toggle({ kind: "rename", draftName: member.name })}
            >
              Rename
            </Button>
            <Button
              size="sm"
              icon="user"
              disabled={busy}
              aria-expanded={action.kind === "confirm-role"}
              onClick={() => toggle({ kind: "confirm-role" })}
            >
              Change role
            </Button>
            {email && (
              <Button
                size="sm"
                icon="mail"
                disabled={busy}
                aria-expanded={action.kind === "change-email"}
                onClick={() => toggle({ kind: "change-email", draftEmail: "" })}
              >
                Change email
              </Button>
            )}
            <Button size="sm" icon="lock" disabled={busy} onClick={() => void handleCreateLink()}>
              Create set-password link
            </Button>
            <Button
              size="sm"
              icon="ban"
              disabled={busy}
              aria-expanded={action.kind === "confirm-archive"}
              onClick={() => toggle({ kind: "confirm-archive" })}
            >
              Archive
            </Button>
          </>
        )}
      </div>

      {action.kind === "rename" && (
        <form
          className="flex flex-col gap-3 rounded-control bg-sunken p-3"
          onSubmit={(event) => void handleRenameSubmit(event)}
        >
          <Field
            id={`rename-${member.id}`}
            label="Name"
            type="text"
            autoFocus
            value={action.draftName}
            onChange={(event) => setAction({ kind: "rename", draftName: event.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="primary" loading={busy}>
              Save
            </Button>
            <Button size="sm" onClick={() => setAction({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {action.kind === "confirm-role" && (
        <div className="flex flex-col gap-2 rounded-control bg-sunken p-3">
          <p className="text-label text-ink">
            Make {member.name} a {ROLE_LABELS[otherRole]}? A Parent can manage everyone and record
            payments; a Child can only add expenses.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="primary" loading={busy} onClick={() => void handleRoleConfirmed()}>
              Confirm role change
            </Button>
            <Button size="sm" onClick={() => setAction({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {action.kind === "change-email" && (
        <form
          className="flex flex-col gap-3 rounded-control bg-sunken p-3"
          onSubmit={(event) => void handleEmailSubmit(event)}
        >
          <Field
            id={`email-${member.id}`}
            label={`New login email for ${member.name}`}
            hint={`${member.name} will need to sign in with the new email. Their password stays the same.`}
            type="email"
            autoComplete="off"
            autoFocus
            value={action.draftEmail}
            onChange={(event) => setAction({ kind: "change-email", draftEmail: event.target.value })}
          />
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="primary" loading={busy}>
              Save email
            </Button>
            <Button size="sm" onClick={() => setAction({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {/*
        Archiving is reversible -- the copy says so explicitly rather than
        implying deletion.
      */}
      {action.kind === "confirm-archive" && (
        <div className="flex flex-col gap-2 rounded-control border border-danger/60 bg-danger-soft p-3">
          <p className="text-label font-semibold text-danger">Archive this member?</p>
          <p className="text-label text-ink">
            Archived members can be restored at any time. This does not delete their history.
            Archiving also stops them signing in.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              loading={busy}
              onClick={() => void runStatusChange("archive")}
            >
              Confirm archive
            </Button>
            <Button size="sm" onClick={() => setAction({ kind: "none" })}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {notice && (
        <p role="status" className="text-label text-ok">
          {notice}
        </p>
      )}

      {error && (
        <p role="alert" className="text-label text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
