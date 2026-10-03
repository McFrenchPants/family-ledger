import { Navigate } from "react-router-dom";

import { Avatar } from "../components/ui/Avatar";
import { cx } from "../components/ui/cx";
import { Icon } from "../components/ui/Icon";
import { useMembership } from "../features/auth/membership-context";
import { useSession } from "../features/auth/session-context";
import { useSignOut } from "../features/auth/useSignOut";
import { LinkButton } from "../features/family/FamilyParts";
import { ROLE_LABELS } from "../features/family/family-view";
import { PushSubscribeButton } from "../features/push/PushSubscribeButton";
import { PushTestSendButton } from "../features/push/PushTestSendButton";
import { InstallRow } from "../features/pwa/InstallRow";
import { AppearanceSwitch } from "../features/settings/AppearanceSwitch";
import {
  ROW_CLASS,
  ROW_DIVIDER_CLASS,
  ROW_TAP_CLASS,
  RowIcon,
  SettingsLinkRow,
  SettingsSection,
} from "../features/settings/SettingsParts";

/**
 * `/settings` -- any signed-in member. Household, Export and backup, and
 * Advanced are hidden from children as decoration only: their pages sit
 * behind `RequireRole role="parent"` in the router, and every read and write
 * they make is Parent-only server-side (RLS, security-definer functions, and
 * the push-test function's own check).
 */
export function SettingsPage() {
  const { session, loading } = useSession();
  const membership = useMembership();

  if (loading) {
    return (
      <p role="status" className="text-label text-subtle">
        Checking session…
      </p>
    );
  }

  if (!session) {
    return <Navigate to="/sign-in" replace />;
  }

  const member = membership.status === "loaded" ? membership.membership : null;
  const isParent = member?.role === "parent";
  const email = session.user.email ?? null;

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-4">
      <header>
        <h1 className="text-title">Settings</h1>
      </header>

      <SettingsSection id="account" title="Account">
        <div className={ROW_CLASS} data-testid="account-identity">
          <Avatar name={member?.name ?? email ?? "?"} />
          <span className="flex min-w-0 grow flex-col">
            {member && <span className="font-semibold">{member.name}</span>}
            <span className="break-all text-label text-subtle">
              {[email, member ? ROLE_LABELS[member.role] : null].filter(Boolean).join(" · ")}
            </span>
          </span>
        </div>
        <SettingsLinkRow to="/settings/account" icon="lock">
          Change password
        </SettingsLinkRow>
        <AppearanceSwitch />
        <SignOutRow />
      </SettingsSection>

      <SettingsSection
        id="device"
        title="This device"
        intro="Optional extras for this phone or computer."
      >
        <div className={cx(ROW_CLASS, "py-3")}>
          <RowIcon name="download" />
          <div className="min-w-0 grow">
            <InstallRow />
          </div>
        </div>
        <div className={cx(ROW_CLASS, "py-3")}>
          <RowIcon name="bell" />
          <div className="flex min-w-0 grow flex-col gap-2">
            <div>
              <h3 className="font-semibold">Payment reminders</h3>
              <p className="text-label text-subtle">A nudge before a payment is due.</p>
            </div>
            <PushSubscribeButton />
          </div>
        </div>
      </SettingsSection>

      {isParent && (
        <>
          <SettingsSection id="household" title="Household">
            <SettingsLinkRow to="/family" icon="users">
              Members &amp; roles
            </SettingsLinkRow>
            <SettingsLinkRow to="/settings/categories" icon="tag">
              Categories
            </SettingsLinkRow>
            <SettingsLinkRow to="/settings/presets" icon="plus">
              Quick-add presets
            </SettingsLinkRow>
          </SettingsSection>

          <SettingsSection
            id="export"
            title="Export & backup"
            intro="Keep your own copy. Nothing is deleted from the app."
          >
            <div className="mt-2 flex flex-wrap gap-3">
              <LinkButton to="/settings/export" icon="file">
                Ledger spreadsheet (CSV)
              </LinkButton>
              <LinkButton to="/settings/export" icon="download">
                Full backup (JSON)
              </LinkButton>
            </div>
          </SettingsSection>

          <details className="group rounded-panel border border-border bg-surface px-4 py-1 shadow-card">
            <summary className="-mx-2 flex min-h-touch cursor-pointer list-none items-center gap-2 rounded-control px-2 text-label font-semibold text-subtle [&::-webkit-details-marker]:hidden">
              <Icon
                name="chev"
                size={16}
                className="transition-transform duration-toggle group-open:rotate-90 motion-reduce:transition-none"
              />
              Advanced
            </summary>
            <div className="flex flex-col gap-2 pb-4">
              <p className="text-label text-muted">
                Tools for checking that reminders reach this device. Shown only once this device
                has reminders turned on.
              </p>
              <PushTestSendButton />
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function SignOutRow() {
  const { signOut, signingOut, error } = useSignOut();

  return (
    <div className={ROW_DIVIDER_CLASS}>
      <button
        type="button"
        onClick={() => void signOut()}
        disabled={signingOut}
        aria-busy={signingOut || undefined}
        className={cx(ROW_TAP_CLASS, "disabled:cursor-not-allowed disabled:opacity-60")}
      >
        <RowIcon name="logout" />
        <span className="grow">Sign out</span>
      </button>
      {error ? (
        <p role="alert" className="pb-2 text-label text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
