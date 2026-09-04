# Family Ledger — Desired Architecture

**Status:** Draft target architecture  
**Primary objective:** A secure, cross-platform, installable family ledger that can operate at approximately **$0/month** under normal household usage.  
**Related document:** `PROJECT_REQUIREMENTS.md`

---

## 1. Architecture Summary

The recommended system is a static React Progressive Web App hosted on Cloudflare Pages, using Supabase Free for authentication, PostgreSQL data storage, Row Level Security, and trusted server-side functions.

The application is Internet-accessible over HTTPS and does not depend on the household Wi-Fi, Home Assistant server, a VPN, native mobile applications, or app-store distribution.

Target stack:

```text
React + Vite + TypeScript + Tailwind CSS + Radix UI
                |
                | build static PWA
                v
        Cloudflare Pages
                |
                | HTTPS
                v
          Supabase Free
        +----------------+
        | Auth           |
        | PostgreSQL     |
        | Row Level Sec. |
        | Edge Functions |
        | Scheduled Jobs |
        +----------------+
                |
                v
             Web Push
          /             \
       iPhone          Android
       PWA              PWA
```

Calendar integration is optional and is not part of the primary reminder architecture.

---

## 2. Architectural Principles

### 2.1 One application codebase

Maintain one responsive web application rather than separate iOS and Android projects.

### 2.2 Static frontend where possible

The React application should build into static assets that can be deployed cheaply and reliably on Cloudflare Pages.

### 2.3 Database-enforced authorization

The browser is untrusted.

Permissions that protect financial data must be enforced through PostgreSQL Row Level Security, constraints, database functions, and trusted Edge Functions rather than only through React conditionals.

### 2.4 Append-oriented ledger

Financial history should be preserved. Prefer creating transactions and explicit void/reversal records over destructive editing.

### 2.5 Minimal backend surface

Use Supabase's generated PostgREST API and Auth client directly for ordinary authorized reads/writes where RLS can safely express the rule.

Use Edge Functions or security-definer database functions only when an operation requires privileged or multi-step server logic.

### 2.6 Provider portability

Avoid coupling business logic unnecessarily to a proprietary UI/backend feature.

The application should keep:

- Schema migrations in source control.
- Business rules in TypeScript/SQL that can be understood independently.
- Standard PostgreSQL data types.
- Standards-based PWA and Web Push APIs.

This keeps future migration away from Supabase or Cloudflare feasible.

---

## 3. Technology Choices

### Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Radix UI primitives (unstyled, accessible components — dialog, popover,
  tabs, switch — composed with Tailwind; chosen over a full component
  framework like Material UI to stay lightweight and keep the app reading
  as "a tiny purpose-built utility" per PROJECT_REQUIREMENTS.md §11.1)
- React Router
- TanStack Query or equivalent server-state library
- React Hook Form or equivalent form library
- Zod or equivalent runtime validation
- `vite-plugin-pwa` / Workbox for PWA generation

### Hosting

- Cloudflare Pages Free

### Backend platform

- Supabase Free

Use:

- Supabase Auth
- PostgreSQL
- Row Level Security
- SQL migrations
- Edge Functions
- Scheduled jobs / `pg_cron` where appropriate

### Notifications

- Browser Push API
- Notifications API
- Service Worker
- VAPID application-server keys
- Supabase Edge Function for trusted Web Push dispatch

### Source control / CI

- Git repository
- Cloudflare Pages Git integration or CI deployment
- Supabase CLI for local development and migrations

---

## 4. Free-Tier Strategy

The architecture is deliberately sized for a very small private family application.

At the time this architecture was written:

- Cloudflare Pages provides a free tier suitable for static PWA hosting.
- Cloudflare Workers/Pages Functions have a free request allowance if later needed.
- Supabase provides a free project tier with PostgreSQL, Auth, storage, and Edge Functions appropriate for a small application.
- Standards-based Web Push does not require a paid push-notification SaaS provider.

The application should not assume that provider pricing or quotas are permanent.

### Cost guardrails

