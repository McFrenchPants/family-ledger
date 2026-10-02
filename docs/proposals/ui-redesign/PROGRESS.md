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
| UI2 | Tokens, dark mode, type scale, icons, primitives | todo | |
| UI3 | App shell and route map | todo | |
| UI4 | Child Home (playful overdue text, encouragement) | todo | |
| UI5 | Parent Home | todo | |
| UI6 | Add expense and Record payment | todo | Child chooser unlocked for all roles. |
| UI7 | Activity page | todo | |
| UI8 | Family and child page | todo | |
| UI9 | Settings completion | todo | |
| UI10 | Polish, cleanup, final verification | todo | |

## Session log

_Newest entries on top._

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
