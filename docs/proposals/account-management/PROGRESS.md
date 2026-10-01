# Progress: Account management

Branch: `feature/account-management` (off `main`).

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
| AM1 | Spike: link generation, ban, admin email change | done | Design works with small changes; see SPIKE_FINDINGS.md and the spec's refinements section. |
| AM2 | Database: controlled role/status paths, invariants, pgTAP | todo | Verifier-routed. |
| AM3 | Edge Function(s): link, email change, archive/restore + ban | todo | Verifier-routed. |
| AM4 | Add-member returns a set-password link | todo | Verifier-routed. |
| AM5 | Frontend: set-password page, change password, manage-members additions | todo | |
| AM6 | Config + docs | todo | |
| AM7 | End-to-end verification and merge | todo | Production promotion is the owner's call. |

## Session log

_Newest entries on top._

### 2026-10-01 — AM1 done: spike confirms the design

Verdict: works. Folded into the spec: hand out our own `/set-password#token_hash=`
URL (the provider's action_link is consumed by a plain GET); a new link
cancels older ones; a password change signs out other devices; a banned
user's existing access token keeps working against the data API for up to an
hour, so archived-member data denial must come from database rules too;
duplicate-email admin updates return a bare 500 and need a pre-check. All
scratch users deleted; no existing data touched. Starting AM2.

### 2026-10-01 — Design signed off; plan written

Owner approved the design and answered the three open questions (Parents may
mint links for other Parents; 24-hour links; 8+ character passwords).
Starting AM1.