1. Do not introduce a paid service without an explicit architectural decision.
2. Do not require object storage for the MVP.
3. Do not add SMS notifications to the MVP.
4. Do not add a transactional email provider unless authentication requirements make it necessary.
5. Keep background jobs infrequent and batch-oriented.
6. Keep images/receipts out of the MVP unless storage requirements are revisited.
7. Monitor provider free-tier usage periodically.

### Known free-tier operational risk

Supabase Free projects may be paused after prolonged inactivity according to the provider's current policy.

For this application that is an acceptable initial tradeoff, but it must be documented. If reliability later becomes more important than zero cost, upgrading Supabase should not require an application rewrite.

---

## 5. Repository Layout

Recommended initial structure:

```text
family-ledger/
├── README.md
├── PROJECT_REQUIREMENTS.md
├── ARCHITECTURE.md
├── package.json
├── vite.config.ts
├── tsconfig.json
├── public/
│   ├── icons/
│   └── ...
├── src/
│   ├── app/
│   │   ├── router.tsx
│   │   ├── providers.tsx
│   │   └── App.tsx
│   ├── components/
│   ├── features/
│   │   ├── auth/
│   │   ├── household/
│   │   ├── ledger/
│   │   ├── payments/
│   │   ├── payment-plans/
│   │   ├── notifications/
│   │   └── settings/
│   ├── lib/
│   │   ├── supabase.ts
│   │   ├── currency.ts
│   │   ├── dates.ts
│   │   └── validation.ts
│   ├── pages/
│   ├── types/
│   └── main.tsx
├── supabase/
│   ├── config.toml
│   ├── migrations/
│   ├── seed.sql
│   └── functions/
│       ├── process-reminders/
│       ├── send-reminder/
│       └── household-admin/
└── tests/
```

Feature-first organization is preferred over grouping the entire application by file type.

---

## 6. Identity and Authentication

### 6.1 Individual accounts

Every household member receives an individual Supabase Auth identity.

Do not use one shared Parent password or unauthenticated secret ledger URLs.

### 6.2 Private registration

The application does not support public household creation or open signup in the normal UI.

A Parent should invite or create household membership for each user.

**Decided:** Email/password, Parent-created accounts (not open signup).

Magic link / OTP was considered and rejected for the MVP: it depends on
reliable email delivery, and Supabase's built-in SMTP is rate-limited and
explicitly unsuitable for production use. Making it reliable would require
a transactional email provider, which Free-Tier Strategy cost guardrail #4
says not to add unless authentication requirements make it necessary -- and
email/password does not need one.

**Accepted limitation:** self-service password reset has the same SMTP
dependency, so it is not reliable for the MVP either. Password reset is
Parent-assisted: a Parent resets a child's (or the other Parent's) password
directly (Supabase Auth admin action) rather than the household relying on
an email-based reset flow. Document this in the app's own help text rather
than shipping a reset-password UI that fails silently. Revisit if a
transactional email provider is ever added for another reason.

### 6.3 User profile vs auth identity

Supabase's `auth.users` owns authentication identity.

Application-specific information should live in a `profiles` or `household_members` table linked by `auth.users.id`.

Do not place application business logic directly in `auth.users` metadata when a relational table is more appropriate.

---

## 7. Household Boundary

Even if only one household uses the application, include an explicit `households` entity.

This creates a clean security boundary and avoids hard-coded assumptions.

Suggested tables:

```text
households
household_members
profiles (optional if separate from membership)
```

A user may only interact with rows belonging to a household where they have active membership.

### Roles

Minimum role enum:

```text
parent
child
```

Prefer a database enum or constrained text field.

Role changes are Parent-only privileged operations.

---

## 8. Proposed Data Model

This is a target model, not a frozen schema. Final names may evolve during implementation, but the security and accounting semantics should remain.

### 8.1 `households`

```text
id                  uuid primary key
name                text not null
timezone            text not null
created_at          timestamptz not null
```

### 8.2 `household_members`

```text
id                  uuid primary key
household_id        uuid not null
user_id             uuid -> auth.users.id
name                text not null
role                parent | child
status              active | invited | archived
created_at          timestamptz not null
archived_at         timestamptz null
```

Historical records should reference the membership/entity in a way that remains understandable if an account is later archived.

### 8.3 `ledger_transactions`

