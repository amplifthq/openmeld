# Center Agent Tasks

## Agent Context

- Purpose: Define the first-class Center Agent Task product, its canonical
  conversation context, lifecycle, authority, cross-channel behavior, recovery,
  Inbox projection, and Web surfaces.
- Read this when: You are changing Center Agent work that can continue in the
  background, run in parallel, be reopened as a conversation, appear in Tasks or
  Inbox, or move between OpenMeld Web and a connected Message Channel.
- Update this when: Task vocabulary, state, context, visibility, events,
  concurrency, execution linkage, Stop, Retry, Recovery, Channel delivery,
  Inbox projection, or Task UI changes.
- Do not use this for: RuntimeCoordinator execution truth, Agent Task
  Coordination subscriptions, controller-native task storage, Routine
  scheduling, Space message truth, Inbox read state, or provider transcript
  storage.
- Source of truth: This file owns the Center Agent Task product. Core owns the
  canonical durable Task record and event stream. Execution, Space, Routine,
  Message Channel, Inbox, and authorization owners retain their existing truth.

## Product Promise

One resident Center Agent can coordinate several independent pieces of work at
the same time without making the user create or manage chat sessions.

The product model is:

```text
one Center Agent identity
-> one everyday Chat for new requests and coordination
-> zero or more durable Tasks with isolated context
-> parallel work across Tasks, serialized conversation inside each Task
-> one conversation-first Task detail for progress, steering, and outcomes
```

A Task is not a second Center Agent. It is one durable unit of user-visible work
managed by the same Center Agent. The user may continue talking in Center Agent
Chat while several Tasks run, open any Task to give more direction, and ask the
Center Agent about another Task without merging their contexts.

Task creation is normally a Center Agent coordination decision, not a
prompt-engineering requirement. The user states the desired outcome. The Center
Agent creates a Task when work is meaningfully independent, long-running,
parallel, delegated, recoverable, or likely to need later re-entry. A short
answer or one immediate safe action may remain in Chat without creating a Task.
When the user explicitly chooses a new or dedicated Task as the work surface,
that choice is binding even for short work: the Center Agent creates the Task
before doing the work and does not silently substitute Chat or a Space. This
rule is identical across Web, OpenMeld Spaces, Slack, the OpenMeld CLI, and
other contracted Message Channels. The shared Remote Agent admission and
provider-execution path preserves this choice inside the ordinary Center Agent
loop: the same primary Agent sees the complete admitted context, decides that
the explicit Task choice is binding, and calls the canonical Task tool. Core
then authorizes and records the mutation. No carrier-specific keyword rule,
pre-agent classifier, auxiliary model, forced tool choice, or abbreviated
acknowledgement may reinterpret or complete this request outside that loop.

## Canonical Vocabulary

Use these terms consistently:

- A **Center Agent Task**, presented as **Task**, is one Organization-scoped,
  durable, user-visible work container coordinated by the resident Center Agent.
- **Center Agent Chat**, presented as **Chat**, is the everyday Direct Message
  Space used to start work, ask questions, and coordinate Tasks. It is not a
  global Task context.
- **Task Context** is the isolated model-execution conversation owned by the
  Remote Agent runtime under a stable conversation id derived from one
  canonical Task id. Core owns admission and the product event stream; it does
  not copy or reconstruct the private runtime transcript.
- A **Task event** is one immutable, ordered fact in the Task conversation or
  lifecycle.
- A **Task execution attempt**, usually presented only as part of Task history,
  is one attempt to advance a Task. It may link one Center Agent native delivery,
  delegated Space Wakes, controller-native executions, and exact continuations.
- An **Agent Task Handle** is an internal exact execution selector used by Agent
  Task Coordination. It is not a Center Agent Task id and is never the product
  object shown on the Tasks board.
- A **Task origin** records where the Task was requested: Center Agent Chat, a
  OpenMeld Space, Slack, Lark, Feishu, a Routine Run, or another contracted
  source. Origin is provenance, not permanent routing or access authority.
  Current Task creation freezes the verified requester's user id, human Profile
  id, and display name from the parent native delivery. An OpenMeld-origin Task
  also freezes a bounded Local Agent client label when the parent request came
  through `openmeld center-agent ask`. The local session locator is never copied
  into Task product data.
- A **Task access scope** defines who may read or steer the Task in OpenMeld. It
  is distinct from who can see a native provider reply.

Existing lower-level wire fields such as `taskId`, controller task, and
`AgentTaskHandle` may remain during compatibility windows. Product copy and new
domain APIs must not use those execution meanings as if they were Center Agent
Tasks. New internal prose should call them Agent executions or execution
handles.

