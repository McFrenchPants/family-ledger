# Implementation plan: UI redesign

Branch: one feature branch per phase, named `feature/ui-redesign-pN-<slug>`,
each cut from `main` and merged to `main` when its phase passes (the app must
work after every phase). Design: `DESIGN_SPEC.md` (the technical detail) and
`mockups/` (the visual target; open `mockups/index.html`). `OWNER_SUMMARY.md`
is the plain-English version. This file adds the owner's decisions and turns
the spec's rollout list into task packets.

**Design only has been done so far. No application code has changed.**

## Owner decisions (2026-10-02) — these override the open questions in the spec

| # | Question | Decision |
| --- | --- | --- |
| 1 | Child's late-payment wording | Playful, not gentle or stern. Example: "$15.00 is overdue. If this were a real lender, you'd be paying a late fee!" Keep it light, never shaming; always include the amount and the due date. Several variants may rotate (client-side, deterministic per day so it does not flicker). |
| 2 | "Remind" button for parents | **Not now.** Dropped from this plan (spec phase 9). Revisit only after push notifications are confirmed on real Android and iPhone devices and the reminder system (Phase 5) exists. |
| 3 | Encouragement for kids | **Yes.** Short, fun messages when a payment is recorded and when a balance reaches zero. See "Encouragement" below. |
| 4 | Family total on Parent home | Keep as in the mockups. The owner is happy with the mockup's dashboard as drawn. |
| 5 | Test-notification tool | Move to Settings, Advanced, Parent only (as in the spec). Remove it from Children. |
| 6 | Dark mode | Follows the phone setting automatically (default "Auto"), with an Auto/Light/Dark switch in Settings. |
| 7 | Who an expense can be added for | Owner wants anyone to be able to add an expense for anyone. **The existing rule already allows this** (`PROJECT_REQUIREMENTS.md` §Add expense: any household member can create a positive expense for themselves or another child), so keep the child chooser **unlocked**: every role picks any child. Do not use the locked version in `add-expense-child.html`; update that mockup/spec note. No backend change. Expenses can only be recorded against a child, because the ledger models what children owe parents; "an expense owed by a parent" is not part of the model and is out of scope (see Out of scope). |

### Encouragement (decision 3) — rules for the implementer

- Purely client-side presentation. No new tables, no new backend, no stored
  "streaks". Derive from data the app already reads (recent transactions,
  balance, payment progress).
- **Where it appears:**
  - Parent, right after recording a payment: the existing success confirmation
    gains a fun line (e.g. "Nice. Alex is $40.00 closer to zero.").
  - Child home: when a payment has been recorded since the child last opened
    the app (remember the newest transaction id they have seen in
    `localStorage`, guarded by try/catch; first ever visit shows nothing), show
    a dismissible card once ("Payment received: $25.00. Look at you go!").
  - Child home, balance is zero: a celebratory "Paid off!" state in place of the
    owe card (calm confetti-free by default; respect `prefers-reduced-motion`).
  - "Paid on time" for the current month, when the payment-plan progress already
    says satisfied.
- Children must never see anything that suggests they can reduce their own
  balance; messages are announcements, never buttons.
- Copy lives in one file, `src/lib/messages.ts`, as small arrays with a
  `pick(seed)` helper so tone can be changed in one place. Tone: light, warm,
  a little cheeky; no emoji required; nothing about shame, rank, or comparing
  siblings.
- Must be announced to screen readers politely (`aria-live="polite"`), and not
  rely on colour or animation alone.

## Global rules for every phase

1. Standing rules in `CLAUDE.md` still apply: the browser is untrusted (UI-only
   permission checks are decoration, not controls; keep every server rule),
   integer cents, no offline write queue, no new paid service, keep it small.
2. **No migrations, no Edge Function changes, no RLS changes in any phase.**
   Every phase is front-end only. If an implementer finds a phase needs one,
   it reports `scope_change_requested` instead of doing it.
3. Reuse existing hooks, RPC calls and validation (`useHouseholdBalances`,
   `useHouseholdPaymentProgress`, `useOwnBalance`, `useChildPaymentProgress`,
   `useRecentActivity`, `add-expense.ts`, `record-transaction.ts`, `history.ts`,
   `install-prompt.ts`, `push-subscribe.ts`). Presentation changes only; their
   tests must keep passing.
4. Keep accessible names (labels, roles) stable where existing tests rely on
   them; where a name changes on purpose, update the test in the same task.
