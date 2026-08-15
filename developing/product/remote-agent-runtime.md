# Remote Agent Runtime

## Agent Context

- Purpose: Define how remote (cloud-hosted) agent execution enters OpenMeld —
  the two runtime families, the Remote Agent (OpenMeld-operated Center Agent
  runtime) MVP on the Flue harness, the native delivery contract, the
  capability tiers, Space reply streaming, Center Agent memory integration,
  Center Agent Task and Routine execution, and the expansion path — so agents
  can evolve the Remote Agent without re-deriving strategy or breaking the
  execution architecture.
- Read this when: You are implementing or reviewing the Remote Agent (native
  delivery in Core, the Flue agent worker, Web runtime-selection surfaces),
  extending Bindings/readiness for non-local runtimes, or asked anything
  about "remote agents", "cloud agents", or "hosted Center Agent".
- Update this when: The remote-runtime contract or shipped Remote Agent behavior
  changes, or Felix settles or reverses a decision in this scope. Record
  reversals in `developing/decisions.md` in the same PR.
- Do not use this for: Center Agent identity/designation/permission semantics
  (`developing/product/organizations-and-center-agent.md` owns them),
  Center Agent Task product semantics
  (`developing/product/center-agent-tasks.md` owns them),
  Routine product semantics or scheduling
  (`developing/product/center-agent-routines.md` owns them),
  Direct Message Space semantics (`developing/product/space-collaboration.md`
  owns them), presentation rules
  (`developing/product/presentation-progressive-disclosure.md`), or local
  Binding/wake mechanics (architecture docs own them).
- Source of truth: This file owns the remote-runtime layering, the shipped
  Remote Agent contract, and its native delivery, streaming, and memory
  boundaries. Implementation-surface facts must still be rechecked against the
  pinned Flue package before changing worker interfaces; method names are not
  strategic contract.

## North Star

A remote agent is **not a new species of identity**. It is the same Agent
Profile (identity, DM history, memberships, designation) bound to a
different kind of runtime. Users see where a profile runs and may move it.

But it **is a different kind of runtime**. The Remote Agent is a
OpenMeld-built, OpenMeld-operated native agent — the way commercial agent
products build agents: official system prompt, model loop, streaming
replies — not a real CLI on a machine we pretend to manage.

End state (the total goal): the Center Agent becomes the **hub of any
organization** — it strings the right people and the right agents together for
day-to-day work. It now executes organization-owned Routines and can continue
to gain triggerable hooks, external connectors, richer organization memory, and
deep per-organization customization: a general-purpose Remote Agent that
OpenMeld builds, maintains, and iterates — capable like a Codex or Claude Code,
but living natively inside the organization.

Now state: **a user opens the organization's managed Center Agent and can
immediately talk to it in a Space DM; Slack app mentions and human App Home
direct messages are shipped external signals. Slack is the first supported
external signal, while Lark Channel setup is available to every production
Organization but still fails closed until its connection-specific transport
checks pass, Feishu remains behind its independent provider gate and feature
flag, and organization-owned Routines are the unattended native-delivery
entry.** The original MVP is judged on
exactly one quality:
**high availability of the conversation loop** — an authorized member asks
in a supported conversation and gets a reply, laptop lid closed or not.
Capabilities beyond the loop ride along only where they stay inside the
Flue/Core contract below (see Capability Tiers); they are labeled
Experimental and are not acceptance gates.

Build principle: **prefer official over self-built where the official surface
passes OpenMeld's safety bar.** Flue owns the harness loop and Durable Object
session mechanics; OpenMeld owns the integration surface (designation,
authorization, Space delivery and streaming, memory policy, runtime policy,
tools, usage diagnostics, and failure copy) — the parts no third-party harness
can provide.

## Center Agent operating control

The hosted runtime is normally always available, but the Organization creator
has one explicit emergency control: **Pause Center Agent**. Pause is not a
disconnect and does not remove the designation, profile, Binding, conversation
state, Channels, Apps, memory, or Routines.

Core changes the designation operating state before requesting cancellation of
all active native deliveries for that Organization and Center Agent profile.
The cancellation scan covers every conversation kind and includes submitted,
accepted, and retry-observed deliveries with a worker submission identity.
New and recovered deliveries recheck the state before worker submission and
fail with `remote_agent.center_agent_paused`. Center Agent-owned tool calls
also fail while paused. A partial cancellation failure remains visible and
leaves the operating state paused; Resume re-enables the same identity without
recreating runtime or integration state.

## Two Runtime Families (settled 2026-07-06)

| Family               | Members                                                                        | Contract                                                                                                                                                                          |
| -------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workstation runtimes | Local machine (shipped), R0 BYO server (future), R2 hosted containers (frozen) | Full Binding + Service contract and the wake lifecycle: claim → execute → finalize via RuntimeCoordinator, park/retry, readiness evidence channels.                               |
| Native runtime       | The OpenMeld-operated Remote Agent (only member)                               | Native delivery contract (below). No wake state machine, no daemon, no readiness evidence chain; final user replies are written under the Remote Agent native delivery authority. |

Rationale: the wake lifecycle's complexity exists to manage execution on
machines OpenMeld does not control — claim resolves contention, park/retry
absorbs offline gaps, evidence channels infer health indirectly. The Remote
Agent has none of those premises: OpenMeld operates it, failures are
synchronous and visible on the request path. Forcing it through the wake
state machine would be strapping a fake-machine mask onto a cloud service.
The wake-lifecycle contract remains fully binding for every workstation
runtime, including R2 if it ever unfreezes.

## The Layered Model (updated 2026-07-06)