## Domain Boundary And Ownership

Center Agent Tasks are a new Core-owned durable domain. They do not enlarge the
ownership of Agent Task Coordination.

Core is the only canonical product Task writer and owns:

- Task identity, Organization scope, requester attribution, title, access scope,
  status, terminal outcome, and timestamps;
- the ordered Task event stream;
- the monotonic Task revision and stable runtime-conversation link;
- links from a Task to execution attempts and exact execution handles;
- Task-level Stop and Retry operation identities;
- the authorized list, board, detail, and compact launcher projections;
- the current `center_agent_task_authorized_readers` projection consumed by
  Inbox and other read surfaces;
- Task source events that may be adapted into Inbox items.

Other owners remain unchanged:

- RuntimeCoordinator owns in-flight workstation Wake execution truth.
- Native delivery owns one hosted Center Agent execution and its publication
  evidence.
- A controller-native task owner owns that local controller execution.
- Agent Task Coordination owns exact-task subscriptions, delegation topology,
  observed terminal outcomes, and declared continuations.
- Space owns Space messages, membership, thread placement, and Space-visible
  outcomes.
- A Message Channel adapter owns provider verification, typed locator handling,
  and native publication.
- A Routine and its Run remain owned by the Routine domain.
- Inbox owns recipient read, unread, Dismiss, and delivery state only.

The Remote Agent runtime owns each Task's private model transcript and context
compaction under the stable Task conversation id. The Task domain consumes
runtime facts through explicit contracts. It must not
reconstruct execution truth from Dispatch Ledger rows, client caches, generic
Agent status, Agent Activity, process presence, elapsed time, or model text.

## Canonical Task Record

The canonical record contains at least:

- stable `taskId` and `organizationId`;
- exact creator/requester principal and creation attribution;
- immutable origin kind plus a typed, bounded source locator;
- current access scope and the authority that established it;
- bounded title;
- canonical product state, optional current phase, and optional terminal
  outcome;
- monotonic `taskRevision` and `contextRevision`;
- current execution-attempt link, when one exists;
- creation, update, and finish timestamps; and
- bounded safe summary fields required by list and compact surfaces.

The requester principal supports either:

- one verified OpenMeld user in the current Organization; or
- one exact connected Message Channel principal proven by the active
  Core-authored delivery.

A provider principal does not become an OpenMeld member, Human Profile, or role.
An exact later Message Channel Identity Link may authorize that same person to
open their exact existing Tasks in Web. Display-name, email, or model similarity
must never attach historical Tasks to an account.

## Phase 1 Implementation Boundary

The first implementation deliberately ships a smaller requester-private slice:

- Task creation is model-initiated only after an explicit request from one
  verified OpenMeld Organization member. There is no public create-Task HTTP
  endpoint and no anonymous provider Task ownership.
- Access is requester-only. Space and Organization sharing remain future
  contract extensions and must not be inferred from source visibility.
- One attempt links one hosted native delivery. The Remote Agent may still use
  existing authorized tools, but the Task record does not claim ownership of
  child executions.
- Core stores the product-visible requester, attention, stopped, failed, and
  completed events. The private Remote Agent transcript remains in its runtime
  conversation and is never copied into Task detail.
- Task list reads are cursor-paginated. Task detail currently returns its full
  product event and attempt history; event pagination must land before this
  surface is used for unbounded, high-volume conversations.
- Web refreshes active Task detail every three seconds and the board every five
  seconds while in the foreground. No Task live-invalidation protocol ships in
  Phase 1, so no surface may claim realtime updates.
- Phase 1 reads queued and running progress from the canonical event timeline.
  Its composer does not send an ordinary status question or queue a non-control
  message behind current work. Submitting while queued or running is an explicit
  superseding instruction: Web explains that it stops the current work, requires
  confirmation, and starts a new attempt. A Needs action reply remains a direct
  answer that continues the Task.
- Stop and Retry are available. Exact retained-result or reply Recovery is not
  exposed until Core owns an explicit recoverability projection and idempotent
  Task mutation contract.
- One stable Task Context may span multiple hidden Remote Agent runtime
  generations. Core rolls generations automatically before durable replay
  becomes unsafe; the requester does not create a replacement Task or carry
  context manually. Retry remains available after the exceptional case where
  automatic rollover itself cannot continue, and the next attempt resolves the
  current runtime generation through Core.
- A Message Channel Task keeps its frozen original publication destination.
  Web shows that destination before accepting another instruction.

