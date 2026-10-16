# Flue 2 integration boundary

This adapter targets exactly Flue 2.3.0. Vite builds the synchronous
`CenterAgentV2` hook function. Asynchronous materialization happens under the
immutable submission context before rendering; nested operations reuse those
resources, and concurrent submissions do not share them.

The first prelaunch cutover creates `FlueCenterAgentV2Agent` and deletes the
beta Agent and Registry classes. It does not delete the Computer class or Core
business data. This reset is authorized for the beta cutover only; repeating it
is not a future release strategy.

## Retained package adaptations

`patches/@flue__runtime@2.3.0.patch` retains ten explicit contracts:

1. A zero durability timeout disables total wall-clock expiration. Recovery
   attempts remain bounded; the five-attempt policy includes the initial run.
   Repeated failed materialization of a queued input consumes the existing
   attempt budget through a fenced SQL update, without a new table or timer.
   Healthy long-running work must not fail because one hour passed.
2. Exact-submission abort and a read-only submission projection support
   OpenMeld's execution identity. A late stop cannot abort a subsequent turn.
   The upstream conversation-wide abort remains available to upstream callers.
3. Persisted submission operations expose their completed text, model, and
   canonical usage through the existing operation observation. Flue 2.3.0
   supplies the text from its inner persisted-input operation, even though the
   outer submission handle returns void. The adaptation enriches that existing
   result with the actual model and recorded usage; it does not emit another
   completion. Usage is rebuilt from durable assistant steps, including prior
   attempts, and absent usage remains absent rather than becoming invented zeroes.
4. Compaction separates observed facts, current status, and pending plans.
   A bounded action-evidence section is regenerated from canonical tool events
   across repeated compactions. Tool counts are evidence of recorded calls and
   results, not proof that every external side effect succeeded.
   Counts cover the active conversation at the checkpoint, including retained
   original messages. The scope note prevents a reader from treating the summary
   and those same retained messages as two executions.
5. An agent may disable automatic queued-delivery joins. Center Agent does so
   because each admitted turn currently has its own authority and terminal
   callback. Upstream's default join behavior remains unchanged for other
   agents. Current-work corrections instead use Core's durable execution-input
   outbox and the exact-execution steering source described below. Core verifies
   the original sender and private Center Agent chat before accepting an input;
   independent queued deliveries retain separate authority and callbacks.
6. Submission instrumentation encloses every shared session-opening boundary.
   Actual recovery execution uses the same exact submission authority and
   prepared resources as live execution. Classification itself reads canonical
   records without rendering: an unavailable Computer or tool preparation must
   not prevent recognition of a completed response, a stop, or an exhausted
   budget. Terminal recovery commits the existing settlement outbox without
   requiring the optional rendered advisory. The next live session repairs any
   interrupted tail before applying new input; no external tool is blindly
   replayed to manufacture a result.
7. An optional exact-execution steering source can supply durably accepted
   inputs at the existing model-turn boundary. It resolves inside submission
   instrumentation. Flue validates the named agent, conversation and host
   execution, writes the input under that host's canonical authority, then
   acknowledges application. These inputs neither admit another execution nor
   run another delivery's start hooks. Canonical entry IDs make replay
   idempotent, and unresolved inputs participate in the existing recovery
   seam. The application must retain accepted inputs and enforce sender
   permissions; this runtime seam alone does not enable Web steering.

8. Tool presentation is consistent before provider serialization. A narrow
   `AgentStatics.projectResourceSignal` extension transforms only reserved
   framework resource/environment signals in model context, never canonical
   records. Live steering, joined inputs, restored histories and compaction
   share the renderer. Upstream 2.3.0 has no public hook at this provenance
   boundary; a provider-payload string replacement cannot distinguish user
   quotations from framework events. Flue also mounts `task` only with declared
   subagents. OpenMeld registers only its native subset; deferred capabilities
   remain in its one authorized catalog for discovery and Code Mode. Skill
   activation and supporting-file reads remain framework-owned and usable.

