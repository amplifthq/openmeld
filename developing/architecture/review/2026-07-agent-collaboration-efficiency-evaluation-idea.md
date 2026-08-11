# Agent Collaboration Efficiency Evaluation Idea

## Agent Context

- Purpose: Preserve a bounded future design for measuring Agent collaboration
  efficiency through the existing Weekly Evaluation path.
- Read this when: Considering collaboration metrics, evaluation schema changes,
  or an official Work Loop quality report.
- Update this when: The Weekly Evaluation owner boundary, retention, or
  coordination facts change materially.
- Do not use this for: Current execution status, automatic product decisions,
  or authority over Wake and continuation outcomes.
- Source of truth: Planning constraints for a future collaboration-efficiency
  ticket only.

Date: 2026-07-18

Status: PLANNING IDEA. Do not implement from this document without a current
ticket and a fresh owner-contract review. Remove it when that ticket ships or
supersedes this design.

This file owns the bounded first Weekly Evaluation slice. Broader long-range
metric candidates remain in
`2026-07-work-loop-collaboration-efficiency-metrics.md`.

## Goal

Give OpenMeld a practical feedback loop for improving Agent collaboration
without creating a second observability firehose, another execution authority,
or long-lived raw event duplication.

The first consumer should be the existing official-Organization Weekly
Evaluation path. A settled weekly snapshot may summarize bounded collaboration
metrics for human investigation. The report can reveal patterns; it cannot
change a Wake outcome, continuation, addressing relation, or current task
status.

## Prefer Existing Durable Facts

Derive the first metrics from already-owned records:

- exact task subscriptions, terminal outcomes, delegations, child states, and
  continuation claims;
- RuntimeCoordinator and native-delivery terminal projections;
- structured `stay_silent` outcomes and explicit Wake/Reference relations;
- settled Weekly Evaluation coverage metadata.

Do not copy prompt text, Space message text, provider payloads, tool arguments,
or complete traces into the report. Do not add per-token or per-model-step
telemetry merely to estimate efficiency.

## Small First Metric Set

The initial report should contain only metrics that directly answer a product
question:

- **Loop closure rate**: declared resume policies that reached one terminal
  continuation outcome.
- **Continuation latency**: child authoritative terminal time to continuation
  admission, reported as bounded percentiles.
- **Duplicate suppression**: replayed callback or ready-subscription attempts
  that did not create a duplicate continuation.
- **Fallback correctness**: fallbacks activated after qualifying primary
  failure, plus planned fallbacks correctly skipped after non-failure.
- **Early no-op rate**: accidentally activated Agents that returned the
  structured reference/candidate `stay_silent` reason before history or tools.
- **Coverage gaps**: unsupported controller callbacks, missing lifecycle
  evidence, and excluded execution domains.

Every metric needs an explicit denominator and coverage statement. A high early
no-op rate is a discovery signal, not automatically proof that the Agent made
the wrong decision or that the composer should rewrite user addressing.

## Data And Retention Rules

- Prefer a weekly aggregate query over existing owned rows.
- Persist only the first-settled weekly snapshot under the current Evaluation
  Report retention policy.
- If one missing fact requires new instrumentation, add one bounded,
  purpose-specific field to the owning record rather than a generic event
  stream.
- Never retain raw context solely for later collaboration analysis.
- Keep metric version and coverage explicit so formula changes do not silently
  rewrite historical meaning.

## Improvement Loop

```text
owned execution and coordination facts
-> settled Weekly Evaluation metrics
-> official Work Loop report
-> targeted human investigation using existing trace selectors
-> general product or prompt improvement
-> later weekly comparison
```

Investigation begins with the aggregate signal, then uses existing exact task,
subscription, dispatch, and Space identifiers to inspect a small sample. The
system must not automatically change prompts, Wake/Reference relations, or
fallback policy from one metric threshold.

## Before Implementation

1. Inventory which metrics are already derivable without schema changes.
2. Define formulas, denominators, coverage gaps, and privacy classification.
3. Confirm the existing Weekly Evaluation publisher owner hard-read is repaired
   before expanding its Organization or publisher scope.
4. Add only the smallest shared schema extension needed for the settled weekly
   snapshot.
5. Validate the report in the official Work Loop before considering a broader
   product surface.
