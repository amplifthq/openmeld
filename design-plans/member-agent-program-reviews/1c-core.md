# Package 1c · Auto-creation and derived presence — external review

Package: 1c of [the MemberAgent program](../member-agent-program.md)
(§4.1, §4.5, §4.10, §9).
Branch: `claude/map-1c-core-c97600`, reviewed diff `54704c15d..d7de78f85`
(the `feat(auth): [1c]` and `feat(core): [1c]` commits before the fixes below).

## Review run

- 2026-10-18, Codex CLI (`gpt-6-astra`, reasoning `high`, `--sandbox read-only`).
- Questions: any sequence that creates two MemberAgents or two default
  Profiles for one (organization, owner, harness) or breaks invariant 3; any
  path that creates in an organization the member has not opened, is not a
  member of, or for another owner; any presence computation that greys a
  present harness or shows a missing one as available; any owner-only fact
  leaking through the public reason enum; SQL correctness of the presence
  fact.

## Findings and disposition

| # | Finding | Verified | Disposition |
| --- | --- | --- | --- |
| 1 | Auth checked membership once; an owner removed between that check and the writes could still gain a Profile and MemberAgent. | Yes (time-of-check window) | Fixed in part. The MemberAgent insert is now one statement conditional on current membership (`member-agent-repository.ts`, `insertDetectedIfAbsent`), and ensure returns `organization.membership_required` when it inserts nothing. Test: "does not insert a MemberAgent once the owner is no longer a member". Residual: the default Profile write itself is not serialized against removal, which matches the existing `createAgentProfileInOrganization` path; such a Profile stays unassigned and is covered by the existing departure rules. |
| 2 | The catalog-update trigger reconciles every organization where the owner has any MemberAgent, including migrated ones the member never opened since the backfill. | Yes | Not changed: this is the rule the package brief prescribes ("only for organizations where this owner already has at least one MemberAgent"). Archived MemberAgents no longer qualify an organization. Reported as a program correction: decide whether a migrated MemberAgent counts as "opened", or whether the trigger needs a recorded surface-open fact. |
| 3 | With no presence history (right after the flag turns on) a single upgrade miss or a turned-off controller read as `missing` at once. | Yes | Fixed. Only sustained absence removes a computer: three misses, or two misses with the first at least five minutes old, whether or not a fact exists yet (`harness-presence-policy.ts`). Tests in `harness-presence-policy.test.ts`. |
| 4 | `local_agent_preparation.not_supported_yet` (installed, not runnable) counted as uninstalled. | Yes (`agent-controller-inventory.ts` returns `not_supported` only when detected) | Fixed. It is `unknown`: it neither increments the miss counter nor allows creation. |
| 5 | The report hook paired accepted results by controller ref, so rejected duplicates of an accepted ref were recorded too. | Yes (the submission schema allows repeated refs) | Fixed. Results pair with inputs by position and ref (`pairAcceptedReports`); Core returns one result per input in order. Test: "forwards only the exact accepted reports, never a rejected duplicate". |
| 6 | The transition read used a pre-update snapshot, so a concurrent writer could hide a "newly present" transition. | Yes | Fixed. The observation runs in a transaction that locks the row (`SELECT … FOR UPDATE`) before the upsert. A first insertion raced by two writers can report the transition twice, which only repeats an idempotent reconciliation. A lost trigger is also recovered by the next surface-open sync. |
| — | Duplicate MemberAgents or default Profiles; invariant 3. | — | None found. |
| — | Owner-only facts leaking through `publicWakeabilityReason`. | — | None found. |

Nothing was rejected outright. Finding 2 is deferred to the designer as a
program question.

## Observed outside the diff (not changed)

- `rpcGetCurrentOrganizationAgentRuntimeOverview` attaches `usageLimits` to
  every directory Profile when `includeUsageLimits` is requested, without an
  owner check (`methods.ts`, Organization directory overview). If a non-owner
  can request it, quota numbers reach other members. Pre-existing; needs an
  owner decision.
