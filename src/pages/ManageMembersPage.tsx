import { useState } from "react";
import type { FormEvent } from "react";

import { useMembership } from "../features/auth/membership-context";
import type { MembershipRole } from "../features/auth/membership-context";
import {
  isLastActiveParentArchiveError,
  LAST_ACTIVE_PARENT_ARCHIVE_MESSAGE,
} from "../features/members/member-errors";
import { useHouseholdMembers } from "../features/members/useHouseholdMembers";
import type { HouseholdMemberRow } from "../features/members/useHouseholdMembers";
import { supabase } from "../lib/supabase";

/**
 * `/members` (M6.4). Parent-only the same way `/export` is: gated by
 * `RequireRole role="parent"` in `router.tsx`, so this component can assume
 * `useMembership()` is already `{status: "loaded", ..., role: "parent"}` --
 * see `ExportPage`'s identical assumption and header comment for why that
 * guard is routing convenience, not the security control. Every write this
 * page makes (add via the Edge Function, archive/restore/rename via the
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
  | { status: "done"; name: string; email: string; initialPassword: string };

function ManageMembers({ householdId }: { householdId: string }) {
  const membersState = useHouseholdMembers(householdId);

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-title font-semibold">Manage Members</h2>

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
        <MemberList members={membersState.members} refetch={membersState.refetch} />
      )}

      <AddMemberForm
        householdId={householdId}
        onAdded={() => {
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
  refetch,
}: {
  members: HouseholdMemberRow[];
  refetch: () => void;
}) {
  if (members.length === 0) {
    return <p className="text-label text-ink-subtle">No members yet.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {members.map((member) => (
        <MemberRow key={member.id} member={member} refetch={refetch} />
      ))}
    </ul>
  );
}

type RowAction = { kind: "none" } | { kind: "confirm-archive" } | { kind: "rename"; draftName: string };

function MemberRow({ member, refetch }: { member: HouseholdMemberRow; refetch: () => void }) {
  const [action, setAction] = useState<RowAction>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isArchived = member.status === "archived";

  async function handleArchiveConfirmed() {
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("household_members")
      .update({ status: "archived", archived_at: new Date().toISOString() })
      .eq("id", member.id);

    setBusy(false);

    if (updateError) {
      setError(
        isLastActiveParentArchiveError(updateError)
          ? LAST_ACTIVE_PARENT_ARCHIVE_MESSAGE
          : updateError.message,
      );
      setAction({ kind: "none" });
      return;
    }

    setAction({ kind: "none" });
    refetch();
  }

  async function handleRestore() {
    setBusy(true);
    setError(null);

    const { error: updateError } = await supabase
      .from("household_members")
      .update({ status: "active", archived_at: null })
      .eq("id", member.id);

    setBusy(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    refetch();
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

    setBusy(true);
    setError(null);

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
      <div className="flex items-center justify-between gap-2">
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
              className="min-h-touch rounded-card bg-accent px-3 text-label font-medium text-white disabled:opacity-60"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setAction({ kind: "none" })}
              className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
            >
              Cancel
            </button>
          </form>
        ) : (
          <span className="flex flex-col gap-1">
            <span className="text-body font-medium">{member.name}</span>
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
          <div className="flex shrink-0 gap-2">
            {!isArchived && (
              <button
                type="button"
                onClick={() => setAction({ kind: "rename", draftName: member.name })}
                className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
              >
                Rename
              </button>
            )}

            {isArchived ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleRestore()}
                className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted disabled:opacity-60"
              >
                Restore
              </button>
            ) : action.kind === "confirm-archive" ? (
              <span className="flex items-center gap-2">
                <span className="text-label text-ink-subtle">Archive this member?</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleArchiveConfirmed()}
                  className="min-h-touch rounded-card bg-owed px-3 text-label font-medium text-white disabled:opacity-60"
                >
                  Confirm archive
                </button>
                <button
                  type="button"
                  onClick={() => setAction({ kind: "none" })}
                  className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setAction({ kind: "confirm-archive" })}
                className="min-h-touch rounded-card border border-surface-border px-3 text-label text-ink-muted"
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
  onAdded: () => void;
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

    try {
      const { data, error } = await supabase.functions.invoke("add-household-member", {
        body: {
          household_id: householdId,
          name: name.trim(),
          role,
          email: email.trim(),
        },
      });

      if (error) {
        // supabase-js surfaces a non-2xx Edge Function response as
        // `FunctionsHttpError`, whose `.context` is the raw Response --
        // the function's own `{error}` body has already been consumed into
        // `data` in some client versions and not others, so fall back to a
        // generic message rather than assume either shape.
        const message =
          (data as { error?: string } | null)?.error ??
          (error instanceof Error ? error.message : "Could not add this member.");
        setState({ status: "error", message });
        return;
      }

      const result = data as { initial_password?: string } | null;
      if (!result?.initial_password) {
        setState({ status: "error", message: "Could not add this member." });
        return;
      }

      setState({
        status: "done",
        name: name.trim(),
        email: email.trim(),
        initialPassword: result.initial_password,
      });
      setName("");
      setEmail("");
      setRole("child");
      onAdded();
    } catch (caught) {
      setState({
        status: "error",
        message:
          caught instanceof Error
            ? `Could not reach the ledger service: ${caught.message}`
            : "Could not reach the ledger service.",
      });
    }
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
          <p className="text-label text-ink">
            Initial password (there is no email flow -- share this with {state.name} yourself; it
            will not be shown again):
          </p>
          <p className="select-all rounded-card bg-surface-sunken px-3 py-2 font-mono text-body">
            {state.initialPassword}
          </p>
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
            className="inline-flex min-h-touch w-fit items-center justify-center rounded-card bg-accent px-4 text-body font-medium text-white disabled:opacity-60"
          >
            {state.status === "submitting" ? "Adding…" : "Add member"}
          </button>
        </form>
      )}
    </div>
  );
}
