# Family Ledger — Deployment & Operations Guide (for the owner)

Plain-English guide to how the live app is put together, how changes reach it,
where each secret lives, and what to do when something breaks. No developer
background assumed. (The agent-facing procedures are in
`docs/SUPERVISOR_RUNBOOK.md`; this file is the human one.)

## 1. The pieces

| Piece | What it does | Where you manage it | Cost |
| --- | --- | --- | --- |
| **GitHub** (`McFrenchPants/family-ledger`) | Stores all the code. The `production` branch is the "what's live" branch. | github.com | Free |
| **Cloudflare** (Worker `family-ledger`) | Hosts the app's screens. Rebuilds and republishes whenever `production` changes. | dash.cloudflare.com → Workers & Pages → family-ledger | Free |
| **Supabase** (project `fsszkclgeekdyyspgrhg`) | Holds the data and logins, and runs the two small server functions (add a family member, test a push). | supabase.com/dashboard | Free |

Live address: **https://family-ledger.mcfrench.workers.dev**

## 2. How a change goes live

1. Work is done on a branch and merged into `main` (the staging branch). Nothing
   goes live from `main`.
2. Once a change is reviewed and tested, the agent merges `main` into
   `production` and pushes it by itself (standing instruction, 2026-10-03:
   you no longer need to say "deploy").
3. Cloudflare notices and rebuilds the app (about a minute). That is the whole
   deploy for screen/behavior changes.
4. **Database changes are separate, and the agent applies them too** (before
   it promotes the screens). If a change adds a migration (a file in
   `supabase/migrations/`), it is applied to the live database with:
   ```bash
   npx supabase db push --linked
   ```
   Do this *before or together with* publishing the screens that need it.
5. **Server-function changes are separate too** (files in `supabase/functions/`); the agent deploys them as well:
   ```bash
   npx supabase functions deploy
   ```

Preview links are deliberately OFF (a guessable public link to a private
ledger is not wanted). To try changes before going live, run them on your own
computer (`npm run dev`).

## 3. Where every secret lives (and what never goes where)

| Secret | What it is | Lives in | Never put it in |
| --- | --- | --- | --- |
| Database password | Lets the command line change the live database | Your password manager. Typed only at the `supabase link` prompt | Chat, files, git |
| `service_role` key | Master key to the live data | Supabase dashboard → Project Settings → API Keys (shown as the secret key). Pasted only into `.env.bootstrap` for the one-time setup, then delete it from the file | Git, chat, Cloudflare, anything the browser loads |
| Push **private** key | Signs push notifications | `supabase/functions/.env` on your computer (gitignored) → copied to Supabase with `secrets set` (section 5) | Git, chat, Cloudflare |
| Push **public** key | Safe to publish | `.env` (`VITE_VAPID_PUBLIC_KEY`) and Cloudflare build variables | — (public is fine) |
| Supabase URL + anon/publishable key | Public by design; the browser needs them | `.env` locally; Cloudflare build variables | — (public is fine; RLS protects the data) |

Keep a copy of your local `.env`, `supabase/functions/.env` and
`.env.bootstrap` in a password manager's secure notes. They are gitignored, so
if this computer dies, they are gone — **the push private key in particular
cannot be recovered**, only replaced (which would invalidate every device's
notification subscription).

## 4. Cloudflare build variables (one-time, and after any change)

Cloudflare dashboard → Workers & Pages → **family-ledger** → **Settings** →
**Build** → **Variables and secrets** (the *build* section, not the runtime
"Variables and Secrets" for the Worker). Add as plain text:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://fsszkclgeekdyyspgrhg.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Supabase dashboard → Project Settings → API Keys → the `anon` (legacy) key, or `npx supabase projects api-keys --project-ref fsszkclgeekdyyspgrhg` |
| `VITE_VAPID_PUBLIC_KEY` | the `VITE_VAPID_PUBLIC_KEY=` line in your local `.env` |

These are baked into the app **at build time**, so after adding or changing
them you must trigger a new build: Deployments → latest → **Retry deployment**
(or push any change to `production`).

Quick self-check that a build has them: opening the live address should show
the sign-in screen, not a blank page or an "environment variable" error.

## 5. Push-notification secrets on Supabase

Run from the project folder (the Supabase CLI must be logged in — `npx supabase
login` once per computer):

```bash
npx supabase secrets set --env-file supabase/functions/.env --project-ref fsszkclgeekdyyspgrhg
```

