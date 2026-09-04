# Progress: Phase 0 — Technical Foundations (local track)

Branch: `feature/phase-0-foundations` (off `main`).

## Legend

| Status | Meaning |
| --- | --- |
| `todo` | Not started. |
| `in-progress` | Actively being worked. |
| `blocked` | Waiting on a decision, credential, device, or upstream task. |
| `done` | Complete and verified. |

## Tasks

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T1 | App skeleton (Vite/React/TS/Tailwind/Radix/Router/tooling) | done | Verified independently: typecheck/lint/build all pass. Orchestrator added a `no-restricted-properties` guard so `Number.parseFloat` can't bypass the existing `parseFloat` one. |
| T2 | Vitest scaffold + currency/dates unit tests | todo | Depends on T1. |
| T3 | Supabase local project + first migration | in-progress | Runs parallel to T1 (touches only supabase/). RLS floor trigger — verifier required. |
| T4 | Auth proof of concept | todo | Depends on T1, T3. Auth floor trigger — verifier required. |
| T5 | Local dev seed data | todo | Depends on T3. |
| T6 | Wrangler config + SPA fallback for Cloudflare | todo | Added after T1. See note below — the app cannot deploy correctly without it. |

## Session log

_Newest entries on top._

### 2026-09-04 — T1 done; T6 added

T1 verified independently (typecheck, lint, build re-run by the orchestrator,
not taken on trust). Radix `Switch` used for the example component with no
keyboard/ARIA overrides; Tailwind tokens deliberately minimal, including a
`touch: 2.75rem` one-handed tap-target token.

**New task T6, found while reviewing T1.** The router uses
`createBrowserRouter`, so a direct hit on `/parent` needs an SPA fallback
(all unmatched paths → `index.html`). Vite's preview server does this
automatically, which is why T1's route check passed locally — production on
Cloudflare will 404 without explicit configuration. Separately, Cloudflare's
current Git integration deploys via `npx wrangler deploy` and takes the
static-assets directory from a `wrangler` config file in the repo, which
doesn't exist yet. Both are needed before the hosted track can produce a
working deployment, and neither was in T1's scope.

### 2026-09-04 — Plan created

Branched from `main`. No `DESIGN_SPEC.md` — Phase 0 treated as the "small"
tier per `/continue-development`'s sizing rule; the open questions were
already resolved in `analysis/00-phase-0-foundations.md`. Hosted track
(Cloudflare Pages) is done — user connected the repo and set the
production branch to `production` directly in the Cloudflare dashboard.