## Status, Outcome, And Phase

The three user-visible board states are:

```text
Active
Needs action
Finished
```

The canonical product values are:

- `active`: the Task can continue without a human decision, including queued,
  running, or waiting for owned work;
- `needs_action`: the Task requires an exact authorized human response,
  decision, permission, connection, recovery choice, or conflict resolution;
- `finished`: the Task has one authoritative terminal outcome.

`finished` carries one outcome:

```text
completed | failed | stopped
```

The shared Task contract derives `state`, `phase`, and `outcome` from one
validated lifecycle reducer. Web, compact launchers, Inbox deep links, and
other clients consume those fields directly; they do not independently group
raw execution literals into product states. The lower-level `status` field
remains in the Phase 1 wire record for lifecycle mutation and rollout
compatibility, but it is not a second board-state authority.

Presentation may additionally expose one current phase such as `queued`,
`working`, `waiting`, or `stopping`. Phase is supporting context, never another
lifecycle authority or board column. `Working` requires fresh accepted/running
execution evidence. A durable row, old progress timestamp, or Center Agent
availability is not enough. If that owner evidence is stale, terminal,
mismatched, or temporarily unavailable, the Task remains honestly `Active`
without a `Working` phase while recovery or terminal projection catches up.

That honest projection is response contract v2. During rolling deployment,
requests without the shared Task response-version header receive the frozen v1
shape that old strict Gateway and Web parsers already understand. Only the Core
response boundary produces v1; Gateway and Web never reconstruct Task phase or
execution freshness. Current Web requests v2 explicitly, and new fields or
honest no-phase running Tasks must not be emitted to an unversioned caller.

`needs_action` is a Task state. The internal Agent Task Coordination observation
literal `needs_attention` may remain an execution fact, while user-facing copy
uses **Needs action** consistently with Inbox.

A Task may return from `finished: failed` to `active` only through an explicit
Retry operation that creates a new execution attempt, except when the failure
states that the stable Task Context cannot accept another turn. In that case,
the requester starts a new Task with a fresh Task Context. A requester may also send
a follow-up after `finished: completed`; that message starts a new attempt in the
same Task Context without stopping or rewriting the completed attempt. The prior
attempt stays terminal and immutable. Completion never rewrites earlier attempts
or events.

## Task Context And Event Stream

Task Context is isolated per Task in the Remote Agent runtime. Its stable
conversation id is derived from the canonical Task id, so independent Tasks do
not share model history and a later attempt under the same Task continues the
same runtime conversation. It is not the Center Agent Chat transcript, the whole
source Space or provider thread, the Agent Context Envelope, or Center Agent
memory.

The Center Agent Computer may keep one durable private working directory at
`/computer/tasks/<taskId>` for that Task across attempts and continuations.
Those files are execution working material only: they are not Task events,
Task status, Task Context transcript truth, or user-visible attachments. A
handoff to a Local Agent must explicitly carry the required bounded content or
use another supported shared surface; the local workstation never implicitly
mounts the hosted Task directory.

The runtime contract carries that identity explicitly as the typed
`center_agent_task` conversation identity. The route string, typed Task id, and
Task-owned delivery handle must agree before execution or terminal projection;
none of those consumers may independently infer a different Task owner.

Core separately stores an append-only product event stream. Phase 1 event kinds
cover Task creation, requester instructions, Center Agent attention requests,
and succeeded, failed, or stopped outcomes. Every event has a stable event id,
Task id, actor, attempt generation, occurrence time, bounded text, and
idempotency evidence. Core advances the Task revision for each accepted event;
stale mutations fail explicitly.

The product event stream is the Task-detail and Inbox source of truth, but it is
not a second model transcript or compaction owner. The runtime receives the
stable Task conversation identity plus the newly accepted instruction and owns
its private history and compaction. OpenMeld must not maintain an independent
summary of that private history while the Remote Agent maintains another one.

The one runtime-owned compaction checkpoint separates **observed facts**,
**current status**, and **pending plan**. Completed actions retain their time,
target, and scope after current status changes; pending work never negates an
earlier completed action; and a plan never proves execution. Later evidence may
correct a historical fact only explicitly and with its scope preserved.
Conflicting evidence remains visible as a scoped conflict until traceable
conversation or tool evidence resolves it. This rule applies equally to
messages, deploys, invitations, approvals, payments, destructive operations,
and delegated work.

Each compaction rebuilds one bounded action-evidence projection from the active
path of that same canonical private conversation. It records only tool names,
call and result counts, and first and latest timestamps; it does not copy tool
arguments or results. The runtime removes any older copy before appending the
fresh projection, so model-authored summary text cannot erase evidence that
tool work historically occurred. This projection is not a second event log and
a non-error tool result is not independent proof of an external provider effect.

