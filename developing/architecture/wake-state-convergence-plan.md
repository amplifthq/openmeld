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
owner-specific answers that may be composed for presentation without acquiring
authority over one another.

## Non-Goals

Batch 0 does not:

- change production behavior or user data;
- rename every compatibility symbol or endpoint before its owning code changes;
- add a feature, public state, fallback, or second resolver;
- rewrite all OpenMeld documentation; or
- treat passing documentation checks as evidence that the implementation is
  already correct.

## One Question, One Answer

Each public question has one authoritative answer. A composed screen may
show several answers together, but one answer must never be recomputed from a
different answer.

| User question | Authoritative answer | Source ownership | Must not decide |
| --- | --- | --- | --- |
| Who is this Agent? | Profile Directory | Auth owns identity; Core owns the permission-scoped directory projection | Wakeability, Activity, progress, or recovery |
| Can this Agent accept a new Wake here now? | Wakeability | Core owns the current verdict from current owner facts | The outcome of an accepted Wake or observed coding activity |
| What is this Agent doing? | Agent Activity | Agent Activity owns privacy-safe provider-observed session activity | Wakeability, queue position, or Wake outcome |
| What is happening to this Wake? | Wake Progress | The per-Wake projection consumes Work Coordinator queue truth and RuntimeCoordinator execution truth | Future Wakeability or general Agent Activity |
| What happened to this Wake? | Wake Outcome | RuntimeCoordinator owns execution outcome; Space owns visible reply or outcome publication | Current Wakeability for later requests |
| What can I do now? | Recovery | A shared stateless resolver maps current owner facts or one exact Wake Outcome to one permitted next action | The blocker, execution outcome, or local facts it consumes |

These are six semantic questions, not a requirement for six endpoints, caches,
stored projections, or state machines. A public answer may be a bounded
projection over several owner facts, and one bounded aggregate request may
carry several owner answers when it preserves their provenance and does not
recompute them. Each factual answer still has one owner and writer; Recovery has
one shared stateless rule. Consumers render the result; they do not repeat its
business decision.

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

Recovery is a shared, stateless resolver. It consumes current owner facts or one
exact Wake Outcome and returns at most one primary action that the current
viewer can perform. Current-state actions such as **Connect computer**,
**Reconnect computer**, **Update**, or **Connect local agent** require
reconfirmed current facts from their owners. An old Wake failure cannot grant
them. One exact Wake Outcome may authorize only an outcome-scoped action, such
as publication or reply recovery for that Wake. Recovery does not own state,
persist a projection, inspect private implementation state, or combine reason
codes into a second verdict. Another viewer may receive a neutral explanation
without receiving an action they cannot complete.

## Read And Refresh Contract

Profile Directory, Wakeability, Activity, Wake Progress, Wake Outcome, and
Recovery have distinct semantic boundaries. Each factual answer retains its
source ownership; Recovery stays derived and stateless. Their delivery shape is
an implementation choice. Existing bounded aggregates or combined requests may
carry several owner answers when they preserve provenance, avoid secondary
adjudication, and allow a failing dependency to be isolated where the user
experience requires it. This contract does not require six endpoints, caches,
state machines, or network round trips.

`OrganizationAgentRuntimeOverviewResponse` may remain a compatibility entrypoint
or bounded aggregate over the same owners. Split it only where measurement shows
that fan-out, coupling, or failure propagation creates user-visible delay,
incorrect blocking, or prevents an owner-correct refresh.

Live invalidation remains a refresh signal, never state. Use existing targeted
invalidation where it is available. Additional WebSocket invalidation, narrower
refreshes, or retirement of normal polling are conditional follow-ups justified
by measured staleness, latency, or traffic; they are not completion gates for
the three implementation batches. Any retained polling is bounded and never
becomes an authority.

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

This is display continuity only. A stale displayed **Available** verdict never
authorizes the Composer or a send. A new Wake still requires current Core
Wakeability and current fail-closed admission.

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

