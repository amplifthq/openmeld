# Flue 2 integration boundary

This adapter targets exactly Flue 2.0.3. Vite builds the synchronous
`CenterAgentV2` hook function. Asynchronous materialization happens under the
immutable submission context before rendering; nested operations reuse those
resources, and concurrent submissions do not share them.

The first prelaunch cutover creates `FlueCenterAgentV2Agent` and deletes the
beta Agent and Registry classes. It does not delete the Computer class or Core
business data. This reset is authorized for the beta cutover only; repeating it
is not a future release strategy.

## Retained package adaptations

`patches/@flue__runtime@2.0.3.patch` retains six explicit contracts:

1. A zero durability timeout disables total wall-clock expiration. Recovery
   attempts remain bounded. Healthy long-running work must not fail because
   one hour passed.
2. Exact-submission abort and a read-only submission projection support
   OpenMeld's execution identity. A late stop cannot abort a subsequent turn.
   The upstream conversation-wide abort remains available to upstream callers.
3. Persisted submission operations expose their completed text, model, and
   canonical usage through the existing operation observation. Upstream's
   persisted-input path returns void, unlike its prompt path; interpreting that
   missing result as an empty answer would incorrectly fail a successful turn.
   Usage is rebuilt from durable assistant steps, including prior attempts.
4. Compaction separates observed facts, current status, and pending plans.
   A bounded action-evidence section is regenerated from canonical tool events
   across repeated compactions. Tool counts are evidence of recorded calls and
   results, not proof that every external side effect succeeded.
5. An agent may disable automatic queued-delivery joins. Center Agent does so
   because each admitted turn currently has its own authority and terminal
   callback. Upstream's default join behavior remains unchanged for other
   agents. Exact-execution steering must be completed through its own authorized
   ingress before the session upgrade is release-ready.
6. Submission instrumentation encloses the shared session-opening boundary,
   including recovery inspection and abort/terminal reconciliation. These paths
   render the agent just as live execution does and require the same exact
   submission authority and prepared resources. Instrumenting only the live
   process leaves a restarted Worker unable to reconcile an interrupted turn.

Beta registry initialization, async defineAgent, implicit sandbox discovery,
global provider registration, and permissive orphan-record reduction are not
ported. Flue 2 repairs partial streams at its execution ownership boundary.
OpenMeld supplies authorized Computer tools and packaged Skills without a Flue
sandbox, so shared Computer files cannot silently become instructions.

The footprint reader is a pinned, read-only aggregate over Flue's inline and
spilled batches. It does not write runtime state or derive execution truth.
Unknown storage tables fail closed until this adapter is updated and verified.

Runtime diagnostics use the actual Flue 2 submission columns and emit the
version-2 shared contract. They do not query beta attempt-marker or recovery
tables. Core must accept that version before the producer is deployed. A test
reads a submission admitted through the pinned SQLite adapter, so a mocked
diagnostic row cannot hide upstream schema drift.

## Remaining release gates

Local runtime recovery is not proof of an uninterrupted deployment. Before
production, verify the real staging deployment handoff, pending external tools
and delegation, session context continuity, and shared Computer behavior.
Core memory and visible messages alone are not sufficient to restore opaque
choices, unpublished drafts, or intermediate tool results.

Flue 2 joins queued deliveries into a live response by default; the Center Agent
disables that default. Before release, bind steering, confirmation, cancellation, and callbacks
to the exact execution and preserve each sender's authority. Independent work
must not inherit the running submission's tools or permission context.

Task retirement is deferred by the latest user scope decision; existing Task
tools and entry points remain coherent for this candidate. Session behavior,
staging Apps and Slack integration, and complex authenticated acceptance still
require verification. Passing runtime tests does not certify those paths.
