# P0 Documents external review

Package: Phase 0 · Documents of `design-plans/member-agent-program.md`.
Reviewer: Codex CLI, `codex exec --sandbox read-only`, 2026-10-18.
Question: find every statement in the eight changed owner documents that
contradicts program §4 (with §5 and §6 where cited) or
`developing/decisions.md`, and every Phase 0 Target rule still missing, with
file:line evidence. Each finding was checked against the files before acting.

## Findings against the program

| # | Finding | Verdict | Disposition |
| --- | --- | --- | --- |
| 1 | `agent-transport-contract.md` Request Chain exempts conversational auto-relay Wakes from repeat rejection; program §4.6 rejects any repeated Agent | Verified conflict | Resolved by the designer: keep the Auto-Relay Loop Policy; repeat rejection applies only to delegated work; one depth maximum, never stricter than the existing auto-relay limits. Program §4.6 corrected by the designer (`da4274158`). Owner text kept |
| 2 | `space-collaboration.md` Space Tasks: **Add and assign** always uses the atomic owner join, bypassing the request path for another member's Agent | Verified | Applied: atomic join only for the caller's own Agent; otherwise the owner request path |
| 3 | `space-collaboration.md` Addressing: every target must already be an active member, which blocks the §5 non-member mention flow | Verified | Applied: a mention of a non-member Agent is not an addressing target; it triggers the owner join or the owner request, with no Wake |
| 4 | `space-collaboration.md` invariant omitted the "already a member" exception of §4.6 | Verified | Applied |
| 5 | `projects.md` kept a single exclusive local workspace boundary across Project labels; §4.9 makes conflicts folder-scoped | Verified | Applied: points to the `folderKey` rule |
| 6 | `space-collaboration.md` fixed "up to five reservations"; §4.9 makes the limit owner-adjustable | Verified | Applied |
| 7 | `inbox.md` keyed interaction items per Wake; §4.6 coalesces per Session by `contextId` | Verified | Applied: interaction items keyed per Session; responses still name the exact Wake and interaction id |
| 8 | `agent-profiles.md` "Owning the Agent alone does not reveal private conversations" denied the §4.6 owner-observer access | Verified | Applied: clarified that only the derived observer access applies |
| 9 | `agent-profiles.md` and `organizations-and-center-agent.md` let Organization members see Computer display names; §4.10 lists computer names as owner-only | Verified conflict, scope unclear | Not applied. The Agent non-owner projection already omits Computer names. The People/Computers directory exception is a separate shipped surface; reported to the designer for a program decision |
| 10 | `organizations-and-center-agent.md` shows teammates the Usage Limit used percentage; §4.10 and the 2026-10-18 decision keep quota numbers owner-only | Verified | Applied: used percentage and other quota numbers are owner-only; teammates see the state and reset time |
| 11 | `projects.md` lets absolute paths transit Core and Gateway to the owner's own Web session; §4.4 says no path ever reaches the cloud | Partly verified | Not applied. §4.4 governs the folder projection; owner-self transit is an existing, non-stored path for the Project folder picker. Reported to the designer to confirm the program's wording |
| 12 | `organizations-and-center-agent.md` let an exact first instruction replace the extra confirmation §4.11 requires for archive and permission-mode changes | Verified | Applied: a separate confirmation after the instruction is always required |
| 13 | `agent-profiles.md` working-folder read said the version identifies "the stored v1/v2 envelope" | Verified | Applied: v1, v2, or v3 |
| 14 | `cli.md` dispatch Space Task tools used normal CLI authentication; §6 requires the task credential for Space actions from a task | Verified | Applied |
| 15 | `agent-profiles.md` MemberAgent text omitted `default_profile_id` and `archived_at` from §4.1 | Verified | Applied (`defaultProfileId`, `source`, `archivedAt`, migration default) |

## Findings against `developing/decisions.md` unrelated to the program

Codex also reported pre-existing contradictions between owner text that this
package did not change and older decisions: same-turn delete, merge, and
Project removal versus the separate-confirmation and two-turn decisions;
destructive Routine App actions; retained Center Agent Task surfaces;
Inbox rail placement, rail badge counting, and default landing; the auxiliary
image model; the current-DM predicate; creation-approval scope; and the
teammate-request launch hold. None of them is a MemberAgent rule. They are out
of scope for Phase 0 and are listed as follow-ups in the package report; no
change was made.