Task surfaces may show messages, lifecycle events, and privacy-bounded semantic
Work summaries. They must not expose chain-of-thought, raw reasoning, tool names,
tool inputs or outputs, commands, paths, credentials, raw errors, internal agent
discussion, or provider transcript payloads.

## Creation And Conversation Routing

Tasks may be created from Center Agent Chat, an OpenMeld Space, Slack, Lark,
Feishu, or another explicitly contracted trigger. Every creation uses one stable
client or provider event identity so retries converge on the same Task.

The originating surface receives one Task creation acknowledgement. A rich
surface may render a Task card; a provider without that capability receives a
plain result and canonical Task reference. The card or link opens the same Task,
not a copied chat session.

A Local Agent request carried by `openmeld center-agent ask` follows the same
rule. Its completed Agent View result preserves every typed Task reference from
the Center Agent's visible reply and adds the canonical Organization Task URL.
The Local Agent must treat that as existing durable work rather than submit a
duplicate Chat request. The Task origin continues to freeze the verified
requester and bounded Local Agent client label; the URL and local session
locator are not Task authority and the session locator is never stored on the
Task.

One source conversation may create several Tasks. Later unqualified messages in
that source conversation remain messages to that source conversation. They do
not guess which Task to mutate. A message enters an existing Task only through an
exact Task detail composer, a reply/action bound to one Task card, or an explicit
Task reference resolved by Core.

Task detail is a first-class conversation surface. A user may answer a
needs-action request, explicitly replace current work with a superseding
instruction, or request Stop or Retry. Phase 1 progress and status are read from
the canonical event timeline rather than requested through an ordinary message.
A future Recovery action follows the contract below. These actions append to the
same canonical Task event stream and do not reopen Center Agent Chat or a
provider transcript as the context owner.

## Access And Visibility

Every Task is Organization-scoped and fail-closed. Organization scope alone does
not make the Task visible to every member.

The initial access scopes are:

- **Requester only**: the verified requester, or the exact connected Message
  Channel principal until an exact identity link exists. Center Agent Chat and
  provider-originated Tasks use this default.
- **Space**: current authorized members of one exact source Space. Losing Space
  access removes Task list, detail, launcher, and Inbox projection access.
- **Organization**: current Organization members, only after an explicit share
  authorized by the owning product policy.

An implementation may encode these as a strict discriminated contract rather
than one ambiguous visibility string. The record must preserve the authority and
source anchor used to decide access.

Provider-native visibility remains provider truth. Seeing a Slack or Lark thread
does not grant OpenMeld Web access, and OpenMeld Task access does not grant
provider thread access. Provider delivery may show a bounded result to the
source conversation while the canonical Task remains requester-only in Web.

Task access does not authorize the work inside the Task. Every App action,
Space mutation, local Agent Wake, Computer use, role-restricted action, and
destructive safeguard still applies its normal current owner policy to the exact
requester. A continuation revalidates membership, Task access, Center Agent
operating state, and action authority before execution.

External Message Channel participants and guests receive no Organization Task
capability. Missing or ambiguous provider evidence fails closed. Successful
ordinary shared work does not add an unsolicited account-link prompt.

## Channel And Web Consistency

Slack, Lark, Feishu, Space, Center Agent Chat, full Task detail, and the compact
Center Agent window are adapters over one canonical Task. They must converge on
the same status, messages, and actions from the same Core snapshot.

The rule is:

```text
one canonical Task event
one execution or business side effect
at most one native publication operation for one destination
zero model reruns merely to mirror another authorized Task view
```

Web rendering the canonical event and a Channel adapter publishing that event to
its frozen native destination do not create two Task truths. Provider delivery
records publication evidence; it does not become the Task event writer. A
callback, model output, mutable channel name, or another provider cannot retarget
the destination.

The canonical Task preserves origin provenance but does not copy complete
Slack, Lark, Feishu, Space, or Chat history. It imports only the exact triggering
content and explicitly requested bounded context. Opening the Task in another
surface never relabels where earlier context came from.

The creating Center Agent must therefore write a self-contained Task goal with
the facts and stable source references needed to do the work. Core carries that
goal as the new Task instruction and strips the parent's already-materialized
memory and Channel Context from the Task admission request. It still preserves
the verified requester, Organization authority, frozen result destination,
approved Organization Skill releases, and bounded Local Agent carrier
provenance. A Task may use the available Organization tools and context to solve
its goal, but a Task cannot create another Task; the parent Chat turn must plan
parallel work explicitly instead of allowing an accidental recursive Task tree.

