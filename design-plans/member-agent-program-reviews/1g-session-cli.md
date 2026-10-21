# Package 1g · CLI Session commands — external review

Package: 1g (`openmeld session list/rename/archive/restore/delete`) of
[the MemberAgent program](../member-agent-program.md).
Branch: `claude/map-1g-session-cli-6f9878`, reviewed the uncommitted diff on
`5503850ec`.

## Review run

- 2026-10-19, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions: output that leaks owner-only facts; an Agent View result or error
  frame inconsistent with 1f's `agent list/show`; a flag-off path that still
  reads auth or calls a route; other correctness bugs (delete without
  confirmation, wrong mapping of `direct_message_session.forbidden`).

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Owner-only leaks. | — | None found. Core scopes the list to the signed-in member's Human–Agent pair and checks the participant before every change. `--agent` resolves only the member's own MemberAgents from Auth. Agent View omits message preview text. |
| 2 | Agent View shape inconsistent with 1f. | — | None found. Results use `{ type: "result", code, payload }`; errors reuse 1f's `emitMemberAgentCommandError`, so Session refusals carry Core's code, message, and one next step in the same frame. |
| 3 | Flag off: the five commands passed the shared sign-in entry check before the handler's flag check, so a flag-off command could contact Auth or show a sign-in error instead of the not-enabled message. | Yes (Auth only; no Session route is reached) | Fixed for `agent` and `session` together so both keep the same flag-off behavior: while `MEMBER_AGENTS_ENABLED` is off, `src/openmeld.ts` runs the handler without entry checks, and the handler prints the not-enabled message. Test: "skips entry checks for agent and session commands while the flag is off". Not changed: CLI-wide `resolveRuntimeContext` still resolves the selected Profile for the view, as for every command; it calls no MemberAgent or Session route. |
| 4 | Other correctness bugs. | — | None found. Delete needs `--yes` or a confirmed prompt; `direct_message_session.forbidden` maps to "Not Your Session" with a next step. |

Nothing was rejected.

## Known gaps outside 1g

- `tests/skill-doc-contract.test.ts` "documents all top-level program commands" still fails for `agent` (added by 1f without a `references/commands.md` section); 1g documents `session`. The same file's SKILL.md length check also fails on the base.
- 22 other CLI tests fail identically on `5503850ec` without this diff (same failure list before and after).
