# Family Ledger UI redesign: design specification

> **Owner decisions 2026-10-02 supersede section 10 and any conflicting detail below** (playful overdue copy, encouragement yes, no Remind button, test tool under Settings > Advanced for Parents, dark mode follows the phone, child chooser in Add expense stays unlocked for everyone). See `IMPLEMENTATION_PLAN.md`.


Status: proposal (design only; no application code changed). Audience: implementing agents and reviewers.
Companion files: `OWNER_SUMMARY.md` (plain English), `mockups/index.html` (open in a browser; all screens, phone light and dark, desktop).

Standing rules in `CLAUDE.md`, `PROJECT_REQUIREMENTS.md` and `ARCHITECTURE.md` still bind. Nothing here changes authorization, money handling, the ledger model, or cost. Every permission shown in a mockup is a *presentation* of what RLS already enforces; hiding a control is never the control.

---

## 1. Method and what was and was not done

- **Skills.** Searched the installed list and the open skills registry (`npx skills find`). Relevant, widely installed, not installed here (installing writes outside `docs/proposals/ui-redesign/`, which this task forbids): `anthropics/skills@frontend-design`, `vercel-labs/agent-skills@web-design-guidelines` (UI review checklist), `designed-by-ai/skills@design-mobile-apps`. Recommendation: install `web-design-guidelines` before the implementation phases and run it as a review pass on each phase. The `artifact-design` skill is for hosted pages, so it was not used; the mockups are plain static files.
- **Research.** Web search on Splitwise, Copilot, YNAB, Greenlight, GoHenry and PWA install UX (sources at the end). Findings are condensed in section 2. Search results were summary-level; the principles below also reflect standard practice (WCAG, platform guidelines), not just those pages.
- **Running the current app.** The dev server starts (`npm run dev`), but Docker's engine is not running and the app needs a signed-in Supabase session, and I do not type credentials, so I could not screenshot signed-in screens. Everything below about the current UI is from reading the code (`RootLayout.tsx`, all pages, `InstallBanner.tsx`, `PushSubscribeButton.tsx`, `PushTestSendButton.tsx`, `tailwind.config.js`).
- **Mockups** were rendered and checked in the browser pane at 375 px and about 1100 px, light and dark. They are static HTML with a few tiny scripts (theme toggle, "+" sheet, selectable chips, dismissible nudge). Tokens and contrast were computed (section 6.2).

## 2. Lessons that matter for this app

1. **Lead with the answer, not the list.** Splitwise research: people want "how much, to whom" first, and the expense list is the wrong hero. Hero = balance; list = supporting.
2. **Say what to do, not what is.** Replace "owed/owes" jargon-style pairs with direct sentences: "Alex is $15.00 behind", "You owe $187.32".
3. **One status vocabulary, never colour alone.** Every status = icon + word + colour (WCAG 1.4.1, already a project requirement).
4. **Separate "total owed" from "due now".** The requirements already insist on this; the UI makes it two different visual levels (big total, smaller due line with a progress bar).
5. **Money typography.** Tabular figures so columns align; smaller cents superscript on hero amounts only (never in lists, where it hurts scanning); explicit minus sign U+2212 for payments plus green plus a "Payment" label; no red for a plain balance (owing is normal in a household; red is reserved for overdue).
6. **Primary action within thumb reach.** Centre "+" in the bottom bar (mobile) and "New entry" at the top of the sidebar (desktop). Add expense is two taps from anywhere, one tap from Home.
7. **Smart defaults over fields.** Quick-add presets first, today pre-selected, child locked for Children, "Catch up $15.00 / Minimum / Pay in full" amount shortcuts for payments.
8. **Show consequences before saving.** Primary button names the result ("Add $42.17 to Alex's balance"); payment screen previews the new balance.
9. **Empty states teach.** "Nothing owed", "No activity yet" each say what happens next.
10. **Install and notification prompts are earned and quiet.** web.dev guidance: keep promotion out of the user's task flow, defer the native prompt, make it dismissible, remember the dismissal, re-offer only when circumstances change. Greenlight/GoHenry-style kid apps keep onboarding in settings or a one-time card, not on every screen.
11. **Kids' apps separate roles cleanly.** Greenlight and GoHenry both ship a distinct child view. Here: Children get fewer tabs and no admin vocabulary; Parent-only controls are absent, not disabled.