9. Optional `workingContextTokens` checks the full active model context before
   every inference through Pi's public `transformContext` seam. Flue alone
   commits the normal summary checkpoint and updates both its own projection
   and the loop snapshot. Supplier usage does not trigger a redundant summary
   afterward. `summaryTargetTokens` gives the model a visible checkpoint target
   with room to finish below `maxSummaryTokens`, the total generation ceiling
   including reasoning. That target guides the existing summary request; it
   does not clip the response or change canonical history. `maxSummaryTokens`
   bounds each completion independently; incomplete
   or empty summaries fail without replacing history. `recall_conversation`
   reads bounded pages of original user/assistant text from the same canonical
   lineage, excludes hidden reasoning, and cannot cross conversation generations.
   Unused string arguments accept null for strict provider schemas. The
   checkpoint prompt retains active facts and source pointers without growing
   an exhaustive archive. Its system instruction requires a fresh rewrite of
   the previous checkpoint, consolidating repeated facts and replacing old
   inventories with conclusions and recall/source references within the visible
   target. The previous checkpoint is source material, not a draft to expand.
   Mid-tool-loop cuts retain the issuing assistant and
   its paired results, including when the latest entry is a tool result. The
   public Node-runtime boundary tests are in `working-context.test.ts` and
   `context-recovery.test.ts`, including recovery after a failed summary and
   SQLite restart without disabling the budget or replaying completed tools. Paid supplier
   comparisons are opt-in in `live-context-cost.test.ts`. No transcript or
   search index is copied into an application-owned store.
   Working-context admission and cut planning share the same serialized UTF-8
   content estimate, including opaque provider signatures, and the native
   1,200-token image heuristic. Base64 bytes are not text tokens. Kept signatures
   and image bytes remain intact; the provider's physical-capacity guard still
   runs. Legacy compaction keeps its original estimator when no working-context
   budget is configured.
   `workingContextHeadroomTokens` reserves space for new work after deducting
   fixed instructions, tools and checkpoint allowance. The recent tail still
   preserves indivisible tool pairs. One working-context checkpoint summarizes
   earlier history and the unfinished turn in one request. Observations report
   fixed cost, before/after estimates, target and ceiling; these are estimates,
   not provider billing measurements. Internal entry metadata is excluded from
   the model-visible estimate.

   Under budget pressure, `reduceToolResultPreviews` can first remove older
   recoverable result previews from an ephemeral inference projection. Flue
   protects the recent token tail and at least two latest results. OpenMeld
   validates completed receipts through the existing execution-scoped result
   reader, including current access and expiry checks. It preserves receipt
   metadata and recovery references. Failed, running, expired and unretained
   results keep their previews. Access denial fails closed. Ordinary requests
   within budget perform no additional result lookup. Flue remeasures the
   reduced projection and summarizes canonical originals if it still exceeds
   the budget. It never persists the reduced projection as conversation history.
   `retained-context-runtime.test.ts` covers this public runtime boundary;
   `fixtures/retained-context-evaluation.md` records the paid experiment scope.

   The 48,000-token estimate is the normal working target. Failed maintenance
   may use an additional 8,000 estimated tokens, bounded by the selected route
   and reviewed prompt-price limit. The provider's final-payload guard remains
   separate. Within this band, one failed maintenance pass per operation is
   deferred; growth past the ceiling requires successful reduction or fails
   with the specific cause. Storage, authority and invariant failures do not
   qualify for deferral. A candidate is measured before committing, so an
   enlarged or over-ceiling summary never replaces usable context.

   Active submission inputs, including accepted steering, are projected from
   canonical originals after compaction. They retain their original role and
   are not added twice when already in the kept tail. The projection is scoped
   to the active submission and does not turn old requests into new authority.
   Summary generation uses low reasoning separately from the main request.
   Its Pi retry helper shares the configured model retry policy, observes each
   actual attempt, handles returned and thrown transient errors, and honors
   cancellation. Failed-attempt provider usage is retained by the existing
   request metering owner; successful checkpoint usage sums its observed calls.
   `context-recovery.test.ts` exercises these rules through the real runtime.

   Model changes apply at the next admitted submission, not inside a running
   tool. Summary requests are capacity-bounded even when the new model is
   smaller than the old history or checkpoint. Sequential intermediate
   summaries remain ephemeral; only a complete successful reduction may
   replace the canonical projection. Recent completed messages can be moved
   into that reduction at valid boundaries. Active input is never truncated.
   `model-switch-continuity.test.ts` exercises real SQLite restart and file
   writes, model isolation, summary failure, and single-execution continuity.
   Its synthetic 8,000-token provider exercises the runtime capacity boundary,
   not live supplier behavior. The pinned Pi adapter reserves additional space;
   the current hosted catalog has no such small-window model. Product admission,
   real inference, and Computer integration require separate smoke evidence.