Task creation and continuation also preserve requester continuity without
copying a parent's materialized context. Core freezes the source destination,
revalidates the represented requester and current access, classifies the result
environment from that destination, and builds a fresh bounded context
projection and `contextScopePlan` for the new turn. A Center Agent DM continuation remains private, an
ordinary Space continuation remains Organization-shared, and a Slack or generic
Message Channel continuation remains externally shared unless the provider
contract proves a narrower audience. The model must never inherit a stale
memory payload or frozen scope plan merely because the new Task originated from
an older turn.

## Concurrency, Conflict, And Idempotency

The Center Agent identity is not the serialization key. Each Task has one
logical conversation lane:

- turns and canonical mutations inside one Task are ordered;
- independent Tasks may execute in parallel;
- delegated child executions inside one Task may execute in parallel when their
  owner contracts permit it; and
- Center Agent Chat remains available while Tasks run.

Every Task mutation supplies:

- one stable client/provider operation id;
- the exact Task and Organization id;
- expected `taskRevision` when changing canonical state; and
- exact actor and authority context.

Core atomically appends the event, advances revisions, and updates the read
projection. Duplicate operation ids return the original accepted result. A
revision conflict returns the current authoritative snapshot and a typed
conflict; it never applies last-write-wins or silently merges incompatible
instructions.

Creating a Task writes the Task row, initial event, queued attempt, Task
projection, and durable admission intent in one transaction. Later attempts
write their accepted Task event, queued attempt, projection, and admission
intent in the same way. Core redrives that exact intent after a process
interruption. Transient admission errors leave it pending; Core settles it only
after the native-delivery owner accepts, durably rejects, or durably owns the
ambiguous result. There is no Task-to-event, event-to-attempt, or
attempt-to-admission crash window that can silently strand accepted work.

A pure replay of an already accepted operation validates the exact stored
payload, event, attempt, and admission identity, then returns its original
accepted result before interpreting later policy changes. Reusing the operation
id with different input is a conflict, never a silent replay. Any new mutation,
delayed attempt creation, or still-pending external admission rechecks current
membership, Task access, Center Agent designation, active managed profile,
primary hosted Binding, Organization Binding authorization, runtime policy, and
model route. This distinction preserves both idempotency and fail-closed
current authority.

An execution result carries the exact `contextRevision` it observed. The complete
model may later queue an ordinary message as the next turn, but Phase 1 does not
expose that mutation. Its queued or running composer submits only an explicitly
confirmed superseding instruction. A Stop, superseding instruction, access
change, or other control event fences stale publication and future side effects.
Core may retain the stale result as diagnostic evidence and create one exact
continuation against the current context; it must not present the stale output
as the latest authoritative answer.

Task serialization does not make Task the transaction owner for GitHub,
Documents, Spaces, Apps, or other external resources. Concurrent external writes
still use their canonical owner operation ids, revisions, claims, and conflict
semantics. An unresolved business conflict moves the Task to **Needs action** or
an explicit failure; Task must not overwrite the external owner's newer truth.

Live invalidation frames are refresh signals only. Reconnect, missed frame, or
multi-tab behavior re-reads the canonical Task snapshot. A frame never advances
status, resolves access, or authors a conversation event.

## Execution Attempts And Delegation

A Task execution attempt is a Task-owned grouping and audit link, not a new
execution authority. Each attempt has one stable attempt id, admitted Task
context revision, start reason, current linkage, and terminal result.

An attempt may link:

- one initial Center Agent native delivery;
- zero or more exact delegated Space Wake or controller-native Agent Task
  Handles;
- declared Agent Task Coordination barriers and continuations; and
- one canonical final Task result event.

An attempt has only the Task-owned admission and settlement facts needed to
explain history. Its presentation may summarize `pending`, `active`, or
`settled`, but those values are reduced from the linked authoritative owners and
must not become a competing execution state machine. A settled attempt records
one bounded outcome reference; later owner evidence is reconciliation data and
cannot reopen it.

RuntimeCoordinator, native delivery, and controller owners continue to decide
their exact execution state. Agent Task Coordination continues to decide exact
barrier and watch continuation state. The Task reducer consumes those facts and
does not turn an attempt row into a second executor.

Owned child work and independently watched work remain different. Task Stop may
propagate only through declared ownership. Watching an independent Task Handle
does not transfer cancellation, retry, or result ownership.

## Stop

