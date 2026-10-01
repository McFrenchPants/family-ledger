# Implementation plan: Account management

Branch: `feature/account-management` (off `main`). Spec:
`DESIGN_SPEC.md` (signed off 2026-10-01). Tasks run in order; each is
committed separately. "V" = verifier-routed (auth / migrations / audit /
credential handling).

| ID | Task | Tier | Depends on |
| --- | --- | --- | --- |
| AM1 | **Spike (no production code):** prove on the local stack that (a) admin link generation returns a token the app can exchange via the OTP-verify call, with the token delivered in the URL fragment, single-use and expiring; (b) a banned user cannot sign in and an unban restores it; (c) admin email change works without confirmation. Write findings to `docs/proposals/account-management/SPIKE_FINDINGS.md`; if (a) fails, document the fallback. | default | - |
| AM2 | **Database:** controlled paths for role change and status change (archive/restore) so clients can no longer UPDATE `role`/`status` directly; last-active-Parent invariant on demote and archive; audit rows (old/new values); same-household Parent-only. pgTAP: Child/other-household/self-lockout negatives, mutation-proofed. | V | AM1 |
| AM3 | **Edge Function(s):** Parent-only (caller JWT re-derived) operations for: create set-password link (audited, never logs token), change login email (audited), archive/restore with login ban/unban (no half-state; roll back DB status if ban fails), read a member's login email. Generic auth errors. Rate limit on link creation. | V | AM2 |
| AM4 | **Add-member flow:** `add-household-member` creates the login with an unguessable unseen password and returns a set-password link instead of an initial password. | V | AM3 |
| AM5 | **Frontend:** `/set-password` page (outside role guards; button consumes the token; fragment-only; expired/used state; success signs in and redirects); "Change my password" form for every signed-in role; Manage Members additions (role change, email change, create-link dialog with copy + lifetime note, add-member shows link, archive/restore failure/retry). Accessible, 44px targets, component tests. | default | AM3, AM4 |
| AM6 | **Config + docs:** `config.toml` min password 8 and 24h link expiry; `DEPLOYMENT_RUNBOOK.md` hosted settings (Auth link expiry, min length, Site URL) and the deploy steps for this release; ARCHITECTURE ADR-010 update; PROGRESS/BACKLOG. | default | AM5 |
| AM7 | **End-to-end verification** on the local stack (all flows, both roles, negatives), full test suites, then merge to `main`. Production promotion needs the owner's go-ahead and the owner's hosted steps (migration push, function deploy, dashboard settings). | V | AM6 |
