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
| UI5 | Parent Home | done | Branch `feature/ui-redesign-p4b-parent-home`. Logic in `src/features/home/parent-home.ts`; household recent activity hook `useHouseholdRecentActivity`. Add expense / Record payment accept `?child=` as the starting choice. Export, Categories, Presets kept as a quiet "Household tools" line on Home because Settings doesn't link them yet -- remove in UI9. Overdue/due-soon attention cards and the payment encouragement line covered by component tests only (fixture had nobody due; no real payment recorded). |
| UI6 | Add expense and Record payment | done | Branch `feature/ui-redesign-p5-entry-forms`. Preview/shortcut maths in `src/features/ledger/entry-preview.ts`; shared pieces in `EntryFormParts.tsx`, `ui/ChoiceChips.tsx`, `ui/StickyActionBar.tsx`; balances via `useMemberBalances` (missing = no preview, never $0). Verifier: pass. Catch-up shortcut and the success screens covered by tests only (local Alex data is "Due Oct 15", not overdue). Presets/category tiles seen only with browser-faked data (local households have none). Sticky bar above the keyboard depends on the browser resizing the page; check on a real iPhone. |
| UI7 | Activity page | done | Branch `feature/ui-redesign-p6-activity`. `HistoryPage`/`useHistory` replaced by `ActivityPage` + `useActivity` (pages of 50, `.range()`, id tiebreak). Mockup's monthly totals line dropped on purpose (would sum only loaded rows); shows "Showing N". Adjustments reachable via "Only adjustments" in the Filters sheet. Verifier: pass. Load more covered by tests only (fixture has 6 rows). For UI10: in "Everyone", rows of an archived child show no child name (names come from the active-children list); dark-mode selected state of shared `Segmented` is low-contrast. |
| UI8 | Family and child page | done | Branch `feature/ui-redesign-p7-family`. `ManageMembersPage`/`PaymentPlanPage` replaced by `FamilyPage` + `FamilyMemberPage`; pieces in `src/features/family/`; reminder state via new `useMemberPushStatus` (yes/no only, so no device count). Previous/upcoming periods from the mockup dropped (no existing data source). Old `/child/:id/payment-plan`: Parent to `/family/:id`, anyone else to `/home`. Verifier: pass. Browser: Parent only, 375 px dark (list, Alex's page, replace-plan confirm then cancel, not-found); Child exclusion by router tests only. For UI10: a failed list re-read after a member change drops the success notice. |
| UI9 | Settings completion | todo | |
| UI10 | Polish, cleanup, final verification | todo | |

## Session log

_Newest entries on top._

### 2026-10-02 — UI8 done

Family list (avatar, role chip, login email, "You", plan status chip for children, reminders on/off icon, Archived section, Add member panel) and a page per person: balance with Expense/Payment buttons, payment plan card with current month progress and the unchanged create / replace-with-confirmation / deactivate-with-confirmation flows, recent activity with See all, and a Manage section (rename, change role, change email, set-password link, archive/restore) using the same server calls and messages as before. Parent members get no balance/plan; archived members get only Restore; unknown ids get "We couldn't find this person". Old member/plan pages deleted, their tests moved across (all 25 old cases). typecheck, lint, 760 tests, build clean (orchestrator re-ran). Verifier routed (member management, role change): pass. Browser: local Test Family as Parent at 375 px dark; started and stopped the local stack. Next: UI9 (Settings completion).

### 2026-10-02 — UI7 done

Activity page rebuilt to the mockups and the old History page removed. Parent: Everyone + one chip per child (kept in step with `?child=`), rows name their child in Everyone, Payment plan link when one child is selected, Export link. Type control All/Expenses/Payments/Voided (Voided = any voided row, asked of the server); Filters sheet with category, from/to and "Only adjustments", count badge. Rows grouped by day in the household time zone (Today/Yesterday), tap to expand: entered time, note, void details, and for Parents "Void this entry…" (same RPC and reason validation as before). Voided rows stay, struck through with a Voided chip. Child: own rows only, no chips/export/void, `?child=` ignored. Pages of 50 with Load more; failures on first load or load more show retry; empty and no-match states. No client money sums (monthly totals from the mockup deliberately dropped). typecheck, lint, 713 tests, build clean (orchestrator re-ran). Verifier routed (void control, household-wide read): pass. Browser: Parent and Child on the local Test Family at 375 px and desktop, light and dark (not every combination); one Test Family row ("Concert ticket") voided locally to see the voided state. Next: UI8 (Family and child page).

### 2026-10-02 — UI6 done

Add expense and Record payment rebuilt to the mockups. Add expense: presets (now labelled with amount, e.g. "Gas $20.00"), large amount field, "For" chips (same chooser rule as before — unlocked unless the household is `self_only`), category tiles with a best-guess icon from the category name, "What was it?", Today/Yesterday/Pick date chips (household time zone), note behind a disclosure, sticky "Add $X to Alex's balance" button with a "balance will be" line only when the caller can see that person's balance. Record payment: Payment/Adjustment radios, "Who paid?" rows with status chip and amount owed, Catch up / Minimum / Pay in full shortcuts (payments only), green "What this will do" before/after preview with a non-blocking "more than X owes" note, "Record $X from Alex" button; success panel unchanged (server numbers). Description stays required on payments (existing validation); Yesterday chip added to payments too. Accessible names changed on purpose (dropdowns became radiogroups, Save buttons renamed), tests updated. Verifier routed (money display): pass; orchestrator fixed its one a11y note (member-choice error now linked via `aria-describedby`). Its other note, the over-balance note also shows for adjustments, was accepted as intended. typecheck, lint, 700 tests, build clean. Browser: Parent and Child checked at 375 px and desktop (some views by DOM inspection after screenshots stopped working); Child at `/new/payment` bounced home. Decision 7 says the locked `add-expense-child.html` mockup is superseded; mockup file left as-is (historical). Next: UI7 (Activity page).

### 2026-10-02 — UI5 done

Parent Home rewritten to the mockup: household-time greeting, Needs attention (overdue and due within 7 days, worst first, inline Record payment, no Remind) or "Everyone is up to date", family total with "due by" line, ordered child cards (status chip, progress, Expense/Payment buttons prefilled via `?child=`, name opens `/family/:id`), 4-row household recent activity with child names and voided rows marked, bottom device nudge hidden while anything needs attention. Each data source loads and fails independently with Retry; page waits for plan data covering every child to avoid a "No plan"/"up to date" flash. Record payment success panel gains a seeded encouragement line (payments only). Midnight-in-Los-Angeles case tested. typecheck, lint, 631 tests, build clean (orchestrator re-ran). Browser: Parent home checked with real local data at 375 px light/dark and desktop dark; fixture Child still sees Child Home with no payment/void/family links. No route changes. Next: UI6 (Add expense and Record payment).

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