## 3. Inventory of the current app

### 3.1 Routes (from `src/app/router.tsx`)

| Route | Who | Purpose |
|---|---|---|
| `/` | all | redirects to `/parent` (even for Children, who then bounce through `RequireRole`) |
| `/parent` | Parent | household overview: per-child balance + plan chip, "+ Expense", "Record Payment", four link-buttons (Export, Members, Categories, Presets) |
| `/child` | Child | "You Owe" balance, plan card, "+ Add Expense", 5 recent transactions |
| `/add-expense` | all | form: quick-add presets, child (locked for Child), amount, category, description, note, date |
| `/record-payment` | Parent | Payment / Adjustment toggle, child, amount, date, note; result screen with balance and period effect |
| `/child/:id/history` | owner or Parent | history with filters (type, category, from, to), Parent can Void with reason; Parent link to plan |
| `/child/:id/payment-plan` | owner (read) / Parent (edit) | create, replace, deactivate monthly plan |
| `/members` | Parent | add member, rename, change role, create set-password link, archive/restore |
| `/parent/categories`, `/parent/presets` | Parent | add/rename/deactivate categories; add/edit/deactivate presets |
| `/export` | Parent | ledger CSV, full JSON backup |
| `/sign-in`, `/set-password` | public / link | sign in; set password from a link |
| `/account` | signed in | change password only |

### 3.2 Problems found in the shell (the owner's complaint, confirmed in code)

- `RootLayout` renders, above every page's content: header, nav, session line, then `InstallBanner`, `PushSubscribeButton`, `PushTestSendButton`, and only then the page. On a phone that is a screenful of chrome.
- The `PushTestSendButton` is a *debug spike control* ("Debug: test push delivery") shown to every signed-in member with a subscription, children included.
- Nav shows **Parent** and **Child** links to everyone, plus **Sign in** while signed in, plus "Change my password" as a top-level item.
- `/` always goes to `/parent`.
- No shared UI components exist except `ToggleField`; each page repeats long class strings. No icons, no dark mode, one weight of card, amounts same size as body text, and the only hierarchy is font size. `owed` red is used for every balance label in places.
- The dashboard rows are links to *history* (so "Parent dashboard to child" skips the child's overview and plan); plan management is hidden behind History.
- Children only see Recent (5 items) with no link to their full history (the route exists but nothing links to it from `/child`).

### 3.3 Needs per role, ranked by frequency and importance

**Parent** (weekly-ish, mostly phone): 1) who is behind or due soon and what do I do about it; 2) record a payment that just happened; 3) add an expense after a purchase; 4) see each child's total and plan progress; 5) look up "what was that charge" (history, filter, void a mistake); 6) rare: change a plan, add/archive a member, categories/presets, export/backup; 7) account and device settings (almost never).

**Child** (opens when reminded or after spending): 1) how much do I owe and what is due when; 2) add an expense I just made; 3) see my recent activity and confirm a payment was recorded; 4) rare: account/password, turn on reminders. A Child must never see, or be offered, anything that implies reducing a balance.

## 4. Information architecture and navigation

### 4.1 Mobile (under 900 px): bottom tab bar with a centre action

Parent: **Home**, **Activity**, **[+]**, **Family**, **Settings**.
Child: **Home**, **Activity**, **[+]**, **Account**.

