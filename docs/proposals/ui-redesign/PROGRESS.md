# Progress: UI redesign

Branches: one per phase, `feature/ui-redesign-pN-<slug>`. See
`IMPLEMENTATION_PLAN.md` for task detail and owner decisions, `DESIGN_SPEC.md`
for the design, `mockups/index.html` for the visual target.

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
| UI1 | Quiet the top: Settings page, menu, role redirect | done | Branch `feature/ui-redesign-p1-quiet-top`. Verified by tests/build only; not viewed in a browser (needs signed-in session). Unused install-banner dismissal helpers left in `install-prompt.ts` for UI10 cleanup. |
| UI2 | Tokens, dark mode, type scale, icons, primitives | done | Branch `feature/ui-redesign-p2-tokens`. Tokens in `src/styles/tokens.css` (contrast test mutation-proofed); primitives in `src/components/ui/`; theme helper `src/lib/theme.ts` (key `family-ledger.theme`). Old class names alias the new tokens, so old pages already follow dark mode. New radii are `rounded-panel` (16) / `rounded-control` (12); `rounded-card` stays 8 until pages migrate. Dev gallery at `/dev/components` (dev builds only). |
| UI3 | App shell and route map | done | Branch `feature/ui-redesign-p3-app-shell`. `AppShell` replaces `RootLayout`; route table exported as `routes` from `router.tsx`; old-path redirects in `src/app/redirects.tsx`. Checked signed in as Parent and Child on the local stack (fixture `scripts/dev/seed-local-test-family.mjs`). Open for UI8: a Child still reaches their read-only plan page only via the old `/child/:id/payment-plan` address, and nothing links to it. Parent `/activity` with no child shows an interim chooser until UI7. |
| UI4 | Child Home (playful overdue text, encouragement) | done | Branch `feature/ui-redesign-p4a-child-home`. Copy in `src/lib/messages.ts`; logic in `src/features/home/child-home.ts`; nudge rules in `src/features/push/device-nudge.ts` (reuse in UI5). Recent activity now reads `voided_at`. Browser-checked only the "due later", payment-received and empty states; overdue/due-soon/paid-off/satisfied covered by component tests only. Nudge not seen in browser (pane's notification permission is denied). |
| UI5 | Parent Home | todo | |
| UI6 | Add expense and Record payment | todo | Child chooser unlocked for all roles. |
| UI7 | Activity page | todo | |
| UI8 | Family and child page | todo | |
| UI9 | Settings completion | todo | |
| UI10 | Polish, cleanup, final verification | todo | |

## Session log

_Newest entries on top._

### 2026-10-02 — UI4 done

Child Home rewritten to the mockups: greeting, "You owe" card with status chip, progress and playful overdue/due-soon copy (rotates once per household-zone day), Add an expense, recent activity with See all, "Paid off!" and "All caught up" states, a one-time "Payment received" card (remembers seen rows per child on the device), and the bottom device nudge (30-day snooze, second dismiss = forever, hidden while overdue). New read-only hook for the household time zone (no browser fallback). Voided rows now show as voided in recent activity and never count as payments. Fixture changed so a *fresh* stack shows Alex overdue; existing local data untouched. typecheck, lint, 577 tests, build clean. No route changes, so the UI3 Child route checks still hold; Home has no payment/void/member links (test enforces). Corrected `CLAUDE.md`: the CLI here is linked to the hosted project (owner's deploy setup) — never run linked-target commands. Next: UI5 (Parent Home).

### 2026-10-02 — UI3 done

New frame: bottom tab bar on phones (Parent: Home, Activity, +, Family, Settings; Child: Home, Activity, +, Settings), sidebar at 900 px and up, "+" sheet (Parent: expense or payment; Child: straight to Add expense), close bar on task pages, skip link and focus move on navigation. New addresses (`/home`, `/activity`, `/new/expense`, `/new/payment`, `/family`, `/family/:id`, `/settings/*`) with every old address redirecting (query kept). Sign-in and set-password now have no chrome; found in the browser that this stranded a just-signed-in user on "Signed in as…", so the sign-in page now forwards a signed-in visitor to `/` (test added). typecheck, lint, 524 tests, build clean. **First signed-in browser check of the redesign**: added a local-only fixture (`node scripts/dev/seed-local-test-family.mjs`, refuses non-local URLs, logins in its header) that adds a separate "Test Family" household without touching other local data. Verified at 375 px (dark) and desktop as Parent (home, + sheet, Activity chooser, old history link redirect) and as Child (4 tabs; all 8 Parent-only addresses bounce to `/home`; another child's `?child=` shows own history). `wrangler dev`: all 18 new/old addresses return 200. Note the dev server runs on **https**://localhost:5173. Fixture's Alex shows "Due", not overdue — adjust the fixture for UI4's overdue state. Next: UI4 (Child Home).

### 2026-10-02 — UI2 done

Design tokens (light/dark CSS variables, one source file), type scale, 36 stroke icons, and primitives (Button, Card, AmountText, StatusChip, ProgressBar, Field, Avatar, Segmented/ChipGroup, Sheet, EmptyState, InlineStatus) added; Radix dialog and toggle-group added. Dark mode follows the phone, with a stored per-device override applied before first paint (Settings switch comes in UI9). Old pages now go dark too: 29 hard-coded white-on-colour texts swapped to on-colour tokens. typecheck, lint, 451 tests, build clean; dev gallery excluded from the production build; checked in the browser at 375 px and desktop, light and dark (gallery and sign-in page only — signed-in pages not viewed). Known dark-mode rough edges on old pages, for the page phases to fix: input borders very faint, inputs have no visible focus ring (pre-existing `outline-none`), old buttons keep 8 px radius. Next: UI3 (app shell and route map).

### 2026-10-02 — UI1 done

Install banner, notification button and debug test button removed from the top of every page; new `/settings` page holds them (test button Parent-only, under Advanced). Menu shows only Home and Settings by role; `/` redirects by role. typecheck, lint, 337 tests, build all clean. Next: UI2 (design tokens, dark mode, primitives). Suggest promoting to production after UI1 (needs owner go-ahead and the account-management hosted steps first).

### 2026-10-02 — Design approved by the owner; plan written

Design spec and mockups produced by a research/design agent and approved by the
owner ("a hundred times better"). Owner answered the seven open questions (see
the decisions table in `IMPLEMENTATION_PLAN.md`): playful overdue wording,
encouragement messages yes, "Remind" button not now, test-notification tool to
Settings (Parent only), dark mode follows the phone, parent dashboard as
mockup, and anyone can add an expense for any child. No code has changed yet.
Next: `/continue-development` picks up UI1.