```text
id                  uuid primary key
household_id        uuid not null
member_id           uuid not null
amount_cents        bigint not null
type                expense | payment | adjustment
category_id         uuid null
description         text not null
note                text null
occurred_on         date not null
created_by           uuid not null
created_at          timestamptz not null
voided_at           timestamptz null
voided_by           uuid null
void_reason          text null
```

Rules:

- `expense` must increase the balance.
- `payment` must decrease the balance and may only be created by a Parent.
- Child-created records must never reduce the balance.
- `amount_cents` is integer money, never floating point.
- Voided transactions remain persisted.

Consider representing `amount_cents` as signed values while retaining `type` for readability and validation.

Example:

```text
expense  +4217
payment  -2500
```

Database constraints and write paths must ensure type/sign combinations remain valid.

### 8.4 `payment_plans`

```text
id                  uuid primary key
household_id        uuid not null
member_id           uuid not null
minimum_cents       bigint not null
frequency           monthly initially
due_day              integer / rule representation
starts_on            date not null
ends_on              date null
active               boolean not null
created_by           uuid not null
created_at           timestamptz not null
updated_at           timestamptz not null
```

The due-date representation should support a deterministic monthly due date and allow future extension.

### 8.5 `payment_periods`

Recommended because payment-plan state should be explicit and auditable rather than recomputed ambiguously forever.

```text
id                  uuid primary key
payment_plan_id     uuid not null
household_id        uuid not null
member_id           uuid not null
period_start        date not null
due_date            date not null
minimum_cents       bigint not null
waived_at            timestamptz null
created_at           timestamptz not null
```

The amount paid toward a period can be calculated from eligible ledger payments or maintained through a deterministic allocation table if later required.

### 8.6 Optional `payment_allocations`

Do not add this table unless the simpler payment-period calculation becomes insufficient.

If explicit allocation becomes necessary:

```text
payment_allocations
- payment_transaction_id
- payment_period_id
- amount_cents
```

This is different from allocating payments to individual expenses, which remains out of scope.

### 8.7 `categories`

```text
id
household_id
name
sort_order
active
```

### 8.8 `expense_presets`

```text
id
household_id
label
amount_cents
category_id
description
sort_order
active
```

### 8.9 `push_subscriptions`

One user may have multiple devices/browser installations.

```text
id
household_id
user_id
endpoint
p256dh_key
auth_key
user_agent / device_label optional
created_at
last_success_at
failure_count
revoked_at
```

The subscription endpoint and keys are sensitive application data.

### 8.10 `notification_events`

Used for idempotency and history.

```text
id
household_id
user_id
kind
subject_type
subject_id
scheduled_for
sent_at
status
idempotency_key unique
error_message
```

### 8.11 `audit_log`

```text
id
household_id
actor_user_id
entity_type
entity_id
action
old_values jsonb
new_values jsonb
created_at
```

Audit rows should be append-only for ordinary application roles.

---

## 9. Balance Calculation

The balance should derive from active ledger transactions rather than a mutable `balance` column.

Conceptually:

```sql
SUM(amount_cents)
WHERE member_id = ?
  AND voided_at IS NULL
```

A database view or RPC may expose calculated balances efficiently.

For household-scale data volume, calculating balances directly from indexed transactions is trivial.

Do not maintain duplicated balance state unless profiling later demonstrates a need.

---

## 10. Authorization and Row Level Security

RLS is a core architecture requirement.

### 10.1 General policy

Authenticated users may only access rows associated with households where they have active membership.

### 10.2 Parent permissions

Parents may:

- Read all household ledger data.
- Insert expenses.
- Insert payments.
- Manage payment plans.
- Void/correct transactions through approved workflows.
- Manage household configuration.

### 10.3 Child permissions

Children may:

- Read their own ledger and payment-plan data.
- Read shared household information specifically required by the UX.
- Insert approved positive expense transactions.

Children may not:

- Insert a payment.
- Insert any negative balance-changing transaction.
- Update an existing financial amount.
- Void transactions.
- Modify payment plans.
- Modify roles.

### 10.4 Avoid overly-permissive direct table writes

If an RLS policy becomes difficult to reason about, prefer a narrow database RPC or Edge Function rather than making a table generally writable and relying on frontend behavior.

