import { useState } from "react";
import type { FormEvent } from "react";

import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Field } from "../../components/ui/Field";
import type { MembershipRole } from "../auth/membership-context";
import { invokeFunction } from "../members/function-errors";
import { NETWORK_MESSAGE } from "../members/member-errors";

type AddMemberState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | { status: "done"; name: string; linkFailed: boolean };

/**
 * Adds a household member through the `add-household-member` Edge Function,
 * which re-checks that the caller is a Parent of this household. No password
 * is ever entered here: the function returns a one-time set-password link,
 * which the caller shows in `SetPasswordLinkDialog`.
 */
export function AddMemberForm({
  householdId,
  onAdded,
  onClose,
}: {
  householdId: string;
  onAdded: (added: { name: string; url: string | null }) => void;
  onClose: () => void;
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
    // be minted (null URL), the Parent can make one from the member's page.
    const url = result.data.set_password_url || null;
    setState({ status: "done", name: addedName, linkFailed: url === null });
    setName("");
    setEmail("");
    setRole("child");
    onAdded({ name: addedName, url });
  }

  return (
    <Card as="section" aria-labelledby="add-member-heading" className="flex flex-col gap-4">
      <h2 id="add-member-heading" className="text-head">
        Add a member
      </h2>

      {state.status === "done" ? (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-control border border-ok/40 bg-ok-soft p-3"
        >
          <p className="text-body font-semibold text-ok">{state.name} was added.</p>
          {state.linkFailed && (
            <p className="text-label text-ink">
              {state.name} was added, but the link could not be created. Use &quot;Create
              set-password link&quot; on their page.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setState({ status: "idle" })}>
              Add another
            </Button>
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={(event) => void handleSubmit(event)}>
          <Field
            id="new-member-name"
            label="Name"
            type="text"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <label htmlFor="new-member-role" className="text-label font-semibold text-ink">
              Role
            </label>
            <select
              id="new-member-role"
              value={role}
              onChange={(event) => setRole(event.target.value as MembershipRole)}
              className="min-h-touch-lg rounded-control border border-border-strong bg-surface px-3 text-body text-ink"
            >
              <option value="child">Child</option>
              <option value="parent">Parent</option>
            </select>
          </div>

          <Field
            id="new-member-email"
            label="Email"
            hint="They sign in with this. You'll get a link to send them so they can choose a password."
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          {state.status === "error" && (
            <p role="alert" className="text-label text-danger">
              {state.message}
            </p>
          )}

          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              variant="primary"
              loading={state.status === "submitting"}
            >
              {state.status === "submitting" ? "Adding…" : "Add member"}
            </Button>
            <Button onClick={onClose} disabled={state.status === "submitting"}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