**Stop Task** is distinct from exact **Stop execution** and Organization-wide
**Pause Center Agent**.

An authorized Stop Task operation:

1. appends one idempotent Stop intent and fences new Task admission;
2. cancels queued turns, pending owned continuations, and planned fallbacks;
3. attempts every active owned Center Agent, Space Wake, and supported
   controller execution target;
4. leaves independently watched work running;
5. prevents late progress or results from escaping the Stop fence; and
6. records one bounded aggregate outcome.

Stop does not undo external writes that already completed. Every cancellation
target is attempted even if another target fails. A successful RPC, socket write,
or `cancellation_requested` value is not a finished Task. The Task may show
`Stopping...` while authoritative owners settle. It becomes `finished: stopped`
only after the required cancellation and visible outcome contracts confirm it.

If cancellation is only partially confirmed, Core retries the same fenced Stop
through durable recovery for a bounded window. When that window expires, the
Task moves from `Stopping...` to **Needs action**, emits an urgent requester
update with the bounded `center_agent_task.stop_confirmation_timeout`
diagnostic, and tells the requester to check diagnostics and try **Stop** again.
It remains nonterminal, does not expose Retry as new work, and never claims that
the previous work stopped. A later authoritative terminal callback or an
explicit Stop retry can still settle the same fenced attempt. Pause Center Agent
remains the separate creator-only emergency control that targets every current
Center Agent delivery and rejects new or recovered work Organization-wide.

## Recovery And Retry

Recovery preserves completed work; Retry runs work again. Product surfaces use
this priority:

1. **Recover result** when an exact retained result can be published
   idempotently without another Agent execution.
2. **Recover reply** when the exact Agent Controller conversation safely owns an
   already-finished reply and can resume only to publish it.
3. **Retry as new execution** only when no higher-priority recovery exists and
   the exact Task instruction, context, target, and authority can be recovered.

Recovery uses the existing exact owner operation identity and never changes the
Task origin or native destination. A request from Web cannot retarget an
ambiguous Slack or Lark publication into Web or Space.

Retry keeps the same Task identity and appends a new execution attempt with a
new execution/client-message/native-delivery identity. Every transport redrive
for that accepted Retry reuses the same Retry operation identity. A terminal
attempt is never reopened or mutated. Stopped Tasks do not retry automatically.

`outcome_unknown` is explicit. The UI asks the user to inspect the original
source when needed and redrives only the same safely idempotent operation. It
must not create a second logical execution or provider reply merely because the
first outcome is ambiguous.

These Recovery rules are the required future contract, not a Phase 1 control.
Phase 1 never labels a Task recoverable and exposes Retry only for failed or
stopped Tasks. Adding Recovery requires the exact retained-result read model,
authorized mutation, and state-aware Web action in the same rollout.

## Inbox

Task is the source owner. Inbox is the member-private attention projection.

A Task may create or update one deduplicated Inbox item for an exact authorized
recipient when:

- the Task requests that person's input, decision, permission, connection, or
  conflict resolution;
- a final result intended for that person is available;
- a material failure, blocked state, or visible stopped outcome requires that
  person's attention.

Task progress, typing, presence, child bookkeeping, ordinary continuation,
successful background repair, and every lifecycle transition do not create
Inbox items.

The structured Inbox target contains only the canonical Task id. Inbox joins
the Task-owned authorized-reader projection and separately rechecks current
Auth-owned Organization membership for interactive requests and urgent-email
delivery; requester identity or access authority is never copied into source
JSON. Opening the item marks the Inbox projection read and navigates to Task
detail. Reading or Dismissing it does not answer, Stop, Retry, finish, or
otherwise resolve the Task. The Task owner updates Inbox resolution after the
exact Task action resolves.

An unlinked Message Channel principal has no authenticated member Inbox. After
an exact identity link, Core may project only events for Tasks that the linked
member is currently authorized to open. Task content is bounded for Inbox and
must not copy the Task transcript, raw provider payload, or diagnostics.

Task and Inbox realtime behavior require an end-to-end refresh contract:
producer, typed signal, transport, consumer, and snapshot refetch. Polling may
remain a recovery path, but a schema or local cache update alone must not claim
realtime delivery.

## Web Product Surfaces

Center Agent header navigation is:

```text
Messages / Graph / Files / Tasks / Routines / Skills / Apps
```

Channels, Memory, and Center Agent settings remain reachable from the compact
header menu; they are not parallel Task surfaces.

### Task cards

