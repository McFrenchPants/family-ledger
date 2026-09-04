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
| — | _(none yet)_ | — | Add a row here for small work that doesn't need a proposal folder. |

## Session log

_Newest entries on top._

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
