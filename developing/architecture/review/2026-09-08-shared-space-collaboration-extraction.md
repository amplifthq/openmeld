# Shared Space collaboration extraction

## Agent Context

- Purpose: Record the shared collaboration extraction and its integration boundaries.
- Read this when: Reviewing the Local instruction change or a later Remote integration.
- Update this when: The extraction scope or integration evidence changes.
- Do not use this for: Production acceptance or runtime authority.
- Source of truth: Historical extraction evidence; shared-contracts.md and local-openmeld-service.md own current contracts.

Status: Historical review evidence; Local delivery remains pending.
Remove when Local delivery is complete and remaining integration guidance is preserved in owner documents.

## Candidate and scope

The local candidate remains uncommitted on `codex/local-agent-instructions-v2`
at base `db625a228` after synchronization with origin/main; the branch has no open PR. This extraction is not a release
or a production acceptance claim. Production repair remains separately owned.

`packages/space-mesh/src/collaboration-context.ts` exports
`SPACE_COLLABORATION_CONTEXT_RULE`, `buildSpaceAgentIdentityLine`, and
`buildSpaceWakeParticipantLines`. Local dispatch prompt construction consumes
these directly rather than retaining copies. Existing shared `renderSpaceEntryBrief`,
`composeDispatchBrief`, `deriveContinuity`, and publication-requirement helpers
remain the owners of their established behavior.

The extraction preserves Local prompt wording for directly activated recipients.
One correction removes the assertion "including you" for a listener absent
from the canonical activation list. It does not assign numbers, ordering,
ownership, or a coordinator. References and members are not activation targets.

## Future Remote integration

Supply canonical acting profile facts, source signal, and activation targets to
the shared renderers. Supply a runtime-specific instruction for reading exact
source-scoped outcomes. Do not advertise such a read until an authorized tool
actually implements it. Use the existing Entry Brief `needMore` input for an
authorized Space Board read. Existing schemas continue to own source messages,
Board responses, and outcomes; these new renderer arguments are in-process
inputs, not another cross-service protocol.

Keep Local CLI/MCP commands, injection epochs, native provider instructions,
private session history, and publication/recovery mechanisms in Local adapters.
Remote must retain native automatic publication and its own tools. Center must
retain its current organization authority, tools, and native execution contract.
No Remote or Center runtime changes, private-context export, or extra access
permissions are included. Waiting/handoff scheduling was not newly extracted:
only existing shared continuity and action rules are reusable today.

## Validation and remaining evidence

- Shared package build, 39 shared tests, and shared typecheck passed.
- All 37 Local bootstrap tests passed, including exact participant wording,
  source-scoped outcome commands, identity, instruction separation, and Local
  mandatory completion contracts.
- The new shared tests cover a non-activated listener and missing source ID.
- A one-off comparison against the actual saved pre-extraction candidate
  (`736e1b78ef9f29bef399a004bfcde3a93307b0ad`) passed 24 complete-plan
  comparisons: bootstrap on/off, zero/one/three activation targets, supplied or
  absent identity/Guide, and supplied or absent source ID. Developer text,
  instruction epoch, turn input, and fallback prompt are equal in those cases.
  The intentional listener correction is covered separately. Evidence:
  `dev-tmp/instructions-spike/shared-extraction-comparison.log` (local only).
- A standalone Node consumer imported the built public package and composed
  Remote-style identity, Entry Brief, and source-result guidance successfully,
  with no Local CLI, MCP, local state, or proposal-publication requirements in
  the resulting context. This proves package reuse, not Remote runtime wiring
  or the existence of its future authorized Board/outcome tools.
- No production Wake or staging runtime was started for this extraction.
  Earlier staging evidence belongs to the pre-extraction candidate; see the
  separate staging smoke report for its successes and limitations.
- Before delivery, synchronize the newer production fixes, rebuild/stamp the
  exact local component candidate, run release-readiness checks, and repeat
  focused real-user Local smoke when it will not interfere with production work.

Contract impact: no wire shape, tool schema, authority, routing, or publication
protocol changes. Older cloud receivers remain compatible with these prompt
rendering changes. This source candidate still requires its own local component
release certification. The shared and Local architecture owner boundaries are
preserved; no owner rule needs an exception.
