# Analysis: Phase 0 — Technical Foundations

Status: finalized 2026-09-04, after user check-in. This is the analysis
required by `BACKLOG.md` before Phase 0 moves to an implementation plan —
it scrutinizes the stack choices `docs/ARCHITECTURE.md` proposes rather
than transcribing them, and records the decisions that came out of that
scrutiny plus the user's own direction.

## Is Phase 0 worth doing as scoped?

Yes, and it isn't really optional: every later phase's task packets need a
`package.json` with real test/build/typecheck scripts to have anything
concrete in their `verification_commands`, and every later task packet's
`read_paths`/`write_paths` inference needs `src/` and `supabase/` to
actually exist on disk. Phase 0 is infrastructure for the rest of the
framework, not just the app.

## Findings

### 1. UI library — Tailwind CSS + Radix UI, not Material UI

`ARCHITECTURE.md` originally specified Material UI. Challenged because a
full component framework's design language pulls toward "admin dashboard,"
working against §11.1's "tiny purpose-built utility" goal, and it's a
heavier dependency than an app this size needs. Material UI does buy real,
tested accessibility compliance for free, which is the honest case for
keeping it — §17 has real requirements (keyboard access, labels, contrast,
touch targets, reduced motion).

**Decision (user-confirmed):** Tailwind CSS + Radix UI primitives. Radix
supplies the same accessibility groundwork (focus management, ARIA,
keyboard interaction) for the interactive primitives that need it —
dialogs, popovers, tabs, switches — without imposing Material's visual
language, and composes naturally with Tailwind for everything else.
Recorded as `docs/ARCHITECTURE.md` ADR-008.

### 2. Auth method — email/password, not magic link/OTP

Magic link/OTP looks like better phone UX (nothing to forget), but depends
on reliable outbound email. Supabase's built-in SMTP is rate-limited and
explicitly not meant for production; making magic link reliable would need
a transactional email provider, which cost guardrail #4 says to avoid
absent an actual need.

**Decision (user-confirmed):** Email/password, Parent-created accounts.
The user's own observation — household browsers save credentials, so
forgetting isn't the real-world risk it looks like on paper — removes the
main practical objection. **Accepted, explicitly recorded** consequence:
self-service password reset shares the same SMTP dependency, so it isn't
reliable either; reset is Parent-assisted (an admin action) rather than an
email flow that would fail silently. Recorded as ADR-010.

### 3. Service worker generation strategy — decide now, not at Phase 4

Not something the original spec called out as a Phase 0 decision, but it
is one: `vite-plugin-pwa`'s default `generateSW` mode can't host a custom
`push` handler or a notification-click deep-link, both hard requirements
(§12, §14). Discovering this during the Phase 4 push spike would mean
reworking an already-built service worker. **Decision:** adopt
`injectManifest` mode from the first PWA setup task in Phase 0/3, not
deferred. Recorded in `ARCHITECTURE.md` §14.

### 4. Cloudflare Pages preview deployments are a real exposure, not a nitpick

Flagged independently, then confirmed by the user's own stated preference:
"good practice to not just be pushing every single change into a publicly
available web application." Cloudflare Pages' *default* behavior builds a
public `*.pages.dev` URL for every push to a non-production branch —
meaning every routine feature→`main` merge would otherwise publish a live
preview of a private household ledger. The user's assessment is that the
data itself (names, dollar amounts) isn't highly sensitive, so this isn't
a severe risk — but it's still an unforced exposure with a free fix.

**Decision (user-confirmed):** disable Cloudflare Pages preview
deployments (or restrict them to the `production` branch, which never
receives a routine merge). Review pre-production changes locally via
`vite preview` / `wrangler pages dev` instead. Recorded as ADR-009 and in
`docs/SUPERVISOR_RUNBOOK.md`'s Cloudflare Pages setup section.

### 5. Local vs. hosted track

Originally flagged as a scoping question — Phase 0 mixes work that needs
nothing but this machine (app skeleton, local Supabase via Docker,
migrations, auth PoC) with work that needs external accounts (hosted
Supabase project, Cloudflare Pages project). As of this check-in, the
Supabase project and the GitHub repo both already exist (provisioned by
the user outside this session); only the Cloudflare Pages connection is
still outstanding, and it requires a GitHub OAuth-style authorization in
the Cloudflare dashboard — not something drivable non-interactively.
**Decision:** keep the local/hosted split in `BACKLOG.md`'s Phase 0 entry.
The local track can proceed now in full; the hosted-deployment task
(Cloudflare Pages connection) stays blocked until a human completes the
one-time dashboard step documented in `docs/SUPERVISOR_RUNBOOK.md`.

## Not reconsidered

TanStack Query, React Hook Form, Zod, React Router, Vite, and Supabase
itself were all checked against the same "is this actually warranted at
this scale" question and held up — in particular, TanStack Query's
mutation-state handling is what ADR-007's "no offline write queue, show a
retry/error state instead" actually needs, not caching a household's tiny
data volume. No changes there.

## Outcome

Phase 0 is ready to move to an implementation plan. `docs/ARCHITECTURE.md`
and `CLAUDE.md` have been updated to reflect ADR-008/009/010 and the
now-live Supabase project/GitHub repo so a fresh session or subagent reads
current decisions, not stale open questions.