10. `AgentStatics.modelRetry` configures the existing transient model-error loop.
   Center Agent allows five retries after the initial request, with exponential
   delays capped at 3, 6, 12, 24, and 30 seconds and upstream 75–100% jitter.
   Upstream 2.3.0 otherwise fixes this loop at three retries. Canonical assistant
   error records own the retry count, including resumed submissions. The patch
   exposes structured waiting, recovered, and exhausted observations, without
   another execution, retry ledger, or tool replay loop. Abort interrupts backoff;
   permanent errors retain upstream classification. Existing platform durability
   attempts are a separate budget and are not multiplied by an adapter retry.

   A text response stopped by the output limit is incomplete. The same session
   can request a complete, shorter answer twice, using its existing tool results.
   Original assistant records own this continuation budget across restarts and
   compactions. Exhaustion is a named failure, including during read-only recovery
   classification; a partial answer cannot become a completed terminal result.
   The existing replacement projection removes superseded partial text from live
   and restored replies instead of concatenating it with the complete answer.
   Truncated tool-call batches keep Pi's existing repair path. The tests in
   `flue-output-limit-recovery.test.ts` cover successful completion, exhaustion,
   preserved effects, and continuation after reopening a SQLite snapshot.

Beta registry initialization, async defineAgent, implicit sandbox discovery,
global provider registration, and permissive orphan-record reduction are not
ported. Flue 2 repairs partial streams at its execution ownership boundary.
OpenMeld supplies authorized Computer tools and packaged Skills without a Flue
sandbox, so shared Computer files cannot silently become instructions.

`patches/@cloudflare__computer@0.4.1.patch` makes a retained command's
`cancel()` await native output-subscription detachment over Workspace RPC.
Upstream unread-handle cancellation only invokes synchronous disposal, which
can return before the container releases its single subscriber. A following
`getExec` then fails with `EEXEC_BUSY` even though the process remains alive.
The patch awaits cancellation of the SDK's output stream; it does not signal
or replay the command. Reading and cancellation share one pending stream-open
promise, so cancelling during connection cannot consume the single-shot RPC
handle twice. Pending reads do not enqueue or close after cancellation.
The Worker client and
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
Upstream 0.4.1 still uses the same unacknowledged unread-handle path; upgrading
alone does not establish this contract.

These ten Flue adaptations are maintained integration code, not a completed
escape from upstream internals. On each Flue upgrade, compare the patch with
the new package, remove an adaptation only when the upstream behavior fulfills
its contract, and exercise the affected cancellation, observation, compaction,
recovery and steering boundaries. A clean patch apply alone proves none of them.

The exact-submission read projection also exposes completed output only after
the canonical settlement record confirms success. It folds the existing stream
without opening a producer, rendering the Agent, or starting another execution.
The final assistant entry supplies text/model, and recorded assistant entries
rebuild cross-attempt usage even after the settlement barrier releases full
attempt records. Running, missing, failed, or mismatched submissions cannot
supply a successful result. Recovery uses the normal Computer cleanup and
execution-owner CAS before projecting that result to Core; cancellation and
requested safety failures still win over an uncommitted success.

Recorded consumption is independent of that success-only output. The same
read-only projection returns exact-submission terminal model/usage for failed
and stopped work too, without returning its draft as an answer. Failed prompt
observations read those persisted assistant steps before emitting their error;
if that read itself fails, the original failure reaches canonical settlement
and reconciliation rather than committing an incomplete application outcome.
The recovery tests run the actual provider/coordinator into failure or Stop,
reopen SQLite with no application terminal metadata, and verify one usage record
and only a failed/stopped result. A failure before any model call stays unknown,
not a synthetic zero-consumption record.

