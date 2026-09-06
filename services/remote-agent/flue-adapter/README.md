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

`patches/@flue__runtime@2.0.3.patch` retains seven explicit contracts:

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
   agents. Current-work corrections instead use Core's durable execution-input
   outbox and the exact-execution steering source described below. Core verifies
   the original sender and private Center Agent chat before accepting an input;
   independent queued deliveries retain separate authority and callbacks.
6. Submission instrumentation encloses the shared session-opening boundary,
   including recovery inspection and abort/terminal reconciliation. These paths
   render the agent just as live execution does and require the same exact
   submission authority and prepared resources. Instrumenting only the live
   process leaves a restarted Worker unable to reconcile an interrupted turn.
7. An optional exact-execution steering source can supply durably accepted
   inputs at the existing model-turn boundary. It resolves inside submission
   instrumentation. Flue validates the named agent, conversation and host
   execution, writes the input under that host's canonical authority, then
   acknowledges application. These inputs neither admit another execution nor
   run another delivery's start hooks. Canonical entry IDs make replay
   idempotent, and unresolved inputs participate in the existing recovery
   seam. The application must retain accepted inputs and enforce sender
   permissions; this runtime seam alone does not enable Web steering.

Beta registry initialization, async defineAgent, implicit sandbox discovery,
global provider registration, and permissive orphan-record reduction are not
ported. Flue 2 repairs partial streams at its execution ownership boundary.
OpenMeld supplies authorized Computer tools and packaged Skills without a Flue
sandbox, so shared Computer files cannot silently become instructions.

`patches/@cloudflare__computer@0.2.1.patch` makes a retained command's
`cancel()` await native output-subscription detachment over Workspace RPC.
Upstream unread-handle cancellation only invokes synchronous disposal, which
can return before the container releases its single subscriber. A following
`getExec` then fails with `EEXEC_BUSY` even though the process remains alive.
The patch adds an acknowledged cancellation method to the SDK's internal
handle RPC; it does not signal or replay the command. The Worker client and
Computer RPC owner must deploy together. The regression test uses both real
SDK wrappers and checks unread, connecting, and actively reading handles.
UTF-8 command events are decoded by a pull-driven reader, which waits for
upstream cancellation without an independently pumping TransformStream. Under
workerd, cancelling the old transform could race its pending enqueue and fail
with "The readable side of this TransformStream is no longer readable."
The runtime wrapper captures its reader before cancelling so a concurrent
pending read cannot clear that reference before cleanup. The same SQLite
Workspace contract runs under Node and workerd, exercising unread cancellation,
a live polling slice, reattachment, split UTF-8 output, and completed output.
Run `pnpm --filter @openmeld/remote-agent test:workerd` for the Workers boundary;
the ordinary package test command includes it after the Node suite.
Cancellation also distinguishes a live output reader from a reader already
released before post-command file synchronization. A delayed synchronization
regression covers cancellation in that interval without cancelling the same
reader twice or publishing completion after the consumer has detached.
The lower container Cap'n Web transport still has no eager cancellation
acknowledgement for a silent stream producer. Consequently the native
`EEXEC_BUSY` result remains a supported live-process observation, exposed as
`running` with `outputPending` after a bounded wait. Output is retained and
replayed after exit; it is never fabricated, and the process is never replayed.
These tests do not certify the WebSocket transport; staging tests cover that
additional boundary.
Upstream 0.2.1 still uses the same unacknowledged unread-handle path; upgrading
alone does not establish this contract.

The footprint reader is a pinned, read-only aggregate over Flue's inline and
spilled batches. It does not write runtime state or derive execution truth.
Unknown storage tables fail closed until this adapter is updated and verified.

Runtime diagnostics use the actual Flue 2 submission columns and emit the
version-2 shared contract. They do not query beta attempt-marker or recovery
tables. Core must accept that version before the producer is deployed. A test
reads a submission admitted through the pinned SQLite adapter, so a mocked
diagnostic row cannot hide upstream schema drift.

## Runtime validation boundaries

Long container commands use `computer_command` and the Computer SDK's retained
`exec` / `getExec` / `killExec` handles. OpenMeld persists dispatch keys before
spawn and scopes them to the exact submission. Repeating a key reconnects;
it never respawns after an ambiguous transport failure or a lost container.
Polling detaches after a bounded slice without killing the process. Completion
requires an exit receipt and stream close (including the SDK's file sync).
Cancellation requests stop only that submission's commands. Terminal handling
requests cleanup and fails the execution if commands were left unfinished or
their outcome cannot be verified. These are execution receipts, not a new Task
or a separate Computer per chat. Real restart and stop smoke remains required.

The container installs Tini. Retained commands replace computerd's outer shell
with `tini -s -g`, so its native PID forwards cancellation to that command's
process group, including shell children and pipelines. Keep the image and
command launcher changes together. Verify the real Linux process boundary with
`node --experimental-strip-types services/remote-agent/scripts/verify-computer-command-process.mjs <local-image>`
from the repository root. `--baseline` reproduces the unwrapped shell behavior
in a disposable, network-disabled container. The check also proves a concurrent
peer survives cancellation and compound commands preserve quoting and exit codes.

Local runtime recovery is not proof of an uninterrupted deployment. For changes
to these boundaries, verify the staging deployment handoff, pending external tools
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