- "+" opens a sheet (Parent: "Add an expense" / "Record a payment"; Child: goes straight to Add expense, because that is the only thing they can add; the sheet is skipped for Child in the real build, shown in the mockup only for consistency of the layout).
- Four to five destinations, all labelled, 48 px high touch targets, current page uses `aria-current="page"` and colour plus weight.
- Tab bar respects `env(safe-area-inset-bottom)`.
- Full-screen task pages (Add expense, Record payment) hide the tab bar and show a sticky bottom action button, so the primary button is always under the thumb and above the keyboard.

### 4.2 Desktop (900 px and up): left sidebar

Same destinations as the tab bar, a "New entry" button at the top, signed-in person at the bottom. Content max width 1040 px. Home becomes a two-column layout (attention and children on the left, recent activity on the right). Add expense and Record payment centre at 560 px; the "+" opens a centred dialog.

### 4.3 Route map (old to new; old URLs keep working via redirects)

| New | Old / source | Notes |
|---|---|---|
| `/` | redirect by role | Parent to `/home`, Child to `/home` (one route, role picks the component) |
| `/home` | `/parent`, `/child` | `/parent` and `/child` redirect to `/home` |
| `/activity` | `/child/:id/history` | Parent: all children with a child filter chip; Child: own only. `/child/:id/history` redirects to `/activity?child=:id` |
| `/new/expense` | `/add-expense` | keep `/add-expense` as redirect |
| `/new/payment` | `/record-payment` | Parent only; keep redirect |
| `/family` | `/members` | list with plan status chips and reminder bell |
| `/family/:id` | new; absorbs `/child/:id/payment-plan` | balance, plan (view/edit), recent, rename, role, set-password link, archive |
| `/settings` | `/account`, `/export`, `/parent/categories`, `/parent/presets` | sections: Account, This device, Household (Parent), Export and backup (Parent). Categories and presets become sub-pages `/settings/categories`, `/settings/presets` |
| `/sign-in`, `/set-password` | same | no app chrome |

Role guards stay exactly as today (`RequireRole` plus RLS). Nav items are *built from the role*, so a Child's bar has no Family tab; direct URL access is still blocked server-side.

## 5. Screens

All are in `mockups/`. Numbers are fake.

### 5.1 Parent Home (`parent-home.html`)

Order, top to bottom on a phone:
1. Greeting line (date, "Good morning, Dana").
2. **Needs attention** (count chip). One card per problem, worst first: overdue (red left border, `Overdue` chip, "Alex is $15.00 behind", "September minimum, due Sep 15, 17 days overdue", buttons *Record payment* and *Remind*), then due within 7 days (amber, "Due in 3 days"). The section is *absent* when nothing needs attention; replaced by a single calm line "Everyone is up to date".
3. **Owed to the family**: total as the one big number, with "$85.00 due by Oct 15" as a secondary line.
4. **Children**: one card each: avatar, name, status chip, balance (hero cents style), a progress bar and "paid of minimum" line when a plan is active, and *Expense* and *Payment* buttons (prefilled with that child). Order: overdue first, then due soonest, then paid up, then no plan. Tapping the name opens `/family/:id`.
5. **Recent activity** (4 rows, "See all").
6. Optional one-line device nudge (section 7).

Desktop: total across the top, attention and children left, recent activity right.

"Remind" depends on a manual-reminder backend function that does not exist yet (only `push-test` does); see phases and risks. Until then the button is omitted.

### 5.2 Child Home (`child-home.html`, `child-home-empty.html`)

1. Greeting.
2. **You owe** card: hero amount; if overdue, a tinted callout "$15.00 is overdue. Was due Sep 15. Please pay a parent." (wording is a product question, section 10); progress bar "$25.00 of $40.00 paid this month"; "Next minimum: $40.00 due Oct 15".
3. Full-width primary **Add an expense** button.
4. Recent activity (3 to 5, "See all" now exists).
5. Quiet note "Payments are recorded by a parent" (mockup annotation; real copy goes in the empty/overdue callout, not a permanent box).
6. Optional one-line device nudge.