| Layer                            | What                                                                                                                                                                                                                           | Status                                                                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| R1 — Remote Agent                | OpenMeld-operated native agent on the Flue harness; conversation-loop MVP with tiered capabilities; labeled "Remote Agent · Experimental"                                                                                      | **Shipped MVP.**                                                                                                         |
| R0 — BYO server                  | User installs OpenMeld Service + a real agent CLI on their own always-on compute (a Linux box, or the user's own cloud container such as a moltworker-style Cloudflare Sandbox); a workstation runtime like any other Computer | After open-source launch. Zero shared engineering with R1.                                                               |
| R2 — General hosted workstations | Any Agent Profile rebinds to an OpenMeld-managed container running a real CLI; a workstation runtime                                                                                                                            | **Frozen.** Do not design, estimate, or partially build. Only obligation: keep the `agentControllerRef` kind space open. |

Related positioning (settled 2026-07-06, after evaluating Pi / Hermes /
OpenClaw): process-shaped agent runtimes (terminal CLIs, self-hosted
always-on assistants) never enter R1 — they physically cannot run in a
Workers isolate and belong to the workstation families (local adapters,
R0). Library-shaped agent frameworks (Flue, AI SDK) are the R1 toolkit.
OpenMeld does not build or host its own process-shaped runtime; the Remote
Agent's future heavy work is done by (a) sandboxed per-call execution tools
("container as disposable glove", distinct from frozen R2's "container as
the agent's home") and (b) waking the org's local agents through the
existing wake system.

## Implementation Base: Flue Harness (updated 2026-07-10)

The agent worker is built on **Flue**, pinned by exact package version in
`services/remote-agent`. OpenMeld uses Flue for the agent harness and Durable
Object session boundary, while keeping OpenMeld product facts out of Flue's
private tables. Core talks to the worker through direct service-binding RPC;
the worker addresses the Center Agent Durable Object by OpenMeld conversation
id: a Space id for `space` conversations, or
`slack:{teamId}:{channelId}:{threadTs}` for Slack conversations.
New provider-neutral Message Channel turns use
`{provider}:{connectionId}:{chatId}:{rootMessageId}`. Existing Slack
conversation ids remain readable and continue through their current producer
until the separately gated Slack adapter migration.

Model-visible tool results must cross an OpenMeld-owned bounded persistence
boundary before Flue stores them in the conversation session. A direct tool
result that exceeds that boundary returns one compact structured failure that
tells the model to narrow or segment the request; OpenMeld must not pass the
oversized provider object through and hope Flue compaction repairs it later.
File-content tools expose one bounded segment plus an explicit continuation
offset. The Center Agent searches first, reads only the relevant segments, and
follows the returned continuation offset when more content is actually needed.
Segmented results retain only an explicit allowlist of bounded file metadata,
the decoded text segment, and continuation fields. Provider-returned encoded
copies and unknown fields never cross this boundary. A file without decoded
text fails with a clear non-text-content error instead of returning its raw
payload.
Segment controls are OpenMeld orchestration fields and must not be forwarded to
the connected provider API.

### Usage boundaries (hard)

1. **Headless worker, conversation-scoped result surface.** The Remote Agent
   worker does not expose browser chat protocols or public channel webhooks.
   Core drives turns programmatically. Each conversation has exactly one user
   result surface, selected by `conversationKind`: `space` conversations
   publish through the Space standard send path. Slack channel mentions publish
   to the originating Slack thread with `chat.postMessage` and `thread_ts`.
   A top-level Slack App Home direct message publishes back to the main direct
   message conversation; when the requester continues inside an existing Slack
   direct-message thread, the reply stays in that thread. Core freezes this
   reply placement before execution and reuses it for success, visible failure,
   and recovery. Legacy Slack deliveries without an explicit placement remain
   thread replies. New Lark/Feishu turns use
   `conversationKind = "message_channel"` and publish through the provider
   adapter selected from the Core-frozen typed locator. A single conversation
   must never write more than one of these surfaces.
   An explicit, model-invoked Slack channel publication is a separate audited
   side effect, not a second result surface. Interactive publication is
   available only when the user is a verified current human member and
   explicitly asks the Center Agent to publish a top-level message in a named
   channel. A Routine may use the same action only when its stored structured
   grant explicitly contains `slack.publish_channel_report`; Core rechecks that
   canonical Routine grant independently before provider I/O. The model selects
   either the current turn, the authorized Routine Run, or an exact approved
   Organization document as the source.
   Remote Agent and Core replace that selection with system-owned execution,
   Run, or document-revision identity before claiming the provider write. An
   exact retry returns the first result without another Slack call; ambiguity
   fails closed. The contract is generic and must not encode a product-level
   rule for a Routine, date, diary, or channel. The turn's normal result still
   returns only to the originating surface.
2. **Slack is the first supported external signal.** Decided 2026-07-08 and
   landed 2026-07-09 and made queue-backed on 2026-07-15, Slack enters through
   Gateway edge signature validation. Gateway acknowledges only after the
   shared queue accepts the event; a missing binding or failed enqueue returns
   a retryable non-2xx response to Slack. Core's queue consumer durably claims
   the event and maps the Slack workspace to an OpenMeld organization. A Slack
   user whose current identity maps to an active OpenMeld member receives the
   ordinary linked-member surface. Another active participant whose internal
   relationship to the Organization is established by the connected Slack
   workspace reaches the Center Agent as a connected Message Channel member.
   The turn receives current channel/thread context, general model knowledge,
   and the explicit connected-member tool contract. That contract contains
   capabilities canonically available to every ordinary member that need no
   personal ownership or OpenMeld role, including Organization-shared Apps.
   GitHub accepts only `githubActor = organization`; ordinary Apps resolve only
   shared connections. Core reauthorizes every call against the exact
   Core-authored native delivery.

   Personal memory, member Apps, Local Agents or Computers, role-restricted
   actions, destructive confirmation, and member-owned mutations remain
   unavailable. Public research and Organization-shared reads run before any
   setup suggestion. The registered `write` effect is the ordinary-member
   policy for non-GitHub shared Apps; unknown or destructive effects fail
   closed. GitHub ordinary writes may run only with
   `githubActor = organization`; file deletion and pull-request merge remain
   identity-gated. Every write accepts provider-delivery attribution. When
   linked identity is required, the Center Agent completes every
   independent safe part, names the concrete blocked action, and attaches one
   one-time setup action that joins or connects the requester, checks
   permissions, and continues the original request. It does not expose a
   reusable Organization invite or claim that it sent an administrator
   request. Connected-workspace participation is ordinary-member capability,
   not Better Auth membership or represented-member authority by itself.
   Accepted `app_mention` and human `message.im` events
   reuse native delivery; the ingress and delivery ledgers,
   idempotency keys, callback retry, and watchdog all apply, and the ledger
   records `conversationKind` plus the Slack conversation locator. A direct
   message is requester-private and never requires an app mention. Bot-authored
   messages and Slack message subtypes are rejected before admission so the
   Center Agent cannot create a reply loop or treat edits as new requests.
   Slack admits a connected Message Channel member only after the Slack user lookup reports
   the connected workspace's exact `team_id` and does not mark the user as
   `is_stranger`, `is_restricted`, or `is_ultra_restricted`. A Slack Connect
   stranger, Slack guest, another workspace's user, or a sender whose workspace
   evidence is missing remains an external participant: the person may converse
   in the current thread but receives no Organization tools, private
   Organization context, or self-enrollment action.
   If a connected Slack, Lark, or Feishu Message Channel member requests an
   identity-owned capability, the
   dedicated `openmeld_require_identity_for_action` tool records the explicit
   request's identity-owned, personal, role-restricted, destructive, or
   capability-declared identity boundary after Core authorizes the exact
   connected-member native delivery. Only that same submission may then select
   `message_channel_identity_link` with `purpose = continue_request`, and only
   after Core advertises support for the handoff.
   It never constructs or carries the secret. Core confirms the task result,
   then issues the one-time token from the exact frozen connected-member
   delivery and publishes it only in a provider-private action visible to that
   exact Slack, Lark, or Feishu user. A required-guidance retry reuses the
   confirmed result instead of publishing the result again.
   Once identity is linked, a personal Computer readiness query may attach one
   exact Core-projected setup, reconnect, or Service-update action. Core sends
   that action privately to the initiating provider identity after confirming
   the result; the channel does not expose the personal setup link, and turns
   that do not need a Computer do not receive setup guidance.
   It binds the token to the Organization, provider connection, provider user,
   source native delivery, and handoff purpose. Safe connected-member tools do
   not record the boundary. After one Web confirmation, Core first claims the
   private token for the signed-in OpenMeld user, Auth creates ordinary
   membership only when needed, Core links the exact provider identity, and
   Core creates one
   deterministic verified-member turn for the original request in the same
   provider conversation. Concurrent clicks and response-loss retries converge
   on that same turn; a known failed attempt may advance one deterministic retry
   generation without becoming execution authority.
   Workspace connection starts from Web's `Add to Slack` action. Slack owns
   workspace selection and app approval, Gateway owns the OAuth edge routes,
   and Core owns the one-time state, organization guard, encrypted workspace
   credential, and Binding write. The manual workspace-ID connection remains
   an advanced compatibility path; it is not the default installation flow.
   In product language this integration is a **Message channel**, not an App:
   it owns conversation ingress and the Slack-thread reply surface, and it does
   not authorize OpenConnector access to Slack data or general Slack actions.
   Its one shipped outbound action may publish an explicitly requested,
   top-level channel message through Core using the Organization-bound Bot
   credential. Core resolves the channel internally, may join an accessible
   public channel, requires the App to be invited to a private channel, and
   records the internal channel ID only in the audit journal. The separately
   authorized read-only Slack tools may list one bounded live page of active
   visible channels, read active human members of a named channel, or read one
   newest-first page of a named channel's message history. Channel listing
   exposes the App membership state without joining. Member and history reads
   require the App to be an existing channel member and never join or publish.
   All three reads are available to interactive and Routine turns under the
   same Core authorization and audit boundary, and return transient untrusted
   provider data without persistence. The workspace-directory tool reads one
   bounded live page of active human Slack members, treats Slack profile fields
   as untrusted data,
   and lets Core classify current OpenMeld membership only by exact normalized
   email. It does not persist a Slack roster, invite people, or send messages.
   On an explicitly requested Slack notification, the model may use an exact
   tool-returned Slack user ID for a real mention; it never guesses from a
   display name. Explicit channel publication accepts those IDs through a
   structured mention field, verifies that the same turn's directory read
   returned them, and constructs the Slack mention tokens outside model-authored
   message text. Installation scopes for bookmarks, canvases, files, links,
   pins, reactions, user groups, slash commands, and private-channel mutation
   remain dormant until each receives a separate product contract and
   model-visible tool policy.
   Before an accepted mention reaches the model, Core reads one bounded page of
   that mention's current Slack thread. The first turn includes the root message
   and earlier replies; later turns include only replies after the last
   successfully admitted cursor. For a root app mention, Core also reads one
   bounded page of recent top-level messages from the same Slack channel before
   the current mention, then merges that transient channel context without
   advancing the thread cursor. This includes other human and Bot messages,
   including recent Center Agent-authored proposals, but all provider history is
   labeled as untrusted reference context and the current mention remains the
   separately verified request. Slack history failure is an explicit context
   status and does not make the current request disappear. This automatic read
   is current-thread and current-channel context only. Interactive and Routine
   turns may use the channel-read tool for another named channel that the App
   has already joined. Locating an arbitrary message or thread across public
   Slack requires the provider-search tool, which is available only when the
   current Slack event supplies an event-bound search authorization. It makes
   one public-message search on behalf of the verified requester and privately
   presents bounded results with Slack permalinks in the originating thread.
   The durable agent turn receives only presentation status and exposes explicit
   `authorization_expired`, `forbidden`, `rate_limited`, or `unavailable`
   outcomes. The model cannot claim it read or summarized the private results.
   Search results are never copied into Remote Agent storage, Center Agent
   memory, Organization documents, or audit logs.
   Lark and Feishu are the next Message Channel producers. They reuse the same
   connected-member-or-external-participant resolution, ordinary-member
   Organization and shared-App capability, Center Agent designation, daily
   admission quota, worker, callback, watchdog, and Native Delivery path. They
   apply the same conversation-admission versus linked-OpenMeld-identity split;
   they do not receive another worker, provider-specific execution ledger,
   capability policy, quota, or Center Agent. A Lark/Feishu internal member may
   use Organization-shared Apps without linking OpenMeld; personal Apps, Local
   Agents or Computers, role authority, destructive confirmation, and other
   identity-owned actions use the same provider-bound setup and exact-request
   continuation contract. Card presentation may differ from Slack, but the
   product boundary cannot. Their Personal Agent credential is Channel-only and
   never becomes a model-visible business-action credential.
   Core freezes a Lark/Feishu locator containing provider, connection, chat,
   root message, and optional native thread identity before admission. Only the
   provider adapter may interpret that locator, and every normal result returns
   to it. CardKit progress is presentation owned by the same Native Delivery
   row: Core may split one product-bounded 100,000-character answer across at
   most six 30,000-character cards, preserving Unicode and Markdown code
   fences. It persists each rollover boundary and exact rendered-segment hash
   before provider I/O, uses deterministic provider UUIDs for mutations and
   visible sends, and never posts a standalone duplicate after a working card
   may be visible. The worker places an explicit shortening notice inside the
   product-wide text ceiling if a model result is larger; CardKit itself never
   silently truncates the accepted callback.
   Generated callback attachments are not delivered into Lark/Feishu in the
   first release. Core finalizes the same card or reply with an explicit
   generated-image delivery notice, removes the unsupported attachment
   references from provider publication, and terminates the durable callback
   successfully instead of retrying forever or silently discarding the fact.
   Core converts a Lark-platform `429` `Retry-After` header into a bounded
   provider retry delay for both stream updates and terminal publication.
   Remote Agent waits for at least that delay, while durable callback retry
   keeps any longer backoff. Existing stream coalescing remains the normal
   request-rate control; `Retry-After` is explicit provider backpressure, not a
   second scheduler or publication path.
   Lark-platform event ingestion is bounded to four Queue attempts. Exhaustion
   records one durable failed ingress and stops; it never resets the attempt
   count by creating a fresh copy of the same event. Replayed provider images
   remain available while worker admission is ambiguous, but a replay that
   resolves to an already accepted delivery removes the newly prepared
   duplicate object.
   Lark/Feishu use Webhook only after real application-config Patch and receipt
   plus separate Event Subscription URL and Message Card Request URL
   verification pass. A persistent WebSocket connector remains an explicit
   connection-scoped transport option, never an automatic retry or a second
   simultaneous producer. Provider device-flow expiry ends only credential
   acquisition: once Core saves the App credentials, it owns a bounded
   configuration window. A connection that reaches `repair_required` or
   `revoked` offers an explicit Repair action that reconfigures and re-verifies
   the same saved App without starting another provider device flow. Feishu
   remains disabled until a qualified
   mainland tenant/network gate passes. Slack ingress, Queue, orchestration,
   credential storage, and publication remain unchanged through the first
   Lark/Feishu releases; Slack moves behind the generic seam only in its
   separate parity-gated release.

3. **Delivery = durable programmatic submission.** Core delivers a trigger
   through OpenMeld's worker RPC over a service binding. The worker admits the
   turn through Flue's Durable Object session using the triggering
   message/dispatch id as the idempotency key. OpenMeld freezes its own RPC and
   response union, not a Flue private method name. Admission returns either a
   durable submission ACK or a structured deterministic rejection with no fake
   `submissionId`.
   The worker reports the finished reply back to Core through an internal
   callback, and Core publishes it to the result surface selected by the
   ledger's `conversationKind`.
   A Space native-delivery exception that occurs before the ledger row exists
   must still produce one standard persisted `terminal_failure` notice from the
   frozen dispatch envelope. Core may acknowledge that dispatch only after the
   visible failure is durable; if publication fails, the queue remains
   unacknowledged so an internal storage fault cannot become a disappearing
   user outcome.
   A user-accepted Space Wake Stop wins over native delivery. Core blocks a
   stopped Wake before worker submission, rechecks after admission and requests
   worker cancellation if Stop raced the ACK, and discards any late callback as
   a stopped terminal outcome. The Space Durable Object also rejects a matching
   final reply after its outbox is cancelled, which closes the last
   stop-versus-publication race without making the Remote Agent a workstation
   runtime or giving it a RuntimeCoordinator execution.
4. **Pinned version.** Flue is consumed at the exact version frozen by spike
   and implementation review. Upgrade requires a separate approval and a
   current-doc/version spike. The product label
   "Remote Agent · Experimental" mirrors this status — the risk is hedged,
   not hidden.

### Turn envelope (2026-07-09)

Core assembles the Remote Agent turn envelope when it submits a turn to the
worker. The envelope is part of OpenMeld's stable RPC contract, not Flue private
state. It carries:

- `sender`: the member, external connected-channel participant, or Agent Profile
  that initiated an interactive turn, or the distinct Routine sender plus
  reauthorized `delegatedBy` member for an unattended Run. An external
  participant uses the existing person shape with `verified = false`, no
  `ownerUserId`, and a provider-scoped id; it is never member authority.
- `space`: the conversation locator, whether it is the Center Agent DM, and an
  optional current Space guide projection for Space-context turns.
- `organization`: the organization identity and lightweight presentation facts,
  plus the optional Core-built canonical `webUrl` for the selected Organization.
- `trigger`: one of `web_dm`, `space_wake`, `slack`, `routine`,
  `message_channel`, `member_research`, `task_continuation`, or
  `task_watch_continuation`.
- optional `channelContext`: a provider-neutral, bounded snapshot or delta of
  the current external conversation, with an explicit retrieval status. It
  never includes the current trigger message.
- optional `centerAgentInteractionSource`: bounded attribution for a request
  carried from an authenticated member through a Local Agent client. Its client
  and optional session locator are trace metadata only. They never change the
  envelope sender, Organization access, conversation identity, memory scope, or
  disclosure environment.
- optional `contextScopePlan`: Core's versioned, frozen per-turn projection of
  requester identity, result audience, and the allowed handling for member
  memory, Organization memory, Organization Documents, Organization Skills,
  protected information, and authentication secrets. Current Core always emits
  `v = 1`; the field stays optional only so a new worker can safely admit an old
  Core request during rollout.

The worker renders these existing facts through the versioned
`agent_context.v1` `Task / Environment / Rules / Action` vocabulary. This
rendering does not add another fact source. The exact current request remains
the worker message, and the turn envelope remains the trusted sender and
environment contract. Only `web_dm` and `space_wake` label Core's
`triggerMessageId` as an OpenMeld source signal. Routine run ids, Slack message
locators, member-research task ids, and delegated-task ids retain their own
trigger-specific names and are never presented as Space signal ids.

For a Local Agent-carried request, the worker tells the Center Agent to return a
self-contained result that the carrier can use, but it never injects the local
session id into the model prompt. Core still authenticates the represented
member and freezes the ordinary Direct Message environment before dispatch.
The source metadata therefore improves handoff and observability without
becoming a second authorization or context channel.

Every interactive carrier frames the current user-authored request separately
from bounded conversation continuity and the authoritative turn-time block.
At the shared provider boundary, the Remote Agent classifies only that current
request when it names the canonical Task or Space surfaces. An explicit request
for a new or dedicated Task or Space pins the first model step to the matching
create tool before large tool catalogs are compacted into Code Mode. That
already-resolved create step preserves the frozen model route, including its
reasoning policy; the provider may require that policy even when the first tool
is deterministic. The created Task or Space keeps the Organization's normal
reasoning policy for its actual work. The rule
does not infer a new work surface from task complexity, does not inspect earlier
conversation history as current intent, and does not run again after the create
tool returns. A self-contained Space request may also include one immediately
requested checklist, note, update, or other message. That bounded path
materializes only Space creation and plain Space-message publication: it creates
the Space first, keeps one-time content out of the durable guide, may publish
the one requested message to the returned Space, and then closes the tool
surface. Participant lookup, membership changes, and any other follow-up keep
the ordinary full execution path. Classification failure preserves the
ordinary Center Agent turn and emits structured diagnostics; the main Center
Agent instruction remains a second, independent behavioral guardrail.

The Local Agent bridge has a separate progressive read contract. It may request
a bounded Context Manifest containing recent user-visible text Signals from the
same authenticated member's Center Agent Direct Message. This read does not
resume or fork the Flue conversation and does not create a turn. After the
harness adds exact manifest entries to its working context, it may write one
verified Context Load Receipt. That receipt proves the harness's reported load,
not model attention or reliance. Core owns both projections and reauthorizes
every read and receipt; Flue remains the only runtime conversation and
compaction owner. Hidden reasoning, system prompts, provider state, memory
records, attachments, and other member conversations never enter this API.

Model-visible Space addressing has exactly two relations. The Center Agent and
Remote Agent use Wake when another Agent Profile must act and produce an
explicit outcome, and Reference when a Human or Agent Profile is context only.
Their tool schemas, role prompts, Routine catalog, and examples must not teach,
accept, or generate the retired CC relation. Historical CC normalization is a
shared transport/read concern completed before model context is assembled; the
model never needs to interpret it.

Space-authoring tools require an explicit `referenceProfileIds` array on every
model-authored message: exact context-only Profile IDs when present, or an empty
array only after deciding there are none. This keeps the model's Reference
decision visible and separate from executable `agentProfileIds` and the
optional fallback. The visible message text is never the addressing authority:
writing
`@Name(reference)` in text without the structured target does not create a
Reference. Core preserves those IDs only in the Space Message Envelope, and a
Reference target never becomes delegated work, a fallback, a completion
subscription, or a continuation trigger.

The Remote Agent verifies Core's shared Space-authoring contract before either
authoring tool can publish. An incompatible Core therefore fails before the
Space write, while the accepted response is still checked to prove that every
requested Reference target was preserved. A failed preservation check blocks
every later Space-authoring call in that submission, preventing a model retry
from duplicating the write. Deploy Core before Remote Agent for this contract
and reverse that order during rollback.

`web_dm` is used for the Center Agent DM, `space_wake` for ordinary Space Wake
delivery to the hosted Center Agent, `slack` for the legacy Slack channel
surface, and `message_channel` for a provider-neutral Slack, Lark, or Feishu
conversation after that provider moves to the generic contract. `routine` is
used for an organization-owned Run. A Routine envelope uses
`sender.kind = "routine"`, carries `routineId`, `runId`, `scheduledFor`, the
Routine name, creator attribution, and the durable delegated member snapshot,
and must not impersonate a live member. Core reauthorizes that member at Run
admission before the worker receives the envelope. The delegated member
snapshot is required. The worker rejects a Routine envelope that omits it
instead of silently substituting shared-only tool access.
The Routine worker request uses the Center Agent as `author`, keeps
`onBehalfOf = null`, and carries historical delegation only through
`sender.delegatedBy`.
When a Workflow Routine resumes once after its own all-terminal Agent Wake,
Core preserves that Routine sender and frozen destination and adds exact
`trigger.continuation` evidence. It never converts the resumed turn into a
member speaker or general task-watch turn.
The worker must consume this envelope from Core's submit payload instead of
re-deriving sender, Space, organization, Routine, or trigger semantics from its
own session tables.
`organization.webUrl` is presentation context, not authorization. The worker
uses it only through the shared Navigation Action builder and never treats it as
a reason to skip the destination's ordinary access checks.

`member_research` is a distinct human-requested, unattended one-shot task. It
carries the Core task id and the subject's user id and display name, targets the
requester’s Center Agent DM, and uses the verified requesting member as
`author` and `onBehalfOf`. It is not a fabricated DM message and is not a
Routine or Run. The worker validates all three task identity fields against the
submit envelope before admission. Its Agent Context Envelope action requires
the structured task callback and explicitly forbids publishing a Space message.

`task_continuation` and `task_watch_continuation` are Core-created new turns,
not synthetic member messages or reopened executions. Both carry one exact
watched Task Handle and authoritative terminal outcome. Delegated continuation
also carries its delegation identity and bounded child snapshot. General watch
instead carries its durable watch identity and never implies ownership of the
watched task. The worker validates this trigger identity against the submit
request before admission.

Task continuation routing is owned by the observer Native Delivery, not by the
subscription or model. The subscription freezes only continuation semantics;
Core reads the observer delivery's `conversationKind` and frozen Space, Slack,
or Message Channel locator, creates a new delivery on that same result surface,
and generates a new provider publication idempotency key when the provider
contract requires one. The model receives a destination-neutral continuation
instruction, while Core remains responsible for returning the final result to
the original conversation. Ordinary Space and Center Agent DM collaboration
continue through this same path without any Channel dependency.

The requester and the interaction environment are separate facts. A verified
member remains the same requester across Center Agent Chat, a Space, Slack,
Lark, Feishu, a Task continuation, and a future Local Agent carrier. Core may
recall that member's bounded memory on any of those turns. The current
destination controls what may be expressed or published; it must not erase the
requester's continuity or silently turn the same person into a less capable
requester.

Core freezes one `interactionEnvironment` on every current turn envelope:

- `requester_private` for a Center Agent DM or provider DM;
- `organization_shared` for an ordinary OpenMeld Space or a provider
  conversation proven to remain inside the Organization; and
- `externally_shared` when external participants are possible or provider
  audience evidence is missing or ambiguous.

Core also freezes one `contextScopePlan.v1` from that environment and the
authoritative sender. The plan records `requester_only`,
`organization_members`, or `external_conversation` as the result audience and
assigns one of `use_and_share`, `use_privately`, `share_when_authorized`, or
`never_available` to each context family. This is the one execution contract
for Web DM, Space, Slack, Message Channel, Routine, Task continuation, and
Local Agent-carried turns. The worker recomputes the expected plan from the
trusted envelope and rejects a frozen plan that was widened, retargeted, or
carried across a changed requester.

Memory rendered into the model is labeled with its exact handling. In
particular, member memory in a shared reply is marked for private reasoning
only. The model may use it to avoid making the verified requester repeat known
background, but the reply and every outbound tool argument must not quote,
expose, or imply that private detail. A linked Slack, Lark, or Feishu identity
creates a new deterministic turn with a newly frozen plan; it never upgrades
the already-admitted unlinked turn.

A verified member may use member and Organization context privately while
working in any environment. In a shared environment, the model may use private
context to avoid forgetting the requester, but must not repeat private facts,
identify the private source, or publish protected information merely because
it helped with the work. An external participant receives no member memory,
Organization memory, Organization Documents, or Organization Skills in model
context. A connected but unlinked internal member may receive bounded
Organization context and Organization memory, never member memory. Credentials,
authentication material, hidden policy text, and ungranted sources are never
available in any environment.

This is a per-turn context projection, not a second conversation or permission
system. Every continuation discards any inherited memory projection, rebuilds
the environment from its frozen result destination, revalidates the requester,
and recalls current bounded memory again. Core does not copy a parent turn's
already-materialized memory into a child or resumed turn.

Channel context is not Slack-specific even though Slack is the first producer.
Each provider adapter must translate its thread or conversation into the shared
contract. The worker renders historical records as untrusted reference content
and labels the current request separately. A connected Message Channel member
receives only the shared ordinary-member tool allowlist, and Core revalidates
the exact native delivery before each allowed tool runs. Personal data, Local
Agents, identity-owned actions, role-restricted actions, destructive writes,
and writes whose owner requires an OpenMeld human remain identity-gated. A
legacy unverified sender without canonical provider identity remains closed.
Current-thread context, explicit cross-conversation search, and durable Center
Agent memory remain three different capabilities; none is a fallback for
another.

Provider tenancy evidence is fail-closed. Slack uses the connected team plus
the current user lookup described above. Lark and Feishu require the event
sender's `tenant_key` to match the connected tenant. Missing or mismatched
evidence keeps the sender on the external-participant conversation surface; a
display name, provider user id, channel membership, or bot mention alone never
creates connected-member authority.

The one-click Lark/Feishu App registration response does not establish the
tenant key. Core binds the connection to the non-empty tenant key from the
first verified provider event whose verification token, App id, encryption,
and signature checks succeed. That write is first-value-wins. Until it succeeds,
`null` is unknown tenancy and can never match a sender or grant connected-member
authority. Every later event must carry that same tenant key.

For every Message Channel turn, the frozen sender controls admission and tool
authority. The current Channel type, audience, thread starter, person who added
the bot, and other participants do not raise or lower that sender's authority.
A verified Organization member therefore keeps that member's authority in a
shared Channel, while another participant's request never inherits it.

Slack audience classification uses the current `conversations.info` facts.
`is_ext_shared` and an ambiguous `is_shared` without `is_org_shared` are
externally shared and take precedence even for a direct message. Otherwise,
`is_im` is requester-private, while ordinary public/private channels and
`is_org_shared` channels are Organization-shared. A failed or timed-out lookup
is externally shared. A channel name is presentation only and may be
missing without losing the audience facts. Lark/Feishu direct messages are
requester-private; group conversations remain externally shared until their
provider contract supplies equally strong audience evidence. This conservative
group classification restricts disclosure, not the verified requester's
otherwise authorized ability to get work done.

An unlinked internal participant may use the existing Organization directory
read plus their own provider account name and available email to reason about
one likely current member account. Remote Agent may pass that exact directory
user id only with an identity-link navigation request. Core revalidates current
membership and binds the private token to that account. This reasoning is not
an admission or authority path, and it never blocks independent work. Remote
Agent requests the action only after a current personal, member-owned, role-
restricted, destructive, or human-attributed operation is actually blocked, or
when the user explicitly asks to connect accounts. A model response, ordinary
Channel reply, or button click never changes the current turn's sender. Only a
later authenticated confirmation can make a new turn a verified represented-
member turn.

All Remote Agent submission surfaces consume the same shared admission response
contract. A valid structured rejection ends admission with its exact reason. A
transport failure or invalid response does not prove that the worker rejected
the task, so Core keeps the submission recoverable and replays the exact durable
request with the same idempotency key. Member research does not advance to the
next member until the current task reaches a confirmed terminal outcome.

After runtime availability succeeds and before calling the worker, Core applies
one Organization-wide daily admission limit to `web_dm`, `space_wake`, legacy
`slack`, `message_channel`, `routine`, and `member_research`. The default is 200
admitted requests per UTC day and Worker configuration may override it. The
Core-owned counter and the native-delivery idempotency marker are committed
atomically, so an ambiguous submit replay does not consume a second admission,
even after UTC midnight.
Once admitted, a downstream worker or publication failure does not refund the
count. Rejection uses `remote_agent.daily_quota_exceeded`, explains that the
limit resets at 00:00 UTC, and follows the entry point's existing visible
failure path. This Core decision does not widen the worker RPC rejection enum.

Member research receives only Organization-directory/document reads, Slack
workspace directory metadata, bounded joined-channel membership/history reads,
bounded Agent Activity, shared-connection read-only GitHub tools, read-only
Organization-shared App actions, and `openmeld_draft_org_document`. The same
reduced surface is rechecked when each tool executes. Slack directory data may
disambiguate the subject's identity but is not work activity; profile text,
messages, and App output are untrusted. Slack history is limited to one
successfully read page in at most five joined channels whose membership
contains the exact subject id. Remote Agent first follows the workspace
directory cursor chain from its first page through completion and requires the
full traversal to yield exactly one subject Slack id. It carries the immutable channel id
from membership inspection to history retrieval; Core fails closed if the name
no longer resolves to that same channel. A thrown or expected-unavailable read
releases the page claim so a later retry can still obtain evidence. Expired
research fence records are deleted in bounded batches at admission.
Connected-App execution rejects every action whose declared effect is not
`read`. Space context remains excluded because the generic Space read does not
prove both public visibility and subject participation at execution time. It
cannot use a member-owned GitHub or App connection, perform external writes,
publish messages, inspect Center Agent-only activity, or manage Routines. This dedicated member-research fence does not
modify the ordinary interactive/Routine catalog. The draft tool is additionally
bound to the turn envelope's task id and subject: both Remote Agent and Core
reject another document kind, member, document, or Remote Agent submission.
Core also rejects a member-research draft that omits the shared structured
evidence-backed or insufficient-evidence report contract. Remote Agent does not
author this workflow's Markdown: Core validates the evidence packet, preserves
approved About text, and renders the reviewable Profile Report. This keeps
document formatting and the minimum evidence threshold under one server-owned
contract, so a thin identity and availability summary cannot enter document
review as a completed Profile Report.

Roll out this contract consumer before producer: deploy Remote Agent with the
optional `memberResearchReport` tool input before Core starts instructing member
research turns to emit it and requiring it at the draft receiver. With old Core,
the new Remote Agent continues following the old Markdown instruction and does
not send the optional field. Rollback removes the Core producer/requirement
before the Remote Agent consumer.

The later Slack-history and connected-App evidence extension rolls out Core
first, then Remote Agent. The new Core schema accepts either the complete
legacy five-source coverage set or the complete current seven-source set; the
new Remote Agent always emits the seven-source set. After Core deployment is
complete, Remote Agent may expose the new source enum values and tools. Rollback
therefore removes the Remote Agent producer before the Core compatibility
reader.

For a `member_research` turn, Slack evidence is not governed by prompt text
alone. Core's workspace directory returns the exact OpenMeld member user id for
every matched Slack identity. Remote Agent requires one unambiguous Slack id
for the task subject, permits member inspection for at most five distinct
channels, and permits one newest-first history page only after the inspected
channel contains that exact Slack id. These restrictions do not narrow ordinary
member-requested or Routine Slack reads.

For an ordinary Space Wake, including a Wake in an ordinary Direct Message
Space, or a Routine whose frozen destination is an OpenMeld Space, Core reads
`SpaceMeta.guide` from the owning Space Durable Object immediately before every
native-delivery submission. A non-empty guide is attached as
`turnEnvelope.space.guide`; an empty guide is omitted. The Remote Agent renders
that value in the turn message, while the approved Organization Brief remains a
separate organization-level system-prompt input. Center Agent DMs, Slack turns,
and Slack-destination Routines do not read or carry a Space guide. Neither Core
nor the Remote Agent caches this projection between turns.

Every hosted Center Agent materialization also renders the shared built-in
information-protection guidance in its system prompt. Core may attach the
active Organization's owner/admin-maintained classification hints through the
Organization Document prompt-context RPC, but those hints remain a distinct
system section and are never model-visible tool authority. This applies equally
to Center Agent DMs, ordinary Space native delivery, Slack, Lark, Feishu, and
Routine turns because they share the same Remote Agent prompt builder. Failure
to read the optional Organization policy falls back to the built-in guidance;
it does not make the conversation loop unavailable. Remote Agent reads the
current policy for every model turn. If that read fails, a cached Organization
Brief and document-title projection may remain available, but a cached policy
must be discarded rather than reused.

The guidance governs disclosure in replies and outbound tool arguments. It
does not disable tools, change represented-member authorization, or create an
additional confirmation flow. Tool-level authorization and destructive-action
contracts remain the only action authority.

### Routine native delivery and tool parity (updated 2026-07-17)

Center Agent Routines are a user-visible product surface owned by
`developing/product/center-agent-routines.md`. Their execution uses the Remote
Agent native-delivery exception, not the workstation Wake lifecycle:

- Core's minute Cron owns due scanning and submits one Run with the Run id as
  the worker idempotency key. Agents SDK/Flue `schedule()` is not the Routine
  scheduler; it remains reserved for worker-to-Core callback retry.
- A Run may freeze the `legacy` or Cloudflare `workflow` execution engine. The
  Workflow instance id is the Run id. It durably owns submission retry,
  callback-event waiting, and callback finalization for that Run without a
  fixed total callback deadline; D1 remains product truth, and the legacy
  recovery scanner must not also take over that Run.
  Callback validation and final destination publication remain the existing Core
  native-delivery contract rather than Workflow-private behavior. Core records
  Workflow creation, safe restart, blocked recovery, and callback-forwarding
  evidence against the same Run id without logging the callback payload.
- The Routine definition and Run history stay in D1. Flue session state and
  Durable Object alarms do not become a second Routine registry.
- The native delivery ledger links the delivery by `routineRunId` and freezes
  exactly one result surface: `conversationKind = "space"` with a target Space,
  or `conversationKind = "slack"` with the originating durable Slack thread. A
  Routine is not a fabricated user message.
- Ambiguous submit recovery reuses the durable worker request and Run identity.
  Core stores that sensitive staging request in a versioned private envelope;
  only legacy values that still pass the current strict shared request schema
  may be replayed. Undecodable legacy values fail the Run visibly without
  reconstructing missing identity.
  A structured admission rejection terminalizes immediately with its stable
  reason code; only thrown RPC or transport errors remain outcome-ambiguous.
  Callback adoption, admission recovery, terminal compare-and-swap,
  publication claims where required, and Space publication deduplication fence
  the model turn and visible result. A legacy deadline-probe message for an
  already accepted execution is ignored; only pre-ACK admission ambiguity or a
  recorded callback-publication failure may use bounded recovery. `routine_runs`
  projects the terminal native-delivery outcome; it is not a second in-flight
  execution authority.
- Skipped Runs do not invoke the model or publish a destination message. Failed Runs
  require an explicit visible failure in the frozen destination. Routine turns do not
  emit the transient Space reply stream.
- Routine turns inherit the interactive Center Agent tool catalog by default,
  including Slack channel list, member, and history reads. Explicit
  capability-owned exceptions keep Agent Task discovery or watch tools out of
  Routine turns, as owned by
  `developing/product/center-agent-routines.md` and
  `developing/product/projects.md`. The durable Routine envelope supplies the
  reauthorized delegated member used by each exposed capability's existing
  current-member, connection, attribution, audit, and Core authority checks.
  Its explicit instructions are standing task direction for ordinary safe
  actions; scheduling does not weaken or replace the remaining capability-owned
  contracts. Free text never authorizes delete or merge, which are unsupported
  during a Routine.
- The Routine trigger also carries the stored `externalActionPolicy`. Missing
  values preserve `standard` behavior during rollout and for ordinary
  Routines. `read_only` keeps source reads available while blocking external
  App actions unless their registered effect is explicitly `read`, every
  GitHub write, and Slack publication by default. Those gates run before the
  corresponding provider side effect. They do not block an explicitly granted
  Organization Document save, an explicitly granted
  `slack.publish_channel_report` action, or the Run's normal
  frozen-destination result. Core reauthorizes the Slack report against the
  canonical Routine and Run instead of trusting only the worker envelope.
- The Routine trigger freezes the Run's Space or Slack-thread destination. Any
  `current_conversation` tool resolution uses that projection; it never treats
  a Slack conversation id as an OpenMeld Space id.

The required Routine publication invariant is that worker submission,
successful output, failure output, and redrive all use the destination snapshot
frozen for that Run. A Routine destination update affects later claims, while an
already claimed Run keeps its recorded routing authority. This
does not define snapshot timing for name, instructions, schedule, or timezone.
Ordinary timestamps remain nonnegative; a negative Run `scheduledFor` is valid
only for `skipped` plus `routine.schedule_invalid` quarantine evidence.
Implementation and recovery changes must prove the target invariant end to
end; a stored Run snapshot alone is not proof that every native-delivery branch
uses it.

### Model (settled 2026-07-09, revised 2026-08-13)

Center Agent model traffic remains **Cloudflare AI Gateway → OpenRouter**. The
OpenRouter provider key stays in Cloudflare AI Gateway Provider Keys under
alias `openrouter`; the Remote Agent worker sends the authenticated gateway
token plus `cf-aig-byok-alias: openrouter` and does not carry provider API keys
in code or tracked config. This is OpenMeld-operated provider configuration,
not user BYOK.

The repo-owned `center-agent` catalog exposes Grok 4.6, Grok 4.5, and DeepSeek
V4 Flash, with Grok 4.6 as the OpenMeld default. Core resolves a complete
immutable route for each new turn. The route contains the exact OpenRouter
model id, friendly display name, input modalities, context window, output
budget, reasoning level, catalog timestamp, preference kind, auxiliary
image-understanding model, and `automaticModelFallback: false`. The Remote
Agent executes that route; it does not consult a mutable Organization setting
or silently substitute another primary model.

Every main OpenRouter turn sends one exact frozen model id, and every
model-backed helper sends one exact configured model id. None sends a
model-fallback list. Each request also sends
`provider.allow_fallbacks = true`, so OpenRouter may reroute that exact model
across healthy providers when one provider is unavailable or rate-limited.
Provider rerouting never authorizes switching between Grok 4.6, Grok 4.5,
DeepSeek V4 Flash, or any other primary models. If all providers for the exact
model fail, the turn still ends in one visible failure. Public-web research
uses the same exact-model provider-rerouting rule.

Provider registration is scoped by Organization and frozen route identity.
Flue/pi-ai capability metadata, AI Gateway headers, usage attribution, and
reasoning behavior must be read through that scoped provider id rather than a
process-global `openrouter` registration that a concurrent Organization can
overwrite.

Grok 4.6 and Grok 4.5 receive image input directly. When the selected primary
is text-only, the worker uses the frozen image-understanding route, currently
Grok 4.6, only to describe the image. Instructions visible inside the image are
explicitly untrusted content, the original image is not sent to the text-only
primary, and the bounded HTML-escaped description enters the turn under an
untrusted-data delimiter that image content cannot close. The worker removes
the generic attachment marker before sending this text-only turn and states
that the original image is not attached. If the auxiliary call fails, the turn
fails; it does not remove the image, pretend the image was understood, or
change the selected primary model.

Model capacity and reasoning metadata are checked in with the catalog so
admission needs no provider metadata lookup. Compaction derives its policy from
the frozen route. Hosted reasoning is currently fixed to `high`; the Harness
reads that frozen route value dynamically rather than reading a user setting or
hard-coding one global effort. Usage remains recorded by the Remote Agent
worker through OpenMeld-owned usage records and Analytics Engine and attributes
the effective primary model.

The worker accepts legacy version-1 submissions during the mixed-deployment and
recovery window. Those requests preserve the historical Grok 4.5 route because
they contain no model route, including the historical image-input capability;
the worker's environment fallback therefore remains Grok 4.5 even after the
new-turn product default becomes Grok 4.6. This is wire compatibility for
already-durable work, not automatic fallback.
An exact continuation or recovery derived from a durable version-1 request
remains version 1. Core must not synthesize a current version-2 catalog route
for that work, because doing so would change its frozen model semantics.
New Core submissions from Space, Slack, Lark/Feishu, Routines, and member
research use version 2 and always carry the exact frozen route.

### Provider tool materialization and Code Mode

Remote Agent materializes turn-scoped model policy, Organization Documents,
Organization Skills, sandbox state, and the active tool catalog in a fixed
sequence. These stages must not run concurrently: each can temporarily hold a
large provider or schema object, and overlapping them raises peak isolate
memory without improving the resulting prompt or capability set.

The complete authorized direct-tool catalog remains the single source for both
direct execution and Code Mode. For a bounded catalog of at most 64 direct
tool schemas, the provider receives those direct tools plus `codemode`. Above
that threshold, the provider receives `codemode`, the three generic Connected
App discovery and execution tools, and the dedicated GitHub tools. Keeping
those bounded direct sequences available prevents generic App discovery from
being mistaken for a requested provider outcome and lets an explicit GitHub
request verify its own connection through the matching GitHub action; it does
not add a second action surface. The generic connected-Apps result explicitly
reports GitHub as `not_checked` and directs the model to the matching dedicated
GitHub action. It must never let the absence of GitHub from the ordinary Apps
list be interpreted as missing GitHub access. The required direct subset must
itself remain within the same 64-schema limit and fails fast if it exceeds that
boundary.
The generated Code Mode catalog still contains every active direct tool,
including that subset, and every direct or inner call re-enters the same
cancellation, authorization, confirmation, audit, usage, and result-bounding
paths. This is provider-payload compaction, not capability removal or a second
tool policy. A large catalog without exactly one valid `codemode` tool fails
fast instead of silently dropping tools. The source tool list is never mutated,
so retries and diagnostics retain the admitted capability evidence.

An explicit, verified request for a new Task or Space has one bounded
lightweight binding path. Before Flue execution, an auxiliary classifier reads
only the current request and may select that path only when the request is
self-contained and requires exactly one canonical creation action. Earlier
conversation, attachments, participant lookup or membership changes, multiple
actions, an unverified speaker, and an existing Task conversation all require
the complete runtime path.

The lightweight path persists only the typed surface decision in the existing
durable callback context. It does not store request text or create another
conversation state. It skips Organization Documents, Organization Skills, and
Computer materialization; exposes only the matching canonical create tool;
and sends the auxiliary provider only the current request plus authoritative
turn time. The same worker-owned auxiliary model that classifies this bounded
request fills the one forced create-tool call and the short result
acknowledgement. It is not the member's selected primary model and is not an
automatic fallback after a primary-model failure. The created Task or Space
uses the frozen selected primary model for its substantive work. This keeps the
mechanical binding step bounded without changing the Organization's model
choice. The tool keeps its existing schema, execution wrapper, Core
authorization, idempotency, audit, result, callback, and publication paths.
After the create result, the provider receives no tools, which prevents a
second mutation. Classifier failure, timeout, insufficient context, or any
unsupported request falls back to the complete runtime path. Keyword rules do
not grant this binding.

When the same self-contained Task or Space request comes from an unlinked
connected Message Channel member, the classifier may identify the requested
surface but must not expose the unavailable create tool or let the model explain
the missing catalog. The worker instead forces the existing identity-boundary
tool, preserves the selected model's valid reasoning contract, and records the
private account connection action. The visible reply says that account
connection is needed and points to the private message in ordinary user
language. Internal tool, catalog, session, route, and permission vocabulary is
never a user-facing recovery instruction.

### Conversation compaction and runtime rollover

Flue remains the sole owner of the message history, summary, and compaction
execution inside one Remote Agent runtime conversation generation. OpenMeld
does not maintain a second transcript or run an additional summarizer on
ordinary turns. Core owns only the logical-conversation-to-active-generation
pointer. That pointer is routing metadata, not transcript, memory, execution,
or publication truth.

OpenMeld configures compaction with two explicit budgets:

- model-specific `reserveTokens` starts compaction before the provider context
  limit or a known higher prompt-price band; and
- `keepRecentTokens = 8,000` preserves the latest verbatim conversation tail
  after older messages are summarized.

These values are runtime policy, not another context store. The current turn
envelope and authoritative system prompt continue to be rebuilt from their
owning Core facts on every submission, so compaction does not have to preserve
mutable authorization, Organization, destination, or tool-policy truth inside
the summary.

Model-context compaction does not by itself bound Flue's canonical durable
event stream or the memory required to replay that stream. Before Flue or the
Agents SDK reconstructs a conversation, OpenMeld reads only numeric aggregate
storage facts from the stream table: batch count, serialized bytes, and largest
batch bytes. The guard verifies the expected tables and payload column against
an integration test that creates and appends through the pinned Flue runtime;
an incomplete or incompatible stream schema fails closed instead of silently
disabling the safety boundary. It never reads message or summary content for
this guard. Before the guard, the worker checks the existing durable
idempotency receipt. A
finalized retry returns its original ACK without replay; a claimed retry keeps
its existing recovery path. The footprint boundary applies only when no
matching receipt exists, so it cannot replace an already-admitted execution
with a false rejection. At 8 MiB the version-4 worker request emits a bounded
soft-limit rejection so Core can roll the same logical Center Agent
conversation to a fresh internal runtime generation before expensive replay.
Core advances the active generation atomically, derives its deterministic
runtime route, materializes a bounded and source-attributed continuity context
from currently authorized product facts, persists the exact replacement
request, and retries once. The continuity context is admitted only into an
empty new generation and never turns Core into a second transcript owner.
For a Space turn, the Space owner resolves the exact dispatch's frozen main or
thread placement and returns only bounded text Signals before that dispatch's
source Signal; the generic main-timeline reader is not a continuity source for
a thread. For a Center Agent Task turn, the Task owner returns the bounded typed
event projection before the trigger event and owns the canonical actor mapping;
Remote Agent must not query the private Task event table or reinterpret Task
actors itself.
Concurrent callers converge on the same active generation. Runtime generations
are invisible implementation details: the member remains in the same DM,
Space, provider conversation, or Task and is never asked to start a new one.

Dispatch diagnostics resolve the exact runtime conversation from the native
delivery's frozen worker request. They never address a Durable Object from the
logical Space id after rollover and never copy Core's active-generation pointer
into the Remote Agent. If the frozen worker and recovery requests disagree or
the exact identity is unavailable, diagnostics fail closed instead of reading
another generation.

At 12 MiB every protocol version fails closed before replay or model work with
`remote_agent.conversation_history_limit_exceeded`. Version-1 through
version-3 callers retain that legacy terminal behavior because they cannot
name a logical conversation and runtime generation separately. A version-4
request rejected again after a fresh-generation rollover is a visible internal
recovery failure with Retry and diagnostics; it must not instruct the member
to manage runtime history. Exact provider transcripts remain isolated by their
authorized source conversation. Cross-surface continuity comes from verified
member and Center Agent identity, Core-owned memory policy, current
environment, and explicitly attributed authorized context, not from copying
private raw transcripts between surfaces.
These deliberately conservative thresholds leave
headroom below the 128 MiB isolate limit for replay amplification, prompt and
tool materialization, and provider payloads; they are a safety boundary, not a
claim that 12 MiB of serialized history alone consumes 128 MiB.

OpenMeld observes Flue's real `compaction_start` and successful `compaction`
events. A successful event updates the submission's existing durable callback
context before final callback publication. For a Space result, Core copies the
safe checkpoint into the final `signal.text` metadata; Web renders one durable
`Conversation compacted` separator immediately before that reply. Multiple
successful compactions during one submission increment the checkpoint count
but still produce one separator. Failed compaction produces no checkpoint and
no user-visible marker. Slack and other Message Channel results keep their one
native result surface and do not receive an extra OpenMeld message.

This observation path is deliberately off the normal-turn hot path. A turn
without compaction performs no additional storage read or write and makes no
additional model call. Compaction turns record only the bounded checkpoint and
safe numeric diagnostics. Deterministic checks flag a missing start event, a
non-reducing message count, or repeated compaction in one submission without
blocking the reply. Prompt text, summary text, message text, and transcript
content never enter these logs or the Space marker. OpenMeld does not run a
secondary model review of every Flue summary; a future semantic validator must
be anomaly-triggered, asynchronous, privacy-reviewed, and unable to delay the
user's reply.

The pinned Flue provider path retries transient network, `429`, and `5xx`
failures up to three times with exponential backoff. These retries do not create
a new native delivery or authorize an unconfigured fallback model. If all
provider attempts fail, the worker returns one explicit failure; if the worker
or platform is interrupted first, the durable submission remains recoverable
under the same idempotency key.

An interrupted submission that has exhausted Flue's attempt budget must settle
its durable submission before any optional conversation advisory is written.
The exhausted path cannot initialize the model, documents, skills, sandbox, or
tool catalog merely to record failure. Core's accepted-delivery probe invokes a
lightweight worker reconciliation RPC that reads Flue's durable submission
projection. When Flue is terminal but the OpenMeld execution callback is still
pending, the worker records that terminal execution and re-enters the ordinary
durable callback path. If the submission is still active, Core requeues the
probe without imposing a total execution deadline.

### Space reply streaming (shipped 2026-07-10)

Space conversations may show accumulated assistant text and privacy-bounded tool
progress before the final reply is published. Private model reasoning is never
published to clients. Streaming is a bounded, best-effort presentation
projection; it is not a second message writer, native-delivery status, or
final-outcome authority.

- The worker uses provider reasoning deltas only as private execution-progress
  evidence. It never sends their content to Core, Space, Web, or a Message
  Channel. For active `space` deliveries, it emits one sequenced stream of
  accumulated text snapshots and privacy-bounded tool lifecycle parts. A text snapshot that
  exceeds its shared callback contract may stop the best-effort preview, but it
  cannot alter or suppress the authoritative final outcome.
  A user-visible part must carry one shared admitted semantic work key and may
  carry one explicitly safe bounded subject label. Technical tool name, call
  id, and AI SDK-aligned lifecycle state remain transport evidence; they are
  not presentation copy. Tool parts never carry tool arguments, results, raw
  errors, commands, or paths. Outer Code Mode lifecycle and errors are hidden;
  only an admitted inner tool that actually succeeded is forwarded, immediately
  after that success. Inner failures do not create Work summary rows, and
  optional Work summary publishing cannot alter the inner tool result. Safe
  subjects are allowlisted per tool and limited to a repository owner/name,
  website hostname, or bounded human-authored product object name or title.
  Slack conversations do not stream into OpenMeld Web.
- Core validates every stream callback against the active native-delivery
  record before Space accepts it. Space owns the short-lived stream cursor,
  text projection, and companion text snapshot read model used for reconnect
  recovery. Space retains only the privacy-bounded tool lifecycle summary
  for a successfully published final reply, keyed by that Signal ID for 14 days
  and readable only through Message details. The retained projection includes
  only admitted semantic work; wrapper and legacy parts without it are not
  exposed.
  Failed or stopped streams discard the draft; no arguments, results, raw
  errors, commands, paths, model reasoning, or private Agent text are retained.
- The persisted Space message or Space system notice remains the visible
  outcome. Finalization closes the projection, a successful terminal points to
  the published Space signal, and late deltas are rejected. Web must replace the
  temporary text with the durable outcome even when their text differs.

This additive stream rollout is consumer first: deploy Web, then Core, then the
Remote Agent producer. New Core accepts the legacy text callback and the typed
typed stream callback. Text WebSocket frames keep their legacy shape. Web also
ignores any legacy thinking frame so a stale producer cannot expose private
reasoning. Rollback removes the Remote Agent producer before Core or Web
consumers.

Workstation Local Agents may use the same downstream Space tool-part and
working-details contracts through RuntimeCoordinator-authorized daemon frames.
That does not make Local Agent private output a hosted text stream: this
section's accumulated text-snapshot producer remains specific to the hosted
Center Agent path.

Shared frame and snapshot schemas live in
`developing/architecture/shared-contracts.md`; Space meaning and Web
reconciliation live in `developing/product/space-collaboration.md` and
`developing/clients/web.md`.

### Required reading for implementers

Read the current Flue framework docs and current Cloudflare Workers/Durable
Objects docs before changing the harness, model route, tool definitions,
sandbox configuration, or Worker service-binding RPC. The frozen product
contract is OpenMeld's direct RPC wrapper plus Core callback, not any private
Flue table or public HTTP route.

## Shipped R1 MVP Contract

### Capability tiers (supersedes "zero tools")

The earlier "zero tools in MVP" line existed to cap our own build effort
and the injection surface. Flue changes the cost structure: harness
capabilities are configuration, not engineering. The scope rule is now a
tier model — **the acceptance surface stays minimal; the capability
surface adopts official features where they are free**:

- **Tier 1 — acceptance surface (a failure here is a P0).** The
  conversation loop: open the managed Center Agent → talk in a Space DM;
  supported Slack app mentions reuse the same native
  delivery loop → reply arrives, always. Includes what Flue provides for it:
  persistence, compaction, per-conversation context blocks, durable recovery.
- **Tier 2 — shipped alongside, Experimental, not acceptance-gated.**
  Phase 1 enabled three hosted capability families for both interactive Center
  Agent turns and Routine turns:
  - live public-web search and single-URL fetch through OpenRouter server tools
    on the existing Cloudflare AI Gateway route;
  - stateless Browser Run Quick Actions for rendered Markdown, links,
    structured extraction, selector scraping, and screenshots; and
  - the Center Agent's computer: a durable org-level workspace filesystem
    (`@cloudflare/computer`, SQLite in the AgentComputer Durable Object) with
    shell execution on the worker-shell backend, exposed through Flue's
    SandboxApi contract.
    The stateless Code Mode increment adds one model-visible
    `codemode` tool that can compose the exact capability definitions already
    active for that turn inside an isolated Dynamic Worker. Direct tools remain
    available for simple calls while the direct schema catalog is within its
    provider-payload budget; larger catalogs are exposed through `codemode`
    alone without removing any inner capability. Generated code receives no
    OpenMeld secrets,
    Worker bindings, Node.js APIs, host filesystem, or unrestricted outbound
    network access, and every inner tool call re-enters the ordinary
    submission-context, cancellation, authorization, destructive-confirmation,
    audit, and usage paths. This increment does not add the durable Code Mode
    runtime, history, snippets, tool search/describe, approval replay, or a
    second scheduler.
    Code Mode projects each direct tool's authoritative Valibot input schema
    into model-visible JSON Schema and attaches the same Valibot parser as the
    runtime validator. Non-representable input transforms such as `trim` remain
    runtime-only; the structural fields and constraints must still appear in the
    generated catalog instead of degrading to `unknown`. Do not maintain a
    separate hand-written Code Mode schema: every new direct-tool field must
    become visible through this one adapter and its catalog regression tests.
    Browser Quick Actions remain one-shot headless Chrome operations. The runtime
    does not retain browser sessions, expose Live View, or implement human
    browser takeover. Browser screenshots use the existing private Space
    attachment contract and are attached to the final Space reply.
    The computer is owned by the agent identity: one durable workspace per
    Agent Profile, keyed `agent-computer:<agentProfileId>`. Org-level
    uniqueness follows from the Center Agent being unique per Organization; a
    future second hosted agent gets its own computer. The computer does not
    mount an OpenMeld host or user workstation. Files persist across
    conversations, Durable Object restarts, and deploys under the fixed layout
    `/computer/{org,projects,spaces,tasks,routines,home}`. Ordinary Space turns
    work under `/computer/spaces/<spaceId>`, each Center Agent Task keeps one
    working set under `/computer/tasks/<taskId>` across attempts and
    continuations, and each Routine keeps one working set under
    `/computer/routines/<routineId>` across runs. The isolation boundary is the
    Organization, not the Space: cross-Space continuity on one computer is the
    point, and disclosure control lives on the output side (which Space the
    Center Agent speaks in), exactly as it already does for Organization
    memory and Documents. Before each hosted turn starts, Remote Agent pulls a
    versioned approved Organization Documents snapshot from Core when the
    current turn's `contextScopePlan` allows it and materializes it read-only
    under `/computer/org/documents`. When the plan disallows Organization
    Documents, Remote Agent clears any projection left by an earlier turn
    before exposing Computer tools and does not expose the Document checkout or
    submit tools. The snapshot
    exposes a convenience manifest, preserves clean Markdown bodies without
    frontmatter, and is fully rematerialized before computer tools become
    available on every authorized turn. The manifest is not trusted identity or
    version state: working-copy submission is bound to the current Core snapshot
    held outside the Agent-writable filesystem. Center Agent edits happen in a
    working directory and return through the Core-owned draft or explicitly
    authorized direct-save contracts; Computer files never become a second
    approved-content writer.
    A Local Agent never receives an implicit mount of this private hosted
    filesystem. A Center Agent may explicitly copy at most three regular text
    files from the current working directory into one Wake, with 32,000 bytes
    per file and 64,000 bytes total; symbolic links, private sidecars, binary
    content, and paths outside the current work fail closed. This is a one-time
    message snapshot, not filesystem access or live sync. Larger or durable
    handoffs use formal Organization Documents or another supported shared
    surface.
    Shell execution has two backends over the same
    files: worker-shell (default — just-bash in a Dynamic Worker reached
    through `env.LOADER`, instant, no container, no public network, text
    tooling only) and container (computerd in a Cloudflare Container,
    FUSE-mounting this same workspace at `/computer` with `MOUNT_POINT`
    pinned for same-path fidelity; full Linux userland with python3, git,
    curl, jq; changes sync back over capnweb). The model selects the backend
    per bash call and is prompted to prefer worker-shell. The per-Space
    `@cloudflare/sandbox` container is fully retired: dependency removed and
    the `Sandbox` Durable Object class deleted (migration
    `v6_retire_sandbox`). Local AGENTS, CLAUDE, and workspace Skill discovery is
    explicitly disabled: model- or tool-written workspace files cannot alter
    later system instructions or tool definitions. Explicit Organization
    Skills admitted by Core are definition-provided Flue Skills, not workspace
    discovery. They remain available through Flue's native catalog,
    activation, and resource loading while workspace-written Skills remain
    invisible. The computer connects lazily: the Dynamic Worker starts only
    when a computer or Code Mode tool actually executes. Routine timing is not
    a Tier-2 harness capability; D1 plus Core Cron owns it.

- **Tier 3 — OpenMeld product tools (Experimental, Core-backed).** The
  first shipped tool slice exposes OpenMeld org actions through Flue
  `defineTool` with Valibot schemas, not through browser sessions or direct DB
  access. Enabled tools are: read Organization directory, list Organization
  Spaces, read a bounded live page of active human Slack members with
  email-based current-Organization membership classification, list visible
  Slack channels with the App membership state, and read bounded members or
  newest-first history only from Slack channels the App has already joined,
  read the current
  active Organization invite link, ensure an active
  Organization invite link on behalf of a verified owner/admin, read
  Organization Agent Activity, read Space context through exact source, thread,
  delta, or explicit history scopes (with a legacy broad bootstrap for old
  callers), read bounded recent Dispatch Ledger diagnostics, create Spaces,
  create Agent Profiles, enable Agent Profiles, add active Organization members
  and Agent Profiles to Spaces, remove Agent Profiles from Spaces, update Space
  settings, post plain Space messages, and Wake Agent Profiles in Spaces through
  Space activation targets. A Slack-triggered turn may additionally search one
  bounded page of public Slack messages when that event carries an encrypted
  event-bound authorization. Core privately presents provider permalinks to the
  requester; the tool receives only presentation status, cannot page, is absent
  from Web, Space, Routine, and member-research turns, and never persists or
  reuses search data.
  A requester-selected Slack channel introduction is not a model-owned loop.
  Core first persists the exact selected-channel manifest, then creates one
  native delivery per channel with a channel-scoped idempotency key and durable
  item checkpoint. The model receives exactly one destination per turn. Core's
  scheduled recovery may resume a stale submitting item, but it never reopens a
  submitted or outcome-unknown item.
  The Center
  Agent may also save an explicit organization memory fact when organization
  memory is enabled. In an interactive OpenMeld Space or Center Agent DM turn,
  it may call `openmeld_request_member_attention` once when the current verified
  member must respond. The model supplies bounded title, prompt, and one exact
  impact: `response_needed`, `work_blocked`, or `material_failure_risk`. The
  first is normal; the latter two are urgent only for concrete blocking or
  time-sensitive material risk. The tool is absent from Routine turns and
  rejects anonymous or provider-message turns. Core reauthorizes the exact
  active native delivery, represented member, Organization, Center Agent, and
  source Space before writing the source request and Inbox projection. It never
  enters RuntimeCoordinator or claims that notification delivery succeeded.
  The vetted Feedback slice adds three
  tools: submit bounded product feedback to OpenMeld through the ordinary public
  Feedback endpoint, list the current Organization's Feedback Inbox, and update
  an issue through the Core-owned status machine. The reporting tool is the only
  Tier-3 application tool with public-network access: its destination is fixed by
  Worker configuration, it uses the public limiter with no privileged write
  path, its model input accepts only bounded `category`, `summary`, and optional
  `details`, and the Organization policy can disable it. Unlike the general
  Tier-2 research and browser capabilities, that reporting tool remains the
  only Tier-3 product tool whose contract directly calls a public endpoint.
  Inbox text is returned with an explicit untrusted-data notice. Every product
  tool builds a Core-originated
  `OpenMeldRequestContext` from the
  native-delivery submission context; Core validates current Organization
  membership and current designated Center Agent authority, owns audit
  attribution, and delegates Auth-owned mutations through organization-scoped
  internal RPCs. The read-only invite-link tool remains available to every
  verified Organization member. An explicit request to share the link
  authorizes the read without another confirmation. The separate create tool
  asks Auth to ensure one exists on behalf of the verified member. Auth
  authorizes the request from its current membership data: owners/admins
  receive the current active link or a newly created link when none exists,
  members receive a structured permission error, and personal organizations
  are rejected. The
  tool never accepts a caller-supplied role and cannot reset, revoke, or email
  invitations. Those remaining invite-management actions, broad member access
  changes, and higher-risk destructive tools remain disabled until they have
  clean internal RPCs and explicit approvals where needed.

  The Tier-3 surface also includes six Center Agent Routine
  management tools: create, list, update, delete, pause, and resume. They derive
  the verified current human speaker or the Routine's reauthorized delegated
  member from the durable turn, call private Core RPC, and use the same
  represented-member authority as Web and CLI. Explicit create, update, pause,
  and resume requests execute without another confirmation. Interactive delete
  requires one separate confirmation backed by a one-time Remote Agent token;
  the first call ends the turn and the exact confirmed second call executes.
  Core remains the represented-member authorization layer.

  A Routine turn inherits the executable interactive catalog by default. This
  includes Routine management and the complete model-visible GitHub catalog.
  The current explicit exception hides the Agent Task discovery or watch tools
  named in
  `developing/product/center-agent-routines.md`; the read-only Project list and
  Slack channel list, member, and history reads remain inherited. Catalog
  inheritance does not bypass any capability-owned rule: current
  delegated-member authorization, connection scope, attribution,
  destructive-confirmation, audit, and Core authority still apply at execution
  time. A
  capability that cannot satisfy its normal contract fails visibly unless the
  Routine and capability owners explicitly define and test its absence.
  For ordinary non-GitHub Apps, connector selection treats the Routine's
  reauthorized delegated member as the requester, so that member's connection
  wins and Organization access is the fallback. Every future ordinary Center
  Agent tool enters this shared catalog by default. The only general Routine
  difference is that no live requester is present for follow-up questions;
  missing input produces an actionable result rather than a Routine-only tool
  or permission policy. GitHub reads and writes instead require
  `githubActor = organization` and use the Organization's GitHub App
  installation. Ordinary writes explicitly named by the durable Routine
  instruction execute as the OpenMeld bot without a live confirmation.
  Free-text instructions are task direction, not structured destructive grants.
  GitHub file deletion, pull-request merge, destructive Generic App actions,
  Project removal, and Routine deletion all return
  `routine_destructive_action_unsupported` with zero side effects. The executor
  never parses Routine grammar, Markdown, quoting, or target text to override
  that boundary. Interactive destructive actions retain their one-time
  later-submission confirmation path.

  A stored `externalActionPolicy = read_only` is the one explicit narrow
  exception used by Center Agent Self-Evolution. The Remote Agent returns
  `routine_external_write_unsupported` with zero side effects before generic
  App writes, GitHub writes, or Slack publication. Generic App metadata must
  explicitly classify an action as `read`; an omitted or unknown effect fails
  closed. Ordinary Routines default to `standard`, so this policy does not
  silently narrow the shared catalog for existing users.

  The read-only `openmeld_read_agent_activity` tool uses the verified current
  human speaker or the Routine's reauthorized delegated member and a private
  Core RPC. Core derives the Organization from that authority, enforces active membership, and returns the same bounded snapshot as
  Web and CLI. The tool may filter evidence but cannot mutate Projects, end a
  session, claim work, Wake an Agent Profile, or turn activity into execution
  authority. It remains available during interactive member and Routine turns.

  The Project tool family adds bounded cloud Project automation:
  `openmeld_list_projects`, `openmeld_create_project`,
  `openmeld_update_project`,
  `openmeld_set_agent_profile_default_project`,
  `openmeld_prepare_remove_project`, and `openmeld_remove_project`. Every tool
  derives the verified current human speaker and calls the represented-member
  Core Project RPC. Inputs never accept Organization identity, role, repository
  fingerprint, local connection state, or absolute paths. Mutations carry
  durable operation IDs; Core replays matching retries and rejects an operation
  ID reused with different input. Remove requires a short-lived Core token
  prepared for the exact Project and consumed after explicit confirmation in a
  later interactive member turn. Routine turns may list, create, update, and
  select Default Project under the same represented-member and idempotency
  contracts without free-text permission evidence. Project removal during a
  Routine is unsupported in both Remote Agent and Core and returns
  `routine_destructive_action_unsupported` before prepare or remove.

  Project prompt guidance teaches the Center Agent that a Project is the
  Organization-scoped code identity used by Agent Activity, Default Project,
  local folder resolution, and Project-aware Wake. When a GitHub or other
  workflow depends on a Project, the agent first checks for an existing
  canonical repository match. It creates one when the user explicitly asks; if
  creation is only implied, it explains why the Project is needed and asks for
  the missing Project name or Repository URL before writing. After cloud setup,
  it returns the trusted Project Navigation Action. The worker records the
  action's code-owned target, and Core rebuilds the canonical URL for the final
  result surface instead of accepting a model-authored URL. Web and Slack
  render the action as a button. The reply directs local-folder connection to
  the intended computer instead of requesting or guessing a path. A completed
  removal never offers a dead link to the removed Project.

  This is an additive private Worker RPC and shared-schema change. Deploy the
  Core D1 migration first, then the Core and API/Web readers that understand
  Center Agent Project audit action set `v8`, and deploy Remote Agent last. New
  Core remains compatible with an old Remote Agent because no Project RPC is
  called. A new Remote Agent against an old Core fails closed with
  `core.rpc.unavailable`; it must never fall back to a public route or fabricate
  success. Older audit readers continue using their frozen action set and
  safely omit Project rows. The change does not affect CLI, OpenMeld Service,
  daemon, Prepare, RuntimeCoordinator, or local-component versions.

GitHub is an **App**, not a Message channel. Its Tier-3 toolset covers the
practical repository workflow: account and repository discovery; directory,
file, code, commit, and Issue or pull-request search; branches, commits,
comparisons, labels, assignees, reviews, requested reviewers, commit statuses,
check runs, and merge state; and GitHub Actions workflow and run diagnosis. The
write surface can create and update Issues, comments, labels, assignees,
branches, files, pull requests, and pull-request reviews; request or remove
reviewers; update pull-request branches; rerun workflows; delete individual
files; and merge pull requests. Repository deletion and release publication
remain unavailable. File deletion and pull-request merge operations use the
interactive two-turn destructive-confirmation contract. Every other GitHub
write executes directly from an explicit verified-user request or an explicit
connected Message Channel member request with `githubActor = organization`. Explicit
Routine instructions direct ordinary writes without per-Run confirmation.
GitHub file deletion and pull-request merge are unsupported during a Routine.

Every dedicated GitHub tool has one required model-visible
`githubActor = organization | requester` input. `organization` means the
Organization's selected-repository GitHub App installation and the OpenMeld bot.
`requester` means the verified current member's GitHub user authorization. Core
resolves only the requested identity and never falls back to the other one.
Interactive turns choose from the concrete repository and authorship need.
Routine turns and member research reject `requester`; they may use only
`organization`. Remote Agent strips `githubActor` before calling OpenConnector
because it is OpenMeld authorization input, not a provider action parameter.

#### OpenConnector access boundary

The OpenMeld OpenConnector deployment keeps administration and runtime action
execution on separate bearer-token surfaces:

| Purpose                                | Endpoint examples                                                                                | Bearer token                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Catalog and connection administration  | `GET /api/providers`, `GET /api/actions`, `GET /api/connections`, and the other `/api/*` routes  | `OPEN_CONNECTOR_OPENMELD_ADMIN_TOKEN`                                                |
| Runtime discovery and action execution | `GET /v1/providers`, `GET /v1/actions`, `GET /v1/apps`, `POST /v1/actions/:actionId`, and `/mcp` | `OPEN_CONNECTOR_OPENMELD_RUNTIME_TOKEN` or an OpenConnector persistent runtime token |

Both surfaces use `Authorization: Bearer <token>`. The self-hosted upstream
route table does not expose `GET /v1/catalog`; use `/api/providers` and
`/api/actions` for the management catalog or the documented `/v1` discovery
routes for runtime clients. Because authentication runs before route matching,
an admin token sent to `/v1/catalog` returns `401`, while a valid runtime token
reaches routing and returns `404`. Neither response indicates a mismatched
admin secret, and `/v1/catalog` must not be used as an admin-token probe.

Cloudflare can list configured secret names but does not reveal secret values.
To verify the root local environment against the deployed Worker without
rotating secrets, call one known route on each surface: the local admin token
must receive `200` from `/api/providers`, and the local runtime token must
receive `200` from `/v1/providers`; each token must receive `401` on the other
surface. Recheck upstream `docs/runtime-api.md`, `docs/configuration.md`, and the
current server route table before attributing a missing endpoint to deployment
lag or synchronizing and redeploying OpenConnector.

Organization GitHub access uses the single OpenMeld GitHub App identity owned
by the OpenConnector deployment. The guarded production deploy maps the
canonical `OPEN_CONNECTOR_OPENMELD_GITHUB_APP_ID` and
`OPEN_CONNECTOR_OPENMELD_GITHUB_APP_PRIVATE_KEY` secrets to the upstream
Worker's runtime names. An Organization installation produces an encrypted,
Organization-scoped connection; the App private key never becomes connection
data and is never returned to Core, Gateway, Web, or a model-visible tool.

The OpenMeld OpenConnector deployment policy supports GitHub, Gmail, Google
Calendar, Google Drive, Notion, Linear, Figma, PostHog, Cloudflare Browser
Rendering, Cloudflare DNS, Cloudflare R2, and Cloudflare Workers. Presence in
this policy does not by itself make an App available. The availability gate is a
review of the credential UX, provider authentication behavior, required
capabilities, scopes, and known limitations, OpenConnector execution contract,
and model-visible service contract against current official provider
documentation and reviewed source. A live smoke is post-enable validation
unless a separate provider decision explicitly requires it.

Google Apps use a production read-only baseline. The tracked policy enumerates
the reviewed Gmail, Google Calendar, and Google Drive read actions instead of
using provider-wide patterns, and the OAuth clients request only the matching
read-only scopes. OpenConnector runtime discovery applies the same deployment
policy before returning services or actions, so a Center Agent cannot discover
a Google write action that execution would later reject. Adding a Google write
scope or action requires a new product review, matching OAuth verification, an
updated tracked policy contract, and production smoke before release.

Other policy-supported services retain provider-wide patterns so the deployment
policy does not silently lag behind the catalog-driven action inventory. The
deployment explicitly blocks `github.delete_repository` and
`github.create_release`, and blocks raw provider proxies. The Remote Agent tool
registry still decides which services the model can discover and call. An
`action_not_allowed` result for a model-visible tool is an OpenMeld deployment
policy failure, not proof that the member disconnected GitHub. An
`action_blocked` result names an intentionally unavailable action. Reconnecting
must not be presented as the remedy for either result. GitHub `Not Found` and
authorization failures preserve the provider error while explaining that the
repository must be included in the OpenMeld GitHub App installation and
available to the explicitly selected GitHub identity.

`config/openconnector/wrangler.production.jsonc` is the tracked source of truth
for this deployment policy, Worker identity, D1 binding, R2 binding, and public
origin. OpenConnector secrets remain Cloudflare secrets and never enter the
file. Production deployment must use the repository command with a clean
OpenConnector checkout and its exact full source SHA; an ignored local Wrangler
file is not an acceptable production source.

Figma production authorization uses one reviewed public OAuth App with the
exact callback `https://connectors.openmeld.ai/oauth/callback`. Its client id,
client secret, requested scope set, access tokens, and refresh tokens are owned
by OpenConnector's encrypted OAuth configuration and credential stores. Core
and Web receive only the existing non-secret authorization URL and connection
projection. OpenConnector's Figma provider must refresh through the current
`/v1/oauth/token` endpoint with the `refresh_token` grant and support PKCE
before Web exposes OAuth as the new connection path. Its public OAuth scope set
excludes `projects:read` and `project_metadata:read` because Figma does not make
Projects endpoints available to public OAuth Apps; the provider may retain
those scopes only for legacy PAT-backed credentials. Deploy and configure
OpenConnector first, then deploy Web; reversing that order would surface a
connection action that cannot complete.

The App rollout generalizes the GitHub adapter into a catalog-driven
OpenConnector action surface. During rapid validation, all implemented actions
for a supported provider are eligible rather than copied into a smaller
provider-specific allowlist. Large catalogs use lazy action discovery and
schema retrieval instead of placing hundreds of tool definitions in every
prompt. Discovery and execution remain Core-authorized and
Organization-scoped; the generic path never exposes the OpenConnector admin
surface, credentials, or an unvalidated raw HTTP proxy. Interactive and Routine
turns use the same discoverable App actions.

The generic action path relies on the provider grant, Core authorization,
represented-member attribution, and one durable Core-owned operation. The
model chooses a stable operation ID and must reuse it when retrying the exact
same action. Core binds that ID to the selected connection, service, action,
represented member, and request signature before execution. That signature
covers the selected connection, service, action, and input. Remote Agent sends
the same ID to OpenConnector in the standard `Idempotency-Key` HTTP header; it
does not invent a JSON-body field outside the official runtime API. OpenMeld's
Core-owned operation record, rather than provider response metadata, is the
source of truth for whether the request is a replay. If provider
execution succeeds but Core finalization is interrupted, the next exact retry
reads the Core operation metadata first, rebuilds and verifies the same
signature with its frozen connection, replays OpenConnector's stored result,
including the output schema that describes that result, and finishes the same
operation instead of creating a second provider mutation. The Remote Agent
interprets the returned data through this execution-owned schema rather than
reconstructing it from a possibly newer catalog. Current membership, connection
availability, and provider catalog state gate only a new claim; they cannot
erase or redefine a provider execution that Core already claimed.

The path does not add confirmation to ordinary writes. A verified user's
explicit request or an explicit Routine instruction is authorization. The
shared OpenConnector action contract may supply first-class
`effect = read | write | destructive` metadata. Remote Agent treats an action
as destructive when either `effect = destructive` or the shared legacy
vocabulary matches its ID or name; contradictory read/write metadata cannot
downgrade delete, merge, remove, trash, purge, erase, destroy, or drop. During
the provider rollout, interactive destructive actions use the shared one-time
confirmation contract. A Routine destructive action returns
`routine_destructive_action_unsupported` with zero side effects. The executor
uses action metadata only to classify effect; it never parses Routine free
text, arbitrary input keys, or model-provided target values as permission.
GitHub remains on its dedicated tools and is never routed through the generic
executor.

Before every new action operation that is eligible to run, Remote Agent asks
Core to resolve an active connection inside the turn Organization. A Routine
destructive action is rejected before operation lookup. An exact eligible retry
instead reads the existing Core operation before current availability and
reuses its frozen connection. For ordinary non-GitHub Apps, interactive turns
prefer the verified sender's member connection and may then use the
Organization's shared connection; they never use another member's connection.
Routine turns use the reauthorized delegated member as the requester and follow
the same member-first, shared-second order. Tool results
for new operations carry the connection scope, authorizing identity, and
selection attribution; recovered operations report the frozen connection
without inventing current ownership metadata. Ordinary GitHub writes execute
immediately from the verified request or explicit Routine instruction. In an
interactive turn, file deletion and pull-request merge first return an exact
action-, repository-, and identity-specific confirmation with no provider side
effect. The confirmed second call requires a one-time token bound to the
issuing submission, Organization, represented user, action, canonical input,
and selected GitHub connection and owner. A token cannot confirm another
action, repository, payload, user, or execution identity. Canonical input
treats recursively
reordered object keys as the same payload, so an already confirmed action does
not ask again solely because serialization order changed. The first call ends
the current model turn so it cannot consume a newly minted token itself. A
Routine delete or merge returns `routine_destructive_action_unsupported` before
provider execution; free-text instructions, retrieved content, and tool output
cannot replace the interactive token.

Requests that create more than one GitHub Issue use one durable batch manifest,
not a model-owned loop of independent writes. The immutable manifest is keyed
by the caller's operation id, has no arbitrary item-count ceiling, records a
deterministic hidden marker per Issue, and checkpoints after every item. A
retry searches that marker before writing so a provider-ambiguous response can
be reconciled without intentionally duplicating an Issue. The explicit request
or Routine instruction authorizes the batch without an extra confirmation.
Every attempted connector write and its `completed`, `failed`, or
`outcome_unknown` result is appended to the Core-owned Center Agent audit
journal with the verified represented human.

A batch that asks for GitHub Project V2 placement or assignees fails closed
before connection resolution or any GitHub write until OpenMeld has an explicit
Project V2 capability contract and Organization-member-to-GitHub-identity
mapping. The model must not guess a username, silently omit requested Project
placement, or partially create Issues while claiming the full request was
completed.

The executable model-visible inventory is owned by
`REMOTE_AGENT_OPENMELD_TOOL_NAMES` in
`services/remote-agent/agent-core/tools.ts`; product documents must not maintain
a second exhaustive name registry. For new working Agent Profiles, the
configured-profile operation is the preferred tool. Standalone create, enable,
and add-to-Space tools remain narrow existing-record operations rather than a
parallel setup workflow.

The member Service-status read is a privacy-bounded product tool, not a
diagnostic or readiness tool. The Center Agent first reads the Organization
directory, then passes one exact member `userId` to Core. Core verifies current
Organization membership and returns only `connected`, `needs_attention`,
`not_connected`, or `unknown`; the model never receives a computer name,
device id, operating system, Service version, last-seen timestamp, or raw lookup
error. Interactive and Routine turns inherit the tool through the normal
catalog. Unattended member-research turns do not receive it.

This is an additive shared-schema, Agent work-activity, and private Service
Binding rollout. Deploy Core, then Web, then Remote Agent. The new Remote Agent
fails closed when the Core method is absent, while the old Remote Agent remains
compatible with the new Core; Web understands the new work key before Remote
Agent emits it. Audit action set `v12` lets current readers accept the new
`read_member_openmeld_service_status` row; older frozen action sets omit it.
Rollback removes Remote Agent before Web or Core. The change does not affect
Gateway, Auth, CLI, OpenMeld Service, daemon, Prepare, RuntimeCoordinator, or
local-component contract versions.

The dispatch-history tool is diagnostic-only. It may cite a terminal attempt's
recorded error evidence, but it cannot decide that a Wake is currently queued,
running, or still waiting from Dispatch Ledger status alone. That judgment
requires a current RuntimeCoordinator projection and freshness; otherwise the
tool must report the current execution state as unknown. Its description and
prompt must preserve that boundary for `queued`, `dispatching`, and
`waiting_result` history.

**Tier-2 vetting bar** (the implementer applies this to each built-in and
reports the enabled/disabled inventory for Felix's review — the standard
is the deliverable, not a pre-baked list):

1. Execution is sandboxed and managed by Cloudflare (no host shell, no
   host filesystem).
2. No access to OpenMeld secrets or Worker bindings beyond what the tool
   needs.
3. Its billable usage is observable through Remote Agent usage records and
   Analytics Engine before being enabled.
4. It is enabled following the official documented configuration, not a
   forked/customized variant.

Current hosted capability inventory:

| Capability                                    | Official doc surface                                                    | Enabled?                      | Reason                                                                                                    | Risk                                                         | Test evidence                                                                                                     |
| --------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| OpenRouter web search and fetch               | OpenRouter server tools through the existing AI Gateway route           | Yes                           | Adds current public-web research without a new OpenMeld data store                                        | Provider requests and model context consumption              | Tool payload, citation, usage, and failure tests                                                                  |
| Browser Run rendered reads                    | Browser Run Quick Actions                                               | Yes                           | Reads JavaScript-rendered pages with a browser binding only                                               | Browser time and untrusted page content                      | Markdown, links, extraction, scraping, and browser-time tests                                                     |
| Browser Run screenshots                       | Browser Run Quick Actions plus the existing Space attachment contract   | Yes for OpenMeld Space output | Lets the Center Agent return a real visual artifact                                                       | Image size, browser time, and private attachment lifecycle   | Browser response, R2 write, Core metadata, callback, and final publication tests                                  |
| Cloudflare Computer (Center Agent's computer) | `@cloudflare/computer` Workspace + worker-shell backend on `env.LOADER` | Yes                           | Gives the Center Agent one durable org-level filesystem and shell that persists across conversations      | Preview-stage API drift and Durable Object storage growth    | Computer naming/enablement, layout, SandboxApi adapter, native grep, observability, and localhost smoke tests     |
| Computer container backend (computerd)        | `@cloudflare/computer/backends/container` + computerd FUSE image        | Yes                           | Full Linux userland (python3, git, curl, jq) over the same durable file world as worker-shell             | Container boot latency and standard-2 instance cost          | Backend routing tests plus local Docker smoke: python3 reads DO-written file, container write syncs back          |
| Cloudflare Sandbox (removed)                  | Cloudflare Sandbox SDK plus Flue Cloudflare adapter                     | Removed                       | Fully superseded by the computer's container backend                                                      | None (class deleted via `v6_retire_sandbox`)                 | Dependency removed; no `SANDBOX` binding or `Sandbox` class remains                                               |
| Browser Live View and retained sessions       | Browser Run Live View and CDP session APIs                              | No                            | Headless one-shot execution covers the current product need                                               | Human takeover and retained-session lifecycle                | No Live View URL, browser session state, or takeover surface exists                                               |
| Stateless Code Mode                           | Cloudflare Code Mode `createCodeTool` plus `DynamicWorkerExecutor`      | Yes                           | Composes the exact active turn tools for dependent calls, loops, filtering, branching, and result shaping | Generated-code execution and multiplied inner tool calls     | Capability-parity, execution-context, prompt, binding, build, and real localhost composition tests                |
| Durable Code Mode runtime                     | Cloudflare Code Mode durable runtime                                    | No                            | Stateless composition is sufficient for the first increment                                               | A second history, approval, snippet, and discovery lifecycle | No durable runtime export, Code Mode storage, snippet catalog, search/describe surface, or approval replay exists |

The implementation report must use this inventory table for every default or
configured Flue capability:

| Capability | Official doc surface | Enabled? | Reason | Risk | Test evidence |
| ---------- | -------------------- | -------- | ------ | ---- | ------------- |

### Conversation Identity And Result Surface

The per-conversation DO instance key is the OpenMeld conversation id. For
`space` conversations, that id is the Space id. A DM with the Center Agent is a
Direct Message Space as defined in
`developing/product/space-collaboration.md`, so DMs need no separate
conversation object. The Space timeline remains the durable user-facing record
for `space` conversations.

For `slack` conversations, the id is
`slack:{teamId}:{channelId}:{threadTs}`. The originating Slack thread is the
only user-facing result surface for that conversation; native delivery ledger
rows provide OpenMeld's diagnostic read projection and no Space timeline entry
is written.

For new generic Message Channel conversations, the id is
`{provider}:{connectionId}:{chatId}:{rootMessageId}`. The typed locator, not
this displayable instance key, is publication authority. Lark and Feishu keep
native thread and root/reply identifiers separately when the provider exposes
both; the adapter chooses the provider-supported reply target and never assumes
that a thread id is interchangeable with a root message id.

For a first-class Center Agent Task conversation, the instance key is derived
from the canonical Organization and Task id, never from the mutable browser URL,
display title, originating provider thread, or one linked execution handle. Core
admits the exact Task id and `contextRevision`. The Task event stream remains the
durable user-facing conversation record; the Flue session is the private runtime
context carrier and must not become a second Task transcript or status writer.

A Task turn may originate from Web, Space, Slack, Lark, or Feishu. Core freezes
the exact authorized Task event and, when native provider publication is
required, one typed destination locator. The worker produces one result for the
canonical Task event. Core records that result once and the provider adapter may
deliver that same event through one fenced publication operation. Opening the
Task in Web never reruns the model or reconstructs a second result.

Turns inside one Task are serialized by the Task conversation instance.
Independent Tasks and the ordinary Center Agent Chat conversation may run in
parallel. A newer Stop, superseding instruction, access change, or Task revision
fences a stale callback before publication or further side effects. Detailed
Task context, access, conflict, Stop, Retry, and Recovery semantics are owned by
`developing/product/center-agent-tasks.md`.

Turns within one conversation are serialized by that conversation's instance;
conversations across Spaces and external provider threads run in parallel.
Conversational context lives in the instance's Flue session (DO SQLite).

Space membership is unchanged (confirmed by Felix 2026-07-06): **any org
member can add the Center Agent to any Space in the org** through the
existing membership mechanics, and the Space conversation model means it
works in every Space it joins. To keep that true, designating onto the
remote runtime org-authorizes the hosted Binding automatically with an
audit record (an application of the settled bulk/automatic authorization
policies) — designation must not leave a Center Agent that members can add
but not trigger.

### Native delivery contract (replaces the wake-lifecycle adapter)

1. **The Binding kind alone selects the path for a member-authored trigger.** A
   trigger on a profile whose
   primary Binding is `builtin:*` goes through the wake pipeline; a trigger
   on a `hosted:center-agent` Binding goes through native delivery. One
   trigger, exactly one path — never both, never a fallback from one to the
   other. This is the no-dual-truth guarantee. The dispatch planner owns
   trigger semantics and is not rewritten for R1; runtime selection happens
   only at the execution-side fork after the planner has selected a target.
   A Routine Run is the separate Core-owned scheduled admission defined in
   `developing/product/center-agent-routines.md`; it targets the designated
   hosted Center Agent directly and must not enter or weaken workstation
   RuntimeCoordinator semantics.
   For an interactive Space Wake already selected for the hosted Binding,
   direct-first dispatch and Queue recovery are transport choices inside that
   one native-delivery path, not a fallback to the workstation path. Both reuse
   the same dispatch id, idempotency key, native-delivery ledger, and persisted
   worker request.
2. **User-visible results have one canonical result and one native publication
   operation.** For ordinary source conversations, `conversationKind` selects
   the only result surface: `space` conversations publish through the Space standard send
   path with the existing attribution semantics; `slack` conversations publish
   to the recorded Slack thread with `chat.postMessage` and `thread_ts`; and
   `message_channel` conversations publish through the provider adapter using
   the frozen typed locator and publication idempotency key. Native delivery
   adds no second write path into any conversation. A first-class Task turn
   writes one canonical Task result event and may deliver that same event through
   one frozen native provider operation. Authorized Web rendering is a projection
   of the Task event, not another model turn, result writer, or business side
   effect. Mechanically: the worker
   finishes a turn and calls back into Core; Core publishes to the
   ledger-selected surface. A Routine delivery may be `space` or `slack`,
   permits only the frozen destination recorded for that Run, and never mirrors
   across surfaces or fabricates a source message. Every publication branch
   must satisfy the frozen-target invariant owned by
   `developing/product/center-agent-routines.md`. Slack terminal publication —
   successful replies and failed-callback notices — uses a fenced, nonterminal
   ledger claim before `chat.postMessage`. Only the claim holder may publish;
   an active concurrent
   loser remains retryable. Core records the terminal delivery state and the
   published Slack timestamp only after Slack returns `ok: true` with a
   non-empty `ts` and the same claim id wins the D1 finalize. Slack has no
   documented idempotency key for this call, so a network-ambiguous result, a
   failed fenced finalize, or an expired claim becomes `outcome_unknown` and is
   never automatically reposted. This is an explicit at-most-once tradeoff for
   Slack terminal publication, not an exactly-once claim.
   Lark/Feishu terminal publication uses the same fenced ledger owner but a
   different provider contract: standalone reply requests carry a deterministic
   UUID that the provider deduplicates for exactly 60 minutes. A
   network-ambiguous reply therefore remains retryable and nonterminal inside
   that window. Core retries only the frozen locator, persisted payload, and
   UUID; callback replay cannot redirect or rewrite it. At the exact deadline,
   Core stops provider calls and records the permanent `outcome_unknown` result.
   CardKit mutations keep their frozen card, sequence, and UUID, but ambiguity
   remains immediately fail-closed because this contract does not invent a
   CardKit deduplication duration.
   Execution Recovery uses this same native-delivery row as the immutable
   hosted destination authority. Admission snapshots the Slack thread or
   Message Channel locator, controller normalization evidence, exact worker
   request, and retained final publication payload. Tier 1 replays the retained
   payload through the matching connector adapter without another model turn;
   Tier 2 submits only an exact-conversation result-republication turn; Tier 3
   creates one new native-delivery identity. A request arriving from a
   different surface cannot retarget any tier. If the original provider
   adapter or immutable locator is unavailable, Core fails closed rather than
   publishing to Space.
3. **Failure is explicit.** Model errors, platform faults, runtime policy
   blocks, and worker submission failures must surface on that conversation's
   result surface as a visible failure. A member-authored trigger must never
   silently disappear. Core owns all failure and system copy; the worker
   produces successful answers only. Core maps only known failure codes to
   approved public copy; an unknown code always uses the generic request-failed
   copy, while the worker detail remains diagnostic-only. Failure copy names
   Center Agent, the user's request, and one next action; it never exposes the hosted runtime's
   internal product name or asks the user to understand tools, catalogs,
   sessions, routes, provider configuration, or permission infrastructure.
   `outcome_unknown` is the fail-closed
   exception for an ambiguous Slack provider outcome, or for a Lark/Feishu
   ambiguity that remains unresolved when its official 60-minute UUID
   deduplication window ends. Core preserves it for diagnostics and does not
   risk creating a second provider reply automatically.
   Completed and failed callbacks both use the applicable pre-publication fence
   before recording a terminal delivery. For an identity-required Message
   Channel result, Core also replaces the worker's completed text with one fixed
   account-connection explanation before publication, task projection, or
   memory. Model-written infrastructure explanations are never the public
   fallback. Routine branches additionally use the
   Run id as the Space publication idempotency key.
   An accepted native delivery has no fixed total execution deadline. The
   admission watchdog applies only before a real worker ACK; accepted/running
   work ends only through a worker terminal result, explicit targeted
   cancellation, or a diagnosed stale-progress policy. Core must persist a
   real worker ACK without waiting for an independently started watchdog
   enqueue to finish; a delayed or failed watchdog must never leave running
   work projected as merely submitted. When the admission watchdog does
   terminalize a delivery, it must use the same Agent Task Coordination
   terminal projection as every other Native Delivery ending. Replaying a
   durable `published` or `outcome_unknown` watchdog result must rerun that
   projection idempotently so a crash cannot leave an observer waiting
   forever. Historic
   `remote_agent.delivery_expired` rows are not execution truth: a matching
   late callback reopens that retired false failure, preserves the old notice as
   reconciliation evidence, and publishes the authoritative result once.
   Core's durable accepted-delivery probe continuously invokes the Remote Agent
   `reconcileExecution` service-binding RPC. Remote Agent remains the only
   writer of Flue submission-to-worker execution state and callback context;
   Core rereads its native-delivery ledger after the call and publishes only a
   confirmed terminal callback. A missing receiver, transport failure, or
   still-active submission is observable and retryable, never terminal success
   or an elapsed-time failure. An exact execution-identity mismatch cannot
   recover through another worker probe. Core retains that exact failure in the
   existing durable final-publication conveyor. A known transient publication
   failure releases the claim for the same idempotent publication and keeps the
   delivery eligible for Queue and scheduler recovery; confirmed publication
   records the failed terminal outcome and retires the probe. Deploy the Remote
   Agent receiver before the Core caller. During the mixed-version window, old
   Core safely ignores the new receiver, while new Core against old Remote Agent
   logs the capability gap and requeues the same probe.
   Queue retry count is not accepted-delivery liveness. Every successful probe
   enqueue or self-requeue renews the ledger's next-probe due time. Core's
   minute scheduler scans missing or expired due times and uses one bounded D1
   compare-and-set lease before enqueueing compensation. A failed enqueue
   releases its exact lease; a crashed caller becomes recoverable when the lease
   expires. The historical first-enqueued timestamp remains audit evidence only
   and must never suppress compensation.
   A terminal worker result is also retained until Core explicitly accepts its
   callback. Callback retry uses capped backoff and Core publication
   idempotency, but no attempt ceiling: a temporary Core, Space, or Slack
   publication outage must not discard a completed answer or replace it with a
   synthetic execution failure.
4. **Presence is honest and Core-owned.** Core is itself the deliverer, so
   remote-runtime health is first-party state, not inferred evidence — no
   `remote_runtime` evidence channel, no daemon-style readiness chain. But
   presence is never hard-coded green: runtime policy blocks and platform
   faults degrade the displayed state with actionable copy.
5. **Every interaction lands in the Core-owned native delivery ledger**,
   separate from the wake Dispatch Ledger, so trace and diagnostics cover
   native delivery with the same deterministic evidence rule as wakes. The
   ledger records what happened; it does not drive execution. Minimum fields:
   `organizationId`, `conversationKind`, conversation locator (`spaceId` for
   `space`; Slack team, channel, and thread timestamp for `slack`),
   `profileId`, `bindingId`, `triggerMessageId`, `submissionId`,
   `idempotencyKey`, `status`,
   `failureCode`, `onBehalfOf`, optional `routineRunId`, durable callback
   publication context,
   `publishedSignalId`, and timestamps.
   The durable worker request freezes the Core-authored sender and Message
   Channel identity used by connected-member authorization. Core tool
   authorization resolves `agentControllerConversationId` back to that exact
   delivery and rejects a missing, stale, cross-Organization, cross-provider,
   or mismatched speaker. The Center Agent audit journal may reference the
   source native delivery instead of inventing an OpenMeld profile for the
   connected Message Channel member.
   A Space Wake routed here retains its original Dispatch Ledger row as the
   public Wake trace. Once Core has confirmed the native terminal result and
   its required Space publication, Core idempotently projects the same terminal
   status, reason, and bounded failure detail onto that Wake attempt. This is a
   read projection only: the native-delivery ledger remains the hosted
   execution record, and Slack or Routine deliveries never invent Wake
   dispatches.
6. **Trigger semantics:** the Remote Agent follows the shared Direct Message
   trigger rule from `developing/product/space-collaboration.md`: current DM
   state, exactly one active human and one active agent, and the human authored
   the text message. Agent-authored messages never auto-trigger. In group
   Spaces and degraded DM-origin Spaces, the existing explicit Wake surface
   applies unchanged; "every mention is not a Wake" stays true. Routine Runs
   are not messages and use the distinct Core scheduled-admission contract;
   they do not add another implicit message trigger.
7. **Delivery mechanics (implementation note):** native delivery is a
   service-binding call into the Flue worker using durable programmatic
   submission. The idempotency key is derived from the triggering
   message/dispatch id, or from the Run id for a Routine, so retries never
   create duplicate turns. If the worker
   accepts a submission but the callback fails, the ledger must preserve a
   diagnosable/recoverable state or Core must publish an explicit failure in
   the Space; the user message must never be swallowed. Core checks only the
   global Remote Agent runtime switch and optional per-organization blocklist
   at the delivery entry, then applies the Organization daily admission limit
   before the worker call. The retired budget breaker and per-member rate limit
   are not active delivery gates.
   The worker persists execution identity, lifecycle state, last progress, and
   cancellation state beside the durable submission. Competing progress,
   completion, and cancellation transitions use atomic compare-and-set; once
   cancellation is recorded, later progress cannot overwrite it and completion
   settles as aborted. Every tool call rechecks that state before side effects.
   Space Stop targets exactly one submission; it must not abort unrelated
   queued work in the same conversation.
   Interactive Space delivery persists its Space outbox record first. Core may
   then attempt direct native admission only when the current Binding preflight
   still resolves the target as `hosted_center_agent`. Any ineligible,
   retryable, or outcome-ambiguous result hands the same message to Queue for
   recovery. Workstation targets never use this direct-first branch.
8. **Hosted image input:** for `web_dm` and `space_wake`, Core may copy up to
   four canonical image attachment references from the triggering Space signal
   into the worker turn message. The worker uses the turn's existing
   Organization and Space identity to read each private object from the shared
   attachment bucket and submits successfully loaded images through Flue's
   direct-agent `images` field. Slack does not use this path. A failed image
   read adds explicit English placeholder text and structured Worker evidence
   without failing the remaining images or the text turn. The prompt also says
   how many images were successfully attached so the model can associate them
   with the current turn. Core sends references only; image bytes never enter
   the service-binding RPC or native delivery ledger.

Deploy the Remote Agent image consumer and R2 binding before Core begins
emitting attachment-bearing turn messages. The field is optional, so old Core
works with the new worker and attachment-free turns keep their prior JSON
shape. The reverse mixed version is unsafe because the old worker's strict
message schema rejects the new field; keep that deployment window closed.

Routine rollout has three different strict windows:

- **W2, Core to Remote Agent:** the worker that accepts the Routine turn-envelope
  discriminants, `delegatedBy`, the rollout-optional frozen destination, and
  Slack locators, plus optional Routine continuation evidence, must deploy
  before Core
  enables the corresponding Routine scheduler producer.
  Rollback reverses that order: stop the Core producer before rolling back the
  worker consumer. Current Core always emits the destination. The worker accepts
  an absent destination only for the short old-Core window and fails visibly
  rather than guessing when a tool needs `current_conversation`.
- **W2a, Core to Remote Agent:** the verified represented Human Profile id in
  `delegatedBy` is rollout-optional in the shared envelope and current Core
  always emits it. Deploy the Remote Agent consumer before the Core producer.
  The worker derives represented-member tool attribution from this trusted
  envelope field and never exposes an `onBehalfOf` identity choice to the model.
  During the short old-Core window, a Routine mutation that needs represented-
  member attribution fails closed instead of accepting a model-authored id.
- **W3, Core to Remote Agent:** the worker that accepts and safely renders the
  optional provider-neutral `channelContext` must deploy before a Core channel
  adapter emits it. Rollback stops the Core producer before removing the worker
  consumer.
- **W5, Remote Agent to Core:** Core's six private Routine tool receiver methods
  must deploy before the final worker exposes the corresponding interactive
  callers. Rollback removes the callers before the receivers.
- **W6, Remote Agent to Core:** Core's worker response-union reader must deploy
  before Remote Agent emits a structured admission rejection. Rollback removes
  the rejection producer before the reader. The old thrown-error behavior may
  still enter bounded ACK recovery during the forward window; it must not be
  mistaken for a deterministic rejection.

Apply D1 migration `0025` before `0026`, `0035` before queued Slack ingress,
`0036` before new Routine fields, and `0063` before Core can append a Routine
continuation delivery. Deploy the Core queue consumer before the
Gateway Slack queue producer; Gateway returns retryable non-2xx if enqueue is
not available. These windows are independent; the W2
consumer-first exception must not be replaced by the default Core-before-Remote
callback order, and W5 must not expose tools against an old Core receiver.
W6 follows the same Core-reader-before-Remote-Agent-producer direction as a
worker callback contract.

### Binding representation (unchanged mechanics)

- The designated profile gets a primary Binding whose `agentControllerRef`
  uses the new kind (`hosted:center-agent`) and whose runtime identity is a
  Core-managed logical runtime (no daemon registration). Runtime identity is
  structured schema, not string concatenation. The shared hosted-runtime shape
  serves UI, trace, ledger, and diagnostics; the org is derivable and the
  identity must not contain volatile data.
- Wake-access records stay per-`(organization, binding)`, fail closed,
  carried over on rebind with audit — unchanged.
- Binding owner is the designating owner/admin (consistent with the local
  rule: designate only onto your own Binding).

### Hosted readiness states

Core-owned hosted readiness has exactly two product states in MVP:

| State       | Condition                                                                                                                                          | User-facing meaning                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `available` | Runtime policy allows the org and the worker binding is reachable.                                                                                 | Remote Agent can answer now.                                            |
| `faulted`   | Runtime policy blocks the org, the global runtime switch is off, submission/callback delivery is failing, or the worker/platform is not reachable. | Remote Agent is temporarily unavailable and the failure is diagnosable. |

"It runs in the cloud, therefore it is always green" is a contract violation.

### Free MVP with operator containment and usage visibility

- The Remote Agent is **free** in MVP. No billing build.
- The retired **$50/org/day circuit breaker**, `resting` state, and
  **60 Remote Agent triggers/member/hour** limit are not active product
  gates. Historical database columns and migrations remain because old rows
  are durable evidence, but Core no longer reads or writes them.
- Operator containment remains a global runtime kill switch and an optional
  per-organization blocklist. Both are operational controls. The separate
  Organization daily admission limit is a uniform product guardrail with no
  official-organization exemption.
- Per-turn usage is recorded by the Remote Agent worker from Flue prompt
  usage, emitted to Analytics Engine, and exposed through
  `readUsageDiagnostics`. Core does not add usage fields to the native
  delivery ledger and does not read AI Gateway REST Logs for enforcement.
- The worker also emits shared Cloudflare runtime evidence for every
  service-binding RPC and completed Center Agent turn. Turn evidence records
  success, bounded provider-failure classes, and submission timeout outcomes;
  it never includes prompts, message text, provider response text, or tokens.
  This operational evidence does not decide admission, retry, timeout, native
  delivery, or final result-surface truth.
- New-turn default route: Cloudflare AI Gateway → OpenRouter BYOK
  `x-ai/grok-4.6` with BYOK alias `openrouter`. The legacy version-1
  environment fallback remains `x-ai/grok-4.5` for durable recovery
  compatibility (settled; see Implementation Base).

Failure copy examples belong to Core, not the worker. Runtime policy blocks
must explain whether the Remote Agent is disabled globally or blocked for the
organization.

### Operator diagnostics

Remote Agent operator tooling is exposed through `pnpm ops:remote-agent`,
consistent with the repo's other `ops:` tools. It reads and writes the Core
runtime policy variables (`OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED` and
`OPENMELD_REMOTE_AGENT_BLOCKED_ORGANIZATION_IDS`) in Wrangler config, and it
reads worker-owned usage diagnostics through `readUsageDiagnostics` via a
temporary service-binding Worker. The operator must provide the exact runtime
conversation id from a frozen dispatch request; `--space` remains only the
logical usage-record filter and cannot select a runtime generation. It does
not read or mutate retired Core breaker tables. This is internal operator
tooling, not a user surface and not availability truth.

### Role prompt (staged)

- MVP: the Remote Agent gets an **official OpenMeld system prompt**, written
  standalone. Its role definition (what a Center Agent is, its posture, its
  boundaries) must agree semantically with the local wake-injected role
  template — reviewed side by side, not shared code yet.
- Every turn's prompt includes the authoritative current UTC ISO instant. The
  model calculates relative times from that instant, never from a guessed
  wall-clock time, and applies a timezone only when user or trusted conversation
  context supplies it. A successful Routine tool result is confirmed from its
  exact returned `runAtMs`, using the user's explicit timezone or UTC when none
  was provided.
- Every interactive and Routine system prompt includes one generic execution
  routing protocol. The Center Agent derives a plan from the current task's
  data, identity, side-effect, and environment requirements; the live tool,
  App, Channel, Project, Agent Profile readiness, Wake-access, and authorization
  signals relevant to those requirements; and the exact results returned while
  executing. It chooses the smallest capable direct, delegated, or combined
  path and re-evaluates that path when a signal fails.
  This is Remote Agent execution planning after Core has already selected the
  managed hosted Binding. It does not select or change the Center Agent's
  Binding, delivery Runtime, or dispatch path, and it does not expose the hidden
  local Center Agent runtime entry point.
  This protocol must not encode a fixed per-Organization capability matrix or
  assume GitHub, Slack, a particular computer, or a particular Local Agent.
  Apps are scoped external capabilities, Channels are conversation and result
  surfaces, Projects are Organization routing context, and Agent Profiles are
  teammate identities rather than execution proof. A connection, catalog row,
  visible profile, previous success, or prior Run is a discovery signal, never
  current permission, readiness, or completion truth. When no authorized path
  exists, the Center Agent names the exact missing capability, connection,
  environment, authority, or material decision and gives one concrete next
  step.
- Top-level Space-, Project-, Projects-, and App-bearing OpenMeld tool results
  include a structured Navigation Action when Core supplied trusted
  Organization Web context. The Center Agent relies on that action and does not
  repeat its URL in Markdown: the delivery layer renders the most recent
  top-level action as a Web or Slack button. For an older result without the
  action, the agent may call the read-only navigation tool with the exact
  returned target ID; it never invents a relative path, origin, Organization
  slug, label, or URL.
- GitHub connection recovery records the code-owned GitHub App target when the
  same trusted context is available. Core rebuilds the current Organization's
  direct App action, Web renders it as a button-styled link, and Slack renders a
  native button. During an old-Core mixed-version window the error keeps the
  textual **Center Agent → Apps → GitHub** breadcrumb and does not guess a link.
- Slack-triggered turns explicitly tell the model that Slack is the reply
  surface. The model writes concise, scannable ordinary Markdown by default
  without waiting for a formatting request; the delivery layer owns Slack
  rendering and mrkdwn conversion. The model never hand-builds Block Kit or
  exposes raw Slack identifiers as presentation. A real Slack mention is the
  narrow exception: only an exact user ID returned by a trusted OpenMeld tool
  may become `<@USER_ID>`, and only when the user asked to notify that person.
  For explicit top-level channel publication, the model passes those exact IDs
  through the posting tool's structured mention field; the tool rejects
  display-name mentions and model-authored raw mention tokens, then constructs
  the verified tokens itself.
- Scannable does not mean fixed-template. The model selects only the
  evidence-supported points that matter for this turn, uses short paragraphs or
  bullets where they improve scanning, and varies headings, order, and length
  with the content. A Routine may instruct the model to publish only meaningful
  change while preserving a fuller artifact in Organization Documents; the
  runtime does not impose a diary schema or require a Slack post.
- Every Slack message surface uses the same delivery-owned presentation and
  publication semantics. Final thread replies and explicit top-level channel
  messages use a controlled Markdown block while within Slack's block limit,
  plus a complete mrkdwn text fallback. When a long final reply also carries a
  Navigation Action, the visible blocks contain an explicitly shortened body
  block before the native button; they never contain a button with no visible
  answer body. The complete bounded fallback still includes the action link.
  Installation welcome DMs may add deterministic Block Kit actions to the same
  text fallback. A confirmed Slack block-validation rejection may retry exactly
  once without blocks. Transport failures and malformed or
  success-without-timestamp responses remain `outcome_unknown` and must not be
  reposted automatically.
- Follow-up: the role-semantic single-source module should compile to the
  local wake template and the remote system prompt. Dispatch/bootstrap
  framing legitimately differs per runtime family; only the role semantics
  are single-sourced. Until that module lands, update the local and remote
  role semantics side by side when adding or changing product tools.
- The current approved Organization Brief, when non-empty, is rendered after
  OpenMeld principles and before tool guidance. It is bounded by copy that
  identifies it as organization-maintained data and explicitly states that it
  cannot override OpenMeld system or tool safety rules. Draft content is never
  projected into the prompt. The knowledge section may list available approved
  document titles, but it does not inject their bodies.
- The Remote Agent keeps the validated Organization Brief and approved document
  titles in a 60-second, organization-keyed memory cache. Flue's materialization
  factory has no execution context, so it never starts or awaits the Core RPC
  during admission. The fiber-side factory returns a fresh cache hit immediately
  or awaits one organization-keyed, deduplicated refresh before model execution.
  A refresh failure fails explicitly instead of running with missing or stale
  organization context.
- `openmeld_read_org_documents` lists folders plus the approved document catalog
  or reads one approved body. `openmeld_draft_org_document` creates or replaces
  reviewable draft content. `openmeld_manage_org_documents` creates and renames
  folders, moves documents, and directly saves approved ordinary knowledge when
  an owner/admin request or durable Routine instruction authorizes publication.
  The management tool has no delete action, rejects direct saves over pending
  drafts, and requires a stable operation id so exact retries do not duplicate
  content. These tools call Core under represented-member authorization, write
  the Center Agent audit journal, and remain available in the shared interactive
  and Routine catalog.

### Center Agent memory (shipped 2026-07-10)

Flue's per-conversation session remains local conversational context for one
Space or Slack thread. Durable Center Agent memory is a separate OpenMeld-owned
contract in Core, with Zep Cloud behind a provider adapter:

- Core recalls the current member's organization-scoped member memory for a
  turn. When organization memory is enabled, it may also recall the shared
  organization subject.
- Completed Center Agent DM turns write only member memory. Completed shared
  Space and connected Channel turns write Organization memory while it is
  enabled. Private Center Agent DMs never automatically write Organization
  memory.
- The explicit `centerAgentRememberForOrganization` tool is designation-gated
  and fails closed while organization memory is off.
- Core projects bounded memory items into the shared turn envelope before
  worker submission. The worker and Flue session must not query Zep, infer the
  enabled state, or create a parallel memory policy.
- Core prioritizes the current request inside the bounded semantic-search
  query, fills only the remaining budget with the newest useful channel
  context, and enforces the same bound again at the provider boundary. The
  recall deadline covers semantic search plus required provenance resolution,
  not search alone.
- Each projected item identifies the episode's actual source surface and, when
  available, its occurrence time. The Remote Agent renders that provenance in
  the memory block. The current recall entry point must not replace the stored
  source, and raw source conversation/message references never enter the model
  prompt.
- Explicitly saved facts are marked as such in the bounded memory text, while
  the source still names the verified conversation surface where the user made
  the request.
- Routine turns do not expose explicit organization-memory save. Their frozen
  publication destination is not the original authorizing conversation, so
  Core fails closed instead of guessing a source if that tool is nevertheless
  invoked through a stale or envelope-less catalog.
- When a turn already carries bounded channel context, Core may include those
  snippets in the recall query so short continuation requests can find relevant
  durable memory from another entry point. Provider history remains a transient
  recall hint and is not stored as memory unless the separate memory policy and
  write path allow it.

Product policy lives in
`developing/product/organizations-and-center-agent.md`; data and provider
ownership live in `developing/architecture/data-and-observability.md`; shared
HTTP and turn-envelope schemas live in
`developing/architecture/shared-contracts.md`.

### Prompt-injection posture (updated for the tier model)

Every member message is untrusted input to an always-on principal. The
posture, in force from day one:

- The model-visible tool surface is limited to vetted Flue capabilities plus
  the Tier-3 Core-backed OpenMeld product tools listed above.
- Anything outside the vetting bar is forbidden at any tier; widening the
  bar or the tier requires Felix.
- Any higher-risk destructive action exposed to an interactive turn must use
  its explicit action-specific confirmation, attribution, audit, and Core
  authorization contract. Routine instructions authorize ordinary safe actions
  only. They never authorize destructive actions; a Routine delete or merge
  returns `routine_destructive_action_unsupported` with zero side effects.
  Unattended execution alone is not a
  reason to hide an otherwise approved tool or substitute shared-only identity;
  only the explicit capability-owner catalog exceptions above may remove one.
- Attribution ("on behalf of X") on every delegated action, audit on every
  privileged action, and runtime policy containment — unchanged.

### Product surfaces

- **Entry point**: the Center Agent page (all contexts — personal too). The
  connection path is hosted-only today: **"Remote Agent · Experimental"**.
  Local-agent-backed and bring-your-own Center Agent runtime choices are future
  redesign items, not current UI.
- The remote runtime option is controlled by a global kill switch and an
  optional per-org block list. When the global switch is on and an organization
  is not blocked, the option is available to that organization.
- The "Remote Agent · Experimental" label appears wherever the runtime is
  shown, until Felix removes the experimental marker.
- Runtime changes must preserve the same managed Center Agent identity:
  identity, history, memberships, authorization meaning, and audit continuity
  stay attached to the designation.
- CLI: `openmeld center-agent` status surfaces show the remote runtime
  read-only in MVP; managing the switch from CLI is post-MVP.
- Routine Web, CLI, and interactive Center Agent surfaces are owned by
  `developing/product/center-agent-routines.md`; this document owns only their
  Remote Agent execution and tool-runtime boundary.
- Task Chat, board, detail, compact-window, and Inbox semantics are owned by
  `developing/product/center-agent-tasks.md`; this document owns the Task turn's
  Remote Agent session, native execution, callback, cancellation, and provider
  publication boundary.

## Expansion Path

One former expansion item is now landed: Center Agent Routines provide
organization-owned one-time or recurring work, explicit Space or durable Slack
thread destinations, Core scheduling, and unattended Remote Agent native
delivery with ordinary Center Agent capability inheritance. They are not a Flue-private
scheduled-task registry. Their product contract lives in
`developing/product/center-agent-routines.md`.

Remaining expansion still requires its own design and ticket pass:

1. **Remaining OpenMeld concierge tools** — email invitations, invite-link
   reset/revocation, member access changes, broader org administration,
   explicit approvals, and the single-source role module.
2. **Additional connectors** — external integrations wired per organization.
3. **Deep customization** — per-organization instructions and configuration, toward
   a general-purpose Remote Agent each org shapes into its own hub.
4. **Durable Code Mode runtime and progressive tool discovery** — history,
   snippets, search/describe, approval replay, and durable state require an
   explicit product contract before they can become another lifecycle beside
   Flue conversation state and Core-owned confirmation.

The current platform provides the Binding-kind routing
seam, per-conversation agent sessions, the single-result-surface reply rule,
ledger observability, usage diagnostics, Space reply streaming, member and
default-on Organization memory, the designation-attached privilege model, and the
Core-owned Routine path. Expansion adds capability on top of these; it must not
create parallel authorities or rework workstation RuntimeCoordinator semantics.

## Red Lines

- Workstation runtimes (local, R0, R2) always run the full wake lifecycle;
  native delivery exists for the OpenMeld-operated Remote Agent only and
  is not a precedent for bypassing RuntimeCoordinator elsewhere.
- The Binding kind alone selects the delivery path — no dual handling of
  one trigger and no cross-path fallback. Ordinary source conversations retain
  one user-visible result surface. A first-class Task retains one canonical
  result event and at most one native publication operation; authorized Web
  projection of that event does not create another writer. The dispatch planner owns trigger semantics and is not changed
  for R1 runtime selection. Routine Runs are a distinct Core scheduled
  admission into the same native runtime, not a workstation trigger or a
  dispatch-planner fallback.
- Every remote execution path is a Binding with per-`(org, binding)`
  fail-closed authorization — no authorization bypass for the Remote Agent.
- Failure and degraded states are always explicit on the selected result
  surface; a member-authored trigger never silently disappears.
- Callback authentication is mandatory: service binding identity is not enough.
  Core must verify `submissionId`/`idempotencyKey` against a Core-originated,
  incomplete submission before accepting a worker reply.
- Stream deltas and terminal frames are transient projections, never a second
  result writer or durable final outcome. The selected result surface must still
  receive one durable reply, stopped outcome, or explicit failure.
- Core owns memory scope, policy, subject identity, and the bounded turn-envelope
  projection. The worker, Flue, and Zep adapter must not derive or override them.
- The model-visible tool surface is vetted Flue capabilities plus the listed
  Core-backed OpenMeld product tools; no host shell, no host filesystem, no
  OpenMeld secrets at any tier; widening the vetting bar or the tool tier
  requires Felix.
- Routines are user-visible and must follow
  `developing/product/center-agent-routines.md`: D1 plus Core Cron owns timing,
  the destination is explicit, each Run has one initial native delivery and may
  have one resumed Center Agent delivery after its own all-terminal delegated
  work, `routine_runs.native_delivery_id` owns the final result, skipped Runs
  have no delivery or result, and Agents SDK/Flue alarms remain callback-only.
- Headless worker integration only: the worker exposes no browser chat protocol
  or public channel webhook. Slack is the first supported external signal and
  enters through Gateway verification plus Core identity mapping before native
  delivery. Flue is consumed at a pinned exact version through its documented
  public surface.
- R2 stays frozen: no container hosting, no BYO API keys, no third-party
  agent connectors — only the `agentControllerRef` kind space stays open.
  The Center Agent's computer (a durable workspace behind execution tools) and
  any per-call execution surfaces are tools of the hosted Center Agent
  runtime, not hosted workstations for arbitrary Agent Profiles, and do not
  unfreeze R2.
- The remote runtime option remains behind a global kill switch, with an
  optional per-org block list for emergency containment.
- One Center Agent per org; designation semantics untouched (org doc owns
  them).
