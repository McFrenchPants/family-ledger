# Implementation Plan: Phase 6 — Accessibility review

Scope for this slice: an audit-and-fix pass against `PROJECT_REQUIREMENTS.md`
§17's accessibility checklist. See `BACKLOG.md` item 7 — this is the last
of the six Phase 6 sub-pieces (categories/presets, export/backup, member
management, transaction filtering, notification preferences [still
blocked on Phase 4/5], accessibility review). No design spec: this is a
fix-what's-broken pass against an existing, already-mostly-followed
convention, not new architecture.

## Background for both tasks

An orchestrator-run audit (Explore agent, read-only) checked every page
under `src/pages/`, shared components under `src/components/`, and
`src/features/auth/`, `src/features/pwa/`, `src/app/` against all eight
§17 items. Six of the eight are **already fully compliant** — keyboard
access, form labels, color-alone status indication, and screen-reader
currency/status labels have no violations anywhere in the codebase and
should be treated as the established convention for any new UI (see
existing examples cited in each task below; don't relitigate these
patterns). The other two — contrast and (separately) three small,
unrelated one-file gaps — are real and in scope here.

No RLS/security-definer/auth/persistence changes in either task. Both stay
at the **default** verification tier (orchestrator spot-check + typecheck/
lint/test), not verifier-routed.

## Tasks

| ID | Task | Depends on |
| --- | --- | --- |
| A6.1 | Fix `ink-subtle` contrast token and sweep its usages | none |
| A6.2 | Fix touch-target, reduced-motion, and heading-hierarchy gaps | none |

Both tasks are independent and may be done in either order or in parallel.

### A6.1 — Fix `ink-subtle` contrast token and sweep its usages

**Problem:** `ink.subtle` (`tailwind.config.js:12`, `#8b939e`) computes to
~3.10:1 against the white `surface` background and ~2.85:1 against
`surface-sunken` (`#f4f5f7`) — both fail WCAG AA for normal text (4.5:1
minimum; `text-ink-subtle` is used at the 13px `text-label` size, which
does not qualify for the 3:1 large-text threshold). It's the app's default
color for secondary/meta text and is used at roughly 56 call sites across
~15 files in `src/pages/` and `src/components/` — timestamps, "Recorded
by …" lines, empty-state copy, disabled-field hints, helper text under
form fields, etc.

**Acceptance criteria:**
1. `ink.subtle` in `tailwind.config.js` is changed to a hex value that
   computes to **at least 4.5:1** contrast against both `#ffffff`
   (`surface.DEFAULT`) and `#f4f5f7` (`surface.sunken`) for normal-weight
   text. Show the computed ratios (a short calculation or a note of the
   tool/method used) in the completion report — don't just assert it
   passes.
2. The new value stays visually distinguishable from `ink.muted`
   (`#5b6470`, ~6.0:1) — i.e. don't just set `ink.subtle` equal to
   `ink.muted` and collapse the two-tier hierarchy the type scale is
   using elsewhere. A value in the ~`#6b7380`–`#727a86` range is a
   reasonable starting point, but pick whatever actually clears the ratio
   requirement while staying visibly lighter than `ink.muted`.
3. No call site needs to change — this is a single token definition change
   in `tailwind.config.js`; Tailwind's `text-ink-subtle` utility picks up
   the new value automatically everywhere it's used.
4. Do a visual sanity pass (browser preview, per this project's own
   `<verification_workflow>` conventions) over at least: `ParentDashboardPage`,
   `ChildDashboardPage`, `HistoryPage`, and `RecordPaymentPage` — these
   have the highest concentration of `text-ink-subtle` usage (dates,
   "Recorded by", helper text, empty states) — to confirm nothing reads as
   visually broken (e.g. a hover/disabled state that depended on the old,
   lighter value looking "faded" and now looks like normal-weight text).
   If the sandboxed browser can't reach the dev server (a known recurring
   limitation on this project — see prior Phase 6 session-log entries),
   fall back to reading the rendered DOM/computed styles and say so
   explicitly rather than asserting a visual check that didn't happen.

**Files:** `tailwind.config.js` only (plus whatever visual verification
touches, not code).

### A6.2 — Fix touch-target, reduced-motion, and heading-hierarchy gaps

Three small, independent, single-file fixes found by the same audit.
Bundled into one task because each is trivial in isolation and none
justifies its own task/subagent overhead — but verify and report on all
three separately in the completion report, not as one blended diff.

**Acceptance criteria:**

1. **Touch targets** — `src/features/auth/SessionStatus.tsx`'s "Sign out"
   button (currently `px-2 py-1 text-label` with no explicit height,
   rendered in the header on every page) gets the project's existing
   `min-h-touch` convention (see any button in `AddExpensePage.tsx` for
   the established pattern — `min-h-touch` plus enough horizontal
   padding that the click target doesn't look cramped next to it).
   `src/features/pwa/InstallBanner.tsx`'s "Dismiss" button (currently a
   bare underlined text link with no padding, rendered on every page
   until dismissed) gets the same treatment — `min-h-touch` plus
   sufficient padding, while keeping its current visual style (text link,
   not a filled button) since this project's install banner is
   deliberately lightweight.
2. **Reduced motion** — `src/components/ToggleField.tsx`'s Radix `Switch`/
   `Thumb` transitions (`transition-colors` at line 50, `transition-transform`
   plus `will-change-transform` at line 52) get a `motion-reduce:transition-none`
   (or equivalent Tailwind `motion-reduce:` variant) guard so the toggle
   snaps instead of animating when the user has requested reduced motion.
   `ToggleField` isn't wired into any page yet (grep confirms no
   `<ToggleField` usage outside its own file) — this fix has no visible
   behavior change today, but establishes the pattern before it ships.
3. **Heading hierarchy** — `src/pages/PaymentPlanPage.tsx`'s
   `ReplacePlanControl` renders `<h4>Replace plan</h4>` (line 346) directly
   under the page's `<h2>` (line 128) with no intervening `<h3>` anywhere
   in that branch — a level skip (h2 → h4). Change it to `<h3>`, matching
   the sibling `NoActivePlan` case (line 171) which already uses `h3` for
   the equivalent "no plan" state. Leave `DeactivatePlanControl` (line 602)
   alone — it has no heading today and adding one isn't part of this
   fix; don't invent new structure beyond correcting the existing skip.

**Files:** `src/features/auth/SessionStatus.tsx`,
`src/features/pwa/InstallBanner.tsx`, `src/components/ToggleField.tsx`,
`src/pages/PaymentPlanPage.tsx`.

## Explicitly out of scope

- The six §17 items already found fully compliant (keyboard access, form
  labels, semantic landmarks generally, color-alone status, screen-reader
  currency/status). Don't "improve" or refactor working, compliant code
  under cover of this task.
- Any new component or page.
- Notification preferences (the sixth Phase 6 sub-piece) — separately
  blocked on Phase 4/5, not part of this slice.
