# Native delivery control identity

## Agent Context

- Purpose: Record the contract impact of the native-delivery identity correction.
- Read this when: Reviewing or releasing the first personal Remote Agent prerequisite.
- Update this when: Its compatibility or validation evidence changes.
- Do not use this for: Personal Remote Agent creation or authorization policy.
- Source of truth: The implementation and remote-agent-runtime.md own behavior;
  this file records the scoped release audit.

Status: Implemented; awaiting merge and release.
Remove this document after the correction is released and its evidence is
preserved in the merged PR.

## Scope

This first personal Remote Agent prerequisite changes only Core's use of
persisted native-delivery identity. It does not enable ordinary hosted Profiles,
change Center Agent designation, or alter workstation execution.

Cancellation, reconciliation and diagnostics now use the same route resolver.
Each available persisted request must match the delivery's Organization,
Agent Profile, Space, dispatch and idempotency key. When both worker and recovery
requests exist, their resolved runtime conversations must also agree. Mismatches
fail before contacting the worker; existing callers retain their error handling.

## Contract impact

- No HTTP, RPC, WebSocket, CLI, Service, Skill or database schema changes.
- Existing request versions 1 through 4 retain their runtime names. Version 4
  uses its persisted generation route; older requests retain their conversation
  ID or Space ID. No namespace or session reset is introduced.
- New Core uses the same cancellation and reconciliation request schemas with
  old Remote Agent receivers. For legacy Space requests it may explicitly send
  the Space ID as `conversationId`, which receivers already resolve to the same
  instance. Old Core continues to interoperate with the unchanged worker.
- CLI, Service, Skills, Gateway and Web contracts remain unchanged through
  setup, Wake, Space actions and diagnostics. No local-component rollout is
  required by this change. Production scope is Core when this candidate is
  eventually authorized for release.
- RuntimeCoordinator remains the workstation execution owner. The native
  delivery ledger supplies frozen routing evidence, not a new in-flight
  execution authority. The scoped architecture rules are preserved.

## Validation boundary

Focused tests cover foreign Organization, Agent, Space, dispatch and
idempotency identities, conflicting generation routes, legacy routing and
absent requests. The native delivery suite covers existing admission, stop,
reconciliation and callback behavior. Local browser acceptance exercises the
existing Center Agent through normal sign-in and chat controls.

This does not certify personal Remote Agent creation, multiple hosted Agents
in one Space, cross-Agent authorization, or production deployment continuity.
Those remain the next feature batch's acceptance obligations.
