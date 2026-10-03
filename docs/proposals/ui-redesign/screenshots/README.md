# UI redesign: before / after screenshots

Captured 2026-10-03 (task UI10.5) with headless Edge against the local Docker
Supabase stack and the seeded local "Test Family"
(`scripts/dev/seed-local-test-family.mjs`; Parent = Dana, Child = Alex).
Viewport only, device scale 1.

- **Before** = commit `750896f` (`b4762d2^`, the app just before the redesign
  started), run from a temporary worktree against the same local database.
- **After** = `feature/ui-redesign-p9-polish` at `e5b9efc`.

The pre-redesign app had no dark mode, so its "dark" captures are identical to
its light ones. It also had no Settings or Activity screen; the closest
equivalents are used and named below.

| Pair (`before-…` / `after-…`) | Shows | Role | Width | Theme |
|---|---|---|---|---|
| `signin-375-light` | Sign-in page (signed out) | none | 375 | light |
| `parent-home-375-light` | Parent home (`/parent` → `/home`) | Parent | 375 | light |
| `parent-home-375-dark` | Parent home; before had no dark mode | Parent | 375 | dark |
| `parent-home-1280-light` | Parent home at desktop width (sidebar layout after) | Parent | 1280 | light |
| `parent-activity-375-light` | Alex's history (`/child/:id/history`) → Activity filtered to Alex | Parent | 375 | light |
| `parent-add-expense-375-light` | Add expense (`/add-expense` → `/new/expense`) | Parent | 375 | light |
| `parent-record-payment-375-light` | Record payment (`/record-payment` → `/new/payment`) | Parent | 375 | light |
| `parent-family-375-light` | Manage members (`/members`) → Family | Parent | 375 | light |
| `parent-settings-375-light` | Change password (`/account`, closest equivalent) → Settings | Parent | 375 | light |
| `child-home-375-light` | Child home (`/child` → `/home`) | Child | 375 | light |
| `child-home-375-dark` | Child home; before had no dark mode | Child | 375 | dark |
