# Supervisor runbook: merge, push, and live verification

This document is for the **supervisor role only** — see
`agents/supervisor.md` and this project's `CLAUDE.md` for why that boundary
exists. An agent implementing a feature/fix should never need anything in
this file; it should stop at this project's own testing doc and hand off.

Everything here reaches outside this repo/machine: the git remote, and
whatever live systems this project actually depends on
(`.sdlc/project.yaml`'s `release.live_systems`: `supabase_production_project`, `cloudflare_pages_deployment`, `physical_ios_and_android_devices`). Treat
every command in this file as something to run deliberately and sparingly,
not to loop or poll with.

**This file was scaffolded with placeholders during `/continue-development`'s
init step and still needs a human (or a deliberate follow-up task) to fill
in the real commands for this project's actual live systems below — the
scaffolding cannot know those. Don't let an agent invent plausible-looking
commands for a system it doesn't actually have verified access to.**

## Guardrails (read before running anything below)

1. **Local tests pass first, always.** Never merge/push/verify-live on a
   change that hasn't cleanly passed this project's own test/build checks.
2. **Verify, don't iterate, against the live system.** Live checks are for
   confirming an already-tested change actually deployed correctly — not a
   debugging loop. If something's broken live, the fix happens locally
   (edit, retest, redeploy), not by repeatedly poking the live instance.
3. **Minimize call count.** One status check to confirm a deploy landed is
   normal. Polling every few seconds, or re-running the same check "just to
   be sure" more than once or twice, is not — if you need to wait for
   something, wait a sensible real amount of time once, not in a tight loop.
4. **Read-only by default.** Prefer a status/health check over any command
   that changes state. Only take a state-changing action when the task
   actually requires it, and say what you're about to do and why before
   doing it.
5. **Never run a destructive or host-/administration-level action** against
   any live system this project merely depends on, without explicit,
   per-instance user confirmation — administering the underlying platform
   is out of scope for this project's supervisor role entirely; if one
   seems necessary, stop and ask instead.
6. **Log what you actually did.** When a supervisor session performs a live
   merge/push/deploy-verify, note the real commands run in the backlog entry
   or commit/PR description for that change, matching whatever
   incident-documentation convention this project already has.

## Merge & push workflow

Two-stage, per `.sdlc/project.yaml`'s `release` block: feature branches fork
from and merge into `main` (routine, automatic); that
branch only promotes to `production` on an explicit live
instruction. Both stages still require this project's own tests fully green
first.

### Stage 1 — feature branch → `main` (routine, no approval record needed)

```bash
# From a feature branch, tests already green:
git add <specific files>              # never `git add -A`/`.` blindly
git commit -m "..."

git checkout main
git merge --no-ff <feature-branch> -m "Merge branch '<feature-branch>'"
git push origin main
git branch -d <feature-branch>
```

Do this as the normal way a finished task/proposal wraps up — no need to
wait for the user to separately ask for this merge, and no approval record
to write for it.

### Stage 2 — `main` → `production` (production; requires a live instruction + approval record)

```bash
git checkout production
git merge --no-ff main -m "Merge main into production: <summary>"

# TODO (fill in during a deliberate follow-up, not invented by an agent):
# if this project's integration and production branches carry any
# environment-specific identity that differs between them (a config file's
# name/slug/port, a version string, feature flags), restore the production
# side of those here before pushing -- a plain merge silently carries the
# integration branch's side of any changed line into production.

git push origin production
```

Never push a production promotion without the approval-record check in
`docs/sdlc/APPROVAL_RECORDS.md` passing first — this is the step that
reaches real users/guests/customers.

## Live systems: read-only checks (preferred)

TODO: fill in the actual health-check / status commands for this project's
real live systems (`supabase_production_project`, `cloudflare_pages_deployment`, `physical_ios_and_android_devices`) here, once they're known and verified
working. Until this section is filled in, the supervisor role should ask
the user for the right command rather than guessing one.

## Live systems: state-changing actions (use deliberately, say why first)

TODO: fill in the actual restart/redeploy/install commands for this
project's real live systems here, along with any system-specific guardrails
(credentials that are single-purpose, access that must be requested fresh
each time, host-level actions that are permanently out of scope, etc.).

### Family Ledger — what these three live systems are

Named so a future supervisor session knows what it is being asked about.
Updated 2026-09-04: the Supabase project and the GitHub repo now exist.
Cloudflare Pages does not yet have this repo connected — see "Cloudflare
Pages: one-time setup" below.

- **`supabase_production_project`** — the hosted Supabase Free project:
  Postgres, Auth, RLS policies, Edge Functions, scheduled jobs. Holds real
  household financial history, so treat any state-changing command against
  it as production data mutation. The `service_role` key belongs only in
  trusted server-side environments and must never reach a browser bundle
  or this repo.

  ```text
  Project URL: https://fsszkclgeekdyyspgrhg.supabase.co
  Project ref: fsszkclgeekdyyspgrhg
  ```

  Read-only checks (preferred):

  ```bash
  npx supabase link --project-ref fsszkclgeekdyyspgrhg   # prompts for DB password; one-time per machine
  npx supabase migration list --linked                    # applied vs. pending migrations
  npx supabase projects api-keys --project-ref fsszkclgeekdyyspgrhg  # anon/service_role, printed to your terminal only
  ```

  State-changing (use deliberately, say why first):

  ```bash
  npx supabase db push --linked        # applies pending supabase/migrations/*.sql to the hosted project
  ```

  The DB password is never typed into a file, chat, or committed
  `.env` — enter it only at the CLI's interactive prompt. Never fetch the
  `service_role` key into anything that could end up in a browser bundle
  or a git-tracked file.

- **`cloudflare_pages_deployment`** — Cloudflare Pages builds the static PWA
  from the `production` branch and serves it over HTTPS. A production
  promotion (Stage 2 above) is what triggers a user-visible deploy. Not yet
  connected — see setup section below. Once connected, a read-only status
  check is `npx wrangler pages deployment list --project-name family-ledger`.

- **`physical_ios_and_android_devices`** — real phones. Required, not
  optional: PWA home-screen installation and Web Push delivery cannot be
  validated in CI or a headless browser (see `docs/ARCHITECTURE.md` §12.4,
  the push implementation spike). Verification on these is inherently
  human-in-the-loop; an agent must ask the user to perform and report the
  device check rather than claiming it.

### Source control

```text
GitHub: https://github.com/McFrenchPants/family-ledger
```

Origin remote should point here; `git push origin <branch>` in the merge
workflow above pushes to this repo.

### Cloudflare Pages: one-time setup (human action, not an agent's)

Connecting a repo to Cloudflare Pages goes through an OAuth-style GitHub
authorization in the Cloudflare dashboard — no CLI/API path an agent can
drive non-interactively. A human completes this once:

1. Cloudflare dashboard → **Workers & Pages** → **Create application** →
   **Pages** → **Connect to Git** → authorize and select
   `McFrenchPants/family-ledger`.
2. **Production branch:** `production` (not `main` — see
   `.sdlc/project.yaml`'s `release` block and ADR-009; `main` is the
   integration branch and must never trigger a deploy on its own).
3. **Build command:** `npm run build` · **Build output directory:** `dist`
   (once Phase 0 establishes these — adjust if the real `package.json`
   scripts differ).
4. **Environment variables** (Settings → Environment variables, Production):
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_VAPID_PUBLIC_KEY`
   — public/browser-safe values only, per `docs/ARCHITECTURE.md` §20/§21.
   Never set `service_role` or `VAPID_PRIVATE_KEY` here; those aren't
   Pages variables, they're Supabase Edge Function secrets.
5. **Preview deployments:** Settings → Builds & deployments → set
   **Preview deployments** to **None** (or restrict to the `production`
   branch only). This is the ADR-009 decision — do not leave it at the
   Cloudflare default, which builds a public preview URL for every
   non-production push including every routine `main` merge.

Once connected, record the actual Pages project name here (replacing the
placeholder `family-ledger` used in the status-check command above) and
remove this TODO framing.
