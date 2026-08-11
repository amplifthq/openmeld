# `@openmeld/agent-profile`

This package owns shared Agent Profile product semantics.

## Current Scope

Phase 1 only owns Agent Profile Reply Recovery:

- consume Core-owned `AgentExecutionReadiness` and Core-provided action intent /
  primary action evidence
- consume small adapter-provided evidence about the current local Runtime
- translate those facts into one user-visible next action for an Agent Profile
  that cannot reply
- return the recovery plan copy attached to that action: `title`, `body`,
  `primaryActionLabel`, and `secondaryLabel`

The package does not own `AgentExecutionReadiness` truth. Core owns that fact
source. This package only renders the recovery meaning of already-provided
readiness and action evidence.

## Inputs

Public inputs must stay source-neutral:

- `currentLocalRuntimeReplyState`
- `selectableLocalAgentTargets`
- `profileReplyReadinessEvidence`

Adapters must flatten source data before calling this package. This package must
not import or expose Start-owned setup, device projection, or profile readiness
types.

`selectableLocalAgentTargets` contains only targets that the adapter already
filtered as selectable. It must not carry a `selectable` field.

## Out Of Scope

This package does not own:

- RuntimeCoordinator execution truth
- dispatch, claim, execution tokens, retries, or final Wake outcomes
- Start, Prepare, or setup orchestration
- OpenMeld Service lifecycle
- Space message, member, thread, or reply placement truth
- Web component rendering details

## Future Candidates

These may move here later if repeated Agent Profile semantics drift across
surfaces:

- shared Agent Profile badge and copy rules
- shared action target naming
- reply status display
- Binding display view
- provider account display view

They are candidates only. Phase 1 must not migrate Space member row badges,
Agents page summaries, display views, or Web component rendering details.
