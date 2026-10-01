# Analysis: Account management (change own password, Parent-managed accounts)

## What problem this actually solves

The app went live 2026-10-01 with one real login whose password is a
placeholder the owner chose for setup. Today nobody can change a password:
`SignInForm` only signs in, and Manage Members (add / rename / archive /
restore) has no password, email or role handling. ADR-010 already commits to
"Parent-assisted reset" because there is no email provider, but nothing
implements it. So the real gaps are: (1) the owner cannot replace the
placeholder, (2) a child who forgets a password is locked out for good,
(3) a Parent cannot fix a mistyped login email or promote/demote a member,
and (4) "archived" members can still sign in (they just see nothing).

## Is it worth doing

Yes, and now: it blocks real family use (nobody should keep a placeholder
password on a financial app) and it is the largest remaining authorization
surface that has no tests. It is also all inside the free tier.

## Simpler alternatives considered

- **Do it by hand in the Supabase dashboard.** Works for a single owner, not
  for a child who forgets a password, and every reset needs dashboard access.
  Rejected as the long-term answer; acceptable stopgap until this ships.
- **Add an email provider.** Gives classic "forgot password" and invite
  emails, but needs a sending domain (~$10-15/yr) and breaks the project's
  no-paid-service guardrail. Rejected for now (ADR-010 stands).
- **Parent sets/sees the new password** (generated or typed). Simplest, but
  the Parent then knows the child's password. Rejected by the owner.
- **Chosen (owner, 2026-10-01): Parent-generated one-time set-password
  link.** Supabase can mint a recovery link without emailing it. The Parent
  copies it into any messenger; the person opens it and chooses their own
  password. One mechanism covers invites, forgotten passwords and first
  setup, at no cost, and no Parent ever learns a password.

## Risks worth designing around

- Link-preview bots in chat apps fetch URLs and can burn a single-use token
  before the real person opens it. Mitigation: the link opens an app page
  that consumes the token only when the person taps a button.
- A set-password link is a credential. It must be Parent-only to mint,
  short-lived, single-use, never stored or logged, and carried in the URL
  fragment (not sent to servers).
- Role change and archive-blocks-sign-in widen the "household must always
  have an active Parent" invariant and the "Child can never gain money
  powers" rule; both need server-side enforcement and negative tests.
- Existing M6.1 trigger deliberately rejects role changes; relaxing it is a
  conscious, tested change, not a side effect.

## Decision recorded

Owner confirmed scope and approach in chat on 2026-10-01 (link-based reset,
self password change, archive fully blocks sign-in, Parent can change name,
role and email, no permanent delete). That conversation is this analysis's
check-in. Design: `docs/proposals/account-management/DESIGN_SPEC.md`.