Empty state when nothing is owed: "$0.00 / All caught up" with encouragement to log things a parent covered, and a teaching empty-activity card.

### 5.3 Add expense (`add-expense.html`, `add-expense-child.html`)

Full screen, tab bar hidden. Order is tuned for speed: Quick-add presets, big amount field (numeric keypad, `inputmode="decimal"`, parsed with the existing decimal-safe code), *For* (child chips; Child sees a locked "You (Alex)" row), category tiles (icon + label, 4 columns), "What was it?", date chips (Today / Yesterday / Pick date), optional note disclosure. Sticky button reads "Add $42.17 to Alex's balance", with "Alex's balance will be $229.49" beneath. Validation errors appear inline under the field and in an announced summary; failure to save shows a retry state (no offline queue, ADR-007). Choosing a preset fills amount, category and description but keeps everything editable (requirement 8).

### 5.4 Record payment (`record-payment.html`, Parent only)

Payment / Adjustment segmented control (existing capability; Adjustment is the existing "Adjustment" type). Child rows show their current status so the parent picks the right one. Amount shortcuts: **Catch up $15.00**, **Minimum $40.00**, **Pay in full $187.32**. Green "What this will do" preview: new balance now; the period effect is shown *after* save from the existing function result, with the preview limited to balance unless a read-only server calculation is added later (flagged as a risk). Green button (existing `settled` colour = "balance goes down") "Record $15.00 from Alex". The success screen keeps today's content: new balance and effect on the period.

### 5.5 Activity (`history.html`, `history-child.html`)

