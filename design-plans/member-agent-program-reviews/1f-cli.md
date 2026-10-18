# Package 1f · CLI agent commands — external review

Package: 1f (`openmeld agent list/show`, parent MemberAgent in
`openmeld profiles`) of [the MemberAgent program](../member-agent-program.md).
Branch: `claude/map-1f-cli-78e2e9`, reviewed the uncommitted diff on
`26ad3eb6d`.

## Review run

- 2026-10-18, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions: output that leaks owner-only facts (paths, computer names or
  runtime ids to non-owners, account identity); an Agent View payload or
  error shape inconsistent with other commands; a flag-off path that still
  calls `GET /v1/member-agents`; other correctness bugs.

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Owner-only leaks. | — | None found. The Auth route returns only the caller's own MemberAgents, so the Service runtime id that `agent show` prints is shown to its owner only. |
| 2 | Agent View errors: Auth failures other than `member_agents.disabled` (for example `organization.membership_required`) were rethrown as `gateway.http_error` with the JSON body in the message and no next step, unlike `routines/errors.ts`. | Yes | Fixed. Auth `{ ok: false, code, message }` bodies become a `MemberAgentCommandError` that keeps Auth's code and message and adds one next step; all MemberAgent errors share one Agent View error frame (`data.error.code/message/nextStep`) and one Human error card. Test: "keeps an Auth failure's code and gives a next step". |
| 3 | Flag-off calls to `/v1/member-agents`. | — | None found. Every caller passes the guard in `readMemberAgentListing()`. Tests cover `agent list`, `agent show`, `profiles list`, and `profiles create --member-agent` with the flag off. |
| 4 | `profiles create --organization B --member-agent <B-agent>` resolved the parent in the active Organization A and reported "not found". | Yes | Fixed. `--organization` is forwarded; a selector that does not name the active Organization is refused with `member_agents.organization_mismatch` and a `openmeld org switch` next step, before any route call. Test: "refuses --member-agent for an organization other than the current one". |
| 5 | With the flag on, `profiles list` required an active Organization: without one, the Auth route answered `organization.context_required` and no Profiles printed. | Yes | Fixed. Profile commands read MemberAgents only when the flag is on and an Organization is active; otherwise their output is unchanged. Test: "lists Profiles without a parent when no organization is active". |

Nothing was rejected.
