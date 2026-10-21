# External review: Phase 1 packages 1a and 1b

Packages: 1a (`member_agents` schema, Auth read) and 1b (backfill).
Reviewer: Codex (`codex exec`, model `gpt-6-astra`, reasoning `high`,
read-only sandbox), 2026-10-18, on commit `0a17a351e` plus the uncommitted
1b files. Each finding was checked against the code before it was acted on.

## Questions asked

1. Constraint or index mistakes, rollout risk, effects on existing writers.
2. A backfill input that produces two `member_agents` rows for one
   `(organization_id, owner_user_id, harness_kind)`, fails the backfill, or
   makes a second run change data.
3. A Profile that is wrongly assigned or wrongly left unassigned.
4. Whether the invariant 1–3 SQL can report a false zero or a false violation.
5. Authorization, organization selection and flag gating in the Auth read.
6. Anything that violates `developing/decisions.md` or the `AGENTS.md` core
   invariants.

No input was found that creates duplicate MemberAgents or makes a successful
second run write data.

## Findings and disposition

| # | Severity | Finding | Verified | Disposition |
| --- | --- | --- | --- | --- |
| 1 | High | `GET /v1/member-agents` trusted a Session-selected organization without a membership check (`authenticated-organization-context.ts` does not query `members` on the Session fallback). | Yes | Fixed: the route checks current membership for a Session-selected organization; test "rejects a Session organization the member has left". |
| 2 | High | An ordinary Profile with `owner_user_id = NULL` bypassed the composite MemberAgent foreign key (`MATCH SIMPLE`), because the existing ownership check evaluates to NULL for `managed_role IS NULL`. | Yes | Fixed: `openmeld_profiles_member_agent_check` requires non-null organization and owner when `member_agent_id` is set. The pre-existing ownership-check gap for unassigned Profiles is out of scope (follow-up). |
| 3 | Medium | `default_profile_id` could point to any Profile, including another owner's. | Yes | Fixed: migration 0039 adds `(id, default_profile_id) → openmeld_profiles(member_agent_id, profile_id) ON DELETE SET NULL (default_profile_id)`. Drizzle cannot express the column-list action, so the reference lives in the custom migration, like the 0004 owner triggers. Invariant 3 is now also a database guarantee. |
| 4 | Medium | SQL `btrim` removes spaces only; the shared parser trims all whitespace, so `builtin:\tcodex` stayed unassigned and invariant 1 reported zero. | Yes | Fixed: one `harnessKindSql` expression with ASCII-whitespace trim is used by the backfill and invariant 1; a test compares it with `harnessKindFromAgentControllerRef` for 16 refs. |
| 5a | Medium | Legacy `openmeld_assistant` Profiles are excluded from assignment and from invariant 1. | Yes | Kept, recorded as a program correction: `developing/product/agent-profiles.md` keeps these Profiles hidden from the Agents home, so grouping them would surface them. §9 invariant 1 should say "managed Profiles are excluded". |
| 5b | Medium | Bindings were filtered by owner before selection, so an enabled Binding under a former owner fell back to the current owner's history. | Yes | Fixed: selection considers every Binding; an owner mismatch yields no Harness (`binding_owner_mismatch` count), and invariant 1 matches enabled Bindings regardless of owner, so the backfill rolls back. Test "fails closed when an enabled Binding belongs to another owner". |
| 6 | Medium | The explicit `SHARE ROW EXCLUSIVE` table lock inverted the lock order of account deletion (owner locks, then the `default_profile_id` FK action). | Yes, by reading the lock order; not reproduced concurrently | Fixed: no table lock. Every write is conditional (`ON CONFLICT`, `IS NULL`), and the transaction sets `lock_timeout = 5s`. |
| 7 | Low | No index for owner-side deletes. | Yes | Fixed: `member_agents_owner_user_id_idx`. The default-Profile reference is checked through the primary key. |
| — | Medium | Account deletion tombstones the user, so `ON DELETE CASCADE` never removes that owner's MemberAgents. | Yes (found during self-review before Codex reported it) | Fixed: the deletion transaction deletes the owner's MemberAgents after their Profiles; the account deletion test asserts it. |

Self-review, before the Codex result: the backfill skips Profiles of a closing
account or Organization, because their owner guards reject any Profile update
and would otherwise abort the whole backfill.

## Not changed

- Migration 0038 is not an online migration: it takes short blocking locks and
  builds a non-concurrent index on `openmeld_profiles`. The migration owner's
  lock and statement timeouts bound this; pre-launch data is small (§8).
- Invariant 3 ignores MemberAgents with no default Profile. Whether every
  MemberAgent must have one is a writer rule for package 1c.
