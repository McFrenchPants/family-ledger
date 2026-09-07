# Analysis: Phase 4 — Push technical spike

Status: finalized 2026-09-07, after two user check-ins — first to pick
this item over the alternatives, then a second confirming this analysis's
own findings before finalizing (library choice, and staying on the local
Docker + mkcert setup rather than triggering the project's first
production deploy). Required by `BACKLOG.md` before Phase 4 moves to a
design spec / implementation plan — scrutinizes the phase as scoped and
answers its one open technical question (`docs/ARCHITECTURE.md` §12.4:
"which Deno-compatible Web Push implementation actually works in Supabase
Edge Functions").

## Is Phase 4 worth doing as scoped?

Yes, and it stays a spike, not a feature. `ARCHITECTURE.md` §12.4 is
explicit that the entire notification UI must wait until end-to-end
delivery is proven on both target phone platforms — this phase exists
precisely to retire that risk cheaply (VAPID keys, `push_subscriptions`
storage, one test Edge Function, two real devices) before Phase 5 commits
to building a whole reminder system on top of an unproven delivery path.
Scope stays exactly what `BACKLOG.md` item 5 and `ARCHITECTURE.md` §29
list: VAPID key generation, subscription storage, a test Edge Function,
physical validation on Android + iPhone. No reminder rules, no scheduling,
no notification-preferences UI — those are Phase 5 and the blocked Phase 6
sub-piece, not this phase.

Nothing blocks starting the non-device parts of the work now. Phase 3 is
done and merged, so the service worker file and `injectManifest` plumbing
this phase needs already exist. The one real dependency — physical Android
+ iPhone hardware for the validation step — doesn't block research, schema
design, or writing the Edge Function; it only blocks calling the phase
*done*.

## Findings

### 1. Library choice: `@block65/webcrypto-web-push`

The open question this analysis exists to answer. Compared four
candidates, all discovered via the same web search:

- **`web-push` (npm, `web-push-libs/web-push`)** — the canonical Node
  library. Rejected outright: it depends on Node's `crypto` module
  directly, not Web Crypto, so it does not run in Deno's edge runtime at
  all.
- **`@negrel/webpush` (JSR)** — built on Web Crypto specifically for Deno
  and other web-compatible runtimes, so architecturally the most
  "native" fit on paper. Rejected on maintenance grounds: JSR's own
  registry metadata shows it last updated 2024-05-29 (over two years
  stale as of this writing), `dependentCount: 0`, and no releases since.
  An unmaintained crypto/security library is a worse bet than an actively
  maintained one even when its design is a closer conceptual match.
- **`web-push-neo`** — also Web Crypto-based and explicitly multi-runtime
  (Node/Deno/Bun/Cloudflare Workers), but still pre-1.0 (npm shows
  `0.1.2`, published 2026-03-27) with no visible track record yet. Kept
  as a fallback candidate, not the primary pick, purely because it's
  young.
- **`@block65/webcrypto-web-push`** — chosen. npm shows `2.0.0` published
  2026-09-03 (four days before this analysis), i.e. actively maintained
  right now, not merely "not yet abandoned." Explicitly supports Node,
  Cloudflare Workers, Bun, and Deno. Encrypts with `aes128gcm` (RFC 8291)
  and authenticates with the `vapid` scheme (RFC 8292) — the README states
  plainly that both are "accepted by every current push service,
  including Apple," which is the exact iOS/Safari requirement §12.4 asks
  the spike to prove. The API is minimal and Web-standard: the exported
  `buildPushPayload(message, subscription, vapid)` returns a `fetch`-ready
  `RequestInit`-shaped payload — the caller does
  `fetch(subscription.endpoint, payload)` directly, nothing Node-specific
  anywhere in the call path. Its only runtime dependency is
  `uint8array-extras`, a small pure-JS utility with no Node API surface.
  Already-established project convention (`supabase/functions/add-household-member/index.ts`
  imports `@supabase/supabase-js` via an `npm:` specifier) means pulling
  this in as `npm:@block65/webcrypto-web-push@2` needs no new tooling
  decision.

One gap: this library does **not** export a VAPID key-generation helper —
only `vapidHeaders`, `encryptNotification`, and `buildPushPayload`. VAPID
keys are a one-time P-256 ECDSA keypair (RFC 8292), not a per-request
operation, so this is a minor, solvable detail rather than a library
disqualifier: generate them once via any standard tool (the Node `web-push`
CLI's `generate-vapid-keys`, or a short throwaway script using
`crypto.subtle.generateKey`), store the public key as a `VITE_`-prefixed
env var (intentionally safe for browser exposure — the whole point of
VAPID's asymmetric scheme is that the public key ships to clients) and the
private key as a Supabase Edge Function secret, never in the repo. This is
exactly the split `CLAUDE.md`'s standing rules already require ("Never
expose the Supabase `service_role` key or the VAPID private key to the
browser or to source control").

### 2. Real-device validation doesn't require a production deploy

Phase 3's analysis (`analysis/03-phase-3-pwa.md`, finding 2) already solved
"how does a phone on the same Wi-Fi reach a secure context for testing" by
adding `vite-plugin-mkcert` so the Vite dev server serves HTTPS with a
locally-trusted cert at `https://<lan-ip>:<port>`. `PushManager.subscribe()`
only requires a secure context, not a public origin — Chrome's push
service (FCM) and Apple's push service both deliver to a subscription
regardless of where the subscribing page was served from, since delivery
targets the browser/OS's own push endpoint, not the app's origin. So this
phase's real-device validation step can reuse the existing mkcert LAN setup
directly; it does not force "do the project's first production deploy" the
way Phase 3 briefly considered and then avoided. Worth stating plainly
since Phase 0's hosted track explicitly deferred linking the CLI to the
real Supabase project "until there's a migration worth pushing to it" —
this phase does add a migration (`push_subscriptions`), which reopens that
question, but the *device-testing* half of the phase doesn't force the
answer to be "yes, deploy now." Whether a `push_subscriptions` migration is
itself reason enough to finally do the first real deploy is a separate
decision, not resolved here — flagged as an open question for the design
spec / user check-in, not decided unilaterally in this analysis.

### 3. Schema and RLS surface is small but security-sensitive

`push_subscriptions` needs, at minimum, per `ARCHITECTURE.md` §12.1 and
`PROJECT_REQUIREMENTS.md` §9.2: an owning `household_member_id`, the
subscription `endpoint` (unique), the `p256dh`/`auth` keys from the
browser's `PushSubscription`, and a timestamp. §9.2 also requires "Parents
can see whether a child has at least one active push subscription" —
notably *whether one exists*, not the raw key material, so the RLS design
should default to Parents being able to see existence/count but not
necessarily the raw `p256dh`/`auth` values of a Child's subscription (those
are only ever needed server-side, by the Edge Function, via a
security-definer path or service_role read — never by another household
member's browser). This table sits squarely in this project's
`verification_profile.widen` list (`push_credential_or_subscription_handling`,
alongside `data_persistence_migrations`), so whatever RLS policy this
becomes must be verifier-routed when implemented, matching how M6.1's
`household_members` RLS work was handled. The exact policy shape (a
dedicated "has active subscription" view/RPC vs. column-level grants) is a
real design choice, not decided here — belongs in the design spec.

### 4. The test Edge Function is deliberately throwaway-shaped

§12.4 asks for a spike proving delivery works, not a production delivery
pipeline — that's Phase 5's `process-reminders` function
(`ARCHITECTURE.md` §13), which doesn't exist yet and shouldn't be built
now. This phase's Edge Function only needs to: read one subscription's
keys, build a payload with `buildPushPayload`, `fetch` it to the push
service, and report the response status back (so a 410/404 "expired
subscription" response can be observed and confirmed handled, per §12.4's
"handling expired subscriptions" requirement) — a manually-triggered test
endpoint, not a scheduled job. Naming and shape (e.g. `push-test`) is an
implementation-plan detail, not decided here.

## Not reconsidered

Reminder rules, the `pg_cron` → `process-reminders` scheduling
architecture (`ARCHITECTURE.md` §13), idempotent `notification_events`,
dead-subscription cleanup policy, and any notification-preferences UI are
all explicitly Phase 5 (`BACKLOG.md` item 6) and the blocked Phase 6
sub-piece — none of that is this phase's job, and `ARCHITECTURE.md` §13
itself says not to scaffold Phase 5 before this spike's result is in.
Whether to eventually move scheduling to a Cloudflare Worker Cron Trigger
(§13's noted alternative) is also untouched here.

## Outcome

Phase 4 is ready to move to a design spec — not straight to an
implementation plan the way Phase 3 was, because this phase introduces a
new external dependency (a push-crypto library), a new secret-handling
surface (the VAPID private key), and a new RLS-covered table holding
subscription credentials, all of which land in this project's verifier
floor/widen tiers. Library choice is settled (finding 1,
`@block65/webcrypto-web-push`, user-confirmed). The first-deploy question
from finding 2 is also settled (user-confirmed): this phase stays on the
local Docker stack + mkcert LAN setup, same as Phase 3 — linking the CLI to
the real hosted Supabase project and doing the project's first production
deploy is explicitly deferred, not triggered by this phase's migration. The
one open question left for the design spec is the `push_subscriptions`
RLS/visibility shape from finding 3. Real-device validation (Android +
iPhone) remains this phase's hard exit criterion per §12.4 and cannot be
marked done without it — implementation of the schema, library
integration, and test function can proceed without the devices in hand,
but the phase itself stays open until that validation happens.