5. Every phase: `npm run typecheck`, `npm run lint`, `npm run test` clean, and
   `npm run build`. Check in the browser at 375 px wide and desktop width, in
   light and dark, and for **both roles** (Parent, Child). Check loading,
   error-with-retry, and empty states. Keep WCAG AA: contrast, 44 px touch
   targets, visible focus, reduced motion, status never by colour alone.
6. Verification tier: **default** (orchestrator spot-check plus the commands
   above) for all phases. Exceptions that are verifier-routed: none planned,
   because nothing touches authorization, persistence, money logic or push
   credentials. But phases 4 and 5 render money and permissions-sensitive UI,
   so for those the orchestrator must also run a live check that a Child
   cannot reach any payment, void or member screen (by route and by menu).
   Money formatting stays in `lib/currency.ts`; never do arithmetic on floats.
7. Routing: any phase adding or renaming routes must be verified through
   `npm run build` then `npx wrangler dev` (deep links return 200), not
   `npm run preview` (it hides routing failures).
8. Local data: the local Supabase stack needs Docker. Phases can be built
   against it for realistic checking (`npx supabase start`, seed, then
   `npx supabase stop` when done). If Docker is unavailable, fall back to
   component tests with mocked data and say so in the progress log.
9. Old URLs keep working via redirects until phase 9 confirms nothing links to
   them (bookmarks, installed-app shortcuts, the set-password link path).
   `/set-password` and sign-in must never be moved or redirected in a way that
   drops the URL fragment.

10. **Mockups are the visual target.** Every task packet must list
   `docs/proposals/ui-redesign/mockups/**` and `DESIGN_SPEC.md` in its
   `read_paths`. Implementers read the mockup HTML/CSS for exact layout, spacing,
   copy and tokens, and should open the page in the browser tool to compare their
   result at 375 px and desktop width (add `?theme=dark` for dark). Exception:
   `add-expense-child.html` shows a locked child chooser, which owner decision 7
   overrides; use `add-expense.html` for every role.

## Tasks

| ID | Phase | Task | Depends on |
| --- | --- | --- | --- |
| UI1 | 1 | Quiet the top: move install + notifications into a Settings page, fix menu, role redirect | none |
| UI2 | 2 | Design tokens, dark mode, type scale, icon set, primitives | UI1 |
| UI3 | 3 | App shell: role-aware tab bar and sidebar, full route map with redirects | UI2 |
| UI4 | 4a | Child Home (with playful overdue text and encouragement) | UI3 |
| UI5 | 4b | Parent Home (Needs attention, family total, child cards, bottom nudge) | UI4 |
| UI6 | 5 | Add expense and Record payment redesign | UI3 |
| UI7 | 6 | Activity page (merged history, filters, household view for Parents) | UI3 |
| UI8 | 7 | Family and child page (members, plan editing, reminder-state bell) | UI3 |
| UI9 | 8 | Settings completion (appearance, categories, presets, export, advanced) | UI3 |
| UI10 | 9 | Polish, cleanup, accessibility pass, runbook, final verification | all |

UI4/UI6/UI7/UI8/UI9 are independent once UI3 is done and may be done in any
order; the order above is the recommended one (it makes the home screens, which
the owner sees first, land earliest). `max_concurrent_implementers` is 1 in
`.sdlc/project.yaml`, so run them one at a time.

### UI1 — Quiet the top (smallest, fixes the owner's main complaint alone)

