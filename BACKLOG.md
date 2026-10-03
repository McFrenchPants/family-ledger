# Family Ledger — Backlog

Candidate work items for `/continue-development` to pick from. This file is
owned by the orchestrator; the implementer role may never write to it (see
`.sdlc/project.yaml`'s `always_forbidden_paths`).

## Status vocabulary

| Status | Meaning |
| --- | --- |
| `idea` | Raw idea. Needs an analysis file scrutinizing whether it's worth doing before any design or code. |
| `needs research` | Direction is wanted but an open technical/product question must be answered first. |
| `ready` | Scoped well enough to scaffold a design spec / implementation plan against. |
| `in progress` | Has a live branch and tracking docs. Its `docs/proposals/<slug>/PROGRESS.md` is the source of truth, not this label. |
| `done` | Shipped. |

## Analysis files

An item's analysis lives at `analysis/NN-slug.md` and is written **before**
design or implementation. It is not a transcription of the backlog entry —
it argues whether the item is worth doing, what it actually solves, and
whether a simpler approach reaches the same goal. "not yet written" below
means exactly that.

## Items

The seven phases below are transcribed from `docs/ARCHITECTURE.md` §29 and
`docs/PROJECT_REQUIREMENTS.md` §19, which already define the intended build
order and its dependencies. They are not invented work. Phases are strictly
sequential except where noted.

1. **Phase 0 — Technical foundations** — status: `done` — analysis: analysis/00-phase-0-foundations.md
   Tracking doc: `docs/proposals/phase-0-foundations/PROGRESS.md` (branch
   `feature/phase-0-foundations`) — that file is the source of truth for
   task-level status, not this entry.

   Vite + React + TypeScript app skeleton, Tailwind CSS + Radix UI setup
   (ADR-008), local Supabase project via CLI, initial schema and first
   migration, Cloudflare Pages deployment, authentication proof of concept.
   Establishes the `package.json` scripts (test/build/typecheck) that
   every later task's verification commands depend on — nothing else can
   be properly verified until this lands.

   Two tracks:
   - **Local track** (done — see the proposal's PROGRESS.md): app
     skeleton, Tailwind/Radix setup, `supabase start` against local
     Docker, first migration, auth PoC against the local Supabase
     instance. All eight tasks (T1–T7 plus T3a) are done and verified.
   - **Hosted track** (done): Cloudflare Pages is connected to the GitHub
     repo with the production branch set to `production`. Linking the CLI
     to the real Supabase project (`fsszkclgeekdyyspgrhg`) is deferred
     until there's a migration worth pushing to it.

2. **Phase 1 — Security and core ledger** — status: `done` — analysis: analysis/01-phase-1-security-core-ledger.md
   Tracking doc: `docs/proposals/phase-1-security-core-ledger/PROGRESS.md`
   (branch `feature/phase-1-security-core-ledger`, merged into `main` at
   `d3bad52` on 2026-09-05). Households/members model, RLS policies,
   Parent/Child role enforcement, add expense, record payment, derived
   balances, transaction history, audit trail, and the Stage 2 UI (Parent/
   Child dashboards, Add Expense, Record Payment/Adjustment + Void,
   History). Gate satisfied: every Child privilege-escalation negative test
   passed (`ARCHITECTURE.md` §24, §29). Depends on Phase 0.

3. **Phase 2 — Payment plans** — status: `done` — analysis: analysis/02-phase-2-payment-plans.md
   Tracking doc: `docs/proposals/phase-2-payment-plans/PROGRESS.md` (branch
   `feature/phase-2-payment-plans`, merged into `main` at `03afa6f` on
   2026-09-05). Monthly payment-plan model, payment periods, upcoming/due/
   partial/satisfied/overdue status calculations, Parent management UI,
   Child progress UI. The payment-to-period allocation rule is documented in
   code (`payment_period_status`) and covered by a mutation-proofed pgTAP
   suite. Gate satisfied: every Child privilege-escalation negative test
   passed. Depends on Phase 1 (satisfied).

4. **Phase 3 — PWA** — status: `done` — analysis: analysis/03-phase-3-pwa.md
   Tracking doc: `docs/proposals/phase-3-pwa/PROGRESS.md` (branch
   `feature/phase-3-pwa`, merged into `main` at `fef4055` on 2026-09-06).
   Web app manifest with a stable `id`, a generated placeholder icon set,
   standalone display mode, an `injectManifest` service worker with
   conservative caching (no ledger-API caching, ADR-007), mobile install
   onboarding (platform-conditional: Android's `beforeinstallprompt` vs.
   iOS's manual Add to Home Screen). Real-device install confirmed on both
   a physical Android phone and iPhone via `vite-plugin-mkcert` over LAN
   HTTPS, not a production deploy (user-confirmed — see the analysis file).
   Depends on Phase 1 (satisfied).

5. **Phase 4 — Push technical spike** — status: `in progress` — analysis: analysis/05-phase-4-push-spike.md
   VAPID key generation, `push_subscriptions` storage, a test Edge Function
   proving encrypted payload delivery, and physical validation on both an
   Android browser and an installed iPhone PWA. Explicitly a spike: prove
   end-to-end delivery on both platforms **before** building any notification
   UI (`ARCHITECTURE.md` §12.4). Depends on Phase 3 (satisfied).

   Research done and user-confirmed 2026-09-07: library choice resolved to
   `@block65/webcrypto-web-push` (actively maintained, explicit Deno
   support, RFC 8291/8292-compliant, Apple-compatible) — see the analysis
   file for the comparison against three rejected alternatives.
   Real-device validation reuses Phase 3's existing mkcert LAN setup;
   confirmed with the user that this phase's migration does *not* trigger
   the project's first production deploy — stays on the local Docker
   stack. One open question remains for a design spec before
   implementation: the `push_subscriptions` RLS/visibility shape (finding
   3). **Still requires physical Android + iPhone hardware to actually
   close out** — implementation can start without the devices in hand, but
   the phase can't be marked done without real-device validation.

   **Update 2026-09-29:** all implementation work is done. Real-device
   testing found and fixed a genuine bug (notifications were silently
   never shown — see `docs/proposals/phase-4-push-spike/PROGRESS.md`) and
   confirmed the feature works end-to-end on a real Android phone. Still
   open: an iPhone check (the only iPhone on hand is locked to an old,
   unknown account — a hardware problem, unrelated to this project) and
   one more automated check (confirming a dead/removed subscription is
   reported clearly). Decision: pause here and finish both after a
   production deploy, since a real hosted address sidesteps most of the
   local-testing friction hit this session (see the PROGRESS.md session
   log for detail). Phase 4 is not yet marked done.

   **Update 2026-10-01:** the app is now deployed (see root `PROGRESS.md`
   and `docs/DEPLOYMENT_RUNBOOK.md`). The remaining Phase 4 checks (iPhone,
   dead-subscription status) can now be run against the live site. Phase 4
   is still not marked done.

6. **Phase 5 — Reminder system** — status: `idea` — analysis: analysis/10-account-management.md
   Configurable reminder rules, scheduled processor (pg_cron → Edge
   Function), idempotent `notification_events` keyed to prevent duplicate
   sends, manual Parent reminder, dead-subscription cleanup. Depends on the
   Phase 4 spike succeeding — do not scaffold this before that result is in.

7. **Phase 6 — Administration and polish** — status: `in progress` — analysis: analysis/07-phase-6-admin-and-polish.md
   Categories and quick-add presets, CSV + full JSON export/backup, member
   management, notification preferences, transaction filtering, and an
   accessibility/performance review against `PROJECT_REQUIREMENTS.md` §17.
   Several of these are independently shippable and need not wait for each
   other. Depends on Phase 1 at minimum.

   Scoped down to the export/backup slice first (an explicit
   `PROJECT_REQUIREMENTS.md` §20 acceptance criterion, schema-ready, no
   physical-device dependency) — see the analysis file. Tracking doc:
   `docs/proposals/phase-6-admin-polish/PROGRESS.md` (branch
   `feature/phase-6-admin-polish`); that file is the source of truth for
   task-level status. **Done and merged into `main`.**

   Member management picked up next as its own slice (branch
   `feature/phase-6-member-management`) — turned out to require the
   project's first Edge Function, since there's currently no way for a
   Parent-created member to get real login credentials at all. Design spec
   signed off 2026-09-06. **Done and merged into `main`** (fast-forward,
   2026-09-06). Tracking doc:
   `docs/proposals/phase-6-member-management/PROGRESS.md` has full
   task-level detail.

   Transaction filtering picked up next as its own slice (branch
   `feature/phase-6-transaction-filtering`), per the user's 2026-09-06
   choice among the remaining sub-pieces. No design spec needed — fully
   determined by the existing schema and `HistoryPage`/`useHistory`.
   **Done and merged into `main`** — see
   `docs/proposals/phase-6-transaction-filtering/PROGRESS.md` for
   task-level detail.

   Categories & quick-add presets picked up next as its own slice (branch
   `feature/phase-6-categories-presets`), per the user's 2026-09-06 choice
   among the remaining sub-pieces. No design spec needed — fully determined
   by `PROJECT_REQUIREMENTS.md` §8/§18 and the member-management CRUD
   convention. `categories` already existed with Parent-only RLS (just no
   UI); `expense_presets` was new — schema/RLS routed through the verifier
   agent (pass on all criteria). **Done and merged into `main`**
   (fast-forward, `0677f10..ee8bdd5`) — see
   `docs/proposals/phase-6-categories-presets/PROGRESS.md` for task-level
   detail.

   Accessibility review picked up next as its own slice (branch
   `feature/phase-6-accessibility-review`), per the user's 2026-09-06
   choice after notification preferences turned out to be blocked (see
   below). No design spec needed — an orchestrator-run audit against
   `PROJECT_REQUIREMENTS.md` §17 found six of eight checklist items
   already fully compliant; the other two (a contrast token used ~56
   places, and three small unrelated one-file gaps: touch targets on two
   persistent buttons, a missing reduced-motion guard, a heading-level
   skip) were fixed as two default-verification-tier tasks. **Done and
   merged into `main`** (fast-forward, `3c0fab8..1189b36`) — see
   `docs/proposals/phase-6-accessibility-review/PROGRESS.md` for
   task-level detail.

   The remaining sub-piece, **notification preferences, is blocked**, not
   merely unpicked: `PROJECT_REQUIREMENTS.md` §9.2 defines it entirely in
   terms of push subscriptions, device-level opt-in, and notification-event
   dedup — all Phase 4/5 infrastructure. Phase 4 (item 5 below, the push
   spike) hasn't started, and Phase 5 (item 6) explicitly says not to
   scaffold before Phase 4's result is in. Don't pick this sub-piece again
   until Phase 4 lands.

8. **Split the Supabase client out of the main bundle** — status: `deferred` — analysis: analysis/08-split-supabase-client.md
   Investigated 2026-09-05: the original justification cited
   `PROJECT_REQUIREMENTS.md` §17, which is actually Accessibility, not
   performance. Route-level splitting wouldn't meaningfully shrink the
   critical path anyway, since almost every route (including sign-in)
   needs `@supabase/supabase-js`, which dominates the bundle. The one real
   lever (a `manualChunks` vendor split for update-caching) is a marginal
   win with no observed problem behind it, in tension with
   `ARCHITECTURE.md` §27's "don't optimize without an observed need."
   Confirmed with the user as low value for this app — deferred, not
   deleted. Revisit only on a real signal: reported slow loads, a measured
   perf regression, or substantial further bundle growth.

9. **Component-test tooling for the auth and UI layer** — status: `done` — analysis: analysis/09-component-test-tooling.md
   Tracking: root `PROGRESS.md` Post-Launch table (branch
   `feature/component-test-tooling`, merged into `main`). Scoped narrowly to the auth/session
   layer (`SessionProvider`, `MembershipProvider`, `RequireRole`,
   `SignInForm`) after a user check-in — see the analysis file for why page
   components are explicitly out of scope.
   `npm run test` covers only the pure `currency`/`dates` modules; there is
   no jsdom or testing-library in `devDependencies`, so nothing guards the
   sign-in flow or session persistence that Phase 0 T4 built — both were
   verified once, by hand, and have no regression net. `ARCHITECTURE.md`
   §24 puts database/security tests first and that ordering is right, so
   this is deliberately *not* a blocker for Phase 1. Revisit once Phase 1's
   RLS suite is in place and there is real UI worth pinning down. Keep
   `npm run test` Docker-free.

10. **Account management: change own password, Parent-managed accounts** — status: `done` — analysis: analysis/10-account-management.md
    Requested by the owner 2026-10-01, right after first deploy. Today a
    signed-in person cannot change their own password, and a Parent cannot
    reset anyone's password, change a member's role, change a login email,
    or fully disable/remove a login (Manage Members only does add, rename,
    archive, restore — `docs/proposals/phase-6-member-management/DESIGN_SPEC.md`
    deferred role changes and password reset as non-goals). ADR-010 already
    commits to Parent-assisted reset (no email provider), so the Parent
    reset path is part of the intended design, not new scope. Needs a design
    spec because it touches Auth Admin API (a second Edge Function) and the
    rule that archived members must not be able to sign in.

    Tracking doc: `docs/proposals/account-management/PROGRESS.md` (branch
    `feature/account-management`). All seven tasks done and verified locally;
    merged into `main`. Not yet on `production`: the owner must first run the
    hosted steps in `docs/DEPLOYMENT_RUNBOOK.md` section 7a.

11. **UI redesign** — status: `done` — analysis: analysis/11-ui-redesign.md
    Requested by the owner 2026-10-02: the interface looks hastily assembled and
    leads with install/notification prompts. A research agent produced an
    approved design and mockups; the owner answered all open questions.
    Front-end only (no migrations, RLS or Edge Function changes). Ten small
    phases, each shippable alone, starting with UI1 (move install and
    notification prompts into Settings, fix the menu).
    Plan and tracking: `docs/proposals/ui-redesign/IMPLEMENTATION_PLAN.md`,
    `docs/proposals/ui-redesign/PROGRESS.md`. Branches `feature/ui-redesign-pN-*`.
    The manual "Remind" button is deliberately out of scope until push is
    confirmed on real devices and Phase 5 exists.

12. **Home improvements and payment-period rule fix** — status: `done` (production a24651e; migration 20261003090000 confirmed applied on the hosted project 2026-10-03) — analysis: none (small; owner-chosen 2026-10-03)
    Tracking: `docs/proposals/home-improvements/PROGRESS.md`. Payments now
    count toward the period month they fall in (migration
    `20261003090000`, needs `npx supabase db push --linked` by the owner when
    promoted); Parent/Child Home tidy. Items 13-15 are follow-ups it found.

13. **Record payment confirmation ignores a backdated payment's month** — status: `done` (live, production 572a80a) — analysis: analysis/13-payment-confirmation-backdated-month.md
    Tracking: `docs/proposals/period-fixes/PROGRESS.md` (task PF2).
    After recording a payment, the confirmation always shows the effect on
    the *current* payment period, even when the payment's date falls in an
    earlier month (`src/pages/RecordPaymentPage.tsx`, period-effect block
    around the `payment_period_status` call). Found 2026-10-03 during H1.
    Display only; the stored payment and balances are correct.

14. **A payment can count toward two plans when a plan is replaced mid-month** — status: `deferred` — analysis: analysis/14-payment-counted-twice-on-plan-swap.md
    Deferred 2026-10-03 with the owner: no screen shows an inactive plan's
    periods, so the double count is invisible today. Revisit if one ever does.
    `payment_period_status` stops overlap within one plan, but ignores a
    plan's `ends_on`. If a child's plan is replaced partway through a month,
    one payment can count toward the old plan's last period and the new
    plan's first. Affects old-plan history only; Home uses the current plan.
    Verifier finding on H1, 2026-10-03.

15. **Plans starting on the 29th-31st get a due date before the period starts** — status: `live (production 572a80a); owner to run db push for migration 20261003120000` — analysis: analysis/15-due-date-before-period-start.md
    Tracking: `docs/proposals/period-fixes/PROGRESS.md` (task PF1). Wider than
    first noted: any plan whose start day is after its due day.
    `ensure_current_payment_period` puts the due date on `due_day` of the
    period-start month, so a plan starting Jan 31 with due day 15 has a
    period starting Jan 31 that was "due" Jan 15 and reads overdue
    immediately. Pre-existing; spotted during H1, 2026-10-03. Also worth a
    test: calling `payment_period_status` for another household's period
    returns zero rows (currently covered by reasoning, not by a test).

16. **Separate balances by category, with payment splitting** — status: `in progress` (design spec awaiting owner sign-off) — analysis: analysis/16-category-balances.md
    Requested by the owner 2026-10-03: keep a child's debts separate (e.g. a
    car with a $300/month minimum and $1,000 of college) and choose how each
    payment is divided between them. Owner decisions: allocate to category
    balances (not individual expenses), per-balance monthly minimums,
    suggested split the Parent can adjust, Child may suggest a split for a
    Parent to confirm. Reverses `PROJECT_REQUIREMENTS.md` §3's "complex debt
    allocation" non-goal in a limited form. Touches the money core: design
    spec first. Branch `feature/category-balances`; spec at
    `docs/proposals/category-balances/DESIGN_SPEC.md`.