When Center Agent Chat or another OpenMeld conversation creates a Task, the
originating conversation shows one compact Task card. It contains the title,
product status, one current summary, origin context when useful, and **Open
task**. The card reads the canonical Task projection and never owns status.

### Tasks board

**Center Agent -> Tasks** is the durable management home. The default board has
three columns in this order: **Active**, **Needs action**, and **Finished**. It
lists only Tasks the current member may open.

The board is a read-only status projection. Cards cannot be dragged to change
state, complete work, transfer authority, or reorder execution. Failed and
stopped Tasks appear in Finished with explicit outcome badges. Narrow viewports
may present the same three groups as a segmented list without changing meaning.

Organization Home may show a bounded Task preview. Its attention state and
action-required rows come from the canonical status-filtered Task list, not
from scanning only the first page of the general recency list. Home must not
present a paginated subset as an exact total; when complete count coverage is
not available, it names **Needs action** without a numeric claim.

### Conversation-first Task detail

The canonical route is `/o/{orgSlug}/center-agent/tasks/{taskId}`. Task detail
uses the existing conversation visual language, but the header explicitly names
the surface as a Task and shows status, origin, and authorized controls. It must
not look like a new Center Agent chat session.

The conversation contains durable product events and final results. In Needs
action, the composer appends the requester's direct answer. After a completed
result, the same composer accepts a follow-up in the same Task Context. While
queued or running, it labels a new instruction as replacing current work and
requires confirmation before stopping that work and starting a new attempt.
Phase 1 controls are state-aware: Stop is available for active work and Retry is
available for failed or stopped work. Future Recovery controls require the
contract in **Recovery And Retry**. Requester and Center Agent events use the
same aligned message primitives and Markdown renderer as the main conversation.
Lifecycle-only events use compact status rows; they do not appear as message
Cards or receive a false human or Center Agent speaker label.

### Compact Center Agent and Task windows

The app canvas adds compact Center Agent and Task controls beside Inbox without
introducing another conversation store or live-stream owner. Active and
action-required Tasks appear as individual shortcuts in a fixed-width,
horizontally scrollable strip. Overflow remains directly scrollable and is never
collapsed into a `+N` summary. A Needs action shortcut has one static amber dot.
Ordinary active work has no persistent status text, badge, spinner, or Mobius
animation.

Each Task shortcut mounts the same Task conversation timeline and composer over
that canonical Task projection; it does not create a summary card, nested
`Latest update` card, or independent send path. Sending remains in the compact
window, and maximize navigates to the exact Task route. Dismissing a shortcut
changes only the local shortcut strip and never deletes, stops, hides, or mutates
the Task.
The shortcut for the Task already open in full detail is hidden. Once a Task
shortcut appears, it remains through the final result until the requester
dismisses it. Historical finished Tasks are not backfilled into the strip; they
remain durable in the Tasks board and applicable Inbox history.

The compact Center Agent window never creates a new session. Outside full Chat,
it is a compact presentation of the same Center Agent Direct Message: the same
`CenterAgentPage`, `SpaceLanding`, conversation timeline, live Agent stream,
Stop control, and Space composer read and write the canonical conversation.
Sending remains in the compact window. Maximizing unmounts that compact owner
before full Chat mounts. When full Chat is already open, the Center Agent
shortcut itself is hidden, so two `SpaceLanding` instances never own the same
live stream or writer concurrently. An independent launcher composer,
conversation store, or send path is forbidden. Inbox, Center Agent, and
individual Task previews are mutually exclusive compact panels.

The compact window is a shortcut, not the only Task home. Tasks remain a
persistent secondary-navigation destination with a board and conversation-first
detail.

## Relationship To Spaces

A Space remains the collaboration room and owner of its messages, membership,
threads, and Space-visible outcomes. A Task may originate in or link to a Space,
but it does not copy the Space timeline or turn a Space Thread into Task truth.

A Space-originated Task uses current Space access as its initial Task access
anchor. Losing that access removes the Task from the member's authorized Web and
Inbox projections. Task messages that are explicitly published to Space use the
normal Space send and idempotency contracts and reference the canonical Task
event. Task detail remains the work conversation; Space remains the source of
the published Space message.

Space Board and Center Agent Tasks remain different projections. Space Board
answers what is happening in one room. Center Agent Tasks answers what work the
resident Center Agent is coordinating for the current member across authorized
origins.

## Relationship To Routines

A Routine is an Organization-owned scheduled instruction. A Run is one durable
occurrence. Neither is renamed to Task, and a Run does not automatically create
a Task.

