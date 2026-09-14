# Codex Desktop and OpenMeld session coexistence

## Agent Context

- Purpose: Track the bounded Codex coexistence correction and experiment.
- Read this when: Implementing or reviewing this correction.
- Update this when: Behavior checks or interoperability evidence change.
- Do not use this for: Production release authority or a Desktop connection contract.
- Source of truth: Current code, observed experiments, and linked provider sources.
- Remove after the correction ships and the remaining compatibility decision is
  recorded in the owning local Service document.

Status: Draft implementation and bounded compatibility investigation.

## Outcome

Keep Codex Desktop open while OpenMeld accurately reports whether its own Wake
is waiting or running. Cancelling a waiting Wake must prevent later execution;
stopping an OpenMeld turn must not stop unrelated Desktop work.

## Delivery order

1. Reuse RuntimeCoordinator lifecycle evidence for working elapsed time instead
   of including admission and controller-occupancy waiting time.
2. Show `Waiting for Codex` with `Another app is using this conversation.` for
   proven Codex conversation occupancy. Preserve existing cancellation fences
   and correct cancellation diagnostics after a retry has started execution.
3. Run an isolated shared App Server experiment and inspect primary-source
   open-source implementations. Distinguish multiple clients of one server from
   independent servers competing for one conversation, and distinguish CLI
   remote support from actual Desktop integration support.

## Boundaries

RuntimeCoordinator remains Wake execution authority. Provider events are
execution evidence, not a second cloud scheduler. Do not clear provider locks,
restart the user's Desktop or Service, or change production connections during
the experiment. Deleted Agent retry projections are outside this work.

## Acceptance evidence

Record focused lifecycle and cancellation regression results, browser evidence
for the changed presentation, installed Codex version, experiment topology,
observed event routing and cancellation behavior, and source revision links.
An isolated two-client experiment does not prove the installed Desktop can
join that server. Keep that limitation explicit until directly verified.