Financial mutation operations should have tests that attempt unauthorized requests as a Child.

---

## 11. Trusted Server Operations

Use Supabase Edge Functions for operations that require secrets or elevated privileges.

Examples:

- Send Web Push notification.
- Process scheduled reminders.
- Parent invitation/account administration when required.
- Administrative export if it cannot be safely done client-side.

The Supabase `service_role` key must exist only in trusted server-side environments and must never be included in the Vite bundle.

---

## 12. Web Push Architecture

### 12.1 Subscription

```text
Installed PWA
    |
    | Notification.requestPermission()
    v
Service Worker
    |
    | PushManager.subscribe(VAPID public key)
    v
PushSubscription
    |
    | authenticated write
    v
Supabase push_subscriptions
```

The VAPID public key may be shipped to the browser.

The VAPID private key must remain server-side as a Supabase secret.

### 12.2 Delivery

```text
Scheduled reminder processor
            |
            v
  determine notifications due
            |
            v
  create/claim notification_event
            |
            v
      Edge Function
            |
            | Web Push protocol
            v
     Browser push service
            |
            v
        Service Worker
            |
            v
       OS notification
```

### 12.3 iOS behavior

On supported iOS/iPadOS versions, Web Push is available to web applications installed on the Home Screen.

The onboarding UI must therefore explain when installation is required before notification permission can be enabled.

### 12.4 Push implementation spike

Before the reminder phase is considered complete, perform a technical spike proving that the selected Deno-compatible Web Push implementation works in Supabase Edge Functions for:

- Chromium/Android subscription.
- Safari/iOS installed PWA subscription.
- VAPID authentication.
- Encrypted payload delivery.
- Handling expired subscriptions.

Do not build the entire notification UI before proving end-to-end delivery on both target phone platforms.

---

## 13. Reminder Scheduling

Preferred initial implementation:

```text
Supabase scheduled job / pg_cron
              |
              v
process-reminders Edge Function
```

The job can run periodically, for example hourly, while reminder rules determine whether anything needs to be sent.

The processor should:

1. Determine the current household-local date/time.
2. Find payment periods matching reminder rules.
3. Generate deterministic idempotency keys.
4. Skip notification events already sent/claimed.
5. Insert a pending notification event.
6. Attempt push delivery to each active subscription.
7. Record success/failure.
8. Retire subscriptions that repeatedly return permanent errors.

### Alternative scheduler

Cloudflare Worker Cron Triggers can be introduced later if there is a specific operational reason to move scheduling outside Supabase.

Do not use two schedulers simultaneously without a clear need.

---

## 14. Progressive Web App Architecture

The PWA should include:

- Web app manifest.
- Stable manifest `id`.
- `display: standalone`.
- App icons and Apple touch icon.
- Service worker.
- Push event handler.
- Notification click handler that deep-links into the relevant ledger/payment screen.

**Service worker generation strategy -- decide in Phase 0, not Phase 3/4.**
`vite-plugin-pwa`'s default `generateSW` mode cannot host a custom `push`
event handler or a notification-click deep-link -- both required above. Use
`injectManifest` mode (a hand-written service worker source file that the
plugin injects the precache manifest into) from the first PWA setup task
onward. Discovering this during the Phase 4 push spike would mean reworking
an already-built service worker.

### Caching

Use conservative service-worker caching.

Safe initial behavior:

- Cache versioned static assets.
- Cache the application shell as appropriate.
- Do not treat ledger API responses as authoritative offline data unless an explicit offline design is implemented.
- Do not queue financial mutations silently for later replay in the MVP.

If a transaction cannot reach the server, show an error and let the user retry.

This avoids duplicate or ambiguous financial writes.

---

## 15. Client Data Access

Use the Supabase browser client with the public project URL and publishable/anon key.

These browser credentials are expected to be public; security depends on RLS.

Recommended client pattern:

```text
React component
      |
      v
feature hook / service
      |
      v
TanStack Query mutation/query
      |
      v
Supabase client / RPC
      |
      v
PostgreSQL + RLS
```

Avoid scattering raw Supabase queries throughout UI components.

Centralize feature-level data access so business semantics remain understandable and testable.