A Run may link one Task only when the work deliberately needs durable human
re-entry, extended coordination, or later steering. The Routine and Run retain
schedule, claim, destination, engine, and terminal truth. The Task retains its
conversation and coordination truth. The link is idempotent and cannot create a
second Run, delivery, or final destination result.

Routine history remains the normal home for unattended occurrence results.
Automatic Task creation for every Run would flood Tasks and Inbox and is outside
the initial product.

## Negative Scope And Red Lines

Center Agent Tasks are not a general project-management or workflow engine. The
initial product does not add:

- custom statuses, workflows, swimlanes, or drag-to-transition authority;
- backlogs, sprints, estimates, dependencies, arbitrary assignees, or due-date
  planning;
- a second Center Agent, per-Task Center Agent identity, or user-managed chat
  sessions;
- cross-Organization Tasks or guest access;
- automatic conversion of every Chat message, Wake, Agent execution, or Routine
  Run into a Task;
- transcript mirroring across providers or a second Flue/context summary;
- Task-owned App, Space, RuntimeCoordinator, controller, or Routine authority;
- raw reasoning, internal agent discussion, tool journals, credentials, paths,
  or diagnostic payloads in Task UI or Inbox;
- client-authored lifecycle state, offline mutation replay, or local-only Task
  truth; or
- automatic Retry, destructive authority, or action permission inferred from
  Task access or free text.

Task cards, board columns, Inbox items, native Channel messages, and live frames
are projections or deliveries. None may become another Task writer.

## Rollout And Contract Impact

This feature changes Core, Gateway, Remote Agent, Web, Message Channel, Inbox,
and shared schema boundaries. It does not change workstation execution authority
or authorize a local-component release by itself.

Roll out in this order:

1. Land owner docs and shared vocabulary.
2. Add strict shared Task records, events, projections, operations, source
   targets, and invalidation schemas. New receivers accept additive contracts
   before any producer emits them.
3. Add Core storage, one-writer services, revision/idempotency fences, access
   checks, and read projections behind disabled admission.
4. Add Gateway and API-client forwarding without local reconstruction.
5. Add Web authorized list/detail readers and unknown-kind fail-closed behavior.
6. Add Remote Agent and Message Channel Task admission/continuation support with
   exact mixed-version failure semantics.
7. Add Task creation producers, native Channel adapters, Task event publication,
   and end-to-end live invalidation.
8. Add Inbox Task target consumption before Core emits Task Inbox source events.
9. Enable Chat cards, Tasks board/detail, then the compact Center Agent window.
10. Complete real-user Web, Slack, and Lark smoke with cross-surface state,
    permissions, duplicate delivery, Stop, Retry, Recovery, and reconnect
    evidence before broad enablement.

Existing Center Agent Chat/DM history is not migrated into Tasks. Existing
`AgentTaskHandle`, Agent Task Coordination, Wake, Routine, and Inbox records keep
their meaning. A rollback stops new Task admission and native Task publication
while keeping already-created Tasks readable; it does not delete or rewrite
Task history or redirect unfinished work into Chat.

The Contract Impact Audit must explicitly decide mixed-version interoperability
for:

- old/new Core and Gateway strict schemas;
- old/new Remote Agent turn envelopes and conversation identities;
- Slack, Lark, and Feishu provider publication/retry behavior;
- Web routes, Inbox targets, live invalidation, and cached projections;
- Space Wake, Agent Task Coordination, and Routine links;
- CLI and Desktop read compatibility; and
- OpenMeld Service, daemon, local skills, and controller contracts, even when
  the final decision is that no local component changed.

## Acceptance Invariants

- One Organization still has exactly one resident Center Agent identity.
- One Center Agent may coordinate multiple Tasks concurrently.
- Each Task has isolated context and one ordered mutation lane.
- Chat remains available while Tasks run.
- Core is the only canonical Task/event writer.
- Task state never replaces execution-owner truth.
- One accepted operation creates one Task event, execution, and native
  publication identity as applicable.
- Every surface re-reads the same authorized Task snapshot.
- Stale, duplicate, and conflicting writes converge or fail explicitly.
- Task Stop never claims completion before authoritative cancellation evidence.
- Retry creates a new execution attempt in the same Task. When a future exact
  Recovery projection exists, Recovery precedes Retry.
- Inbox read or Dismiss never resolves source Task work.
- Tasks board is read-only and Task detail is conversation-first.
- The compact Center Agent window is another presentation of the one canonical
  Chat owner; it never creates a new session, store, send path, or concurrent
  second writer.
- Routine, Run, Space Thread, Agent Task Handle, Inbox item, and Agent Activity
  retain their existing distinct meanings.
