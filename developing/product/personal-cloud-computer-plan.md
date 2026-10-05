# Personal Cloud Computer

## Agent Context

- Purpose: Track implementation of account-owned cloud Computers.
- Read this when: Implementing or reviewing the personal Computer change.
- Update this when: The implementation or acceptance evidence changes.
- Do not use this for: The current shipped runtime contract or release authority.
- Source of truth: This temporary plan owns the delivery checklist; the runtime,
  shared-contract and data owner documents own lasting behavior.

Status: IN PROGRESS. Remove when implementation and acceptance are recorded in
the owner documents and PR. Git history preserves this plan.

## Outcome

Each human account has one default cloud Computer. Center, personal Remote
Agents and authenticated Local Agents can continue work in its persistent
filesystem. Core resolves ownership from trusted identity. Agents decide how
to use resources and disclose results from the supplied task and audience
context. This intentionally replaces per-conversation Computer identity.

## Implementation

- Upgrade Cloudflare Computer and computerd together from 0.2.1 to 0.4.0.
  Use the official backend for the current platform-scheduled deployment.
  Preserve necessary cancellation fixes and exact process-group cleanup.
- Provide one account-owned Computer identity and one shared operation owner.
  Keep provider resource identifiers behind the Cloudflare adapter.
- Support concurrent commands with exact invocation attribution. Protect
  controlled file edits from stale writes. Use independent working directories
  or native Git worktrees for concurrent repository changes. Arbitrary shell
  writes are not covered by file-tool conflict detection.
- Expose the same filesystem and command state to hosted tools and authenticated
  Local CLI access. Future human UI must read these contracts; it must not
  introduce another execution-state writer. No UI is part of this change.
- Retire whole-Computer historical-source access gates. Disconnect blocks new
  provider requests; completed personal copies remain available. Keep live
  reference checks, external credentials and publication with their owners.
- Remove replaced tools, unused fallback paths and per-turn legacy cleanup.
  Keep legacy command addressing only where persisted work still requires it.
- Update scoped owner documents, Agent guidance and the Changelog together.

## Acceptance

Use representative disposable localhost fixtures, not production user state.
Prove same-account continuation across Center, Remote and Local entrypoints,
different-account rejection, concurrent commands with Stop A preserving B,
stale-edit rejection, cold persistence, disconnect semantics and normal Files
publication. Preserve original handles for legacy cleanup. Source checks and
real process/container evidence prove different boundaries.

After implementation and smoke, request an independent GPT-6 Astra review at
high reasoning effort. Resolve blocking findings, validate the final candidate,
and mark the PR Ready. Leave merge and deployment to the next authorized task.

Related to #1321. Its old per-conversation isolation acceptance is superseded
by the selected account-owned model; closure requires the integrated evidence.
