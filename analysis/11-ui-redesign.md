# Analysis: UI redesign

## What problem this actually solves

The owner finds the app looks hastily assembled. Every screen opens with a large
"install this app" banner, then a notification button, and (for everyone, even
children) a leftover developer test button, all above the real content. The
menu shows Parent, Child and Sign in links to everyone, payment plans are hidden
inside History, numbers all look alike, and there is no dark mode. The owner
does not want a reskin; they want the app's real jobs (see what is owed and what
needs attention, add an expense, record a payment) to be the obvious things.

## Is it worth doing

Yes. It is the most visible quality gap now that the functional phases are done,
it needs no backend work, and it can run while real-device push testing is
waiting on the owner's hardware.

## Simpler alternatives considered

- **Only move the banners.** Fixes the loudest complaint (and is UI1, shipped
  first) but not the information layout. Kept as the first phase, not the whole job.
- **Adopt a component framework.** Rejected: ADR-008 chose Tailwind plus Radix to
  keep the bundle and dependency surface small.
- **Reskin only.** Rejected by the owner.

## Outcome

Design and mockups: `docs/proposals/ui-redesign/` (approved 2026-10-02).
Plan: `docs/proposals/ui-redesign/IMPLEMENTATION_PLAN.md`. Front-end only; no
migrations, RLS, or Edge Function changes.
