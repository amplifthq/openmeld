# Shared Agent Plugins

## Agent Context

- Purpose: Track the authorized promotion of Plugins to a shared Agent capability.
- Read this when: Implementing this draft PR or reviewing its authorization boundary.
- Update this when: Implementation scope or validation evidence changes.
- Do not use this for: Production release authorization or cross-Organization personal credentials.
- Source of truth: Existing scoped owner documents remain authoritative until updated with the implementation.

Status: IN PROGRESS. Remove when the implementation and its owner-document updates are complete; Git history preserves the plan.

## Outcome

Plugins becomes one primary navigation destination. Center Agent, Local Agents,
and personal Remote Agents reuse connection management, discovery, execution,
and audit contracts. Personal connections remain private to the represented
owner; shared connections remain Organization-owned. Cross-Organization reuse
of personal connections is outside this increment.

## Authorization and ownership

- Core owns connection ownership, current membership, consumer access, and
  durable operation admission. Clients cannot supply another user's authority.
- Connection owners configure access for Center Agent, Local Agents, and
  personal Remote Agents. Shared access is managed only by owners/admins;
  personal access grants are managed by the connection owner.
- Preserve existing access when migrating. New consumers require explicit
  grants; moving navigation does not broaden an existing connection's authority.
- Read and write permission are checked against trusted action metadata.
  Destructive actions retain exact-action authorization. Discovery is filtered
  by the same access policy used by execution.
- A different person waking an Agent does not obtain the Agent owner's private
  connection. Routine authority comes from its verified delegated member.
- Local execution authenticates the owning account and Agent through existing
  product contracts; an arbitrary Agent ID or native session ID is not proof.
- Third-party credentials and broad executor tokens stay on the server.
- Exact operation retries preserve the selected identity and existing outcome;
  they cannot authorize a different action after revocation.

## Implementation sequence

1. Shared connection access schema, persistence, management, and authorization.
2. Reusable action discovery/execution and Remote Agent integration.
3. Authenticated CLI capability entrypoints with shared contracts and attribution.
4. Primary Plugins navigation and connection access controls, removing Center-only UI coupling.
5. Boundary tests, affected checks, owner docs, Changelog, local browser and CLI
   smoke, and a running localhost handoff for human UI/UX acceptance.

## Simplification scope

S1: Remove Plugins' dependency on Center Agent route state and duplicate navigation
ownership. Preserve a canonical destination and supported inbound links.

S2: Share connector execution policy and transport rather than implementing one
executor per Agent family. Preserve credential, membership, destructive-action,
and durable-retry boundaries even when their existing names are Center-specific.

No unrelated cleanup, merge, production deployment, or account migration is
authorized by this draft implementation.

## Acceptance

Exercise personal/shared connections, owner/member/admin roles, all three Agent
consumers, read/write denial, cross-user and cross-Organization denial, revoked
access, and exact retry identity. Browser smoke proves navigation and permission
editing through real login; backend tests prove authorization and persistence.
Keep the PR draft and provide local URL and test-account credentials for review.
