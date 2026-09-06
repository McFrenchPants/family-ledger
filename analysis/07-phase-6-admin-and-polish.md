# Analysis: Phase 6 — Administration and polish

## What this actually covers

`BACKLOG.md` item 7 bundles six independently-shippable pieces:
categories/quick-add presets, CSV+JSON export/backup, member management,
notification preferences, transaction filtering, and an accessibility/
performance review. They don't depend on each other, and per
`PROJECT_REQUIREMENTS.md` §19 they're all part of the MVP's final phase
("Administration and polish"), not future-ideas material.

## Is it worth doing now

Yes, for at least one slice of it — and that slice should be **export and
backup**, not the item as a whole. Reasoning:

- `PROJECT_REQUIREMENTS.md` §20's acceptance criteria (what "ready for
  normal family use" actually means) includes #12: "A Parent can export the
  ledger and a complete JSON backup." That's not a nice-to-have; it's a
  named MVP gate, and right now there is no way to get data out of this
  app at all. `ARCHITECTURE.md` §19 is explicit that Supabase Free "should
  not be treated as the only permanent copy of household financial
  history" — until export exists, it is exactly that.
- It doesn't require physical hardware or real-device testing (unlike the
  Phase 4 push spike, which is genuinely blocked on that). It's fully
  verifiable against the local Docker Supabase stack and the browser
  preview tool.
- It's schema-complete already: `households`, `household_members`,
  `categories`, `ledger_transactions`, `payment_plans`, `payment_periods`,
  and `audit_log` (the tables `ARCHITECTURE.md` §19 asks the JSON export to
  cover) all exist as of Phase 1/2. Nothing needs to be built first.
- Per `ARCHITECTURE.md` §11, export only needs to run server-side
  (Edge Function/`service_role`) if it can't be done safely client-side.
  A Parent already has RLS-scoped read access to every one of these tables
  for their own household (that's how the existing dashboards work), so a
  client-side export — plain PostgREST reads, assembled into CSV/JSON in
  the browser — is both sufficient and the simpler choice; no new Edge
  Function, no new secret exposure surface.

The other five pieces (categories/presets, member management, notification
preferences, transaction filtering, accessibility review) are real MVP
work too, but there's no reason they need to land together, and bundling
all six into one task risks exactly the kind of oversized, hard-to-verify
change `CLAUDE.md`'s "keep it small" warns against. They stay on the
backlog as their own future picks under this same item, tracked by
splitting this entry's status per sub-piece once export lands.

## Scope for this task

**In scope:**

- A Parent-only "Export" affordance (a page or a section of an existing
  Parent-accessible page — implementer's call, following this project's
  existing routing/RequireRole conventions) offering two actions:
  - **CSV export** of `ledger_transactions` for the household (the
    "ledger" export named in the acceptance criterion) — human-readable
    columns (date, member, type, amount as formatted currency, category,
    description/memo, voided status), not a raw table dump.
  - **JSON export**: a single snapshot object covering, at minimum, the
    fields `ARCHITECTURE.md` §19 lists — household settings (name,
    timezone), members, ledger transactions, payment plans, payment
    periods, categories, and relevant audit metadata (the audit log rows
    for this household). Push subscriptions are explicitly excluded per
    that same section ("devices can subscribe again").
- Both exports are Parent-only, scoped to the signed-in Parent's own
  household only (RLS already enforces this on every underlying read —
  the task is to not accidentally bypass it, e.g. by using anything other
  than the normal authenticated Supabase client).
- Downloaded as a file from the browser (client-side `Blob` + anchor
  download), no server round-trip beyond the existing PostgREST reads.
- Money in the CSV is formatted via the project's existing
  `Intl.NumberFormat`-based currency helper (`src/lib/currency.ts`), not
  raw integer cents — this is a human-facing export, not an API payload.
  The JSON export keeps amounts as integer cents (matching how the rest of
  the app stores and reasons about money) since it's meant as a durable,
  re-importable backup, not a human-readable report.

**Explicitly out of scope** (future backlog picks under item 7, not this
task): categories/quick-add preset management UI, member management UI,
notification preferences UI, transaction filtering/search UI, and the
accessibility/performance review. None of this task's work blocks or is
blocked by any of them.

## Sizing

Small-to-medium tier. No design spec needed — the shape is fully
determined by `ARCHITECTURE.md` §19's own field list and the existing
schema. Track as a flat task list in a `docs/proposals/phase-6-admin-polish/`
folder (reusing this project's proposal-folder convention since it's likely
to grow more tasks under the same item over time) rather than a single
Post-Launch row, so later Phase 6 slices (categories, member management,
etc.) have a natural home to append to.
