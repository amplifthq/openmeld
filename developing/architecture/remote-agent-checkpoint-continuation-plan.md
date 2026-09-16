# Remote Agent checkpoint continuation repair

## Agent Context

- Purpose: Preserve the accepted user outcome and source-backed investigation for issue #1087.
- Read this when: Taking over the corresponding repair PR or reviewing its scope.
- Update this when: Fresh main, a reproduction, or implementation changes the evidence or accepted scope.
- Do not use this for: A new scheduler, external event-watch product, unlimited tool budgets, or production repair instructions.
- Source of truth: This is a temporary handoff. Runtime behavior remains owned by the existing Remote Agent, Core delivery, and Space publication contracts.

Status: DRAFT — first-priority repair approved for handoff on 2026-09-16. Remove when the repair is implemented and its durable conclusions are incorporated into the relevant owner documents, before the implementation PR is merged. Do not merge this handoff alone as a delivered fix.

## Outcome and delivery boundary

A user should not have to repeat “continue” because an internal tool-budget segment ended. Accepted work should continue within its authorization and bounded runtime policy, or present an honest stopped, needs-input, incomplete, or failed outcome. Finishing one model segment is not evidence that the user's deliverable is complete.

This is the repair PR itself, initially carrying research only. The implementing Agent continues on the same PR and branch after resolving fresh main. No runtime change, test execution, deployment, or production reproduction is claimed by this initial commit. Issue #1087 remains open until the implementation actually meets the agreed outcome; the original issue's proposed mechanics are not mandatory acceptance criteria.

## Inspected baseline and evidence

Baseline: `42ee500ef2af9244c5cb985ec3d09e624302a9a8`.

- [Tool progress](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/services/remote-agent/agent-core/tool-progress.ts) retains a 64-call submission limit, bounded unchanged-observation protection, and copy telling the model to finish with existing evidence. Attempts are recorded before execution.
- [Tool execution](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/services/remote-agent/flue-adapter/tool-execution.ts) records a work-loop checkpoint on budget exhaustion and ends further tool execution for the submission.
- [Terminal callback projection](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/services/remote-agent/agent-core/terminal-callback-projection.ts) projects the durable completed answer through `projectRemoteAgentCompletedAnswer`.
- [Callback context](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/services/remote-agent/agent-core/callback-context.ts#L1389) removes `workLoopCheckpoint` on the normal new-answer projection path, while callback delivery selects continuation when that field survives. This is a concrete investigation seam, not a production root-cause certification.
- [Stream observer](https://github.com/amplifthq/openmeld/blob/42ee500ef2af9244c5cb985ec3d09e624302a9a8/services/remote-agent/flue-adapter/stream-observer.ts) handles model completion, durable execution settlement, stream delivery, and terminal callback projection. Existing Core continuation coverage is in `services/core/tests-node/remote-agent-native-delivery-service.test.ts`.

The issue's historical diagnostics are reported evidence, not a new live read. A fixed multiplier of working capacity cannot be inferred from the constants alone. Changing one prompt string is not sufficient evidence of a repair.

## Recommended direction

Prefer a coherent correction of the current checkpoint-to-settlement boundary. Runtime-owned continuation facts should not depend on whether the model happens to write a final-sounding paragraph. Reconcile worker execution ownership, callback projection, streaming, and Core resubmission together without introducing another execution truth. Align model guidance with the resulting contract rather than using it as the sole control mechanism.

Preserve exact work, conversation, request, and publication identity across continuation and callback retries. Internal handoff text must not masquerade as a finished user deliverable; existing meaningful progress need not disappear. Stop, pause, revoked authority, real terminal failure, and bounded exhaustion must remain effective, including after recovery. Inspect how unfinished Computer commands interact with segment completion instead of assuming they can be stopped and blindly restarted.

Treat budget accounting as a bounded policy decision. Pre-execution rejection, successful reads with oversized output, provider errors, and uncertain external writes are different cases. No returned evidence does not prove that nothing executed. Avoid automatic mutation replay or unlimited free retries; useful bounded/paginated reads may be preferable to discarding large results. Exact counters, thresholds, model-visible guidance, and implementation organization remain with the implementing Agent.

## Evidence that would close the repair

Validation should exercise the actual worker budget boundary through completion/callback handling into Core, rather than only injecting `continuation_required` into a Core test. Cover a later coherent result for the same request, no duplicate effects or final publication, a checkpoint followed by assistant text, and honest stop/failure/exhaustion behavior. Use focused deterministic tests and a risk-matched real runtime check; do not equate a synthetic callback or larger limit with a completed user outcome.

Relevant owners are `developing/product/remote-agent-runtime.md`, `developing/product/organizations-and-center-agent.md`, `developing/architecture/data-and-observability.md`, and `developing/architecture/shared-contracts.md`. Any changed contract, compatibility behavior, rollout order, and user-visible Changelog belong in the implementation, with the normal repository validation and release process. #256/#855's future first-class deterministic event/callback product is explicitly outside this repair.