(The `--env-file` part matters; without it the command errors with "No arguments
found".) Check what is stored — it shows names only, scrambled values:

```bash
npx supabase secrets list --project-ref fsszkclgeekdyyspgrhg
```

Status: done 2026-10-01 (`VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`).

## 6. One-time: create the first family and Parent login

Needed once, on a fresh database, because the app has no public sign-up and a
Parent is required to add anyone else.

1. Supabase dashboard → **Project Settings → API Keys** → copy the
   `service_role` / secret key.
2. Open `.env.bootstrap` (in the project folder) and paste it after
   `SUPABASE_SERVICE_ROLE_KEY=`. Check the email, password, display name,
   household name and time zone lines are what you want.
3. Run:
   ```bash
   npm run bootstrap
   ```
   Success prints "Done. First household created." The script refuses to run
   if any household already exists, so running it twice is harmless.
4. **Delete the `service_role` value from `.env.bootstrap`** afterwards, and
   change the sign-in password to something private (see "Known gaps").

## 7. Supabase settings checklist (dashboard)

- **Authentication → Sign In / Providers → Email:** "Allow new users to sign up"
  must be **OFF** (done 2026-10-01).
- **Authentication → URL Configuration → Site URL:** set to
  `https://family-ledger.mcfrench.workers.dev`.
- **Database → Backups:** the Free plan does not give you restorable backups.
  Use the app's own **Settings → Export & backup → full backup** regularly (monthly is sensible)
  and keep the file somewhere safe.

## 7a. Releasing account management (one-time hosted steps)

The account-management release (set-password links, change password, role/email
changes, archive-blocks-login) needs these in addition to the normal deploy.
Do them in this order, **before** promoting to `production` (otherwise the new
screens will call things that do not exist yet):

1. Apply the new database migration (`20260908090000_...`) — the agent now does this itself in every release (historical note for this one-time release):
   ```bash
   npx supabase db push --linked
   ```
2. Tell the functions the app's address (an https address, no trailing slash):
   ```bash
   npx supabase secrets set APP_BASE_URL=https://family-ledger.mcfrench.workers.dev --project-ref fsszkclgeekdyyspgrhg
   ```
3. Deploy both functions (one is new, one changed):
   ```bash
   npx supabase functions deploy --project-ref fsszkclgeekdyyspgrhg
   ```
4. Supabase dashboard, **Authentication → Providers → Email**: set
   **Email OTP Expiration** to `86400` (24 hours, the Free maximum) and
   **Minimum password length** to `8`. (The set-password links last exactly
   as long as this setting; the app tells people 24 hours.)
5. Then ask the agent to promote `main` to `production`.

Until step 1 is done the Archive/Restore buttons (on each person's page under
**Family**) stop working (the database no longer allows direct status edits), so do not
promote first.

## 8. Costs

All three services are on free plans, so the running cost is **$0/month**.
Things that could change that:

- **Supabase Free pauses a project after about a week with no activity.** If
  the app suddenly can't sign in, check the Supabase dashboard for a "paused"
  banner and click Restore. Normal family use keeps it awake.
- Free limits (database size, monthly active users, function calls) are far
  above household use. Supabase emails before you hit one.
- A custom domain name is optional (about $10–15/year); not needed.
- No Apple developer fee is needed for push on an installed iPhone web app.

## 9. When something goes wrong

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Blank page or an environment-variable error on the live site | Cloudflare build variables missing/stale (section 4) | Add them, **Retry deployment** |
| Sign-in says wrong password / can't connect | Project paused, or the first Parent was never created | Dashboard → Restore; or section 6 |
| A page returns 404 when opened directly | Should not happen (`wrangler.jsonc` handles it); check the latest build succeeded | Cloudflare → Deployments |
| "Add member" (on **Family**) or "Send test push" (Parent only, **Settings → Advanced**) fails | Functions not deployed, or secrets missing | Section 2 step 5; section 5 |
| No payment reminders arrive on a phone | Reminders not turned on for that device | On that phone: **Settings → This device → Payment reminders**. A Parent can then check delivery with **Settings → Advanced → Send test push** |
| Phone stuck on an old version | Installed app caches itself | Close fully and reopen; if stuck, remove and reinstall |
| A bad release is live | — | Cloudflare → Deployments → pick a previous good one → **Rollback**. Then tell the agent so the code is fixed |

## 10. Known gaps (as of 2026-10-01)

- The first login was created with a placeholder password. Once account
  management is released, change it at **Settings → Change password**
  (`/settings/account`).
- iPhone push validation still needs doing against the live site (install the
  app and turn on reminders from **Settings → This device**).