The accepted identity includes the immutable request, target, Binding and
configuration revision, execution authority, source message, and reply
destination. Transport-attempt timestamps, recovery provenance, and
display-name enrichment may change without changing that identity. A genuine
accepted-payload conflict is neither a duplicate nor a connectivity verdict:
RuntimeCoordinator settles the exact pre-execution Wake visibly when safe, and
otherwise the dispatch remains retryable without executing changed content.
Core retains the accepted-payload fingerprint in a rollback-safe sidecar after
terminal head cleanup. Two known, different fingerprints conflict; a legacy
terminal authority without the sidecar safely reuses its terminal outcome and
records a compatibility diagnostic without claiming that details changed. This
also closes a changed-payload redrive after terminal-head retirement without
execution, duplicate publication, or ledger rewrite. An already-prepared
non-conflict failure keeps its owning RuntimeCoordinator reason instead of being
relabeled as a payload conflict. A per-Wake conflict may publish its exact
outcome but must not write a current Wakeability blocker.
Validation covers three consecutive Wakes to one Agent Profile plus controlled
Service update and replacement-generation redelivery without crossed execution
or reply identities.

The same pull request updates the relevant sections of
`developing/architecture/agent-transport-contract.md` and
`developing/product/agent-profiles.md` when behavior changes.

### Batch 2 — Current fact and projection ownership

The Local Service owner and Core projection owner may work in parallel after
their shared input contracts are fixed. The Local Service lane produces current
local facts and freshness only. The Core lane produces the single Wakeability
verdict from the implemented owner inputs. Touched paths stop making duplicate
current-versus-history decisions and preserve the owner of each answer.

This batch must stop using a historical Wake failure or persisted
`readinessImpact` as a direct input to later Wakeability. When old failure
evidence suggests that a blocker may still exist, Core must reread or reconfirm
the current fact from its owner before producing the current verdict.

Existing aggregate APIs and compatibility entrypoints may remain when they
delegate to the same owner answer. Narrower reads, list/runtime separation, and
targeted invalidation are follow-ups only where behavior and measurement justify
them. The physical removal of `readinessImpact` persistence, historical
diagnostic use, tables, schemas, and lifecycle code may also remain a follow-up
after it no longer decides Wakeability. None of those cleanup items is an
automatic Batch 2 completion requirement.

The same pull requests update
`developing/architecture/local-openmeld-service.md`,
`developing/architecture/shared-contracts.md`,
`developing/architecture/data-and-observability.md`, and the affected product
owner documents.

### Batch 3 — Client convergence

Web, Composer, CLI, and other touched clients consume the authoritative owner
answers. They may adapt layout, detail, and viewer-permitted actions; they must
not change the verdict or let displayed stale data authorize a Wake.
Independent loading, targeted invalidation, and polling changes are required
only where measured behavior shows they are needed for correctness or a clear
user-facing improvement.

The same pull requests update the affected client owner documents. Touched
paths stop duplicate adjudication. Unrelated compatibility resolvers,
entrypoints, terminology, and polling may remain until an evidence-backed
follow-up removes them safely.

## Batch Gates

Each implementation batch has one owner per changed authority, one pull request
or explicitly integrated batch candidate, one exact release SHA when a release
is required, and one evidence set.

A batch is not complete until:

1. the changed user question has one authoritative answer;
2. the touched path does not introduce or retain competing adjudication;
3. behavior tests fail when another authority is reintroduced;
4. the matching owner documents change with the implementation;
5. the change passes its risk-selected validation and exact candidate gate; and
6. any user-visible behavior is verified through the smallest real product
   entry point after release.

Full Runtime Overview decomposition, universal narrow reads, complete WebSocket
coverage, normal-polling retirement, and repository-wide resolver or terminology
cleanup are conditional follow-ups, not hidden gates for these three launch
batches.

Batch 3 also removes this plan after every durable rule has one permanent owner.
