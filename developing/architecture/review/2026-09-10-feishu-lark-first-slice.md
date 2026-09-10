# Feishu and Lark conversation feedback: first slice

## Agent Context

- Purpose: Record the first conversation-feedback slice and its acceptance boundary.
- Read this when: Reviewing receipt timing and terminal card behavior in PR 864.
- Update this when: The remaining first-slice acceptance results change.
- Do not use this for: Full provider parity or production release authority.
- Source of truth: This review records the first-slice implementation evidence; runtime owner documents define its contracts.

Status: local success-path acceptance completed; the full provider state matrix remains open.
Remove when the remaining first-slice acceptance gaps are resolved and stable behavior is recorded in the runtime owner documents.

This change implements step 1 of the [product gap audit](2026-09-10-feishu-lark-product-gap-audit.md).
It is not the completion of the full channel parity roadmap.

## Delivered code

- Prepare the existing durable receipt card after identity/admission checks and
  before history and attachment I/O. Accepted duplicate deliveries skip this I/O.
- Extend the existing admission watchdog to cover preparation, so a receipt does
  not lose its recovery path when preparation throws. Accepted running executions
  retain the existing lifecycle policy; no execution timeout was introduced.
- Keep CardKit streaming and sequence/idempotency ownership. Final cards distinguish
  completed responses, failures, confirmed stops, and continued segments, with
  terminal conversation previews and explicit streaming closure.
- Clarify direct-response and no-tools/no-delegation intent in the shared Center
  Agent prompt. This is guidance, not a deterministic model-behavior guarantee.
- Record history and attachment preparation durations without message contents.

The implementation follows the official CardKit lifecycle and the pinned
OpenClaw streaming reference in the audit. It reuses OpenMeld's existing durable
card instead of adding a separately owned reaction lifecycle. No competitor
latency advantage or end-to-end speed improvement is claimed from source checks.

## Boundaries and compatibility

Core owns receipt, delivery and terminal publication; provider adapters only render
those outcomes. Frozen destinations, identity gates, quotas, runtime authority,
and business App permissions are unchanged. This does not violate the scoped
architecture owner contracts. The owner document records the earlier receipt.

The preparation callback and card outcome parameter are internal Core calls.
No shared wire schema, database migration, binding, resource, dependency, CLI,
Service, managed Skill, or contract version changes. Existing CLI/Service and
old/new Remote Agent callbacks interoperate with either Core version. Deploy
Core for the receipt/cards and Remote Agent for prompt guidance; neither requires
the other to be deployed first. Final Candidate and release checks remain pending.

Stop, Retry and approval buttons are a separate action slice. In particular, the
existing cancellation helper can return `stop_requested` before a worker submission
exists; its parent Task owner supplies the durable stop intent. Calling that helper
from an unowned button would not provide the same guarantee. Controls must bind
actor, conversation, operation and lifecycle to canonical owners; Retry must not
blindly repeat completed side effects. Native files/tools and business Apps remain
in their later roadmap steps.

## Validation and requested next acceptance

Focused Core tests cover receipt ordering, accepted replay, preparation failure
recovery scheduling, terminal publication, rollover, provider errors and CardKit
payloads. Core and Remote Agent typechecks and the existing prompt suite pass.
Localhost Feishu acceptance passed on `2af8d033c`: a fresh bot was created using
the Codex Chrome extension and connected through Web. Two real native-client
messages showed a receipt followed by a completed card, including a precise reply
and a formatted heading/list. Screenshots are retained in the task's local smoke
artifacts. This is not Lark, failure/stop, latency-SLO, or production acceptance.
The user accepted this first slice and authorized subsequent draft-PR work.

Remaining acceptance uses the supported local entry point with an isolated lane:

1. Feishu and Lark separately: DM and addressed group/thread receipt and final placement.
2. A self-contained exact reply and an explicit no-tools/no-delegation request.
3. A slow attachment/history path: measure first receipt, first output and final
   reply separately; verify the receipt does not wait for input preparation.
4. A failed preparation and a long multi-card result: visible terminal failure
   or correct continuation, no duplicate reply or permanently streaming card.
5. Save a small set of screenshots. Report actual timing without calling a few
   samples p50/p95 or claiming the prompt guarantees behavior.
