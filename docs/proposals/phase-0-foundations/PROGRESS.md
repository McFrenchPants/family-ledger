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
| T2 | Vitest scaffold + currency/dates unit tests | done | Verifier: PASS. 146 tests. Two minor findings fixed by orchestrator (see log). |
| T3 | Supabase local project + first migration | done | Verifier: PASS on all 6 criteria, verified live against the DB. Two genuine gaps found — see T3a. |
| T4 | Auth proof of concept | todo | Depends on T1, T3. Auth floor trigger — verifier required. |
| T5 | Local dev seed data | done | Verifier: PASS. Idempotent across resets (identical md5), no auth.users rows. |
| T3a | Close two integrity gaps the T3 verifier found | done | Verifier: PASS. Validation survived a real search_path hijack attempt. |
| T6 | Wrangler config + SPA fallback for Cloudflare | todo | Added after T1. See note below — the app cannot deploy correctly without it. |
| T7 | Database invariant regression tests | todo | **Do before Phase 1 policies.** Nothing in CI currently re-checks the unique index or timezone trigger. |

## Session log

_Newest entries on top._

### 2026-09-04 — T3a + T5 verified (pass); T7 opened

Verifier returned **pass** on both. It probed attack paths the brief did not
name, and two results are worth recording:

- **The timezone validator resists search_path hijacking.** As
  `authenticated` with `search_path = 'evil, public'` it still rejected bad
  zones; then, as superuser, the verifier created a real
  `evil.pg_timezone_names` view returning `'Not/AReal_Zone'` and put `evil`
  first — still rejected. `pg_catalog` cannot be shadowed at all (the `pg_`
  prefix is reserved). It also confirmed application roles cannot disable
  the trigger: they hold no `CREATE` on `public`, and both tables and the
  function are owned by `postgres`.
- **The unique index blocks escalation via UPDATE, not just INSERT** —
  repointing a second existing member row at an already-linked user is
  rejected. Same user in a *different* household is still allowed, so the
  index is correctly scoped rather than over-broad.

Timezone edge cases all resolve strictly in the right direction. Notably
`'localtime'` is rejected — that is the server-local alias the standing rule
forbids, and the most important of the edge cases. `'EST5EDT'` is accepted,
which is fine: it is a real legacy IANA zone that does observe DST, so it
cannot mis-date.

**New task T7, from the verifier's second finding.** Neither invariant has a
committed regression test — the only thing proving them is ad hoc SQL that
will not run in CI. `CLAUDE.md`'s Testing section explicitly calls for
database/security tests with negative cases, and Phase 1 is about to layer
RLS policies directly on top of these two guarantees. If the unique index or
the trigger were dropped, nothing would currently catch it. This should land
**before** Phase 1's policy work, not after.

Also carried forward to Phase 1: `households.timezone` must be a picker
sourced from `pg_timezone_names`, never a free-text field. Validation is
deliberately case-sensitive (canonical storage), so plausible input like
`'america/chicago'` raises a raw `check_violation` — acceptable in the
database, unacceptable as a user-facing experience.

### 2026-09-04 — T2 verified (pass), two findings fixed

Verifier returned **pass**. It did not take the module's comments on trust:
it enumerated every amount from 1 to 200,000 cents, kept the 9,171 values
where naive float multiplication drifts, excluded the seven already in the
test file, and confirmed every one parses to the exact cent. It also
mutation-tested by copying the modules to a scratchpad and running the
project's own unmodified tests against a deliberately broken parser (14
failures) and a timezone-stripped formatter (13 failures) — so the suite
demonstrably fails when the thing it protects is broken. Date tests pass
under six hostile host `TZ` values including two half-hour offsets.

Two minor findings, both fixed by the orchestrator:

1. **A comment asserted a guarantee the code does not have.** The
   `formatCents` non-Intl-V3 fallback claimed `Number(decimalString)` is safe
   "because the nearest double to a 2-decimal value always formats back to
   that same value" and that `MAX_SAFE_CENTS` bounds it. Confirmed false:
   `90071992547409.91` formats as `...409.90` via the float path — the cap is
   exactly where the claim breaks, not what rescues it. Display-only and
   unreachable for a household ledger, but a money module should not carry a
   false guarantee in a comment. Rewritten to state the real, bounded
   behavior with the measured counterexample.
2. **`parsePositiveMoney` returned `malformed` for a well-formed negative.**
   A caller switching on `code` could not tell "you typed gibberish" from
   "negatives aren't allowed here". Added a distinct `negative_not_allowed`
   code plus a test asserting the two do not collapse. Still documented as a
   UX affordance, never an authorization control — that remains RLS's job.

### 2026-09-04 — T3 verified (pass), T3a opened

Verifier returned **pass** on all six acceptance criteria, checked live
against the running database rather than read off the SQL. Notably it
confirmed the attribution invariant empirically: it created an `auth.users`
row, linked a member, deleted the user, and confirmed the member row
survived with name and role intact and only `user_id` nulled. It also
confirmed default-deny is real, not nominal — as both `anon` and
`authenticated`, selects returned 0 rows and writes were refused.

One thing it checked that is worth recording so nobody re-investigates it:
`anon`/`authenticated` DO hold DML grants on these tables, but those come
from Supabase's stock `pg_default_acl` defaults, not from this migration.
Default-deny therefore rests entirely on RLS — which is the normal Supabase
posture, and it is working. Related: RLS is enabled but not `FORCE`d, so the
table owner bypasses it. That matters later — security-definer functions run
as owner and will bypass RLS by design.

**Two genuine gaps found, now T3a.** Both were demonstrated with real
inserts, not inferred:
1. The same `auth.users` id can be inserted twice into one household as two
   members with *conflicting roles* (one `parent`, one `child`). Phase 1's
   policies will resolve a caller's role by membership lookup, so this is a
   privilege-escalation ambiguity waiting to happen. Most consequential of
   the findings; fix before policies are written on top of it.
2. `households.timezone` accepts any string — `'Not/AReal_Zone'` inserts
   fine. Since the household zone drives every today/due/overdue
   computation, a bad value doesn't fail at write time, it silently
   mis-dates financial obligations later.

Deferred as reasonable: `status='archived'` with null `archived_at`, and
empty-string `name`. Both recoverable and genuinely later-phase concerns.

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
