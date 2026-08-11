# Work Loop Collaboration Efficiency Metrics

## Agent Context

- Purpose: Preserve broad, long-range candidate metrics for evaluating Work
  Loop collaboration without creating new runtime authority or raw telemetry.
- Read this when: Exploring collaboration-efficiency measurements beyond the
  bounded first Weekly Evaluation slice.
- Update this when: Long-range metric candidates, guardrails, privacy limits,
  or the broader reporting loop change.
- Do not use this for: Current execution status, automatic product decisions,
  implementation authority, or the first bounded Weekly Evaluation slice.
- Source of truth: This file owns only the long-range candidate backlog. The
  bounded first slice is owned by
  `2026-07-agent-collaboration-efficiency-evaluation-idea.md`.

Date: 2026-07-18

Status: IDEA — NOT IMPLEMENTED. Remove this file when its remaining candidates
are accepted into or rejected by a current implementation ticket.

This document records a future measurement direction. It does not authorize new
runtime events, database tables, dashboards, retention, or automated Feedback
Issue creation.

For the bounded first Weekly Evaluation slice, use
`2026-07-agent-collaboration-efficiency-evaluation-idea.md`.

## Goal

Measure whether OpenMeld collaboration completes user goals with less delay,
less redundant Agent activation, and less unnecessary model context while
preserving visible outcome correctness.

## Reuse Before Addition

The future implementation should reuse:

- RuntimeCoordinator execution projections;
- native-delivery outcome records;
- Dispatch Ledger trace selectors;
- Space signal and final-visible-outcome facts;
- model usage facts already produced by the owning runtime;
- immutable `eval_reports`;
- the official `OpenMeld Quality` weekly report.

It must not create a second execution-status source or a broad raw event
firehose.

## Candidate Settled Metrics

- final visible outcome rate;
- time to first executable action;
- time to final visible outcome, including p50 and p95;
- processed, cached, non-cached input, and output tokens per successful Work
  Loop;
- activation that was deterministically unnecessary because a structured role
  or relation said the Agent should not run;
- duplicate primary work;
- model calls after a terminal tool or final publication action;
- stale user-visible progress after terminal outcome;
- primary, retry, and fallback attempt counts;
- continuation creation and completion rates.

`stay_silent` alone is not evidence of waste. A future metric requires a
structured reason such as:

```text
not_assigned
reference_only
fallback_not_activated
duplicate_owner
no_action_needed
```

An explicit multi-Agent Wake in which one Agent chooses silence may still be
correct collaboration.

## Guardrail Metrics

Context reduction and activation filtering must be evaluated against:

- final visible outcome correctness;
- completion and explicit-failure rate;
- member correction, immediate Stop, and re-Wake rate;
- tool error rate;
- fallback recovery rate;
- cases where an Agent incorrectly stayed silent.

No token reduction is successful if these guardrails regress.

## Data Minimization

The future report must not copy:

- prompts or conversation transcripts;
- file contents or commands;
- local absolute paths;
- credentials or provider payloads;
- model-generated free-form silence explanations;
- arbitrary client metadata.

Prefer bounded enums, counts, durations, usage totals, and trace selectors.
Retention follows each owning domain. Weekly aggregate snapshots may be kept
without retaining the private raw content that produced them.

## Reporting Loop

```text
owning execution facts
-> weekly immutable aggregate
-> OpenMeld Quality presentation
-> sampled trace investigation
-> reviewed Feedback Issue when a repeated general problem is proven
-> implementation and canary comparison
-> next weekly aggregate
```

Feedback remains storage-only. A metric anomaly must not automatically Wake an
Agent or create unbounded issue noise. Conversion to a Feedback Issue is a
reviewed action supported by trace evidence.

## Deferred Questions

- exact raw-detail retention by owning domain;
- aggregation thresholds and minimum sample sizes;
- Organization-level visibility beyond the official OpenMeld Organization;
- sampling strategy for successful ordinary work;
- whether context-source bytes require a new bounded fact or can be derived;
- anomaly thresholds for reviewed Feedback Issue creation;
- presentation changes to the current `OpenMeld Quality` Space.

## Non-Goals

- real-time per-Agent productivity ranking;
- employee surveillance;
- prompt or transcript analytics;
- replacing RuntimeCoordinator or native-delivery truth;
- automated model selection based on unreviewed small samples;
- a new dashboard before the weekly report proves practical value.
