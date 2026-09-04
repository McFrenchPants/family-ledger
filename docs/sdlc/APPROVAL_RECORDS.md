# Approval records (`.sdlc/approvals/`)

How the release operator (`agents/supervisor.md`) records and checks a
human approval before a merge/push/deploy/live-restart. Schema:
`docs/sdlc/schemas/approval.schema.json`. Applies only to projects using
`full` release mode (see `.sdlc/project.yaml`'s `release.mode`) — a `lite`
project has no supervisor role and no approval records.

## What this is — and, importantly, what it is not

An approval record is a **written-down fact about something a human already
said**, not a permission slip the user has to produce before an agent will
listen to them.

The authorization is still exactly what it has always been in this repo: a
live, specific instruction from the repo's owner in the current conversation.
This project's own `CLAUDE.md` (its user-override carve-out, if it documents
one) and `agents/supervisor.md`'s "Scope note for non-supervisor agents" are
unchanged and still govern. If the user says "merge this now," the answer is
to do it (after the usual local-test gate), not to ask them to go write a
JSON file first.

What the record adds is *durability against reuse*. Approvals for production
mutations are single-use and pinned to one commit SHA, so that:

- a later session can't infer "they approved a merge of this branch once, so
  merging it again now is fine" — a new commit is a different artifact;
- a differently-worded ask can't quietly inherit an earlier approval;
- and the live action leaves a durable trace, matching this repo's own
  convention (if it has one) of documenting real remote/live access rather
  than only mentioning it in a session that later scrolls away.

Read-only live checks (a status query, a health-check `curl`/API call) are
the Local-read tier and need **no** record. Nothing in `supervisor.md`'s
"What you never do" list can be authorized by a record at all — an approval
record is not a route around those.

## File naming

One file per approval:

```
.sdlc/approvals/<approved_at compact UTC>--<operation>--<branch slug>.json
```

- `<approved_at compact UTC>`: `YYYYMMDDTHHMMSSZ`, matching the record's own
  `approved_at`. Sorts chronologically by filename.
- `<operation>`: the `operation` enum value verbatim (e.g.
  `merge_to_default_branch`).
- `<branch slug>`: `target_branch` with `/` replaced by `-` (e.g.
  `feature-my-change`).

Example:
`.sdlc/approvals/20260831T134500Z--merge_to_default_branch--feature-my-change.json`

The filename is an **index, not the truth** — every field it encodes also
lives inside the record, and the record's fields are what the operator
verifies against. The convention exists so the operator can find the right
record with one glob instead of opening every file:

```sh
ls .sdlc/approvals/*--merge_to_default_branch--feature-my-change.json
```

Consumed records stay in place (same filename) with `consumed: true` — they
are the audit trail. They are not renamed or deleted.

## The check, before acting

The release operator runs this before every operation in the `operation`
enum. Steps 1–5 are read-only; step 7 is the only write.

1. **Find the record.** Glob `.sdlc/approvals/` for the operation and target
   branch (above). If more than one matches, use the one with `consumed:
   false`; if several are open, stop and ask — ambiguity here means the
   history isn't clean, and guessing is exactly the failure mode this
   mechanism exists to prevent.

2. **No record?** Then this action hasn't been approved *yet* — which is
   normal, not an error. If the user has just asked for it in this
   conversation, that instruction **is** the approval: write the record (step
   6) and proceed. If there is no such live instruction, do not act; ask.
   Never treat "I found no record" as "I may proceed silently," and never
   treat "I found no record" as grounds for refusing a user who is asking
   right now.

3. **Validate the record** against
   `docs/sdlc/schemas/approval.schema.json`. A record that doesn't validate
   does not authorize anything.

4. **Check it isn't already consumed.** `consumed: true` → refuse and say so,
   naming `consumed_at`/`consumed_by`. Approvals are `single_use`.

5. **Check the commit SHA still matches.** Resolve the target branch's current
   HEAD and compare to `commit_sha` in full:

   ```sh
   git rev-parse <target_branch>
   ```

   If it differs, refuse. A new commit landed since the approval, so the
   artifact in front of you is not the artifact that was approved. Report the
   mismatch (approved SHA vs. current SHA) and ask for a fresh approval; do
   not "update" the existing record's SHA — that would turn a single-use fact
   into a standing one.

   Also confirm the operation and `target_branch` in the record are the ones
   you are actually about to perform. A record for `push_to_remote` does not
   authorize a merge.

6. **If the approval is being given right now,** create the record *before*
   acting, with `consumed: false`, `single_use: true`, `approved_by` set to
   the repo owner, `commit_sha` from `git rev-parse <target_branch>`, and
   `instruction` quoting what the user actually said. Then continue from step
   3 against what you just wrote.

7. **After acting, consume it.** Set `consumed: true`, `consumed_at` to now,
   and `consumed_by` to this run's identifier; add what you actually ran to
   `notes`. Do this immediately after the operation, in the same turn — an
   unconsumed record for an action that already happened is worse than no
   record, because the next session will read it as still-open.

If the operation fails partway, leave `consumed: false` and record what
happened in `notes`; the approval still refers to the same unchanged artifact,
so a retry in the same conversation is covered by it.

## The usual local gate still applies

None of the above replaces `supervisor.md`'s pre-flight checks (local tests
passed, version/changelog consistent, or whatever else this project's own
release checklist requires). An approval record says a human authorized the
action; it says nothing about whether the change is ready.
