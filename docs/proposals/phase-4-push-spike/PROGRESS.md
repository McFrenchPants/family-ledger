# Progress: Phase 4 — Push technical spike

Branch: `feature/phase-4-push-spike` (off `main`).

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
| N4.1 | `push_subscriptions` table and RLS | todo | Verifier-routed (`data_persistence_migrations`, `push_credential_or_subscription_handling`). |
| N4.2 | VAPID keypair generation and secret wiring | todo | Verifier-routed (credential handling). |
| N4.3 | Edge Function: `push-test` | todo | Verifier-routed (auth floor + credential handling). Depends on N4.1, N4.2. |
| N4.4 | Subscribe UI and persistence | todo | Default tier. Depends on N4.1–N4.3 (Stage 1 complete). |
| N4.5 | Test-send trigger | todo | Default tier. Depends on N4.3, N4.4. |
| N4.6 | Real-device validation (Android + iPhone) | blocked | Not delegable — requires user's own hardware. Depends on N4.1–N4.5. Phase's hard exit criterion. |

## Session log

_Newest entries on top._

### 2026-09-07 — Plan created; Stage 1 starting next

Design spec signed off by the user (approved as-is, including the three
open questions resolved per the spec's own suggested defaults: a read-only
view for the Parent-visible existence/count check, no audit-log row for
subscribe/unsubscribe, and the test-send trigger placed next to the
subscribe control rather than a separate page). Six tasks planned
(N4.1–N4.6) across three stages: data/authorization/Edge Function (Stage 1,
entirely verifier-routed), client subscribe UI (Stage 2, default tier), and
real-device validation (Stage 3, not delegable — blocked pending Stage 1–2
completion and the user's own Android + iPhone hardware). Starting N4.1
next.
