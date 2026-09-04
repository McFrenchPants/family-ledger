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