Header with Filters button (count badge). Parent: child chips (Everyone, each child). Type segmented control: All, Expenses, Payments, Voided. A one-line summary of the filtered range (totals) and, for Parents, an Export link. Rows grouped by day; each shows icon, description, "child, category, who added", amount. Tapping a row expands it in place: timestamp, note, and for Parents *Void this entry* (destructive style, opens the existing reason form; voided rows are struck through with a *Voided* chip and keep their reason). Filters sheet holds category and from/to date (today's controls). Child sees only their own, no void control, no export.

### 5.6 Family and child page (`family.html`, `child-detail.html`, Parent only)

List: avatar, name, role chip, email, plan status chip, bell icon (reminders on or off, from the existing push-status function). "Add member" button. Child page: balance with Expense/Payment buttons; payment plan card (amount, due day, status, current period progress, previous and upcoming periods with chips); recent activity; "..." menu for rename, change role, create set-password link, archive. Plan editing (create, replace, deactivate) reuses today's forms and confirmations, moved here.

### 5.7 Settings and Account (`settings-parent.html`, `settings-child.html`)

Sections: **Account** (who you are, change password, appearance Light/Dark/Auto, sign out); **This device** (Install the app, Payment reminders switch, iPhone explanation); **Household** (Parent: members, categories, presets); **Export and backup** (Parent: CSV, JSON); **Advanced** collapsed (Parent only: send a test notification; the debug button moves here and is never shown to Children).

### 5.8 Sign in (`sign-in.html`)

No nav, no install or notification UI, title and one sentence. Forgot-password copy depends on how recovery works today (ask a parent for a set-password link).

## 6. Visual system

### 6.1 Principles

Calm, trustworthy, a little warm; "banking app clarity without bank seriousness". Big readable numbers, generous whitespace, soft 16 px cards, one accent colour, status colours used sparingly and always with an icon and a word. No decorative gradients or illustrations.

### 6.2 Colour tokens (light / dark) and contrast

Defined as CSS variables on `:root` and `:root[data-theme="dark"]` (plus `prefers-color-scheme` when theme is Auto), exposed to Tailwind as `rgb(var(--x) / <alpha-value>)` colours so existing class names keep working during migration.

| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` (page) | #f5f6f8 | #0d1015 | page background |
| `surface` | #ffffff | #151a21 | cards |
| `sunken` | #eceff3 | #10141a | wells, tracks, neutral chips |
| `border` / `border-strong` | #dde1e7 / #c4cad3 | #262d37 / #38414d | hairlines / inputs |
| `ink` | #14181f | #eef1f5 | primary text |
| `muted` | #454e5b | #b4bdc8 | secondary text |
| `subtle` | #5b6573 | #97a1ae | tertiary text (still AA) |
| `accent` | #1f5aa6 (text on it #fff) | #6aa5ef (text on it #08131f) | primary buttons, focus |
| `accent-text` / `accent-soft` | #174a8b / #e6eefa | #8dbcf5 / #182a44 | links, selected chips |
| `danger` / `danger-soft` | #a8321f / #fdecea | #ff9d8c / #3a1d19 | overdue only |
| `warn` / `warn-soft` | #7a4a00 / #fdf0d8 | #f2c06b / #38290f | due soon |
| `ok` / `ok-soft` | #1b6b3d / #e3f4ea | #74d39f / #14301f | paid, payments, "record payment" button |

Measured contrast ratios (WCAG, computed): light: ink on surface 17.8, muted 8.4, subtle 5.9 (5.1 on sunken), accent-text on surface 8.8, danger on danger-soft 5.9, warn on warn-soft 6.6, ok on ok-soft 5.7, white on accent 6.8. Dark: ink 15.4, muted 9.2, subtle 6.7, accent-text 8.9, danger 7.6, warn 8.4, ok 7.9, dark text on accent 7.3. All meet AA (4.5:1 text). Focus ring: 3 px `accent`, 2 px offset, ≥3:1 against both backgrounds.

Migration of the existing tokens: `ink`, `surface`, `accent`, `owed`, `settled` map to the new names (`owed` becomes `danger`, `settled` becomes `ok`); old class names stay as aliases until the last phase so each phase compiles and passes tests.

### 6.3 Typography

System font stack (no web font: zero bytes, instant, works offline). Money always `font-variant-numeric: tabular-nums`.

| Role | Size / line | Weight | Used for |
|---|---|---|---|
| display | 40 / 42 | 700 | one hero amount per screen |
| amount | 28 / 32 | 650 | per-child balance |
| title | 22 / 28 | 650 | page titles |
| head | 17 / 24 | 600 | section headings |
| body | 16 / 24 | 400 | default (never below 16 for inputs; avoids iOS zoom) |
| label | 14 / 20 | 400-600 | secondary text, buttons |
| caption | 12 / 16 | 400 | units, helper text (use sparingly) |

Hero money: `$187` large with `.32` at 0.6em superscript; list money: full-size `$42.17`, right-aligned, tabular. Payments: `−$25.00` (true minus) in `ok`, expenses `+$42.17` in `ink`. Screen-reader text for amounts is a full phrase ("187 dollars and 32 cents owed") via `aria-label` on the number.

### 6.4 Spacing, shape, elevation

4 px base grid; page gutter 16 px (24 at 900+ with 40 px content padding); card padding 16; vertical rhythm between sections 16; radius: cards 16, buttons 12, chips full, inputs 12; elevation: one soft shadow on cards in light, border only in dark. Touch targets 44 px minimum (existing `touch` token), 48 px for main buttons, 56 px for the main action.

### 6.5 Components (all small, local, no library beyond Radix)

Button (primary, ok, secondary, ghost, danger; sizes sm/md/lg), Card, AmountText (hero/list variants, sign handling, cents formatting via `formatCents` input), StatusChip (kind, icon, label), ProgressBar (`role="progressbar"` with label), Avatar (initial), Chip/Pill toggle (Radix ToggleGroup), Segmented control (Radix ToggleGroup type="single"), Field (label, hint, error), CategoryTile, ListRow, Section header, EmptyState, Sheet/Dialog (Radix Dialog), Switch (existing Radix Switch via `ToggleField`), TabBar and Sidebar (one `nav` component, two layouts), TopBar, Toast/inline status (`role="status"`).

New Radix packages (free): `@radix-ui/react-dialog`, `@radix-ui/react-toggle-group`, `@radix-ui/react-dropdown-menu`, optionally `@radix-ui/react-collapsible`. Together they are small; no component framework (ADR-008 stands).

### 6.6 Iconography

Single set of about 30 stroke icons (1.9 px, round caps), shipped as an inline SVG sprite or a tiny `Icon` component; the mockups include the exact set (home, list, plus, users, user, sliders, alert, clock, check, checkc, half, dash, chevrons, bell, download, send, dollar, fuel, food, phone, car, ticket, book, tag, calendar, filter, logout, lock, mail, undo, file, ban, edit, more). Icons are always decorative (`aria-hidden`) next to text, or carry `aria-label` when alone. Alternatively `lucide-react` (tree-shaken) if the owner of the code prefers; same visual style.

### 6.7 Status vocabulary (one source of truth)

| Period status | Icon | Chip text (Parent) | Chip text (Child) | Colour |
|---|---|---|---|---|
| overdue | alert triangle | "$15.00 overdue" | "Overdue" | danger |
| due (within 7 days or due today) | clock | "$30.00 due Oct 5" | "Due Oct 5" | warn |
| partially paid | half circle | "$25 of $40 paid" | same | accent/info |
| satisfied | check circle | "October paid" | "Paid for October" | ok |
| upcoming (more than 7 days) | calendar | "Due Oct 15" | same | neutral |
| waived | dash | "Waived" | "Waived" | neutral |
| no plan | dash | "No plan" | (nothing shown) | neutral |
| balance zero | check circle | "All caught up" | "All caught up" | ok |

The "7 days" window is a presentation constant; "overdue", "due", "today" come from the existing household-time-zone logic, never the browser clock (standing rule).

### 6.8 Motion

Subtle and optional: 150 ms transitions for toggles, sheet slide-up 200 ms ease-out, progress fill 300 ms on first paint, nothing else. All wrapped so `prefers-reduced-motion: reduce` removes it (the mockup CSS already does).

### 6.9 Accessibility checklist (keeps the WCAG AA target)

Landmarks (`header`, `nav aria-label="Main"`, `main`); one `h1` per page; every input has a visible label; errors tied with `aria-describedby` and announced; status never colour-only; progress bars have names and values; focus ring on all controls; tab bar and sidebar are real links; dialogs trap focus and return it (Radix); text resizes to 200% without loss (rem units, flexible rows); touch targets at least 44 px; amount text has a spoken form; dark mode and Auto honour `prefers-color-scheme`; no information only in hover.

## 7. Install and notification prompts

Principle: neither is ever above the content, neither is a section, and neither appears more than one at a time.

1. **Permanent home: Settings, "This device".** Install row (button; on iPhone, a short "Share, then Add to Home Screen" note) and a Payment reminders switch. This is where the full explanation, the failure messages (`denied`, `error`, `unsupported`, `ios-install-required`) and the current state live. All logic in `install-prompt.ts` and `push-subscribe.ts` is reused unchanged; only the presentation moves.
2. **One-line nudge at the *bottom* of Home**, below the activity, text size, no box shadow: "Get a nudge when a payment is due. Turn on | x". Rules: shown only when the device is not subscribed and notifications are supported; install nudge instead if not installed and push needs install (iPhone); never both; never above the fold; never on task pages; the x snoozes for 30 days (store timestamp in localStorage, like today's dismissal flag); dismissing twice hides it for good (still in Settings). Never shown while there is something in Needs attention.
3. **Contextual ask** (optional later): after a Child's first successful expense, a one-time toast "Want a reminder before payments are due?" with Turn on.
4. The **debug push test** moves to Settings, Advanced, Parent only, and is removed from Children.
5. A Parent sees each child's reminder state as a bell icon in Family, so the parent can ask the child to turn it on rather than the app nagging.

## 8. Mapping onto the current code

Tailwind: add `darkMode: ["selector", '[data-theme="dark"]']` (or media + attribute), colours as CSS variables, keep `label/body/title/amount` font sizes and add `display`, `head`, `caption`; add radius `xl2` (16), keep `card` as alias. Add `tabular-nums` utility use through an `AmountText`. `index.css`: add the `:root` token blocks and a tiny `prefers-color-scheme` block.

| File | Change |
|---|---|
| `tailwind.config.js`, `src/index.css` | tokens, dark mode, type scale |
| `src/app/RootLayout.tsx` | becomes `AppShell`: role-aware tab bar / sidebar; removes `InstallBanner`, `PushSubscribeButton`, `PushTestSendButton`, session text, Parent/Child/Sign-in links |
| `src/app/router.tsx` | new routes plus redirects from every old path |
| `src/features/auth/SessionStatus.tsx` | folded into Settings Account section and sidebar footer |
| `src/features/pwa/InstallBanner.tsx` | becomes `InstallRow` (Settings) and `DeviceNudge` (Home); keep `install-prompt.ts` and its tests as is |
| `src/features/push/PushSubscribeButton.tsx` | becomes `ReminderSwitch` (Settings) reusing its state machine; `PushTestSendButton` moves under Advanced (Parent) |
| `ParentDashboardPage`, `ChildDashboardPage` | rewritten as `HomePage` variants; reuse `useHouseholdBalances`, `useHouseholdPaymentProgress`, `useOwnBalance`, `useChildPaymentProgress`, `useRecentActivity` |
| `AddExpensePage`, `RecordPaymentPage` | same logic and validation (`add-expense.ts`, `record-transaction.ts`), new layout and sticky action; tests keep passing because labels and roles are preserved or updated deliberately |
| `HistoryPage` | becomes `ActivityPage`; `useHistory` gains an optional "all children" mode for Parents (read-only query; RLS already lets Parents read the household ledger; **no migration**); void flow unchanged |
| `PaymentPlanPage`, `ManageMembersPage` | split into `FamilyPage` and `FamilyMemberPage`; forms and confirmations reused |
| `ManageCategoriesPage`, `ManagePresetsPage`, `ExportPage`, `AccountPage` | become Settings sub-pages with a back arrow |
| New `src/components/ui/*` | primitives from 6.5 |
| New data needs | household-wide recent activity (client query, no schema change); days-overdue and "due within 7 days" derived from existing progress hooks plus the household time zone helper in `lib/dates.ts`; "Remind" needs a new Edge Function (separate, later, Parent-only, rate-limited, audited) |

## 9. Phased rollout (each phase ships alone; the app works after each)

Each phase: branch, implement, `npm run typecheck`, `lint`, `test` (and `test:db` only if the database is touched, which it is not until phase 8), review in light/dark at 375 px and desktop, then merge. Existing tests are updated in the same phase as the UI they cover.

1. **Quiet the top (smallest, biggest win).** Move install banner and notification button out of `RootLayout` into a new `/settings` page "This device" section; remove the debug button for Children; fix the nav so it shows Home/Settings by role and drops the Parent/Child/Sign-in clutter; `/` redirects by role. Old pages unchanged. Test: banner and push button no longer render on dashboards; settings page renders them; role redirect.
2. **Design tokens and primitives.** CSS variables, dark mode, type scale, `Button/Card/AmountText/StatusChip/ProgressBar/Field`, icon set, plus a plain "components" test page route behind dev only. No page changes. Test: unit tests for `AmountText` formatting and chips, contrast script in CI.
3. **App shell.** Tab bar and sidebar, route map with redirects. Pages still old inside the new frame.
4. **Homes.** New Child Home then Parent Home, including Needs attention and the status vocabulary; add the home-bottom nudge. Test: states (loading, error with retry, empty, overdue, due, paid, no plan), role isolation.
5. **Add expense and Record payment** redesign, sticky actions, shortcuts, balance preview. Test: all existing form tests, plus child cannot reach payment UI (and DB tests unchanged).
6. **Activity.** Merge history, child filter chips, household-wide Parent view, expandable rows, void flow intact. Test: filter logic (existing `history.ts` tests), Parent vs Child views.
7. **Family and child page.** Members, plan editing relocated, reminder bell.
8. **Settings completion.** Appearance (Auto/Light/Dark stored per device), categories, presets, export, backup, Advanced.
9. **Manual reminder ("Remind")** (only if the owner wants it): new Edge Function plus audit row plus DB test; the only phase touching the backend.
10. **Polish and cleanup.** Motion, empty-state copy, accessibility pass with the review skill and a keyboard/screen-reader walk-through, remove old class aliases and dead components, update `docs/DEPLOYMENT_RUNBOOK.md` if install or reminder instructions changed, verify with `wrangler dev` that deep links (e.g. `/family/…`) return 200.

## 10. Open product questions for the owner

Also listed, in plain English, in `OWNER_SUMMARY.md`.

1. Should the child's overdue message be gentle ("$15.00 was due Sep 15") or firm ("Overdue, please pay a parent")?
2. Do you want a "Remind" button that sends a push to a child's phone (requires new backend work), or are automatic reminders enough?
3. Should kids see an encouraging touch (e.g. "Two months paid on time") or stay plain and factual?
4. Should the household total ("owed to the family") be shown on the Parent home, or would you rather keep each child's number separate?
5. Should the debug "send a test notification" tool be removed entirely?
6. Dark mode: follow the phone's setting automatically (proposed) or offer only light?
7. Can children see each other's names when choosing who an expense is for (policy default allows it) or should the child chooser stay locked to themselves?

## 11. Risks

- **Scope creep into a reskin plus features.** Mitigation: phases 1-8 reuse existing data hooks and RPCs; only phase 9 touches the backend.
- **Tests tied to old markup.** Many page tests query labels and roles. Mitigation: keep accessible names stable; update tests in the same phase.
- **Windows/wrangler routing.** New nested routes must be checked via `wrangler dev`, not `vite preview` (CLAUDE.md).
- **Household-wide Activity query performance** for large histories: paginate (limit 50, "load more") from day one.
- **Presentational "Needs attention" can drift from server truth.** Derive only from existing progress data; never compute ledger math in the client; the payment-effect preview shows balance only.
- **Dark mode contrast regressions.** Contrast table is the contract; add a small script test that recomputes ratios from the token file.
- **iOS PWA quirks** (safe-area, 100vh, keyboard covering sticky buttons): use `100dvh`, `env(safe-area-inset-*)`, test on a real iPhone before phase 5 ships.
- **Install and notification logic is subtle** (already has tests). Move presentation only; keep the state machines and tests.

## 12. Mockup index

`mockups/index.html` (gallery), `parent-home.html`, `child-home.html`, `child-home-empty.html`, `add-expense.html`, `add-expense-child.html`, `record-payment.html`, `history.html`, `history-child.html`, `family.html`, `child-detail.html`, `settings-parent.html`, `settings-child.html`, `sign-in.html`. Add `?theme=dark` to any URL to force dark; `?sheet=1` opens the "+" sheet. The mockups are generated from shared CSS but each file is self-contained (no network).

Sources consulted: Splitwise UX case studies (uxdesign.cc, uxplanet.org); Copilot Money UI breakdown (screensdesign.com); Greenlight and GoHenry overviews (moneyprodigy.com, womenwhomoney.com); web.dev "Patterns for promoting PWA installation"; MDN "Making PWAs installable"; skills registry listings on skills.sh.