- Create `/settings` (both roles) with a **This device** section containing the
  install control (a row with a button; on iPhone a short "Share, then Add to
  Home Screen" note) and a **Payment reminders** switch. Reuse the existing
  logic in `src/features/pwa/` and `src/features/push/` unchanged; only the
  presentation moves. Keep the failure states (`denied`, `error`, `unsupported`,
  `ios-install-required`) with their explanations here.
- Remove `InstallBanner`, `PushSubscribeButton` and `PushTestSendButton` from
  `RootLayout`.
- Put the test-notification control under **Settings > Advanced**, rendered only
  for Parents (and still rejected by the server for Children). Children no
  longer see it anywhere.
- Fix the top menu: show only what the signed-in role can use (Home, Settings
  for now; keep the existing page links reachable from their current places).
  Remove the "Parent / Child / Sign in" trio. Signed-out visitors see only the
  sign-in page. `/` redirects by role (Parent to the parent page, Child to the
  child page, signed out to sign-in) instead of always going to the parent page.
- Move "Change my password" (`/account`) link into Settings; keep the route.

Acceptance: (1) no screen shows an install banner, a notification button, or
the test button above its content; (2) Settings shows install and reminder
controls with the same states and messages as before; (3) a Child has no path to
the test-notification control; (4) `/` goes to the right place for each role and
for signed-out; (5) existing tests pass, with new tests for role-based menu,
redirect, and Settings contents.

### UI2 — Design tokens, dark mode, type scale, icons, primitives

- Colour tokens as CSS variables for light and dark exactly as in `DESIGN_SPEC.md`
  section 6.2 (contrast table is the contract); dark mode follows
  `prefers-color-scheme` by default and honors an explicit
  `data-theme="light|dark"` attribute set from a stored per-device choice
  (try/catch around storage). Apply the theme before first paint to avoid a
  flash.
- Type scale including `display`, `head`, `caption`; tabular numerals for money.
- Small local icon set (inline SVG components, no new dependency unless the
  orchestrator approves one that is tiny and tree-shaken).
- Primitives from spec 6.5 under `src/components/ui/`: Button, Card, AmountText,
  StatusChip, ProgressBar, Field, Sheet/Dialog (Radix), Tabs/Chips as needed,
  EmptyState, Toast. `AmountText` takes integer cents only.
- A script test that recomputes the contrast ratios from the token file and
  fails below 4.5:1 for text pairs and 3:1 for UI components.
- No page changes in this task except where required to keep the build green.

Acceptance: tokens and primitives exist with unit tests (money formatting,
status chip text+icon, progress bounds); the contrast test passes; dark mode
toggles correctly via OS setting and via attribute; build, typecheck, lint,
tests green; visual check of a throwaway dev-only components page (not shipped
to production routes).

### UI3 — App shell

- Replace `RootLayout` with `AppShell`: bottom tab bar under 900 px (Home,
  Activity, a centre + button opening an "Add" sheet, Family, Settings; Children
  see Home, Activity, +, Settings), left sidebar at 900 px and up. Built from the
  person's role; Parent-only entries must not render for Children, and Parent-only
  routes must stay behind the existing `RequireRole`.
- The centre "+" sheet offers Add expense for everyone and Record payment for
  Parents only.
- Implement the route map from spec section 4.3 with redirects from every old
  path. Pages inside can still be the old pages.
- Safe-area insets and `100dvh` for iOS; focus management and a skip link.

Acceptance: both roles navigate everywhere they could before; Child cannot see
or reach Parent entries (menu and direct URL); old URLs redirect; deep links
return 200 under `wrangler dev`; set-password and sign-in unaffected (fragment
preserved); tests for menu-by-role and redirects.

### UI4 — Child Home

- New `HomePage` variant for Children per spec 5.2 and `mockups/child-home*.html`:
  "You owe $X", due/overdue note, one large Add expense button, recent activity,
  a link to full Activity.
- **Overdue copy (decision 1):** playful wording with amount and date, from
  `src/lib/messages.ts`. Due-soon and on-track states get matching light copy.
- **Encouragement (decision 3):** the payment-received card, paid-off state, and
  on-time note as specified above.
- Empty state for a brand-new child with no expenses.
- Add the single-line device nudge at the bottom of Home (spec section 7): shown
  only when not subscribed and supported; snooze 30 days; dismissing twice hides
  it for good; never shown with something needing attention; never on task pages.

Acceptance: states covered by tests (loading, error with retry, empty, owes,
due soon, overdue, paid off, new payment since last visit, no plan); no control
on this page can lower a balance; message selection is deterministic for a given
day and has tests; nudge rules have tests.

### UI5 — Parent Home

- New Parent `HomePage` per spec 5.1 and `mockups/parent-home.html`: Needs
  attention (behind or due within 7 days, derived only from existing progress
  hooks and the household time zone helper, never recomputing ledger math),
  Record payment shortcut inline, family total, one card per child with progress
  bar and status chip, and a link to each child's page. The family total stays.
- Hide the nudge while anything is in Needs attention; no "Remind" button
  anywhere (decision 2).
- Success message after recording a payment includes the encouragement line.

Acceptance: states covered by tests; "Needs attention" matches existing status
data for the same inputs (including a case just across midnight in a non-UTC
household time zone); everyone-up-to-date state; Parent-only enforcement
unchanged.

### UI6 — Add expense and Record payment

- Re-layout both flows per spec 5.3 and 5.4 with a sticky action bar. Reuse
  `add-expense.ts` and `record-transaction.ts` validation unchanged.
- Add expense: **child chooser unlocked for every role** (decision 7); presets
  and categories kept; clear amount entry with decimal-safe parsing.
- Record payment (Parents only): shortcuts ("catch up", "pay the minimum", "pay
  in full") computed from existing progress data, and a "balance after" preview
  that is display-only (the server is still the authority).
- Failed write shows the existing retry/error state; no queueing (ADR-007).
  Duplicate-submit protection stays as is.

Acceptance: all existing form tests pass; new tests for shortcuts and preview
math in integer cents; a Child cannot reach Record payment by menu or URL.

### UI7 — Activity

- Merge history into `ActivityPage` (spec 5.5): child filter chips, type filter,
  expandable rows, void flow intact (Parent-only). Parents get an all-children
  view using a read-only client query (RLS already allows Parents to read the
  household ledger; no migration). Paginate 50 at a time with "load more" from
  day one. Children see their own activity and have an obvious link to it.
- Keep `history.ts` filter tests passing.

Acceptance: Parent vs Child views tested; voided rows remain visible and marked;
pagination works; no balance arithmetic on the client beyond what exists.

### UI8 — Family and child page

- Split payment-plan and member management into `FamilyPage` and `FamilyMemberPage`
  (Parent only), reusing forms and confirmations from `PaymentPlanPage` and
  `ManageMembersPage`, including the account-management dialogs (set-password
  link, role change, login email, archive/restore).
- Reminder-state bell per child from the existing push status function.

Acceptance: every member-management action still works with its confirmations and
error/retry states; existing member tests pass; Child cannot reach these pages.

### UI9 — Settings completion

- Appearance (Auto/Light/Dark, stored per device), categories, presets, export,
  backup, change password, and Advanced (Parent only: test notification). Sub-pages
  with a back arrow.

Acceptance: each moved page behaves as before; Parent-only items are not rendered
and not reachable for Children; theme choice persists and falls back safely when
storage is blocked.

### UI10 — Polish, cleanup, final verification

**Owner decision (2026-10-03):** the `web-design-guidelines` review skill is
installed (user-level, so it is available here). Priorities for this phase are
**functionality and visual consistency first**; accessibility is fine but not a
priority -- keep the WCAG basics already in place, fix accessibility findings
only when cheap, and don't let them displace functional or consistency work.
Use the skill's findings as a checklist, triaged by that priority.

- Motion kept subtle and reduced-motion safe; empty-state copy pass; accessibility
  walk-through (keyboard, screen reader labels, contrast, 44 px targets) using the
  `web-design-guidelines` review skill **if the owner has approved installing it**
  (it writes outside the repo, so ask first); otherwise a manual checklist.
- Delete dead components and old class aliases; remove redirects only if nothing
  links to them (otherwise keep).
- Update `docs/DEPLOYMENT_RUNBOOK.md` if install or reminder instructions changed.
- Verify with `npm run build` then `npx wrangler dev` that deep links return 200.
- Update `docs/PROJECT_REQUIREMENTS.md` if any user-visible behavior description
  is now out of date.

Acceptance: full suite green, bundle size reported before and after, both roles
walked end to end in a real browser on the local stack in light and dark at phone
and desktop widths, and a short before/after screenshot set saved under
`docs/proposals/ui-redesign/screenshots/`.

## Out of scope

- A manual "Remind" button and anything new in the notification backend
  (revisit after real-device push is confirmed and Phase 5 exists).
- Letting an expense be recorded against a parent (or any new debtor type): the
  ledger tracks what children owe parents. If the owner later wants parents to
  owe children or each other, that is a data-model change needing its own design.
- Any database, RLS, Edge Function or deployment-configuration change.
- New paid services or heavy UI libraries.

## Release

Each merged phase goes to `main` automatically under the standing rule.
Promoting `main` to `production` (the live site) needs the owner's live,
explicit go-ahead and an approval record each time; do not bundle a promotion
into a phase. Suggest promoting after UI1 (immediate relief), then after UI5
(both homes done), then at the end.

**Heads-up for whoever promotes:** account management (`main` only so far) is
still waiting on the owner's hosted setup steps in
`docs/DEPLOYMENT_RUNBOOK.md` section 7a. A promotion carries it live too, so
those steps must be done first.