---

## 16. Currency Handling

Money must be stored as integer cents.

Frontend forms may accept strings such as:

```text
42.17
```

Convert and validate using decimal-safe parsing before sending:

```text
4217 cents
```

Never calculate financial state using JavaScript binary floating-point currency values.

Formatting for display should use `Intl.NumberFormat`.

---

## 17. Dates and Time Zones

Each household has an IANA time-zone identifier.

Use:

- PostgreSQL `timestamptz` for moments/timestamps.
- PostgreSQL `date` for human calendar dates such as a payment due date.
- Household time zone when determining `today`, reminder timing, and overdue status.

Do not rely on Cloudflare, browser, database, or function server local time implicitly.

---

## 18. Audit Strategy

Critical database changes should write audit rows transactionally.

Prefer database triggers for broad audit coverage when they remain understandable, or explicit trusted mutation functions when richer actor/context information is required.

Audit requirements include:

- Transaction creation.
- Transaction void/correction.
- Payment creation.
- Payment-plan create/update/disable.
- Role changes.
- Member archive.

The audit table should not be directly writable by ordinary users.

---

## 19. Backup and Export

Supabase Free should not be treated as the only permanent copy of household financial history.

MVP application-level backup:

- Parent can export ledger transactions as CSV.
- Parent can export a complete JSON snapshot.

The JSON export should include at least:

- Household settings.
- Members.
- Ledger transactions.
- Payment plans.
- Payment periods/waivers.
- Categories/presets.
- Relevant audit metadata.

Push subscriptions do not need to be considered durable backup data because devices can subscribe again.

Later automation may copy database dumps elsewhere, but it is not required for MVP.

---

## 20. Cloudflare Pages Deployment

### Production flow

```text
Git push
   |
   v
Cloudflare Pages build
   |
   | npm ci
   | npm run build
   v
Vite dist/
   |
   v
HTTPS Pages deployment
```

Required public frontend environment variables are expected to include:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_VAPID_PUBLIC_KEY
```

Only values intentionally safe for browser exposure may use the `VITE_` prefix.

### Preview deployments

Cloudflare Pages' default Git integration builds a public `*.pages.dev`
preview URL for every push to a non-production branch, including every
routine feature->`main` merge. Left at defaults, that means a household
financial app with real names and dollar amounts gets a freshly published,
guessable-URL, HTTPS-but-publicly-reachable preview on every merge -- worse
still if a preview build ever inherits production environment variables and
points at the real Supabase project.

**Decision:** disable Cloudflare Pages preview deployments for this
project (Pages dashboard -> project -> Settings -> Builds & deployments ->
Preview deployments -> set to "None", or restrict to the `production`
branch only so `main` merges never trigger one). Reviewing a change before
it reaches `production` is done locally instead:

```bash
npm run build
npm run preview          # Vite's local static preview server
# or, for Pages-Functions-accurate behavior:
npx wrangler pages dev dist/
```

This keeps "look at it before it ships" as a real, cheap step (per the
user's stated preference for not publishing every change) without standing
up a public URL for pre-production builds. Revisit only if Cloudflare
Access (which can gate preview URLs behind authentication on the free tier
within its seat limits) is deliberately adopted later.

### Custom domain

A custom domain is optional.

The default `*.pages.dev` HTTPS address is sufficient for the application to function.

---

## 21. Supabase Environment and Secrets

Browser/public configuration:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_VAPID_PUBLIC_KEY
```

Trusted Supabase secrets may include:

