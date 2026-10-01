# Design spec: Account management

Status: **signed off by the owner 2026-10-01.** Open questions resolved: (1) a Parent MAY create a link for another Parent; (2) link lifetime 24 hours; (3) passwords 8+ characters, no other rules. No file/class-level detail on
purpose; that belongs in the implementation plan.

## Goals

1. Any signed-in person can change their own password.
2. A Parent can give any member of their household a one-time **set-password
   link** (new member invite, forgotten password, first-time setup). The
   person chooses their own password; no Parent ever sees or chooses it.
3. Archiving a member fully blocks sign-in; restoring re-enables it.
4. A Parent can change a member's display name (exists), role
   (Parent / Child) and login email.
5. Everything above is enforced server-side, audited, and free-tier only.

## Non-goals

- No email sending, no email provider, no self-service "forgot password"
  without a Parent (ADR-010 stands).
- No permanent deletion of members or logins (history keeps attribution).
- No multi-household membership changes, no passkeys/2FA.
- No change to who may touch money; this feature adds no balance powers.

## Requirements

### R1. Change own password
- Available to every active member (Parent or Child) from within the app.
- Requires the current password; new password entered twice.
- Minimum length raised to 8 (local config and hosted setting).
- Other devices' sessions keep working until they expire (not forced out).

### R2. Set-password link
- Only an active Parent of the member's household can create one, for any
  member of that household (including other Parents; see Open Q1).
- The app shows the link once, with a copy button, a plain-words note on
  its lifetime, and a warning that anyone holding it can set the password.
- Link is single-use and expires (target 24 hours; Supabase Free allows up
  to 24h, a hosted dashboard setting mirrored in `config.toml`). An
  expired or used link shows a clear "ask a Parent for a new link" page.
- The link opens an app page that shows a "Set your password" screen with a
  button; the one-time token is only consumed when the person submits the
  form, so chat-app link previews cannot burn it. The token travels in the
  URL fragment (after `#`), never the query string, and is never logged or
  stored by us.
- After success the person is signed in and sent to their dashboard.
- Used for **new members** too: adding a member creates the login with an
  unguessable password nobody sees and returns a set-password link instead
  of an initial password (replaces the current "initial password shown
  once").
- Minting a link writes an audit row (who, for whom, when; never the token).
- Rate-limited at the function (a Parent cannot mint unbounded links).

### R3. Archive blocks sign-in
- Archiving a member bans their login at the identity provider; restoring
  lifts the ban. Existing refresh tokens stop working at next refresh;
  database access is already denied immediately by existing row rules.
- Failure mode: if the ban call fails, the archive is not reported as
  successful (no half-archived state), and the Parent sees a retry state.
- Cannot archive the household's last active Parent (existing rule stays).

### R4. Parent edits to a member
- **Display name:** exists; unchanged.
- **Role change (Parent <-> Child):** Parent-only, same household only.
  Never allowed to leave the household with zero active Parents. Recorded
  in the audit log with old and new role. This deliberately relaxes the
  current rule that a member's role is immutable, in one controlled,
  tested path only (no general UPDATE of role by clients).
- **Login email change:** Parent-only. Applied immediately without email
  confirmation (no email provider). Shown to the Parent in the member
  detail so they know the current one. Duplicate emails rejected with a
  clear message. Audited (old and new email).
- A Parent may not change their own role in a way that violates the
  last-Parent rule; may change their own display name and password.

### R5. Security invariants (verifier checks these)
- A Child cannot: mint a link, change any role/email/name of anyone, archive
  or restore anyone, or read another member's email. Negative tests for each.
- A Parent of household A has zero effect on household B (every operation).
- The browser holds no service-role capability; privileged identity-provider
  calls happen only in Edge Functions that first re-derive the caller's
  Parent status from their own session.
- Authorization failures are generic and never reveal whether a member or
  household exists.
- Every create-link, role change, email change, archive, restore writes an
  audit row; audit_log stays unwritable by app roles.

## Constraints

- Free tier only; no new service. Reuses the existing Edge Function pattern
  (`add-household-member`): caller JWT for authorization, service role only
  for the identity-provider admin call, rollback on partial failure.
- Money/ledger code untouched. `npm run test` stays Docker-free; database
  rules are tested in pgTAP and mutation-proofed.
- Hosted settings that live outside git (link lifetime, minimum password
  length, site URL) must be recorded in `docs/DEPLOYMENT_RUNBOOK.md`.

## Risks

- Supabase API detail (admin link generation returning a hashed token the
  app can exchange) must be proven first with a throwaway spike against the
  local stack before the rest is built; if it does not behave as expected
  the design falls back to the recovery link's built-in redirect, still
  behind the same button-click page.
- A leaked link is as good as a password for its lifetime. Mitigations:
  short life, single use, Parent-only, audit trail, shown once.

## Open questions (resolved 2026-10-01)

1. **May a Parent create a link for another Parent?** Recommended **yes**
   (two-parent households need it; every use is audited). The alternative is
   that Parents can only reset Children, and a locked-out Parent needs the
   database dashboard.
2. **Link lifetime:** recommended 24 hours (the Free-plan maximum). Shorter
   is safer; longer is not possible.
3. **Password rules:** recommended 8+ characters, no other composition
   rules. OK?
