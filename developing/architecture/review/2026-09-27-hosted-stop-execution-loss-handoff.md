# Hosted Stop After Computer Execution Loss

## Agent Context

- Purpose: Preserve the bounded handoff for Hosted Stop and completion that fail
  to settle after confirmed Computer execution loss.
- Read this when: Implementing the fix described in this draft PR's comments.
- Update this when: Implementation, regression evidence, or production recovery
  changes the disposition of this handoff.
- Do not use this for: A completed fix, release approval, private incident data,
  or permission to replay commands or rewrite production state.
- Source of truth: This document owns the handoff scope only. The
  [Remote Agent Runtime](../../product/remote-agent-runtime.md) owns runtime and
  cancellation semantics; the PR comments contain the detailed repair plan.

Status: DRAFT — investigation and implementation handoff only. No runtime change
has been made. Remove this file when the fix and its regression coverage are
complete and any durable contract clarification is in the owner document;
retain the investigation and production acceptance record in the PR discussion.

## Confirmed problem

Production inspection on September 27, 2026 found a personal Remote execution
and a Center execution whose Flue submissions had settled, with no active runs
or fibers, while their callbacks remained pending with zero attempts. Cleanup
repeatedly raised `WorkspaceExecutionLostError` (`EEXEC_LOST`). Cancellation
used the same cleanup path and failed to converge. Accepted delivery records
continued to project as running after page refresh.

The cleanup owner handles paired missing-record errors and execution loss that
was already reported through a tool call, but misses execution loss first
observed during terminal cleanup. Both normal settlement and Stop await that
cleanup. The original cause of the runtime replacements is not established.

## Repair boundary

Durably classify confirmed loss at the existing command owner, preserve the
failure evidence, and let the existing execution owner publish a truthful
terminal outcome. Preserve cancellation ordering and terminal idempotency.
Keep transient inspection failures pending when a process may still be alive.
Do not replay commands, invent success, reset a shared Computer, hide the
indicator with a timeout, or make the delivery ledger an execution authority.

The PR comments specify affected files, the required negative cases, meaningful
regression coverage, and separate implementation/release/production-recovery
acceptance. This documentation-only draft does not close the incident and needs
no product changelog entry until behavior is actually changed.
