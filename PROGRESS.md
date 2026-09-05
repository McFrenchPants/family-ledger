# Family Ledger — Progress

Root progress tracker. Phased work gets its own
`docs/proposals/<slug>/PROGRESS.md`; the Post-Launch table below is for
lightweight work that never warranted a full proposal folder.

Owned by the orchestrator — the implementer role may never write to it (see
`.sdlc/project.yaml`'s `always_forbidden_paths`).

## Legend

| Status | Meaning |
| --- | --- |
| `todo` | Not started. |
| `in-progress` | Actively being worked. |
| `blocked` | Waiting on a decision, credential, device, or upstream task. |
| `done` | Complete and verified. |

## Post-Launch / unphased work

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| 9 | Component-test tooling for the auth/session layer | done | Branch `feature/component-test-tooling`, merged to `main`. |

## Session log

_Newest entries on top._

### 2026-09-05 — Item 9 done: component-test tooling for the auth layer

Default verification tier (no RLS/monetary/audit-log/push/export changes,
so outside the verifier-agent floor/widen list) — spot-checked the diff
directly and independently re-ran `npm run typecheck`/`lint`/`test` rather
than taking the implementer's report on faith.

**What landed.** `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`,
`@testing-library/user-event` added as devDependencies. `vitest.config.ts`
gained one `setupFiles` entry (`src/test/setup.ts`, registering jest-dom's
matchers via the `/vitest` subpath and calling `cleanup()` after each test)
— the global `environment: "node"` default was left untouched, per the
existing docblock convention; each new test file opts into
`// @vitest-environment jsdom` individually. Confirmed both kinds of test
run correctly in the same `vitest run` (pure-logic tests stay ms-fast under
`node`; the four new files run under `jsdom`).

Four new test files, one per component, exactly the scope agreed with the
user ahead of time (see `analysis/09-component-test-tooling.md`) — the
auth/session layer only, not the already-hand-verified page components:
`SessionProvider.test.tsx` (4 tests: initial `getSession` resolution,
`onAuthStateChange` updates, unsubscribe on unmount), `MembershipProvider.test.tsx`
(7 tests: signed-out short-circuit, successful row mapping, no-membership,
query error + working `retry()`, re-fetch on user-id change, the defensive
invalid-role/status branch), `RequireRole.test.tsx` (7 tests: all five
`MembershipState` branches including both directions of the wrong-role
cross-redirect), `SignInForm.test.tsx` (6 tests: typing, submit payload,
success clears password, `signInError` surfaced as an alert, thrown/network
error surfaced as a fallback message, submit button disabled while
submitting). The Supabase client is mocked per-file with `vi.mock`, not
MSW, per the agreed scope. No bugs found in any of the four components; no
source changes to them.

Verified: `npm run typecheck` clean, `npm run lint` clean, `npm run test`
209/209 (185 pre-existing + 24 new), `npm run build` unaffected.

Per this project's `full` release mode, dispatching a `supervisor` agent
next to merge `feature/component-test-tooling` into `main` and push — the
routine feature→integration-branch merge tier, standing-authorized once a
task is done and verified.

### 2026-09-04 — Phase 0 complete (T4 auth PoC verified)

T4, the last remaining Phase 0 task, is done and verifier-passed. The local
track's eight tasks (T1–T7 plus T3a) are all complete; the hosted track was
already done. Detail lives in
`docs/proposals/phase-0-foundations/PROGRESS.md` — this entry is the summary.

Supabase Auth email/password sign-in works end to end against the local stack
and the session survives a reload, proven two independent ways (a real browser
driven through the DOM, and a headless reconstruction of the client that showed
a fresh client recovering the persisted session). Nothing has been confirmed by
human eyes in a rendered browser yet — worth one manual pass before Phase 1.

Deliberately not built: any route guard. Session state is display state; the
authorization boundary is Phase 1's RLS, per the standing rule that the browser
is untrusted.

Two new backlog items came out of this, both `idea`, neither blocking Phase 1:
**8** (split the 451 kB single-chunk bundle that `@supabase/supabase-js`
created) and **9** (component-test tooling — the auth code has no regression
net, since `npm run test` still covers only the pure currency/dates modules).

**Merged.** `feature/phase-0-foundations` fast-forwarded into `main` at
`ae5d2fe` and pushed to `origin` (`git merge --ff-only` + `git push origin
main`). The feature branch still exists at the same SHA; it was not deleted.
HEAD is now on `main`. Phase 1 should branch fresh off `main`.

`production` is still at the framework-init commit `5ce9c38` and far behind
`main`. Cloudflare's production branch is `production`, so this push did not
trigger a deploy — nothing has ever been deployed. Promoting it needs an
explicit go-ahead and an approval record; nothing here authorizes that.

### 2026-09-04 — Strategy clarified; infrastructure provisioned; Phase 0 analysis finalized

User provisioned real infrastructure outside this session: a GitHub repo
([McFrenchPants/family-ledger](https://github.com/McFrenchPants/family-ledger)),
a Supabase project (`fsszkclgeekdyyspgrhg`), the Supabase MCP server
(`.mcp.json`) and the official `supabase` / `supabase-postgres-best-practices`
agent skills (`.agents/skills/`, tracked by `skills-lock.json`). Cloudflare
account exists but the Pages project is not yet connected.

Resolved three open questions from the Phase 0 analysis check-in, each
now recorded as an ADR in `docs/ARCHITECTURE.md`:

- **UI library:** Tailwind CSS + Radix UI, not Material UI (ADR-008).
- **Cloudflare Pages preview deployments:** disabled/restricted to
  `production` only; local `vite preview`/`wrangler pages dev` instead
  (ADR-009). Confirmed by the user's own stated preference against
  publishing every change.
- **Auth:** email/password, Parent-created accounts, Parent-assisted
  password reset (ADR-010) — already the working assumption, now formally
  confirmed and the SMTP-dependency reasoning recorded.

Also decided, not from a user check-in but from re-examining the spec: the
PWA service worker must use `vite-plugin-pwa`'s `injectManifest` mode from
the start, not the default `generateSW` — the default can't host the
custom push handler §12/§14 require, and discovering that at the Phase 4
spike would mean reworking an already-built service worker.

Updated `docs/ARCHITECTURE.md` (§6.2, §14, §20, §21, four new ADRs),
`CLAUDE.md` (stack line, provisioned-infrastructure section), `BACKLOG.md`
(Phase 0 entry split into local/hosted tracks, now points at
`analysis/00-phase-0-foundations.md`), `docs/SUPERVISOR_RUNBOOK.md`
(real Supabase CLI commands, GitHub remote, a step-by-step Cloudflare
Pages one-time setup section), and added `.env.example` and
`analysis/00-phase-0-foundations.md`.

No application code yet. Local track of Phase 0 (app skeleton, Tailwind/
Radix, local Supabase via Docker, first migration, auth PoC) is unblocked
and ready to scaffold as an implementation plan. Hosted track (Cloudflare
Pages connection) stays blocked on the one manual dashboard step described
in the runbook.

### 2026-09-04 — sdlc-supervisor framework initialized

Greenfield repo containing only `docs/PROJECT_REQUIREMENTS.md` and
`docs/ARCHITECTURE.md`. Initialized git (`main`) and scaffolded the
sdlc-supervisor framework in `full` release mode: integration branch `main`,
production branch `production`, three live systems named but not yet
existing (Supabase project, Cloudflare Pages deployment, physical phones).

Seeded `BACKLOG.md` with the seven build phases already defined by
`ARCHITECTURE.md` §29 / `PROJECT_REQUIREMENTS.md` §19 — transcribed, not
invented. No analysis files written yet; Phase 0 is the natural first pick.

Not yet done, and deliberately so: no application code, no `package.json`,
so `CLAUDE.md`'s Testing section has no real commands in it and
`docs/SUPERVISOR_RUNBOOK.md`'s live-system commands are left as TODOs rather
than guessed at.
