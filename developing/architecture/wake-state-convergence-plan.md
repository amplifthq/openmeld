# Wake State Convergence Plan

## Agent Context

- Purpose: Freeze the approved migration from overlapping Agent state models to
  one authoritative answer for each user question before implementation begins.
- Read this when: Implementing or reviewing Wake identity, Wakeability, Agent
  Activity, per-Wake progress or outcome, recovery guidance, Agent directory
  loading, Composer eligibility, or Agent status freshness during this migration.
- Update this when: A batch lands, current source invalidates a recorded gap, or
  an approved owner boundary changes before the migration is complete.
- Do not use this for: Current production behavior, endpoint or schema details,
  permission to infer one state from another, or a permanent replacement for the
  routed product, architecture, client, and engineering owner documents.
- Source of truth: This file owns the approved migration boundary and batch
  order until the durable rules are absorbed into their owner documents.

Status: APPROVED — Batch 0 freezes the contract; Batches 1 through 3 remain
implementation work and must not be described as shipped until their own code,
tests, owner-document updates, merge, release, and user-visible evidence exist.

Removal condition: Delete this plan when all three implementation batches have
landed and every durable rule below is represented once in its routed owner
document; git history is the archive.

Written against: `645501a80c28847664585cf705b651ed2c1392e8`.

## Outcome

An OpenMeld surface should answer the user's immediate question without mixing
identity, current availability, background activity, one Wake's lifecycle, or a
repair action into one ambiguous status.

The target is not a larger universal status object. It is a small set of
owner-specific projections that may be composed for presentation without
acquiring authority over one another.

## Non-Goals

Batch 0 does not:

- change production behavior or user data;
- rename every compatibility symbol or endpoint before its owning code changes;
- add a feature, public state, fallback, or second resolver;
- rewrite all OpenMeld documentation; or
- treat passing documentation checks as evidence that the implementation is
  already correct.

## One Question, One Answer

Each public question has one authoritative projection. A composed screen may
show several answers together, but one answer must never be recomputed from a
different projection.

| User question | Authoritative answer | Source ownership | Must not decide |
| --- | --- | --- | --- |
| Who is this Agent? | Profile Directory | Auth owns identity; Core owns the permission-scoped directory projection | Wakeability, Activity, progress, or recovery |
| Can this Agent accept a new Wake here now? | Wakeability | Core owns the current verdict from current owner facts | The outcome of an accepted Wake or observed coding activity |
| What is this Agent doing? | Agent Activity | Agent Activity owns privacy-safe provider-observed session activity | Wakeability, queue position, or Wake outcome |
| What is happening to this Wake? | Wake Progress | The per-Wake projection consumes Work Coordinator queue truth and RuntimeCoordinator execution truth | Future Wakeability or general Agent Activity |
| What happened to this Wake? | Wake Outcome | RuntimeCoordinator owns execution outcome; Space owns visible reply or outcome publication | Current Wakeability for later requests |
| What can I do now? | Recovery | Recovery maps a current blocker or exact Wake outcome to one permitted next action | The blocker, execution outcome, or local facts it consumes |

The public answer may be a bounded projection over several owner facts. That
projection has one contract and one writer. Its consumers render it; they do not
repeat its business decision.

## State Laws

### Wake identity stays attached to the accepted request

One accepted Wake keeps its source message, target Agent Profile, accepted
Binding and configuration revision, execution identity, and reply destination.
A later recheck may prevent that exact Wake from starting when a current owner
fact proves it cannot run, but it must not silently retarget the Wake, publish
under another request, or mutate a later Wake.

### Current and historical facts stay separate

A durable failure explains what happened to one Wake. It is not by itself a
current Wakeability blocker for a later Wake. When a failure suggests a lasting
problem, the owner of that current fact must confirm and project the problem.
Recovery and diagnostics may retain the historical failure without presenting
it as a current verdict.

### Wakeability and Activity stay separate

Wakeability answers whether a new Wake can be accepted now. Activity answers
what provider-observed coding session activity is visible now. Working does not
prove Available, and an idle or missing Activity row does not prove Offline or
Unavailable.

### Progress and Outcome stay scoped to one Wake

Queue position, delivery, running progress, stop, failure, reply, and
publication uncertainty belong to the exact Wake. They remain visible even if
current Wakeability later changes. A current Available verdict must not hide a
real failure, and an earlier failure must not replace a current Available
verdict.

### Recovery is an action projection

Recovery consumes an owner verdict and returns at most one primary action that
the current viewer can perform. It does not inspect private implementation state
or combine reason codes into a second verdict. Another viewer may receive a
neutral explanation without receiving an action they cannot complete.

## Read And Refresh Contract