```text
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

Supabase's own server environment provides appropriate project credentials to Edge Functions; use the least-privileged credential possible.

Never check private keys or service-role credentials into source control.

### Project identity

The Supabase project for this application exists (created outside this
repo). Its URL and project reference are not secret and are recorded here
for linking the CLI and setting `VITE_SUPABASE_URL`:

```text
Project URL: https://fsszkclgeekdyyspgrhg.supabase.co
Project ref: fsszkclgeekdyyspgrhg
```

The database password and the `anon`/`service_role` keys are secret and
must never appear in this repo, in chat, or in any committed file -- link
the CLI with `npx supabase link --project-ref fsszkclgeekdyyspgrhg` (it
prompts for the password interactively) and pull the `anon` key from the
Supabase dashboard directly into a local, gitignored `.env` when needed.

---

## 22. Local Development

Preferred developer experience:

```text
npm install
supabase start
npm run dev
```

Use Supabase CLI locally where practical to provide:

- Local PostgreSQL.
- Local Auth.
- Migration testing.
- Seed data.
- Function development/testing.

The project should include deterministic seed data for:

- One household.
- Two Parent users/members where feasible.
- Several Child members.
- Example expenses/payments.
- At least one payment plan.

Do not use real family financial information in committed seed fixtures.

---

## 23. Database Migrations

All database changes must be represented by migration files under source control.

Never make production-only schema changes manually without capturing the equivalent migration.

Migration review should pay particular attention to:

- RLS enabled/disabled state.
- New policies.
- Grants.
- Security-definer functions.
- Monetary constraints.
- Foreign-key delete behavior.

---

## 24. Testing Strategy

### Unit tests

Cover pure business logic such as:

- Currency parsing.
- Balance calculations.
- Payment-period status.
- Due-date generation.
- Reminder selection.

### Database/security tests

These are critical.

Test as both Parent and Child identities.

Required negative tests include:

- Child attempts negative transaction.
- Child attempts payment transaction.
- Child attempts to update an amount lower.
- Child attempts to void a transaction.
- Child attempts another household's data.
- User attempts role escalation.

### Integration tests

Cover:

- Add expense -> balance update.
- Record payment -> balance and payment-period update.
- Void -> balance recomputation + audit row.
- Reminder job -> one notification event, no duplicates.

### End-to-end tests

Use browser automation for primary desktop/mobile responsive flows where practical.

Physical-device validation remains necessary for iOS/Android PWA installation and Web Push.

---

## 25. Observability

Keep observability proportionate to the project.

Minimum:

- Edge Function logs.
- Reminder/notification event history in database.
- User-visible error states.
- Admin diagnostics for push subscription status.

Do not add a paid monitoring platform for the MVP.

---

## 26. Security Checklist

Before Internet deployment:

- [ ] RLS enabled on every user-data table.
- [ ] RLS policies tested using Child credentials.
- [ ] No `service_role` key in frontend build or repository.
- [ ] No VAPID private key in frontend.
- [ ] Parent-only operations enforce role server-side.
- [ ] Financial amount/type constraints exist in database.
- [ ] Audit log cannot be modified by ordinary roles.
- [ ] Push subscriptions are private.
- [ ] Production uses HTTPS.
- [ ] Auth redirect URLs are limited to expected application URLs.
- [ ] CORS/function behavior is limited appropriately.
- [ ] Database indexes exist for foreign keys and common ledger queries.
- [ ] Backup/export workflow has been tested.

---

## 27. Performance Expectations

This is a household-scale application.

Expected data size is tiny relative to PostgreSQL and Cloudflare capacity.

Optimize for:

- Simple queries.
- Correct authorization.
- Clear code.
- Fast mobile interactions.

Do not introduce caching layers, queues, brokers, Redis, event buses, microservices, or denormalized balance stores without an observed need.

---

## 28. Architecture Decisions

### ADR-001 — PWA instead of native mobile apps

**Decision:** Use an installable responsive PWA.

**Reason:** One codebase can support iPhone, Android, and desktop while retaining home-screen installation and Web Push capabilities.

### ADR-002 — Public HTTPS hosting instead of Home Assistant/LAN-only hosting

**Decision:** Host the frontend on Cloudflare Pages and backend data/auth on Supabase.

**Reason:** The ledger must be usable away from home without VPN configuration or LAN-only calendar workarounds.

### ADR-003 — Supabase Auth + RLS instead of shared passcodes/public slugs

**Decision:** Every person gets an authenticated identity and role.

**Reason:** Children need limited write access while remaining unable to reduce balances. This is best represented through role-based authorization.

### ADR-004 — Web Push instead of calendar-first reminders

**Decision:** Web Push is the primary reminder channel.

**Reason:** It supports immediate cross-platform application notifications and removes calendar polling from the core correctness path.

### ADR-005 — Payment plans are separate from ledger transactions

**Decision:** Total debt and minimum payment expectations are different concepts.

**Reason:** A child may owe a large balance while only a smaller minimum amount is due during the current period.

### ADR-006 — Derived balances

**Decision:** Calculate balance from ledger transactions rather than persisting a mutable current-balance field.

**Reason:** It reduces synchronization bugs and preserves a clear audit trail.

### ADR-007 — No offline financial write queue initially

**Decision:** Failed writes require retry instead of being silently queued in the service worker.

**Reason:** Avoid duplicate and ambiguous money transactions while keeping MVP complexity low.

### ADR-008 — Tailwind CSS + Radix UI instead of a full component framework

**Decision:** Use Tailwind CSS with Radix UI's unstyled, accessible primitives rather than Material UI or an equivalent full component framework.

**Reason:** Material UI's design language biases the app toward looking like generic admin/dashboard software, working against the "tiny purpose-built utility" feel PROJECT_REQUIREMENTS.md S11.1 asks for, and it is a heavier dependency than this app's scope needs. Radix supplies the accessibility primitives (keyboard interaction, focus management, ARIA) that S17 requires without dictating visual style.

### ADR-009 — Cloudflare Pages preview deployments disabled; local preview instead

**Decision:** Do not use Cloudflare Pages' automatic public preview URLs for non-production branches. Review changes locally (`vite preview` / `wrangler pages dev`) before a `production` promotion.

**Reason:** A public, guessable-URL preview of a private household financial app on every routine merge is an unnecessary exposure for data that, while not highly sensitive, the household has explicitly said should not be published on every change. Local preview achieves the same "see it before it ships" goal without a public deployment.

### ADR-010 — Email/password authentication; password reset is Parent-assisted, not self-service

**Decision:** Household members authenticate with email/password, created by a Parent. There is no self-service, email-based password-reset flow in the MVP.

**Reason:** Magic link/OTP and self-service reset both depend on reliable outbound email, which requires a transactional email provider that Free-Tier Strategy cost guardrail #4 says to avoid unless authentication needs force it. Email/password avoids that dependency entirely; the household's own browsers retaining saved credentials makes the "children might forget a password" concern largely moot in practice.

---

## 29. Implementation Phases

### Phase 0 — Technical foundations

- Vite/React/TypeScript application.
- Tailwind CSS setup and design tokens (spacing, color, type scale).
- Supabase local project.
- Initial schema and migrations.
- Cloudflare Pages deployment.
- Authentication proof of concept.

### Phase 1 — Security and core ledger

- Household/member model.
- RLS policies.
- Parent/Child role enforcement.
- Add expense.
- Record payment.
- Balances.
- History.
- Audit trail.

Do not proceed to convenience features until Child privilege-escalation tests pass.

### Phase 2 — Payment plans

- Monthly payment-plan model.
- Payment periods.
- Status calculations.
- Parent management UI.
- Child progress UI.

### Phase 3 — PWA

- Manifest.
- Icons.
- Standalone installation.
- Service worker.
- Mobile onboarding.

### Phase 4 — Push technical spike

- VAPID keys.
- Push subscription storage.
- Test Edge Function.
- Physical Android test.
- Physical iPhone installed-PWA test.

### Phase 5 — Reminder system

- Reminder rules.
- Scheduled processor.
- Idempotent notification events.
- Manual Parent reminder.
- Subscription cleanup.

### Phase 6 — Administration and polish

- Categories.
- Presets.
- Backup/export.
- Member management.
- Notification preferences.
- Accessibility/performance review.

---

## 30. Definition of Architectural Success

The architecture is successful when:

1. One React codebase serves desktop, iPhone, and Android.
2. The application is reachable securely from outside the household network.
3. No native app store deployment is necessary.
4. Child authorization rules remain secure even when requests bypass the React UI.
5. Financial history is auditable and balances are reproducible from ledger data.
6. Payment-plan state is separate from total debt.
7. Push reminders work on supported Android browsers and installed iPhone PWAs.
8. The normal family workload fits comfortably within free service tiers.
9. The system can later upgrade hosting/provider tiers without a major application rewrite.
10. The project remains simple enough for one developer to understand and maintain.