Normal completion and recovery atomically persist the execution owner with the
existing callback model/usage fields in one conditional SQL update. This keeps
both stored record shapes readable by the previous patched release; it does
not add a second completion ledger. A losing observer cannot replace the
winner's metadata. Successful, failed, and stopped outcomes retain known usage,
with the owner's stable completion time as the existing usage-record key so
callback retries do not count consumption again. Missing usage is not zero.

OpenMeld consumes observation deltas rather than Flue's public conversation
stream. When a failed assistant step is replaced, the first replacement text
delta carries a prefix derived from the official conversation UI projection.
The publisher atomically replaces accumulated and buffered failed text with
that prefix before appending the new delta. Legitimate earlier tool narration
remains; reasoning and tool payloads never enter the prefix. Ordinary model
turns do not reset text. The existing stream identity, increasing sequence,
snapshot bounds, cancellation checks, and Core callback schema are unchanged.
This correction becomes visible with the first replacement text, not through
an invented empty delta while the replacement is still waiting for its model.
The pending prefix belongs to the response, not an individual assistant step:
tool-only steps and empty deltas do not consume it. The first nonempty text
delta consumes it once, and response cleanup prevents it reaching another
submission. No new durable state or callback protocol is introduced.

The Flue 2.3.0 integration retains the registration boundary, the trusted
resource-signal projection, and conditional task mounting. Upstream 2.3.0
still mounts `task` unconditionally and lacks the signal projection hook, so
the existing adaptation remains necessary. Provider-side clipping stays removed. Run
`tool-catalog-contract.test.ts`, `tool-catalog-compaction.test.ts`,
`tool-catalog-loop.test.ts`, the existing capability/Code Mode authorization
tests, and the real-provider opt-in loop. The retained pre-fix SQLite fixture
must stay unchanged; recreating it with the new implementation loses the
old-session regression. The Node executor proves orchestration and real Core
policy, not Worker Loader isolation or deployed Space publication.
Remote Agent declares Core as a development dependency for these cross-owner
contract tests, so the existing workspace build graph prepares Core dependencies.
The Node Vitest config reuses Core's lazy-module builder, including for targeted
test runs; generated runtime files remain owned by Core and untracked.

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
spawn in the account-owned Computer and scopes them to the exact invocation.
Hosted submissions retain only their immutable Computer target for cleanup;
Local CLI operations reach the same owner through authenticated Core RPC.
Repeating a key reconnects;
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

The container image includes Node.js 24 and Corepack-managed pnpm, so hosted
turns can install dependencies, build, and run JavaScript projects in the same
durable Computer workspace. All three backends have direct network access.
The worker-shell backend runs built-in commands. The worker-javascript backend
runs ECMAScript modules in Workers. Neither provides installed Node.js binaries.
A development server listening inside this
container is not automatically reachable from Browser Run; a separately
authorized private preview route is required for browser smoke of that server.

Local runtime recovery is not proof of an uninterrupted deployment. For changes
to these boundaries, verify the staging deployment handoff, pending external tools
and delegation, session context continuity, and shared Computer behavior.
Core memory and visible messages alone are not sufficient to restore opaque
choices, unpublished drafts, or intermediate tool results.
Computer replacement acceptance proves a narrower outcome: a command may be
lost while conversation context and durable files survive, and the model can
recognize the loss and continue safely. It does not promise uninterrupted
native processes or transparent replay of arbitrary external effects. Core-only
deployment smoke does not certify simultaneous Remote Agent and Computer
updates. No dual-target handoff is implemented or claimed here.

Flue 2 joins queued deliveries into a live response by default; the Center Agent
disables that default. Steering, confirmation, cancellation, and callbacks must
remain bound to the exact execution and preserve each sender's authority. Independent work
must not inherit the running submission's tools or permission context.

Task retirement is a separate product change; existing Task tools and entry
points remain supported. Changes to sessions, Apps or Slack require their own
authenticated acceptance. Passing runtime tests does not certify those paths.

Computer capability admission freezes identity and checks authorization without
opening the remote workspace, describing a browser, or loading document contents.
The first Computer operation prepares the workspace. Concurrent operations share
a successful preparation. A failed preparation can be attempted by a later call
without replaying its business operation. Document checkout separately loads its
authorized projection on demand. Required Space Work handoff files remain a
precondition before execution. Each operation still checks current authorization.