Profile Directory, Wakeability, Activity, Wake Progress, Wake Outcome, and
Recovery must be independently readable, cacheable, and refreshable. A list may
request a bounded batch of one projection; it must not acquire every other
projection as a prerequisite.

`OrganizationAgentRuntimeOverviewResponse` remains a compatibility aggregate
during migration. New consumers must not depend on it. Batch 2 retires it from
normal Agent list and authoring paths by introducing or reusing the narrow
owner projections required by those surfaces.

Live invalidation is a targeted refresh signal, never state. A client refreshes
only the affected projection and profile IDs. Bounded polling is a fallback for
an active operation or missed invalidation, not the normal source of truth.

A refresh does not erase the last settled answer. For example:

```text
Available · Checked 3 minutes ago
Refreshing…
```

`Checking` is used only when the owner currently lacks enough evidence for a
settled answer and is actively trying to obtain it. It is bounded. Starting a
client refresh does not itself change an existing Available, Offline, or
Unavailable verdict; the client keeps that verdict visible and shows freshness
separately until the owner returns a newer verdict.

## Product Language Contract

Product vocabulary uses **Wakeability** for the current ability to accept a new
Wake. The public verdicts are **Available**, **Checking**, **Offline**, and
**Unavailable**. Existing `AgentExecutionReadiness`, `AgentWakeAvailability`,
`AgentExecutionStatusProjection`, and `/execution-readiness` identifiers are
compatibility implementation names during migration, not additional concepts
or permission to create another model.

User-facing recovery copy names the affected object and the concrete action.
The blocker and its action appear together.

| Known fact | Status copy | Primary action |
| --- | --- | --- |
| No connected computer is selected | Connect a computer to run this Agent. | `Connect computer` |
| A known computer is disconnected | `{computerName} is not connected.` | `Connect computer` |
| A known computer was connected but is offline | `{computerName} is offline.` | `Reconnect computer` |
| The computer needs a required OpenMeld update | `{computerName} needs an update.` | `Update` |
| The Agent Profile has no local-agent Binding | This Agent is not connected to a local agent. | `Connect local agent` |
| A current check did not finish | The check did not finish. | `Check again` |

Primary blocker copy must not say `needs setup` or use `Review setup` as an
action. Broad onboarding may still use setup language when the user is entering
an actual multi-step setup flow; a known blocker uses the specific object and
verb above. Diagnostics may name OpenMeld Service, Runtime, Binding, route, or
claim; primary recovery copy does not require those internal concepts.

## Implementation Batches

### Batch 1 — Wake identity and execution correctness

One execution owner fixes accepted-Wake identity, dispatch and execution
ownership, reply attribution, deterministic redrive, and visible terminal
outcomes. It must prove that requests, executions, and replies cannot be lost or
crossed. It does not redesign Agent list loading or UI status presentation.

The same pull request updates the relevant sections of
`developing/architecture/agent-transport-contract.md` and
`developing/product/agent-profiles.md` when behavior changes.

### Batch 2 — Current fact and projection ownership

The Local Service owner and Core projection owner may work in parallel after
their shared input contracts are fixed. The Local Service lane produces current
local facts and freshness only. The Core lane produces the single Wakeability
verdict and narrow directory, Wakeability, Activity, progress, and recovery
reads required by clients.

This batch removes historical Wake failure as direct current Wakeability input,
retires duplicate resolvers from touched paths, separates normal list reads from
runtime fan-out, and makes targeted invalidation sufficient for refresh.

The same pull requests update
`developing/architecture/local-openmeld-service.md`,
`developing/architecture/shared-contracts.md`,
`developing/architecture/data-and-observability.md`, and the affected product
owner documents.

### Batch 3 — Client convergence

Web, Composer, CLI, and other touched clients consume the authoritative narrow
projections. They may adapt layout, detail, and viewer-permitted actions; they
must not change the verdict. Independent loading keeps available sections
usable, live invalidation refreshes affected data, and bounded polling remains
only where an active operation needs confirmation.

The same pull requests update the affected client owner documents and remove
obsolete client-side resolvers, terminology, and normal-state polling.

## Batch Gates

Each implementation batch has one owner per changed authority, one pull request
or explicitly integrated batch candidate, one exact release SHA when a release
is required, and one evidence set.

A batch is not complete until:

1. the changed user question has one authoritative answer;
2. competing resolvers and stale terminology in the touched scope are removed;
3. behavior tests fail when another authority is reintroduced;
4. the matching owner documents change with the implementation;
5. the change passes its risk-selected validation and exact candidate gate; and
6. any user-visible behavior is verified through the smallest real product
   entry point after release.

Batch 3 also removes this plan after every durable rule has one permanent owner.
