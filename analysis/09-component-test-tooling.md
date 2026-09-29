# Analysis: Component-test tooling for the auth/UI layer

## What problem this actually solves

`npm run test` currently exercises only pure-logic modules
(`src/lib/currency.ts`, `src/lib/dates.ts`, and the `src/features/ledger/*`
transform functions). Every React component — critically, the four pieces
that decide who is signed in and what they're allowed to see
(`SessionProvider`, `MembershipProvider`, `RequireRole`, `SignInForm`) — has
never been exercised by an automated test. Each was verified once, by hand,
against the local Docker Supabase stack during Phase 0 and Stage 2, and has
had zero coverage since.

This is a UX/display-state regression risk, not a security one.
`CLAUDE.md` and every one of these files' own doc comments are explicit:
none of this code is a security boundary — RLS and security-definer
functions in Postgres are, and a compromised or buggy client gains nothing
by tricking `RequireRole` into rendering the wrong branch. So the case for
this work is narrower than "close a security gap." It's: these four
components sit on every single route in the app, Phase 2 and Phase 3 will
add more routes built the same way, and right now nothing stops a future
edit (e.g. changing `MembershipProvider`'s dependency array, or a Supabase
SDK version bump changing `onAuthStateChange` payload shape) from silently
breaking sign-in, session restoration, or role-based redirect — and nothing
would catch it except another manual pass.

## Is it worth doing now

Yes, but narrowly. Arguments for doing it now rather than later:

- The backlog's own reasoning holds: Phase 1's RLS suite (the higher-value
  regression net, per `ARCHITECTURE.md` §24's ordering) is done, so this no
  longer competes with higher-priority work.
- Phase 2 and Phase 3 will add more forms and likely more role-gated routes.
  Establishing the pattern now (how to mock the Supabase client, how to
  render a provider tree in a test) means those phases' new components can
  reuse it cheaply. Waiting means the same investigation happens later under
  time pressure from a real regression instead of proactively.
- The cost is low: `vitest` is already the runner; `jsdom` +
  `@testing-library/react` + `@testing-library/jest-dom` +
  `@testing-library/user-event` are the standard, well-trodden pairing for
  it, not a novel tooling choice.

Arguments against doing all of it now, which shape the scope below:

- Every page component (`ParentDashboardPage`, `ChildDashboardPage`,
  `AddExpensePage`, `RecordPaymentPage`, `HistoryPage`) was already
  hand-verified live against real seeded data, including edge cases
  (sibling isolation, empty states, already-voided races). Retrofitting
  component tests for all of them in one pass is a much larger, separately
  decidable task, and the marginal regression-catching value is lower than
  the auth layer's — a page bug is visible immediately to whoever uses the
  app next; an auth-layer bug can silently gate every route at once.
  Confirmed narrow scope with the user directly rather than assuming.
- Chasing full coverage risks becoming its own multi-week testing-only
  project, in tension with `CLAUDE.md`'s "keep it small."

## Scope decided (confirmed with user)

**In scope**, one task:

- Add `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`,
  `@testing-library/user-event` as devDependencies.
- `vitest.config.ts` already anticipates this — its own comment says UI
  tests "should add their own environment via a per-file docblock"
  (`// @vitest-environment jsdom`) rather than switching the whole suite's
  default environment. Follow that existing convention; don't change the
  global `environment: "node"` default, since the pure-logic tests are
  deliberately DOM-free and should stay fast.
- Mock `src/lib/supabase.ts`'s exported `supabase` client per test file via
  `vi.mock`, not MSW. The client surface actually used by the four
  components in scope is narrow (`auth.getSession`, `auth.onAuthStateChange`,
  `auth.signInWithPassword`, and one `.from(...).select(...).eq(...).maybeSingle()`
  chain) — mocking the module directly is less setup than standing up MSW's
  request interception for a REST-ish PostgREST/GoTrue surface, and adds no
  new runtime dependency (MSW would be devDependency-only too, but the
  narrower approach is simply less machinery for the same coverage target).
  Confirmed with the user over the MSW alternative.
- Cover exactly: `SessionProvider` (initial `getSession` resolution incl.
  persisted-session restore, `onAuthStateChange` updates, unsubscribe on
  unmount), `MembershipProvider` (role/status resolution incl. the
  no-membership and unrecognized-role/status defensive branches, refetch on
  session change, `retry`), `RequireRole` (all five `MembershipState`
  branches: loading/signed-out redirect/error+retry/no-membership/loaded
  with correct-role passthrough and wrong-role cross-redirect), `SignInForm`
  (submit success clears password, `signInError` surfaces as visible text,
  a thrown/network error surfaces as visible text, `submitting` disables
  the button).

**Explicitly not in scope** for this task (left as future backlog items if
ever picked up): page-level component tests for the five route pages
listed above; visual/snapshot testing; end-to-end/browser-driven testing
(already covered ad hoc via the project's manual verification passes).

## Sizing

Small tier — one implementer task, no design spec. `IMPLEMENTATION_PLAN.md`-
style breakdown isn't warranted; tracked as a single row in root
`PROGRESS.md`'s Post-Launch table.
