# Progress: Phase 3 — PWA

Branch: `feature/phase-3-pwa` (off `main`).

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
| S4.1 | Vite PWA tooling and manifest | todo | |
| S4.2 | Placeholder app icon set | todo | Can run alongside S4.1 (independent files), but S4.1's manifest references S4.2's output filenames — coordinate names, or land S4.1 with placeholder filenames S4.2 then fills in. |
| S4.3 | Service worker: app-shell precaching, no ledger-API caching | todo | Depends on S4.1 (plugin config). |
| S4.4 | Mobile install onboarding | todo | Depends on S4.1 (manifest must exist for `beforeinstallprompt` to fire in a real browser), but its platform-detection logic can be built/unit-tested independently. |
| S4.5 | Real-device confirmation | blocked | User-performed, not delegated — requires a physical Android phone and iPhone. Blocked until S4.1–S4.4 are done. |

## Session log

_Newest entries on top._

### 2026-09-05 — Plan created; Stage scaffolded

Branched `feature/phase-3-pwa` from `main` (`main` was at `dcef13d` —
includes Phase 2's merge and this phase's finalized analysis). Analysis
(`analysis/03-phase-3-pwa.md`) went through an explicit user check-in on two
points: real-device install testing via `vite-plugin-mkcert` over LAN HTTPS
rather than the project's first production deploy, and a generated
placeholder icon set rather than commissioned artwork. No separate design
spec — judged small/well-understood enough to go straight to an
implementation plan.

Five tasks planned (S4.1–S4.5), no data/authorization stage (Phase 3 has no
database component). All of S4.1–S4.4 are default verification tier (no
RLS/security-definer/audit_log changes). S4.5 is explicitly not delegable —
flagged `blocked`, pending the user's own physical-device testing once
S4.1–S4.4 land. Starting S4.1 next.
