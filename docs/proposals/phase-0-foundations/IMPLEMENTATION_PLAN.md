# Implementation Plan: Phase 0 — Technical Foundations (local track)

No `DESIGN_SPEC.md` for this proposal — Phase 0 is well-understood
scaffolding with the open questions already resolved in
`analysis/00-phase-0-foundations.md` (Tailwind+Radix, email/password auth,
`injectManifest` SW mode, no offline queue). This plan is the task
breakdown that document promised.

Scope here is the **local track only** (see `BACKLOG.md`'s Phase 0 entry):
app skeleton, tooling, local Supabase via Docker, first migration, auth
PoC. The **hosted track**'s Cloudflare Pages connection is now done by the
user; linking the CLI to the real Supabase project and pushing this
migration to it is deliberately deferred — nothing here requires the
hosted Supabase project or its credentials.

Tasks are sequenced mostly serially: T1 establishes `package.json` and
config files that every later task edits alongside, and running multiple
agents against those same files concurrently in one shared working tree
risks conflicting edits. Five tasks total, matching this run's
`max_tasks_per_run` budget.

## Tasks

### T1 — App skeleton: Vite + React + TS + Tailwind + Radix + Router + tooling

**Scope:** Vite/React/TypeScript project scaffold; Tailwind CSS configured
with a small design-token theme (spacing/color/type scale per
`ARCHITECTURE.md` §5 layout); Radix UI installed with one example wrapped
primitive (e.g. a `Button` or `Dialog` in `src/components/`) to prove the
composition pattern; React Router with a minimal route table (placeholder
Parent and Child dashboard pages, per §11.2/§11.3); ESLint + Prettier +
TypeScript strict mode; `npm run dev` / `build` / `preview` / `typecheck` /
`lint` scripts in `package.json`.

**Files:** `package.json`, `vite.config.ts`, `tsconfig.json`,
`tailwind.config.*`, `postcss.config.*`, `index.html`, `src/main.tsx`,
`src/app/App.tsx`, `src/app/router.tsx`, `src/app/providers.tsx`,
`src/components/`, `src/pages/`, `.eslintrc.*`/`eslint.config.*`,
`.prettierrc*`.

**Acceptance criteria:**
- `npm install && npm run build` succeeds from a clean clone.
- `npm run dev` serves the app; placeholder Parent/Child routes render.
- `npm run typecheck` and `npm run lint` both pass with zero errors.
- Radix example component is keyboard-operable (tab to it, operate with
  Enter/Space — no mouse-only interaction), matching §17.
- No Material UI, no `@mui/*` packages anywhere in `package.json`.

**Do not touch:** `CLAUDE.md`, `BACKLOG.md`, `PROGRESS.md` (this proposal's
own `PROGRESS.md` below is fine), anything under `.sdlc/`, `docs/sdlc/`,
`supabase/`.

### T2 — Vitest unit-test scaffold + first real tests

**Scope:** Vitest configured (`npm run test`); `src/lib/currency.ts`
(decimal-string ↔ integer-cents conversion, per §16 — never floating
point) and `src/lib/dates.ts` (household-timezone-aware date helpers, per
§17/§6.4 note on IANA timezones) implemented with real unit tests, not
stubs. These are the two pure-logic modules `ARCHITECTURE.md` §5 names
explicitly and §24 calls out as needing unit coverage first.

**Files:** `vitest.config.*`, `src/lib/currency.ts`,
`src/lib/currency.test.ts`, `src/lib/dates.ts`, `src/lib/dates.test.ts`.

**Acceptance criteria:**
- `npm run test` runs and passes.
- `currency.ts` round-trips `"42.17"` → `4217` cents → back to display
  string via `Intl.NumberFormat`, and rejects/handles malformed input
  (e.g. `"12.999"`, empty string, negative-with-no-context) without ever
  using a floating-point arithmetic step on money.
- `dates.ts` has at least one test proving a date computed "for today" is
  computed relative to a supplied IANA timezone parameter, not the host
  machine's local time.

**Depends on:** T1 (needs `package.json`/build tooling in place).

### T3 — Supabase local project + first migration

**Load the `supabase` and `supabase-postgres-best-practices` skills before
starting this task** — see `.agents/skills/`, referenced from `CLAUDE.md`.

**Scope:** `supabase init` (creates `supabase/config.toml`); confirm
`supabase start` brings up local Postgres/Auth/Studio via Docker; first
migration under `supabase/migrations/` creating `households` and
`household_members` (role enum `parent`/`child`, status enum
`active`/`invited`/`archived`) per `ARCHITECTURE.md` §7/§8.1–8.2. Enable
RLS on both tables. Full policy set is Phase 1 scope — for Phase 0, RLS
enabled with no permissive policies (default-deny) is the correct and
sufficient state; do not write Phase 1's authorization policies here.

**Files:** `supabase/config.toml`, `supabase/migrations/<timestamp>_households_and_members.sql`.

**Acceptance criteria:**
- `supabase start` succeeds locally (Docker required — confirm it's
  running first).
- `supabase db reset` (or equivalent) applies the migration cleanly from
  scratch.
- `households` and `household_members` exist with the columns
  `ARCHITECTURE.md` §8.1/§8.2 specifies; `role` and `status` are
  constrained (enum or `CHECK`), not free text.
- RLS is enabled on both tables (`ALTER TABLE ... ENABLE ROW LEVEL
  SECURITY`), verified with a query against `pg_tables`/`pg_policies`
  showing `rowsecurity = true` and zero policies yet (default-deny is
  correct here, not a gap).
- Migration file is idempotent/re-runnable via the standard Supabase
  migration flow (no manual out-of-band schema edits).

**Depends on:** T1 (repo needs to exist; independent of T2's app code).

### T4 — Auth proof of concept

**Load the `supabase` skill before starting.**

**Scope:** `src/lib/supabase.ts` (browser client using
`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` from `.env`, never a
hardcoded key); a minimal sign-in page/form using Supabase Auth
email/password (per ADR-010 — no magic link) against the **local**
Supabase instance; confirm a session persists across a page reload.

**Files:** `src/lib/supabase.ts`, `src/features/auth/` (sign-in
form/hook), wiring into `src/app/router.tsx` from T1.

**Acceptance criteria:**
- Signing in with a local test user (create one via the local Supabase
  Studio or CLI as part of this task, documented in the completion
  report — not committed as a fixture with real-looking data) succeeds
  and the session survives a reload.
- The `service_role` key is never referenced anywhere in `src/`.
- Sign-in failure (wrong password) shows a clear error state, not a
  silent failure or an unhandled exception.

**Depends on:** T1, T3 (needs local Supabase Auth running with the schema
in place — Auth itself doesn't need the `households` tables, but running
`supabase start` from T3 is the simplest shared path to "local Supabase is
up").

### T5 — Local dev seed data

**Scope:** `supabase/seed.sql` matching `ARCHITECTURE.md` §22's deterministic
seed requirement, scoped to what T3's schema actually has: one household,
two Parent members, a couple of Child members. **Do not invent columns
or tables beyond T3's migration** (no ledger/payment-plan seed rows yet —
those tables don't exist until Phase 1). Use obviously-fake names, never
real family information, per §22's explicit warning.

**Files:** `supabase/seed.sql`.

**Acceptance criteria:**
- `supabase db reset` applies the migration then the seed cleanly.
- Seed data is idempotent (safe to reset repeatedly).
- No real names, emails, or identifying information — placeholder/fake
  data only.

**Depends on:** T3.

## After all five land

Orchestrator (not a subagent) updates `CLAUDE.md`'s Testing section with
the real `npm run <script>` names T1/T2 established, and records the local
Supabase workflow. This is deliberately not delegated — `CLAUDE.md` isn't
in `always_forbidden_paths` but is treated as orchestrator-owned tracking
content for this project, same as `BACKLOG.md`/`PROGRESS.md`.

### T6 — Wrangler config + SPA fallback for Cloudflare (added after T1 review)

**Scope:** A `wrangler` config file (`wrangler.jsonc` or `wrangler.toml`) at
the repo root declaring the static-assets directory (`dist`), plus SPA
fallback so unmatched paths serve `index.html` rather than 404ing.

**Why this exists:** T1's router uses `createBrowserRouter`, so a direct
navigation to `/parent` or `/child` is a real HTTP request for that path.
Vite's `preview` server applies an SPA fallback automatically — which is why
T1's route verification passed locally — but a static host does not, unless
told to. Separately, Cloudflare's current Git integration deploys with
`npx wrangler deploy` and reads the assets directory from a repo-side
wrangler config; without one, the connected Pages/Workers project has
nothing to deploy.

**Acceptance criteria:**
- A wrangler config exists declaring `dist` as the assets directory, with
  SPA/not-found handling set so unmatched routes serve `index.html` with a
  200, not a 404.
- Verified locally against a real build: `npm run build`, then serve via
  `npx wrangler dev` (or equivalent) and confirm a **direct** request to
  `/parent` and `/child` returns the app rather than a 404. Do not verify
  this with `npm run preview` — Vite's fallback masks exactly the bug this
  task exists to prevent.
- No secrets in the config file. `VITE_*` values are set in the Cloudflare
  dashboard, not committed here.

**Depends on:** T1.

**Note:** this task only makes deployment *correct*; actually deploying is
the supervisor role's job and is out of scope here.

### T7 — Database invariant regression tests (added after T3a/T5 review)

**Load the `supabase` and `supabase-postgres-best-practices` skills before
starting this task.**

**Scope:** A committed, runnable database test harness plus regression tests
for the two schema invariants T3a introduced. Use **pgTAP** via the Supabase
CLI's own `supabase test db` runner (tests live in `supabase/tests/*.sql`) —
it needs no new npm dependency and runs inside the existing local stack.
Add an `npm run test:db` script that wraps it.

**Why this exists:** T3a's two integrity fixes were verified only by ad hoc
SQL typed during a review session. Nothing in the repo re-checks them.
Phase 1's RLS policies are about to be written directly on top of both
guarantees — the policies resolve a caller's role by membership lookup
(which the partial unique index makes unambiguous) and every due/overdue
date derives from `households.timezone` (which the trigger keeps real). If
either were dropped or weakened, nothing would currently catch it.

**Files:** `supabase/tests/*.sql` (new), `package.json` (the `test:db`
script only), `supabase/config.toml` **only if** enabling pgTAP genuinely
requires it.

**`npm run test` must stay Docker-free.** The existing Vitest suite is pure
unit tests that run anywhere; do not fold the database tests into it or make
it depend on a running container. `test:db` is a separate command.

**Do not add pgTAP to a migration in `supabase/migrations/`** if it can be
avoided — a test framework should not become part of the production schema.
Prefer `create extension if not exists pgtap with schema extensions;` inside
the test file itself. If that genuinely does not work, report what you
found rather than silently adding it to a migration.

**Acceptance criteria:**

- `npm run test:db` runs against the local stack and passes, from a clean
  `npx supabase db reset`.
- Tests are self-contained: they create the rows they need and do not
  depend on `seed.sql`'s contents, and they leave the database as they
  found it (pgTAP's `begin` / `rollback` wrapper per file).
- **Partial unique index** (`household_members_household_id_user_id_key`)
  is covered by at least these cases, each asserting the *specific* failure,
  not merely "some error":
  - two members in one household with the same non-null `user_id` → rejected
    on INSERT;
  - repointing an existing second row at an already-linked `user_id` via
    UPDATE → rejected (escalation path, not just the insert path);
  - the same `user_id` in a **different** household → allowed (the index is
    scoped, not over-broad);
  - two or more rows with `user_id is null` in one household → allowed (the
    partial predicate);
  - a structural assertion that the index exists, is unique, and carries the
    `where user_id is not null` predicate.
- **Timezone validation trigger** (`households_timezone_is_valid`) is
  covered by at least: a valid zone accepted; `'Not/AReal_Zone'` rejected;
  `'localtime'` rejected (the server-local alias the standing rules forbid —
  this is the most important single case); empty string rejected; an UPDATE
  that changes `timezone` to an invalid value rejected (the trigger fires on
  update, not only insert); and a structural assertion that the trigger
  exists on `public.households` and its function is declared with an empty
  `search_path`.
- The `'america/chicago'` case (correct zone, wrong case) is asserted as
  **rejected**, with a comment recording that this is deliberate
  canonical-storage behavior and that Phase 1 must supply a picker rather
  than free text — so a future session cannot mistake it for a bug.
- Also cover the `household_members_role_check` and
  `household_members_status_check` constraints: a bogus role and a bogus
  status are each rejected. Cheap, and `role` is what every later
  authorization decision reads.
- **Mutation-proof the suite.** Demonstrate that the tests actually fail
  when the invariant they protect is removed: temporarily drop the unique
  index, run the suite, record the failures; restore; then temporarily drop
  the trigger, run, record, restore. Report the actual failure counts. A
  regression test that passes against a broken schema is worse than no test.
  Do this against a scratch/reset database and leave the repo's migration
  files untouched.

**Do not touch:** `CLAUDE.md`, `BACKLOG.md`, `PROGRESS.md`, this
`IMPLEMENTATION_PLAN.md`, anything under `.sdlc/` or `docs/`,
`supabase/migrations/**`, `supabase/seed.sql`, `src/**`.

**Depends on:** T3, T3a, T5 (all done).
