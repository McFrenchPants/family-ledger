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

2. **Phase 1 — Security and core ledger** — status: `ready` — analysis: analysis/01-phase-1-security-core-ledger.md
   Households/members model, RLS policies, Parent/Child role enforcement,
   add expense, record payment, derived balances, transaction history,
   audit trail. Gate: **do not proceed past this phase until every Child
   privilege-escalation negative test passes** (`ARCHITECTURE.md` §24, §29).
   Depends on Phase 0.

3. **Phase 2 — Payment plans** — status: `ready` — analysis: not yet written
   Monthly payment-plan model, payment periods, upcoming/due/partial/
   satisfied/overdue status calculations, Parent management UI, Child
   progress UI. The payment-to-period allocation rule must be documented in
   code and covered by tests (`PROJECT_REQUIREMENTS.md` §7.3). Depends on
   Phase 1.

4. **Phase 3 — PWA** — status: `ready` — analysis: not yet written
   Web app manifest with a stable `id`, icons and Apple touch icon,
   standalone display mode, service worker with conservative caching, mobile
   install onboarding. No offline write queue (ADR-007). Depends on Phase 1;
   independent of Phase 2 and could run in parallel with it.

5. **Phase 4 — Push technical spike** — status: `needs research` — analysis: not yet written
   VAPID key generation, `push_subscriptions` storage, a test Edge Function
   proving encrypted payload delivery, and physical validation on both an
   Android browser and an installed iPhone PWA. Explicitly a spike: prove
   end-to-end delivery on both platforms **before** building any notification
   UI (`ARCHITECTURE.md` §12.4). Open question: which Deno-compatible Web
   Push implementation actually works in Supabase Edge Functions. Requires
   real devices. Depends on Phase 3.

6. **Phase 5 — Reminder system** — status: `idea` — analysis: not yet written
   Configurable reminder rules, scheduled processor (pg_cron → Edge
   Function), idempotent `notification_events` keyed to prevent duplicate
   sends, manual Parent reminder, dead-subscription cleanup. Depends on the
   Phase 4 spike succeeding — do not scaffold this before that result is in.

7. **Phase 6 — Administration and polish** — status: `idea` — analysis: not yet written
   Categories and quick-add presets, CSV + full JSON export/backup, member
   management, notification preferences, transaction filtering, and an
   accessibility/performance review against `PROJECT_REQUIREMENTS.md` §17.
   Several of these are independently shippable and need not wait for each
   other. Depends on Phase 1 at minimum.

8. **Split the Supabase client out of the main bundle** — status: `idea` — analysis: not yet written
   Adding `@supabase/supabase-js` in Phase 0 T4 took the built bundle from
   ~60 kB to 451 kB (132 kB gzip), all in a single chunk. This is a
   phone-first PWA on possibly-poor connections, and
   `PROJECT_REQUIREMENTS.md` §17 sets performance expectations, so a
   route-level code-split or a Vite `manualChunks` decision is owed before
   anything ships. Not urgent — it is a build-config change, not a
   rewrite — but it gets worse to retrofit the more feature code piles on
   top. Independent of the phase sequence; can be done any time after
   Phase 1 lands enough routes to make the split meaningful.

9. **Component-test tooling for the auth and UI layer** — status: `idea` — analysis: not yet written
   `npm run test` covers only the pure `currency`/`dates` modules; there is
   no jsdom or testing-library in `devDependencies`, so nothing guards the
   sign-in flow or session persistence that Phase 0 T4 built — both were
   verified once, by hand, and have no regression net. `ARCHITECTURE.md`
   §24 puts database/security tests first and that ordering is right, so
   this is deliberately *not* a blocker for Phase 1. Revisit once Phase 1's
   RLS suite is in place and there is real UI worth pinning down. Keep
   `npm run test` Docker-free.
