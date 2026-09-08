# Data And Observability

## Agent Context

- Purpose: Define durable data ownership, projections, correlation keys, trace
  contracts, Opportunity, Center Agent Routine and memory storage boundaries,
  diagnostic reports, weekly evaluation reports, Cloudflare runtime evidence,
  and sensitive-data boundaries.
- Read this when: You are changing D1 ownership, projections, database writer
  rules, Opportunity, Routine or Run storage, Center Agent memory storage, Wake trace
  selectors, `clientMessageId`, weekly evaluation reports, Cloudflare runtime
  evidence, diagnostic reports, structured logs, or observability payload
  schemas.
- Update this when: Data ownership, Opportunity storage, trace correlation,
  diagnostic read paths, memory/provider ownership, runtime evidence projection, evaluation or
  Diagnostic Report ownership, or sensitive-data logging rules change.
- Do not use this for: Product object semantics, local service lifecycle, client
  presentation details, SQL tutorials, Cloudflare operations runbooks, endpoint
  implementation, schema field catalogs, or temporary investigation logs.
- Source of truth: This file owns the durable architecture boundary for data
  ownership and observability.

## Space message previews and slow Web experiences

Space owns message preview truth. Message publication and retention capture a
bounded text preview and a monotonically increasing Space-local revision into
the existing durable Space index outbox. Core projects this into
`space_index_spaces`; delayed retries cannot overwrite a newer revision.
AccountSpaces attaches previews only to its already-authorized result set, in
bounded D1 batches, when `includeMessagePreviews=true`. Older strict clients
receive the unchanged shape. A null preview means no retained text message;
an omitted preview has not been projected. Existing Spaces are repaired ten at
a time after the minute scheduler's delivery work, with delayed retries.
Space SQL schema v33 creates the preview revision table for existing v32
Spaces before message publication or backfill. Fresh-table initialization alone
does not upgrade a Space that already has the previous migration marker.

Web reports threshold-crossing experiences to its same-origin
`/v1/observability/performance` receiver. Search Worker logs for
`web.openmeld.slow_experience`. Reports contain build identity, an ephemeral
page-session ID, route templates, navigation lifecycle duration, request-category
counts/durations and long-task summaries. They exclude message text, profile
identity, concrete URLs, query strings, and resource names. They do not prove
that independently fetched conversation content has finished rendering.

Tune `clients/web/src/lib/observability/performance-policy.ts`: navigation
defaults to 1500 ms, interactions to 250 ms, and reporting to twenty events per
page session per hour. A pending navigation produces an observation after at
least five seconds. Hidden-page navigation is excluded. Policy changes ship
with Web; existing clients refresh policy on navigation after five minutes.
The receiver validates payload size/shape and applies the current threshold
and a best-effort per-isolate volume cap. These diagnostics are sampled failure
evidence, not a complete traffic or latency distribution. Worker log retention
governs how far back an investigation can look.

## Boundary

OpenMeld data and observability exist to support the main product chain:

```text
Space Wake -> RuntimeCoordinator -> local OpenMeld Service -> local agent -> Space reply or explicit failure
```

This document answers two architecture questions:

```text
Who owns each durable fact?
How can one real user action be diagnosed without guessing?
```

It does not make observability a second execution system. It does not make a
projection a source of truth. It does not make logs, traces, timestamps, or
message text the only way to understand what happened.

## Data Ownership Rule

Every persistent state needs one authority owner.

Before adding or changing a table, database, projection, Durable Object state, or
diagnostic event, the owning design must answer:

- who owns the truth
- who may write it
- who may read it
- whether it is source of truth or projection
- how it can be rebuilt, or why it cannot be rebuilt

If those answers are unclear, do not add the storage surface yet.

One physical storage binding can temporarily contain multiple domains. That does
not create shared ownership. Logical ownership still decides who may write facts,
who may project them, and who must repair them.

Auth owns Organization membership removal. Its `beforeRemoveMember` guard may
perform one read-only join from the Core-owned `center_agent_designations` row to
the designated managed profile's owner in the shared D1 database. This bounded
referential read exists only to prevent removal of the Center Agent execution
host and must fail closed. It gives Auth no write authority over Center Agent or
Agent Profile state; Core remains the only owner and writer of those facts.

## Durable Data Domains

The Space execution-input outbox owns reliable forwarding of already-authorized
human corrections to one native Center Agent execution. The Space is its only
writer. It atomically retains the human Signal and exact request, including
the original Signal ID for idempotent retries. It cannot rebuild an unsent
request from a chat summary or retarget it to the next execution. Its runtime
receipt is a projection, not execution truth. The Remote Agent intake owns
durable receipt; Flue owns canonical conversation application and acknowledges
it only after the input is recorded there. Core retries pending forwarding
through the existing Space alarm and retains terminal receipts for replay.
Deleting the Space removes its input outbox with the rest of Space data.

OpenMeld separates durable truth from query projections.

Agent Profile Work Coordinator state lives in the existing owner-sharded
RuntimeTransportHub Durable Object. Each Profile has one current record with
the running lifecycle id, at most 50 ordered waiting lifecycle ids, and only the
minimum pending-promotion or recovery-hold metadata. It is current scheduling
state, not an append-only history. Complete prompts, attachments, and Space
context remain in the Space durable outbox; durable execution and final-outcome
evidence remain in the existing RuntimeCoordinator and Dispatch Ledger domains.

D1 may project `profile_queue_waiting`, queue counts, and correlation ids for
queries and diagnostics. Those rows never promote work, reconstruct a Wake
payload, or decide execution. Durable evidence useful for one collaboration's
audit or trace follows the existing retention policy. Current coordinator
snapshots, inactive admission rows, and execution head references are removed
when they no longer own active work, recovery, promotion, or pending
publication. Final publication records may keep their exact lifecycle record
for idempotent replay, but they are removed from the historical lifecycle
index. A completed execution head may be deleted only after its deterministic
terminal execution-token authority can reject the same head and dispatch on
replay; the D1 Dispatch Ledger remains audit evidence, never replay authority.
D1 retains the existing 30-day Wake evidence used for audit and trace.
Forward cleanup uses exact keys in the terminal transaction; old inactive rows
are removed only by the existing 128-row index-repair pages. Neither path scans
the owner shard or adds work to new-Wake admission.

Queued-work recovery Inbox projection uses a current intent in the same owner
shard. Creating or replacing the intent schedules the shared Durable Object
alarm. Housekeeping reads at most eight pending intents per run; Profile state
and Operational Context reads never fan out into Inbox writes. After the
idempotent D1 Inbox write succeeds, one Durable Object transaction verifies the
same intent, interrupted head, and admission state. Resolving an item deletes
the intent and retires the exact current head and lifecycle-index reference in
that transaction. A projection failure records one bounded attempt on the
current intent. After three failed attempts, housekeeping preserves diagnostics,
moves that intent to a parked retry lane, and continues later intents so one
broken Profile cannot starve the owner shard. Parked keys are ordered by their
next retry time, so housekeeping still reads only the next fixed batch and
retries each failed intent no more often than once per minute. A later
successful retry still creates or resolves the idempotent Inbox item and, for
resolution, retires the exact old head and lifecycle-index reference; the intent
is never discarded merely because a dependency failed three times. This uses no
cron, owner-shard scan, or Wake hot-path work.

Conversation occupancy in D1 is a compact current-state projection keyed by the
exact execution and state, not an append-only event history. Repeated
recovery keepalives upsert the current `occupied` or `available` value so
reconnect can self-heal while retaining only the evidence needed for trace and
reconciliation.

The long-term data domains are:

Auth also owns the account's last-selected Organization entry preference. Auth
is its only writer and accepts a selection only while the account has a current
membership in that Organization.

Auth also owns `account_sidebar_preferences`, keyed by account user ID and
Organization ID. It stores personal group names, opaque Space IDs, section sort
modes, and manual ordering. Membership gates reads and writes; revision-checked
updates reject stale devices instead of overwriting newer preferences. These
preferences never grant Space access, write pins, or change Space membership.
The Web renders only Spaces returned by the existing authorized Space Index.
Deleting a personal group removes its presentation association only.

| Domain                             | Product role                                                                                                                                                                                        | Ownership rule                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                               | Authentication and session truth.                                                                                                                                                                   | Auth-owned source of truth.                                                                                                                                                                                                                                                                                                                                            |
| Profile                            | OpenMeld profile product semantics.                                                                                                                                                                 | Profile-owned source of truth.                                                                                                                                                                                                                                                                                                                                         |
| Runtime                            | Runtime registry and agent controller reports.                                                                                                                                                      | Runtime-owned source of truth.                                                                                                                                                                                                                                                                                                                                         |
| Dispatch Ledger                    | Wake execution ledger and query projection.                                                                                                                                                         | Records RuntimeCoordinator decisions; not execution authority.                                                                                                                                                                                                                                                                                                         |
| Center Agent Tasks                 | Organization-scoped canonical requester-private Tasks, immutable requester and origin provenance, product event streams, lifecycle, native-delivery attempt links, and authorized read projections. | Core-owned D1 source of truth and sole product writer. Remote Agent owns the isolated runtime conversation; native delivery, Message Channel, and Inbox owners retain their existing truth. Task freezes the verified requester snapshot and bounded carrier attribution from its parent delivery, then links and projects those facts without replacing their owners. |
| Agent Task Coordination            | Durable exact-task subscriptions, delegation topology, and observed terminal outcomes used to continue work across Agent executions.                                                                | Core owns coordination state only; RuntimeCoordinator, native delivery, and controller-native task owners remain execution authority.                                                                                                                                                                                                                                  |
| Agent Activity                     | Organization-scoped Project definitions, immutable safe activity evidence, current-session projections, digests, and daily aggregates.                                                              | Core-owned D1 source of truth; local provider files and the OpenMeld Service outbox are observation and delivery inputs, not Organization truth.                                                                                                                                                                                                                       |
| Agent Profile Creation Requests    | Organization-scoped coordination for creating an Agent Profile owned by the requester or another member, including immutable origin, Session strategy, approval progress, and completion linkage.   | Core-owned D1 request and per-member approval-preference truth. Auth owns the final Agent Profile identity write; Agent Activity owns authorized Session observation; Inbox is only the target owner's attention projection; Space and Binding owners retain membership and execution authority.                                                                       |
| Organization Member Activity       | Latest accepted Human-authored activity used by the People directory.                                                                                                                               | Core owns one monotonic `(organizationId, userId)` projection tied to the current Human Profile. Only an accepted, persisted Human text Signal or an authenticated Web activity write advances it; CLI use, Computer heartbeats, login/session refresh, presence, and Agent Activity never write it.                                                                   |
| Center Agent Routines              | Organization-owned Routine definitions, immutable creation attribution, and durable Run history.                                                                                                    | Core-owned D1 source of truth; each new definition freezes its verified represented-human display name and optional bounded Local Agent carrier, while `nextDueAt` and Run native-delivery linkage remain projections rather than parallel schedulers.                                                                                                                 |
| Center Agent Model Preference      | Organization choice between the OpenMeld default and one explicit hosted model.                                                                                                                     | The Core-owned hosted Binding's nullable model id and configuration revision are the only durable preference; the repo-owned catalog defines defaults and runtime policy, while each native-delivery request freezes execution-time truth.                                                                                                                             |
| Organization Working Language      | Optional Organization-wide advisory for Center Agent and Local Agent language judgment.                                                                                                             | Core owns the optional `automatic` or `selected` D1 record, revision, represented-member authorization, conditional trusted observation, and audit. Remote Agent turns and compatible workstation dispatches receive a frozen optional projection; messages, prompts, Channels, clients, and Local Services never become parallel preference stores.                   |
| Organization Skills                | Organization-owned portable Skill identities, permissions, immutable releases, provenance, and activation evidence.                                                                                 | Core owns D1 metadata and private immutable R2 release bytes; Flue is the hosted model-visible runtime, while Web, CLI, Remote Agent, and local agents consume Core-authorized exact-release projections.                                                                                                                                                              |
| Center Agent Memory                | Member- and organization-scoped semantic memory.                                                                                                                                                    | Core owns policy, subject identity, and lifecycle; Zep Cloud stores semantic content behind Core's adapter.                                                                                                                                                                                                                                                            |
| Center Agent Context Manifests     | Auditable records of bounded requester-private context supplied to a Local Agent.                                                                                                                   | Space Signals remain canonical message truth. Core stores only request metadata, budget outcome, cursor, source refs and hashes, plus the linked Audit Log row; it never copies message bodies into D1.                                                                                                                                                                |
| Center Agent Context Load Receipts | Immutable reports of the exact manifest entries a Local Agent added to its working context.                                                                                                         | Core reauthorizes the represented member and verifies the manifest client, source refs, and materialized hashes. The receipt and linked Audit Log row contain no message bodies or local session locator and never claim model reliance.                                                                                                                               |
| Center Agent Attention Requests    | Explicit response requests from one active hosted Center Agent native delivery to its verified represented member.                                                                                  | Core owns request creation and resolution in D1. The native-delivery ledger proves the source turn; Inbox is only the recipient/read/dismiss/delivery projection, and RuntimeCoordinator has no role.                                                                                                                                                                  |
| Information Protection             | Built-in disclosure guidance plus bounded Organization classification hints.                                                                                                                        | `packages/agent-runtime` owns built-in prompt semantics; Core D1 owns the optional Organization policy and owner/admin read/write authority.                                                                                                                                                                                                                           |
| Connector Connections              | Organization- and member-scoped external account registrations.                                                                                                                                     | Core owns non-secret ownership and status; OpenConnector owns credentials and action execution.                                                                                                                                                                                                                                                                        |
| Connector App Requests             | Member-attributed demand for Apps that OpenMeld cannot connect yet.                                                                                                                                 | Core owns the Organization-scoped request ledger and stable requester attribution; the catalog and future requester notifications are read and delivery projections, not request truth.                                                                                                                                                                                |
| Connector Action Operations        | Recoverable generic App action attempts and final outcomes.                                                                                                                                         | Core owns the non-secret operation ledger; OpenConnector owns provider execution and durable result replay.                                                                                                                                                                                                                                                            |
| Evaluation Reports                 | Settled Organization quality snapshots for human review.                                                                                                                                            | Core owns the immutable weekly snapshot; RuntimeCoordinator, Space, and Space Index facts remain inputs and retain their normal authority.                                                                                                                                                                                                                             |
| Diagnostics                        | User-submitted Diagnostic Report events.                                                                                                                                                            | Diagnostics-owned source of truth for the report event.                                                                                                                                                                                                                                                                                                                |
| Space Attachments                  | Private image bytes and their authorization metadata.                                                                                                                                               | Core owns D1 metadata; Gateway owns writes and authenticated user byte transfer; the Remote Agent worker is a read-only internal consumer for Core-authorized native delivery; Space DO membership remains the access truth.                                                                                                                                           |
| Organization Logos                 | Organization identity image reference and public versioned bytes.                                                                                                                                   | Auth owns the canonical `organizations.logo` reference and owner-only mutation decision; Gateway owns image validation, Cloudflare Images transformation, and R2 object lifecycle. Personal workspaces have no Organization logo mutation path.                                                                                                                        |
| Feedback                           | Organization-scoped Feedback Inboxes, submitted Feedback Issues, and Center Agent reporting policy.                                                                                                 | Core owns runtime writes; the guarded admin ensure command provisions inboxes.                                                                                                                                                                                                                                                                                         |
| Opportunities                      | Member-private, Organization-scoped evidence-backed recommendations and their current decision.                                                                                                     | Core-owned D1 source of truth and sole writer. Source domains own cited facts; Inbox is only a recipient attention projection; downstream capabilities own execution and authorization.                                                                                                                                                                                |
| Inbox                              | Member-private, workspace-scoped attention items, per-Space read-through watermarks, read state, delivery preferences, and notification delivery attempts.                                          | Core owns item, watermark, state, preference, and delivery-ledger writes in D1. Source domains remain authoritative for represented work. Auth owns account email identity and performs Cloudflare Email Service sends through a strict internal RPC.                                                                                                                  |
| Space Index                        | Cross-Space list projection.                                                                                                                                                                        | Rebuildable projection from Space truth.                                                                                                                                                                                                                                                                                                                               |
| Ephemeral                          | Short-lived handoff/session state.                                                                                                                                                                  | Temporary state, not a permanent domain.                                                                                                                                                                                                                                                                                                                               |
| Space Truth                        | Space collaboration truth.                                                                                                                                                                          | Space Durable Object source of truth.                                                                                                                                                                                                                                                                                                                                  |

Agent Profile Creation Requests keep the approval/update time, execution attempt
number, and optional start time on the Core-owned request row. Recovery covers
both an approval abandoned before claim and a claimed execution abandoned
before its terminal write. Compare-and-swap claims and terminal writes make that
row the single execution coordinator for request retries. The same row also
carries a generation-fenced durable Inbox projection intent. Core repairs
missing or stale intent left by mixed-version writers and redrives the
idempotent Inbox projection; this operational state is not a second request or
Inbox authority.

Start is orchestration. It is not a permanent data owner and must not become a
long-term database domain.

## Center Agent Context Manifest Data Boundary

`center_agent_context_manifests` is a Core-owned interaction ledger, not a
transcript or context store. One row records the authenticated Human Profile,
designated Center Agent, exact Direct Message Space, Local Agent client label,
schema/view version, requested and estimated token counts, truncation outcome,
continuation cursor, and the exact Signal source refs and hashes returned. It
does not store message text, attachments, Local Agent session ids, system
prompts, hidden reasoning, memory contents, credentials, or provider runtime
payloads. `center_agent_context_manifest_materializations` stores the exact
source ref, materialized-content hash, and estimated token count for each
returned entry so a later receipt can be verified without copying the text.

Space Durable Object Signals remain canonical and access-controlled message
truth. Core reauthorizes the current Organization membership and derives the
exact member-Center Agent Direct Message on every request; caller-supplied
cursor and source metadata cannot select another conversation. Core writes the
manifest, materialization projection, and `read_center_agent_context` Audit Log
row in one D1 batch. The
audit response may join the sanitized Local Agent client label for user
visibility, but never exposes a private thread or session locator.

`center_agent_context_load_receipts` permits one immutable receipt per manifest.
Every write rechecks current Organization membership and requester ownership,
requires the same Local Agent client, and verifies an all-or-explicit-subset
selection against the stored materializations. The receipt and
`load_center_agent_context` Audit Log row are written in one D1 batch. An exact
retry returns the existing receipt; a conflicting retry requires a fresh
manifest. A pre-receipt manifest without materializations cannot be promoted
into false load evidence.

The per-turn Center Agent Context Scope Plan is not stored in the Context
Manifest table. It travels with the exact Core-owned native-delivery worker
request and callback context already used for deterministic recovery. That
preserves the plan alongside the turn it governed without creating a second
transcript, memory record, authorization table, or user-content copy. Structured
runtime evidence may report the plan version, requester class, result audience,
and handling categories, but never the underlying memory or document bodies.

## Agent Activity Data Boundary

`projects` is the Organization-scoped Project definition truth.
`agent_activity_events` is immutable, idempotent level-zero evidence and uses
an Organization-scoped event-id fence. `agent_activity_sessions` is the
replaceable current-session projection derived atomically from accepted
events. `agent_activity_digests` and `agent_activity_daily_aggregates` are
bounded read models; neither can claim work ownership, completion, Wake
readiness, or execution state. Core is the only cloud writer for all five.
Snapshot and daily-aggregate reads may project one Project inside the already
authorized Organization; this is a read filter, not a second Project authority
or permission path.

Raw provider session ids remain private ingestion keys. Public snapshots use a
separate opaque session id and never return provider session ids, local paths,
device ids, OpenMeld Service runtime ids, prompts, responses, transcripts,
tools, commands, file contents, or arbitrary provider objects. Local observer
files and the mode-0600 outbox are delivery evidence only and cannot authorize
an Organization, member, Project, or runtime.

Raw events expire after 14 days. Scheduled retention aggregates the exact
event and session counts before bounded deletion; a session split across
cleanup batches is counted once for each UTC day. Digests expire independently
after 90 days. A failed or interrupted digest remains explicit evidence and
cannot replace the latest completed summary.

Current-session retention is anchored to `last_observed_at_ms`, not a
client-supplied presence expiry. `expires_at_ms` controls whether presence may
be shown as active; it cannot extend the 14-day storage window after the last
accepted observation.

## Center Agent Project Operation Data Boundary

`projects` remains the only Project definition truth. Center Agent automation
does not create a second Project registry. It calls the same Core Project
service and authority boundary as human clients after Core revalidates both the
designated Center Agent and represented member.

`center_agent_project_operations` is a durable idempotency and recovery ledger,
not Project state. Its uniqueness scope is Organization, designated Center
Agent profile, represented user, operation kind, and model-supplied operation
ID. The stored request signature prevents one operation ID from being reused
for different input. A completed row stores the bounded shared response so an
exact retry can return `replayed` without repeating the user-visible mutation.
A pending row remains explicit recovery evidence; it cannot be interpreted as
a completed Project change.

`center_agent_project_remove_confirmations` stores only the SHA-256 hash of the
opaque confirmation token. The row binds the confirmation to Organization,
designated Center Agent, represented user and Human Profile, Project, Project
version, preparation request, and expiration. Consumption is bound to one
operation ID. The raw token exists only in the preparation response and must
not enter logs, audit rows, Center Agent memory, Organization documents, or
durable instruction evidence or public replies. Remote Agent may retain the raw
token only inside the private conversation tool state needed to consume it
after the member's later interactive confirmation. Routine Project removal is
unsupported, so no Routine target projection or confirmation state is created.
Core remains the sole confirmation writer and consumer.

Successful Project reads, mutations, and removal preparation append
`center_agent_audit_journal` rows attributed to the designated Center Agent
acting on behalf of the represented member. Mutation completion and its audit
row use one D1 batch after the canonical Project service succeeds. Failed or
unauthorized attempts do not claim a successful audit action; the durable
operation ledger preserves ambiguous pending recovery evidence.

## Center Agent Publication Operation Data Boundary

`center_agent_publication_operations` is Core's durable idempotency and
recovery ledger for explicit model-invoked external publications. It is not
Routine state, Message Channel history, Organization document state, or a
provider message mirror. The current destination kind is `slack_channel`; a
future destination must define equally explicit provider outcome semantics
before sharing this ledger contract.

The unique scope binds the Organization, designated Center Agent, resolved
provider destination, a Core-verified source identity, and one normalized
operation key. For Slack, the
destination id is the resolved channel id for a top-level publication or the
resolved channel id plus exact root message timestamp for a thread publication;
both retain destination kind `slack_channel`. A current
interactive turn becomes its trusted Remote Agent execution id only after Core
revalidates the active native-delivery provenance and excludes Routine-owned
deliveries. A Routine turn
becomes the Run id verified against native delivery, and an Organization
document becomes its id plus a revision digest of the approved title, kind, and
content. The model can select the current turn or an exact document, but it
cannot supply the internal execution or Run identity. An interactive
current-turn message may supply one bounded stable `operationId`; Core scopes
it under the verified execution as the operation key. Different IDs represent
distinct ordered effects, while reuse of one ID is reserved for an exact retry.
Older callers, Routine Runs, approved documents, and file publications use the
source-owned `source` operation key. The request signature also binds the
represented user and final message text without storing that text. Reusing one
operation key for changed content or representation fails closed.

The first caller receives a bounded `pending` claim lease before provider
publication. All local message presentation must finish before the action audit
and before the provider publisher begins; the provider publisher accepts the
prepared presentation and must not hide another fallible presentation step
inside the ambiguous write boundary. A local preparation failure therefore
records `failed`, creates no action audit, and may reclaim the same source. A
`completed` row stores only the bounded shared response needed to replay the
exact result without another provider call. A provider-confirmed
non-publication records `failed` and may reclaim the same source. A
transport-ambiguous provider outcome or a failure after provider success records
`outcome_unknown` and must not be automatically reposted. An expired `pending`
claim also closes to `outcome_unknown`; expiry never proves that the provider
write did not happen. Claim-fenced completion prevents a stale caller from
overwriting a newer retry. Failure telemetry records the operation identity,
destination identity, source identity, phase, bounded error identity, and
classified outcome without message text or credentials. The action audit is
written only by a new claim holder after local presentation succeeds, so a
preparation failure or exact completed replay does not create a misleading
audit row.

## Connector Connection Data Boundary

The `connector_app_requests` D1 table is Core's internal demand ledger for Apps
that a member asks OpenMeld to support. A request is scoped by Organization,
requesting user, and a normalized provider key so a repeated request updates the
same fact instead of inflating demand. It preserves both stable user and member
identity for a future notification backfill, the OpenConnector provider id when
known, display name, bounded requested capabilities, optional use case, catalog
or freeform source, lifecycle status, and notification timestamps. It stores no
provider credentials. Web supplies the requested App and use case; Core derives
requester identity from the verified active Organization membership.

The `connector_connections` D1 table is Core's non-secret ownership truth for
external connections. It stores Organization id, member or shared scope,
authorizing user id, service, OpenConnector-safe connection name, status, and
timestamps; it stores no OAuth credential or runtime token. For member scope,
the user id is the access owner and records who authorized the connection. For
shared scope, the Organization owns access while the user id preserves the
authorizer for ownership and audit. Provider execution identity is a
provider-owned authentication fact and must not be inferred from either Core
ownership field. For example, Notion OAuth actions authenticate as the Notion
integration bot rather than impersonating the authorizing member; OpenMeld must
not present that provider activity as human-authored. A successful complete
OpenConnector connection-list response is executor evidence for that service
inventory. A matching registered name may promote from pending to active. When
a registered active name is absent from the response, it must become ineligible
for selection until executor evidence confirms it again. A failed list request
is not an empty inventory and must preserve the failure instead of rewriting
status. Executor evidence cannot register a legacy or otherwise unowned
connection.

Provider authentication mechanisms remain OpenConnector-owned credential
detail and do not become a parallel Core connection kind. The Figma transition
from PAT entry to public OAuth therefore changes how a new executor credential
is authorized without adding an auth-type field or rewriting active Core rows.
Existing PAT-backed registrations remain eligible while OpenConnector still
confirms their named credential; new and replacement registrations converge on
the same member/shared ownership projection after OAuth completes. The executor's
granted-scope set remains the action-eligibility truth: public Figma OAuth
credentials omit `projects:read` and `project_metadata:read`, so project actions
are absent for those connections, while an active legacy PAT registration may
continue to expose them until it is disconnected.

The `github_app_installation_states` D1 table is the short-lived Core-owned
handshake ledger for Organization GitHub App setup. It stores only a digest of
the single-use state, Organization, installing user, Center Agent profile,
target and temporary verifier connection names, installation id, bounded
`installing | verifying | completed` status, and timestamps. The raw state
expires after ten minutes and is never persisted. Replacing setup consumes any
earlier in-progress state for the same Organization and user. This table stores
no GitHub App private key, OAuth client secret, user access token, or
installation access token. OpenConnector owns the App private key and mints
short-lived installation tokens only at provider execution time.

`center_agent_connector_action_operations` is Core's durable idempotency and
recovery ledger for generic App actions. The unique scope binds Organization,
designated Center Agent, one canonical requester-attribution source, and the
model-supplied operation ID. A linked member uses represented user identity. A
connected Message Channel member uses the exact source native-delivery id and
its frozen provider identity; the operation never fabricates a represented
user.
The request signature additionally binds the selected connection, service,
action, and action input without storing raw input. The first claim freezes the
connection name, service, scope, owner user id, owner display name, and
requester attribution. Core atomically records the
`pending` claim with the attempted audit row, and atomically records each
terminal or reconciled outcome with its audit row. An exact retry reuses the
same operation ID. It reads the existing operation metadata before consulting
current membership, connection availability, or provider catalog state, then
rebuilds and verifies the same request signature with the frozen connection
before provider replay. Replay attribution and logs come from that frozen
non-secret snapshot rather than current Organization membership or connection
state. Rows created before the snapshot rollout retain `null` snapshot fields
and may expose only the already-frozen connection name and service. Only a new
claim reauthorizes the current member or connected Message Channel delivery and
connection. A mismatched retry fails closed.

D1 migration `0096_lovely_roland_deschain` backfills existing
represented-member operations with a `user:{id}` requester-attribution key and
adds the mutually exclusive `delivery:{id}` form for connected Message Channel
requests. It does not reinterpret an existing operation as
provider-attributed.

OpenConnector receives that operation ID as its idempotency key and owns the
provider execution ID plus durable result replay. Every successful provider
response carries the exact output schema that describes its data, and
OpenConnector persists and replays both together. Core stores only the provider
execution ID and `pending`, `completed`, `failed`, or `outcome_unknown` status;
it does not copy provider output, its output schema, credentials, or action
input. A later provider replay may reconcile `outcome_unknown` to `completed`
or `failed`. Audit history may therefore show the earlier uncertainty and later
confirmed outcome while the operation row remains the current read truth.

Organization membership and connection-owner display remain Auth-owned inputs.
Connector code must consume them through the centralized Organization
membership boundary or another explicit owner projection; it must not create a
connector-local membership or identity decision by reading Auth private tables.
The Organization Directory follows the same rule: Auth owns member, account,
default Human Profile, and Organization-scoped Agent Profile identity
projections. Core owns Center Agent designation, readiness overlay, and the
optional Organization Member Activity overlay. Core does not expand the
Directory with cross-Organization authorization records.
Core may expose that same owned data through a stable Profile Directory and a
dynamic Agent Runtime Overview so a slow runtime read cannot withhold member or
Agent identity. These are separate read projections, not separate truth:
Profile Directory does not call Runtime Transport, and Runtime Overview batches
route, owner-Service, and display-inventory reads by owner before applying the
same permission-scoped readiness projection used by the compatibility
Directory.
Core records the activity overlay only after Space accepts and persists a text
Signal from an active Human Profile or after an authenticated Web request proves
the active Organization member and that member's current active Human Profile.
Both paths advance the projection monotonically. Web reports the explicit
source as `web`; CLI use, session refreshes, Computer heartbeats, and Agent
Activity do not infer or advance member activity. A successful write emits
`organization_member_activity.recorded`; missing authority inputs and write
failures emit explicit rejection or `not_recorded` / `record_failed`
diagnostics.
Directory reads emit `organization_directory.read` with the actor kind,
Organization, request id, projection flag, and result counts, without message
content or personal identifiers. Sharing one physical D1 binding does not authorize Core
to join Auth's `members`, `users`, or `openmeld_profiles` tables to reconstruct
those identity projections.
For a new connector-operation claim, a member connection freezes the display
name from the already-verified represented-human projection. A shared
connection resolves its owner through Auth's shared
`resolveUserDisplayName` RPC contract. A missing method, malformed response,
failed result, or mismatched user id fails the new claim; Core does not fall
back to its local `users` join.
The connector repository reads only `connector_connections`. Before selecting a
requester-owned connection, the RPC verifies that represented requester through
`resolveOrganizationMembershipById`. Public connection DTOs resolve the owner
display name through Auth's `resolveUserDisplayName` RPC. Selection and
presentation do not fall back to direct `members` or `users` reads.

Center Agent selection and action logs record Organization, requester,
connection owner, connection name, service, action id, requested preference,
and resolved selection mode. They must not include the Worker token, provider
credential, or action input.
Member-connection selection requires the requester and connection owner to be
the same active Organization member; a different member's row is not fallback
authority.
Dedicated GitHub tools require an explicit `requester` or `shared` preference
derived from model-visible `githubActor = requester | organization`. Core
rejects GitHub `automatic`, resolves only that exact credential form, and never
falls back. Routine and member-research boundaries reject requester selection,
so unattended GitHub work can use only the Organization installation.
Shared-connection start and disconnect mutations are owner/admin-only and write
the Center Agent audit journal in the same D1 batch as the Core registry change.

## Slack Workspace Directory Evidence Boundary

The Slack workspace directory is live provider evidence, not a new durable data
domain. Core reads one bounded `users.list` page through the
Organization-bound Slack credential and returns normalized active-human
profiles to the authorized Center Agent call. OpenMeld does not mirror or cache
the Slack roster in D1, Remote Agent storage, Center Agent memory, or
Organization documents.

Auth remains the source of truth for current OpenMeld Organization membership.
Core compares Slack email with the centralized Organization directory
projection only for the current response. An exact normalized email match is
positive directory-classification evidence; a nonmatching available email is
negative evidence for that read; a missing email is unknown. This comparison
does not create an identity link, represent the Slack sender, or grant any
member-owned authority. Names, titles, guest/admin flags, Slack user ids, and
email equality are not durable identity authority or a membership writer.

After a successful provider read and response validation, Core records only the
audited directory-read action and Slack workspace resource identifier. It does
not log the returned roster, emails, titles, matching candidates, bot token, or
cursor. Failed reads preserve their provider error context but do not write a
successful-read audit entry.

## Slack Channel Read Evidence Boundary

Slack channel listing, membership, and history are live provider evidence, not
a mirrored Slack data domain. Core may return one bounded active-channel page
with the App membership flag. A member or history read first resolves the named
channel and fails closed unless the App is already a member; reads never call
`conversations.join`, publish a message, or change provider state.

Channel members reuse the live active-human workspace profile normalization and
the same directory-only OpenMeld membership classification. Channel history is a
bounded newest-first page; Core resolves human display names when available,
preserves bounded file id, name, MIME type, size, and permalink metadata, and
labels all provider text and file metadata as untrusted. An explicit file read
uses `files.info` to prove the requested file id belongs to the exact channel or
direct-message conversation before Core follows a Slack-owned private download
URL. Core bounds the download to 5 MiB and transfers the encoded bytes only over
the private Worker RPC. Remote Agent removes the encoding before returning the
tool result and may deliberately save the bytes into the Center Agent Computer;
it never writes file bytes or content into D1, Memory, Organization Documents,
logs, or diagnostics. Neither history response nor descriptive file metadata is
written to D1, Center Agent memory, Organization documents, logs, or
diagnostics. Remote Agent retains only a short-lived submission-scoped mapping
from observed file id to its resolved conversation for the follow-up byte read.
Each successful read records only its action and Slack workspace
or internal channel/file resource identifier in the Center Agent audit journal.
Provider errors remain failures rather than empty successful results.

## Slack Real-time Search Evidence Boundary

Slack Real-time Search is bounded provider evidence inside one user-initiated
Slack Center Agent turn. Core places an encrypted event authorization in the
trusted turn envelope only after resolving the exact Organization, workspace,
verified member, OpenMeld user, Slack user, source channel, and source thread.
The plaintext action token is never a model-controlled tool argument.

The ordinary durable Center Agent is the only reasoning and answer owner. It
decides from the full request and conversation whether workspace evidence is
useful, may refine focused searches when the evidence is insufficient, receives
at most eight normalized matches per call with up to two nearby context
messages per match, and then continues the original task. Each evidence item
is limited to 2,000 characters. Search may be
followed by an invitation, document, delegation, or other authorized OpenMeld
action in the same turn. The Slack App does not need to join a public channel
for this provider search. Search infrastructure cannot directly answer or
publish.

Normalized tool results enter the current Flue conversation history because
the same Agent must reason from the evidence and recover durably. They are not
automatically promoted to Center Agent Memory, Organization Documents,
Computer files, or Profile Reports. Raw provider responses, plaintext action
tokens, and separate search-result projections are not stored in D1. Logs,
diagnostics, and audit rows contain no query or message content; a successful
provider read records only the action, represented requester, and Slack
workspace identifier.

Authorization decryption or designated-Center-Agent, Organization, workspace,
OpenMeld-member, represented-profile, or event-grant mismatch fails closed
before a Slack search request. Provider rate limits, missing permission,
expired authorization, and availability failures remain distinct model-visible
statuses. An unavailable search never becomes empty success. Strict schema
validation rejects malformed or extra provider result fields before the model
sees them. The final Slack message carries deterministic OpenMeld metadata; a
Slack retry reconciles that exact publication so a confirmed reply is never
knowingly published twice.

## Weekly Evaluation Report Data Boundary

`eval_reports` stores one first-settled metrics snapshot per Organization and
completed UTC week. The current publisher is limited to the official OpenMeld
Organization. Its inputs are RuntimeCoordinator execution projections, Space
Durable Object signal metrics, and Space Index Organization attribution. Those
inputs retain their normal owners: the report cannot finalize execution,
reclassify a Space outcome, repair the Space Index, or become a second current
status source.

The first successful aggregation freezes the weekly snapshot. A retry reads the
stored row and republishes the same metrics; later-arriving ledger facts do not
rewrite the settled report and remain available only through their owning raw
diagnostics. The report must disclose known coverage gaps instead of presenting
the snapshot as complete telemetry. The published Space signal is a human
presentation of the stored snapshot, not another report writer or source of
truth.

Publisher identity must come from an explicit Auth/Profile/Center Agent owner
projection. The current `readOfficialOrganizationEvalPublisher` implementation
instead joins private `organizations`, `users`, `openmeld_profiles`, and
`center_agent_designations` tables inside the evaluation service. This is a
known cross-owner hard read; do not extend it to more Organizations, publisher
types, or scheduled reports before replacing it with an owning contract.

## Feedback Data Boundary

Feedback is a durable data domain, not a Space signal, Diagnostic Report,
notification, or agent execution record. `openMeldFeedback_inboxes` owns the
organization-scoped destination and opaque submission key.
`openMeldFeedback_issues` owns each submitted Feedback Issue and its triage
state. `openMeldFeedback_reporting_policies` owns each organization's explicit
Center Agent preset-reporting opt-out and update attribution; no row means the
default enabled policy, while read failures fail closed. All three tables
currently share the physical `openmeld-db`; that co-location does not change
logical ownership.

The Core Feedback Issue service is the sole runtime issue writer. It resolves an
`inboxKey`, rejects missing or paused inboxes, accepts only `inbox_only`, copies
the inbox organization onto the issue, initializes status to `new`, and applies
the owner-defined forward-only status transitions atomically. The
organization projection on an issue is never caller-selected. The guarded
Feedback Inbox admin command is the only W-FB1 provisioning writer and never
writes issues. The official OpenMeld organization is ordinary tenant data and
must not be encoded as a special branch.

Feedback submission is storage-only. It must not create a Space, Wake or invoke
an agent, publish a notification, or write another result surface. Feedback
Issue list and status update operations remain Core-internal. The approved
Remote Agent service-binding methods require an explicit organization derived
from the Core-originated turn; no list or update HTTP route exists.

`summary`, `details`, and `contactEmail` are sensitive submitted content. They
must never appear in logs or error messages. Structured logs may record only
non-sensitive identity and classification fields, text lengths, and stable
reason codes. `clientContext` is the bounded shared strict object serialized as
JSON text; it is not an arbitrary observability blob. No attachment or free-form
record belongs in either the shared submission contract or this storage domain.

## Center Agent Routine And Run Data Boundary

D1 is the only durable product truth for Center Agent Routines:

- `routines` stores each organization-owned definition, its bounded structured
  unattended-action grants, and its rebuildable `nextDueAt` UTC projection.
- `routine_runs` stores durable Run records for individually claimed
  occurrences and aggregate `skipped` records for bounded overdue ranges.
- Core is the only runtime writer for both tables.
- Remote Agent Durable Object state, Flue private storage, client caches, and
  eligible-target projections are not alternate Routine or Run stores.

Free-text Routine instructions are task input, not a permission database. The
Remote Agent callback context does not copy or retain them as destructive
authorization evidence, and no executor parses their grammar, Markdown,
targets, or quoted fragments to grant delete or merge authority. Routine delete
and merge return `routine_destructive_action_unsupported` with zero side
effects. Instruction text must not enter logs, analytics, Center Agent memory,
Organization documents, or model-visible authorization metadata. Ordinary
Routine actions still use the reauthorized delegated member plus each
capability's existing ownership, permission, audit, and idempotency contracts.
Capabilities that require an unattended grant read the structured
`authorized_actions_json` field through the canonical Routine repository; they
must not infer authority from instruction text or a client-side projection.
The Self-Evolution Slack report is one such capability: the worker may propose
it only when the frozen Routine turn carries
`slack.publish_channel_report`, and Core independently resolves the current Run
back to the canonical Routine and verifies that same stored grant before
claiming or calling Slack.

The occurrence fence is `UNIQUE(routineId, scheduledFor)`. Claiming a Run and
advancing `nextDueAt` are one D1 atomic operation. A recurring claim advances
to the next occurrence. A one-time claim atomically sets the Routine to
`completed` with `nextDueAt = null`, so later scans cannot create another Run.
Pausing sets `nextDueAt` to `null`; resuming rebuilds it from the definition and
a new future reference time. Deleting a Routine removes its definition but
retains its Run history.

Ordinary timestamps are nonnegative. Run and `lastRun` `scheduledFor`, together
with the Runs `beforeScheduledFor` cursor, use a signed safe-integer contract so
pre-1970 quarantine evidence stays queryable. A negative `scheduledFor` is
valid only when the Run is `skipped` with
`failureCode = routine.schedule_invalid`; every other negative combination
fails closed. Quarantine readers and writers must not clamp, hide, or migrate a
valid negative value into an accepted ordinary occurrence.

D1 records one destination snapshot on a claimed Run. The required ownership
invariant is that worker submission, successful publication, failure
publication, and redrive all use that same destination. A concurrent Routine destination
update affects later claims, while the existing claimed Run keeps its recorded
Space id or Slack team/channel/thread/conversation locator. This rule does not define snapshot timing for other Routine
fields. Every Routine and native-delivery writer must prove the destination rule end
to end; the snapshot column alone is not evidence that the execution and
publication paths comply.

Each claimed Run also freezes `execution_engine = legacy | workflow`.
Migration `0028_routine_run_workflow` backfills existing non-skipped Runs to
`legacy`. This field prevents the legacy recovery/watchdog path and the
Cloudflare Workflow instance from both acting as execution authority for one
Run. Workflow instance status is operational evidence only; it cannot replace,
repair by rewriting, or become a read source for the D1 Run lifecycle.

Workflow observability uses the Run id as its correlation key. Core emits
`core.openmeld.routine_workflow.*` structured runtime evidence for instance
creation, recognized phase restart, blocked recovery, and callback forwarding.
The same event is written to the existing Analytics Engine dataset with
`dispatchId = runId`; it contains stable status and reason codes but never
Routine instructions, callback payloads, model output, or credentials.
Cloudflare's native Workflow metrics remain the source for platform attempts,
step failures, retries, waiting duration, and terminal instance state. The
OpenMeld evidence joins those platform facts to the D1 Run, native-delivery
ledger, and one destination result; neither metric surface may repair or override
product truth.

An unknown Workflow error phase, a terminated instance, a status read failure,
or a completed instance paired with a nonterminal D1 Run is a blocked-recovery
condition. Core records the condition and leaves the Run unchanged for operator
inspection. It must not erase Workflow state, silently start from the beginning,
or hand the Run to the legacy recovery scanner.

A Run may link to an ordered native-delivery chain through `routineRunId`: one
initial Center Agent delivery and, only when delegated all-terminal work was
registered, one resumed Center Agent delivery. The ledger has a non-unique Run
lookup index. `routine_runs.native_delivery_id` is the current final-result
owner and fences terminal projection and publication; earlier delivery rows
remain immutable execution evidence. Once a Run reaches `submitted`, its status
is a product and diagnostic projection of the current native delivery. It must
not become a second in-flight execution state machine beside Remote Agent.
`routine_runs.continuation_delegation_id` is the atomic one-continuation fence:
the same delegation id may replay, while a different second id conflicts before
child work is created.

Each successful human- or Center-Agent-initiated Routine create, update, pause,
resume, or delete appends one audit row in the same D1 batch as the mutation.
Direct human Web and CLI paths record the current human profile as actor and no
`onBehalfOf` value. Center Agent tool paths record the designated Center Agent
profile as actor and the verified represented human in `onBehalfOf`. Rejected
or unapplied mutations write no audit row. An exact Local Agent-originated
mutation also stores the existing native delivery id; the Audit Log read
projection resolves its client from the original Local Agent request row.
Creation is the narrow lifecycle-durable exception: in the same conditional
insert, the canonical Routine definition freezes the verified represented-human
display name and, when the exact source request exists in the same Organization,
the bounded Local Agent client. That snapshot survives profile renames and audit
retention, contains no session locator, and is never identity or mutation
authority. It does not copy later update actors or Run evidence into the Routine
definition. Scheduler quarantine is a system
containment transition, not an attributed `pause_routine` mutation; its durable
evidence is the `routine.schedule_invalid` skipped Run plus structured evidence
correlated by organization id, Routine id, and Run id. The general Center Agent
Audit Log exposes these Routine mutation rows only through action set v17;
earlier action sets filter them. Run history is execution evidence, not a
substitute for human or represented-member mutation attribution.

## Projection Rules

A projection exists to make facts queryable.

A projection must not become the authority that created or decided the fact. It
must stay traceable to its source and be rebuildable unless the domain explicitly
owns a unique event that cannot be reconstructed.

Examples:

- Space Index is a projection of Space truth. Account Space Index queries must
  read this projection instead of reconstructing cross-Space visibility from
  profile history, client caches, or deletion tombstones. Bounded account-level
  fan-out reads, including active Wake summaries, must select the exact same
  Gateway-scoped candidate Space ids in the same pin, join, name, and id order
  as the Account Space Index list. They must not run a separate unordered limit
  that can inspect a different subset of the member's Spaces.
- Account Space member previews are opt-in (`includeMemberPreviews=true`).
  Enrich only the authorized candidate list from active membership projections,
  selecting at most three profiles by added time and profile id. The existing
  active-member count remains the total; the preview is not another membership
  authority. Batch reads stay under D1's parameter limit and do not contact each
  Space Durable Object. Legacy callers receive no new response field.
  Rollout requires Core and Gateway support before Web enables this opt-in query.
  CLI, Service, Skills, setup, Wake dispatch, Space publication, and diagnostics
  contracts are unchanged; no local-component contract bump is required.
- The Space-owned Direct Message conversion timestamp projects to
  `space_index_spaces.direct_message_converted_at_ms`. It is an irreversible
  classification fact, not a client hint: reusable-DM lookup excludes converted
  rows, Account Space Index returns the nullable timestamp, and generation
  counting still includes every DM-origin row for that pair. Rebuilding the
  projection must reproduce the Space-owned marker rather than deriving it from
  member count.
- Dispatch Ledger is a ledger/query projection for Wake execution.
- Wake trace read models compose existing facts for diagnosis.
- Wake progress composes each execution owner's current lifecycle with
  Space-owned public source context at read time. Space remains the only owner
  of requester identity, source-message text, and thread placement; the
  dispatch outbox, RuntimeCoordinator projection, and native-delivery ledger
  remain lifecycle evidence and never receive copied author display, message,
  or thread state. The dispatch and native ledgers may retain the immutable
  source Profile ID solely as an indexed requester selector; Space remains its
  authority. Legacy rows may match through bounded active-outbox dispatch IDs.
  Every owner filter runs before ordering and limiting, never scans the author's
  unbounded Space message history, and prevents a busy Organization from
  pushing that author's work out of the result.
- Diagnostic Report pointers can derive Wake context, but the user-submitted
  report event itself belongs to Diagnostics.

When a projection is stale, missing, or degraded, expose that as evidence. Do not
silently invent truth to make a diagnostic view look complete.

### Space Board Execution Projection

The Space Board composes Space-owned room facts with a Core read projection of
RuntimeCoordinator-written execution records. The projection is read-only: it
must not reserve work, advance lifecycle, finalize an outcome, publish a reply,
or become a second execution writer.

Terminal Board outcomes may summarize recorded RuntimeCoordinator terminal
states. `Working now` is stricter: it may include only executions whose current
RuntimeCoordinator projection and freshness support `running`. A persisted D1
status or historical lifecycle event without explicit freshness is not enough.
If the execution store is unavailable, stale, or internally invalid, the Board
must fail or expose unavailable evidence rather than fall back to Dispatch
Ledger, Agent Activity, service liveness, or client caches.

## Organization Logo Data Boundary

Auth is the only writer for the canonical `organizations.logo` reference. The
reference is either `null` or one managed Gateway URL whose configured
`OPENMELD_GATEWAY_URL` origin matches the active environment and whose path
identifies the same Organization and one immutable asset id. Generic Better Auth
Organization create and update requests reject caller-supplied `logo` values so
no second writer can bypass the owner-only mutation contract. They also reject
caller-supplied Organization metadata; Auth preserves personal classification
when a personal workspace slug changes.

Gateway owns the byte pipeline. It authorizes the active Organization and actor
through Auth before reading the request body, accepts only bounded JPG, PNG, or
WebP source bytes, asks Cloudflare Images for real dimensions, and writes only a
non-animated 512 x 512 WebP derivative to the
`openmeld-organization-logos` R2 bucket under:

```text
organizations/{organizationId}/logos/{assetId}.webp
```

Source uploads are never retained. Public reads resolve only the strict
versioned path and return immutable cache headers. The URL itself is public
identity data; upload, replace, and remove remain authenticated owner-only
operations. Personal workspaces keep using the owning user's avatar and must
reject this mutation server-side even if a client exposes an invalid control.

Mutation ordering is prepare, transform, R2 write, Auth compare-and-set commit,
then best-effort deletion of the previous managed object. A failed commit first
attempts to delete the newly written object. If that rollback delete fails, the
request returns `organization.logo.storage_failed` and logs the orphan asset id
instead of hiding the cleanup failure behind the original commit error. Cleanup
failure after a successful commit is observable but cannot roll the canonical
reference back to an older logo. Raw bytes, image content, and user file names
must never appear in logs or diagnostics.

The final compare-and-set atomically rechecks the actor role, current logo,
Organization slug, and Organization metadata observed during prepare. A role or
classification change wins over the stale logo mutation and returns a conflict.

## Space Attachment Data Boundary

Core is the only writer for Space attachment metadata. The metadata row records
the organization, Space, uploader, media type, byte size, optional
client-declared dimensions and file name, and creation time. The private image
bytes live in the Gateway-owned `openmeld-space-attachments` R2 bucket under:

```text
org/{organizationId}/space/{spaceId}/{attachmentId}
```

`packages/schemas` owns the pure key constructor used by both Gateway and the
Remote Agent worker. The template must not be copied into either service.

Gateway may transfer bytes only after Core authorizes the request against the
Space DO viewer-membership truth. `space_index_memberships` remains a query
projection and must not authorize attachment upload or download. Downloads are
authenticated reads; an attachment object must never be exposed through a
public or unauthenticated URL.

For a hosted Center Agent image turn, Core first reads the already-authorized
triggering signal from Space and sends only its canonical attachment references
to the Remote Agent worker. The worker uses the same private bucket through a
read-only binding and derives scope from the Core-authored turn's
`organizationId` and `spaceId`; it does not query or write attachment metadata
and is not a second authorization owner. An R2 miss, size mismatch, read error,
unsupported media type, or Flue base64-limit failure degrades that image to an
explicit prompt placeholder and a structured
`remote_agent_attachment_load_degraded` Worker log. Other images and the text
turn continue; raw image bytes and base64 data must never be logged.

Upload ordering preserves the authorization boundary: Core records and
authorizes metadata before Gateway writes R2. If the R2 write fails, Gateway
asks Core to delete the metadata row. An R2 object left behind after a later
failure is unreachable without its Core metadata row and may be cleaned up by
a future maintenance process. A metadata row whose object is missing resolves
to an explicit not-found response at the byte boundary.

## Space File Data Boundary

The Space Durable Object is the only writer for Space File identity, folder
hierarchy, current placement, revision sequence, Trash state, and actor
attribution. Its SQLite tables are canonical business state, not a D1
projection. No Resources, Organization Documents, Center Agent Computer, or
Space Index table mirrors this tree.

Private immutable revision bytes live in the Space file R2 binding under the
shared key constructor:

```text
org/{organizationId}/space/{spaceId}/files/{fileId}/revisions/{revisionId}
```

Core owns the raw-byte storage operation for every caller. Gateway transports
authenticated browser and CLI bytes to Core; Center Agent tools call the same
Core operation. Core asks the Space Durable Object to authorize the actor and
prepare the canonical object address, writes one immutable object, then asks
Space to commit the matching metadata with the supplied base revision. The
commit rechecks authorization and the base revision. On rejection or an
uncertain commit response, Core preserves the immutable object and the
structured error. It must not delete inline because another exact retry may
have committed the same deterministic revision key. An object that Space did
not commit remains unreachable and may be reclaimed only by a future
Space-owned reconciliation process that proves the revision is unreferenced. A
read first resolves the authorized canonical revision descriptor through Space
and only then reads the exact object. An R2 key or file id alone never grants
access.

Temporary Web Composer bytes use the same private R2 binding under the separate
`composer-uploads/v1/` prefix. A Composer Upload object carries frozen scope,
name, MIME type, size, upload identity, and expiry metadata, but it has no row in
the Space File tree and is never a canonical read projection. Core authorizes
the current Space member before staging, publishing, or discarding, derives the
object key from that member scope, and rejects metadata or scope drift. Publish
reads the staged bytes and enters the ordinary canonical Space File write path;
it does not reinterpret the temporary object as canonical storage. When an
upload is still staged, a publication replay must match its content-derived
revision identity against the durable committed File receipt. This rejects an
upload id that was discarded or expired and then restaged with different
content. If the temporary object is gone, an exact committed mutation receipt
remains sufficient to replay the original response. Explicit discard and
scheduled expiry cleanup delete temporary objects. Cleanup failures remain
observable and do not convert abandoned uploads into Space Files.

Trash is a reversible metadata state in the MVP. Trashing a folder requires it
to be empty, so one mutation cannot silently hide a subtree. Revision objects
remain private and retained. An active member may list Trash and restore the
same stable entry id; restoration fails visibly if its former parent is no
longer active or its name now collides in that folder. Public and
Organization-only viewers cannot list Trash. Physical reclamation is a later
explicitly-owned maintenance lifecycle, not part of an interactive delete
request.

The Space Durable Object appends one durable File audit event for each accepted
content read or metadata mutation request. A successful metadata mutation and
its event commit in the same SQLite transaction. Core reports the final R2
content-read result and pre-commit R2 write failures back to that same writer;
the metadata commit owns the successful content-write event. Exact request
retries reuse the event id, while the operation id correlates separate attempts
of the same client mutation.

File audit events include Organization id, Space id, stable entry id, revision
id when relevant, operation, request and operation ids, actor kind, actor
Profile for authenticated or dispatch actors, represented human when
applicable, result, and a bounded error code for failures. Logs and diagnostics
never include file bytes, text bodies, or user file names.
`space.files.changed` is a live invalidation only; clients re-read the
Space-owned tree and never derive file state from the frame.

## Agent Profile Deletion Lifecycle

Deleting an Agent Profile is an Auth-owned identity decision with cross-domain
consequences. Those consequences are server-side and entry-point independent:
Web, CLI, and any future surface converge on the Auth DELETE. A database trigger
writes `openmeld_profile_deletion_outbox` in the same transaction as the
Profile-row deletion, so a Worker crash or an unavailable Core binding cannot
lose the lifecycle work. Auth attempts Core
(`ProfileLifecycleEntrypoint.reconcileDeletedAgentProfile`) immediately and its
existing 15-minute scheduled handler retries due items with bounded backoff.
Clients must not own cross-domain deletion consequences.

Core asks RuntimeCoordinator to stop every matching accepted, waiting, or
in-flight Wake, disables the exact owner/Profile primary Binding, resolves the
affected Spaces from the `space_index_memberships` projection (Space-truth
membership, including owner-added members), removes the member from each Space
DO, and posts a system notice so the removal is visible instead of silent. Its
response reports `complete: true` only when cancellation, Binding cleanup,
Space discovery, bounded pagination, and every attempted Space consequence are
confirmed. Missing storage, a partial cancellation, a truncated discovery page,
or a failed Space call keeps the Auth outbox item. The migration also seeds the
outbox from any enabled Binding whose Agent Profile was already missing, so the
durable path repairs pre-existing deletion residue instead of protecting only
future deletes.

`openmeld_profile_space_history` is a visit/recency record for the start surface,
not membership truth: it has no rows for owner-added members who never opened
the space, and a profile's rows cascade away when the profile is deleted. It
must never be the source for deletion fan-out or for space access decisions.
Access checks that need "is this profile in that Space" read the
`space_index_memberships` projection (history may still contribute recency
and pinning).

The backstop is the Space-owned membership liveness reconcile:

- Members snapshot reads and failed Wake dispatch preflight checks that directly
  receive the auth owner's authoritative `profile.not_found` verdict record
  observations in the same Space-owned evidence ledger. Neither path may infer
  deletion from a generic Binding, route, soft-retirement, or transient auth
  failure. Both record evidence only; they never change membership state.
- The Space background alarm removes an agent member only after the evidence
  threshold is met (two independent observations, at least 30 minutes apart)
  AND a fresh auth re-verification still answers `profile.not_found`.
- A `found` re-verification clears the evidence. A transient auth failure
  keeps the evidence and retries on a later alarm. Space creators are never
  auto-removed.

## Service Liveness Facts

The ServiceRuntime record in Runtime Transport Durable Object storage owns service
liveness truth per (account, device): register and heartbeat handlers write it,
route lookup / owner-service lookup / readiness / device listings read it, and
the next heartbeat re-declares it in full, which is its rebuild story.

The D1 runtime registry stays a slower evidence projection. Device-facing
"last seen" displays overlay the live heartbeat timestamp over the registry
value; the registry value is the fallback for devices without a live session.
Stale registry or report evidence is diagnostic-only and must not be projected
as public unavailability.

Core's Organization member Service-status read model fans out owner-service
lookups for current Directory members and exposes only `{ userId, state }` plus
one response generation time. A failed lookup is logged with Organization and
member correlation and projects `unknown` for that member without failing the
remaining batch. Public consumers must not receive device ids, computer names,
operating-system details, Service versions, per-member heartbeat timestamps,
or raw lookup errors from this projection.

Core owns a separate Organization Computers read projection. It joins current
Organization membership with the Core-owned device registry, execution-target
evidence, and Runtime Transport session liveness, then emits only team-safe
fields: owner id, opaque computer id, display name, device category,
operating-system family/version, last-seen time, coarse per-computer Service
state, local-agent ref/enabled/readiness status, and an optional sanitized
Agent Controller Interface detail projection. That detail projection permits
controller state, native interface, installed version and update status, launch
status and install count, model display names, native capability flags, check
status, and check timestamps. It never emits controller accounts, executable
or installation paths, launch arguments, update commands, diagnostic messages,
private skills, local policy, credentials, or raw lookup errors. One member's
failed live lookup is logged
with Organization/member correlation and projects `unknown` without hiding
their registry-backed Computers or failing the remaining batch. The signed-in
member's complete mutable inventory still comes from the owner-scoped
local-runtimes contract.

When a matching live Runtime Transport session reports local-component facts,
the same Organization Computers projection may emit a sanitized OpenMeld Tools
detail object: Service and CLI installed/latest versions, required Service
version, component update status/policy, Wake-blocking state, bounded reason
codes, and managed skill target count. It excludes setup commands, component
hashes, runtime lanes, credentials, and mutation authority.

The Center Agent single-member reader uses the same Core projection and
Runtime Transport owner-service authority after Core verifies current
Organization membership. A successful coarse read appends
`read_member_openmeld_service_status` with an `organization_member` resource
to the Center Agent audit journal. The audit row carries the target user id for
correlation, never device identity, heartbeat evidence, Service versions, or
lookup errors. Audit action set `v12` includes this row; older strict readers
exclude it.

## Runtime Transport Session Disconnect Diagnostics

The owner-scoped Runtime Transport Durable Object owns the bounded session
disconnect diagnostic projection. The socket close and socket error handlers
are its only writers. The owner-scoped disconnect diagnostics endpoint and Core
diagnostic clients are its readers. This evidence records how a registered
session ended; it is not service liveness truth, Agent Profile availability,
Wake readiness, or execution authority, and none of those decisions may read
from it.

Each owner shard uses a fixed 20-slot ring plus one cursor. One session
disconnect performs one Durable Object storage transaction that reads the
cursor and overwrites one slot; heartbeats perform no additional diagnostic
write. Diagnostic reads return only records from the previous 24 hours, newest
first. Older physical slots may remain until overwritten, but the fixed ring
prevents storage growth. The projection cannot be rebuilt after storage loss;
the next observed disconnect begins repopulating it without affecting runtime
behavior.

Each record contains only bounded structured evidence: daemon session and
device ids, lane, service version, connection generation, up to 20 Agent
Profile ids plus the total profile count, connection/heartbeat/disconnect
timestamps and derived durations, close code, stable close reason code,
disconnect class, deploy-adjacent reason code, and clean-close status. It must
not persist raw WebSocket reason text, messages, prompts, replies, local paths,
credentials, tokens, or arbitrary payloads.

## Dispatch Ledger Boundary

Dispatch Ledger records what happened to a Wake so traces, diagnostics, and
operators can read it later.

It may record durable Wake evidence such as:

- dispatch identity
- source signal identity
- target Agent Profile identity
- Binding, Runtime, and capability evidence
- attempt or delivery history
- result references
- publication references
- status and reason codes

Dispatch Ledger does not own in-flight execution authority.

It must not decide route ownership, retry, timeout, late-result acceptance,
runtime route ownership, or final execution state. Those decisions belong to
RuntimeCoordinator. Dispatch Ledger records and projects the decisions; it does
not make them.

A Dispatch Ledger history reader may show recorded statuses, attempts, and
terminal error evidence. It must not translate `queued`, `dispatching`, or
`waiting_result` into "still running" without a current RuntimeCoordinator
projection and explicit freshness. A stale ledger row is historical evidence,
not a second in-flight execution state.

The dispatch result inbox is the single durable Core intake for both normal
results and exact token-matching results that arrive after
`runtime.progress_stale`. A retained successful late result uses
`late_result_available`; it is recoverable evidence, not a RuntimeCoordinator
state transition and not permission to bypass the existing publication
pipeline. The inbox
keeps the existing dispatch, task, token, controller-conversation, result, and
published recovery-notice references so replay is idempotent. Diagnostics must
prefer that state over archival Dispatch Ledger `dispatching` or
`waiting_result` rows and must return a reconnect/recover next action rather
than `none` or a fresh execution instruction. Core does not ACK the Service
outbox record until the idempotent recovery notice is durable; publication
failure returns `retry_later` and reuses that same outbox and inbox record.

Execution Recovery reads this same inbox and RuntimeCoordinator history across
all publication surfaces. It does not create a Space-only recovery truth, a
Center-Agent-only outcome store, or another copy of Service outbox data.
`inspectExecutionRecovery`, `recoverExecutionResult`, and
`resumeControllerConversation` project from these owners, verify the complete
execution, owner, controller conversation, and frozen destination identity,
and record idempotent recovery attempts and outcomes without rewriting the
original terminal event. The owning Durable Object keeps only the operational
idempotency record needed to fence duplicate command I/O; it is not another
result or execution authority. Its transaction callback is retry-safe, and
outcome-unknown operations retain the same operation identity rather than
starting controller or publication work again.

The operation record is a leased state machine, not a write-once
`in_progress` marker. Its unique claim identity is the exact execution,
destination, and action; caller operation ids are aliases to that claim.
Every attempt stores its own fence token. Expired attempts cannot finalize a
newer attempt, and a thrown provider or controller call is reconciled against
the authoritative publication, result, or controller fact before another
attempt is eligible. Missing authoritative evidence is classified explicitly
as `safe_to_retry` or `outcome_unknown` according to the destination's
idempotency contract. Restart does not erase or guess this state.

A Space Wake routed to native delivery still has one Dispatch Ledger row for
the original Wake. After the native-delivery ledger has confirmed both the
worker's terminal result and the required destination publication, Core
idempotently projects that terminal status, reason code, and bounded failure
detail onto the corresponding Dispatch Ledger attempt. This closes the public
Wake trace without making Dispatch Ledger a native execution authority.
Routine and Slack native deliveries are not Space Wakes and must not fabricate
Dispatch Ledger rows.

For every interactive Space Wake, the Space durable outbox is the acceptance
boundary before transport runs. Production Core performs the current Core-owned
Binding preflight and then processes a workstation Wake directly into
RuntimeCoordinator; a retryable workstation result stays in the unchanged
outbox for alarm redrive and does not enter Queue. Direct processing uses the
same dispatch claim, RuntimeCoordinator head, execution ledger, and idempotency
key as the former Queue path. If the preflight authoritatively identifies the
hosted Center Agent, direct processing instead uses the same native-delivery
ledger, exact persisted worker request, and admission watchdog as Queue
processing, and a retryable or outcome-ambiguous hosted result may send the
same outbox message through Queue. A retryable preflight that cannot identify
the hosted runtime stays in the outbox rather than blindly entering Queue.
Diagnostics must distinguish `direct`, `queue`, `direct_queue_fallback`, and
workstation routing from hosted native delivery. A Binding whose
`runtimeKind` is `hosted_center_agent` uses the hosted runtime family as the
routing authority; a stale workstation controller snapshot is normalized at
the Binding read boundary and recorded as diagnostic drift. It must not route
the hosted Wake to local workspace readiness or produce simultaneous remote
designation and local-route guidance.
Those routing facts are not separate execution owners or separate Dispatch
Ledger rows.

Core projects the Space outbox state after either accepted transport as
`handed_off`. Existing Space Durable Objects retain the historical persisted
`queued` value and `queued_at_ms` column for rollout compatibility; the outbox
repository alone maps that storage encoding to `handed_off`. No policy, trace,
or execution decision may expose the historical storage word as evidence that
Cloudflare Queue carried a workstation Wake.

The shared `openmeld-daemon-dispatch` Queue resource remains required by hosted
native-delivery recovery, Remote Agent deadline probes, Agent Task
continuations, and Agent Task observation redrive. Removing workstation Wake
messages from Queue is not permission to delete that shared resource or any of
those independent consumers.

Concurrent claims for the same dispatch idempotency key, including an immediate
direct attempt racing an outbox alarm or Queue recovery, must atomically converge
on the existing Dispatch Ledger row. Only the winning ledger insert may create a
new attempt. A losing idempotency-key conflict is a dedupe outcome, not a
delivery failure and not a reason to enqueue another Queue recovery message.

## Message Channel Event Ingress Ledger

Core owns one generic Message Channel ingress ledger for new Lark and Feishu
events and, only after the Slack parity migration, new Slack events. Its
idempotency key is the tuple of provider, connection id, and provider event id.
One atomic claim chooses the only worker-admission attempt. Redelivery replays
the same frozen Native Delivery request and never creates a second Center Agent
turn.

The ledger stores provider and connection identity, bounded event and Queue
correlation, claim lease, attempts, Native Delivery id, reason code, and
timestamps. It never stores message text, raw Webhook payloads, credentials,
access tokens, card tokens, provider profiles, or transcript history. Provider
content remains in the provider and enters one turn only through the bounded
Channel Context projection.

A participant whose provider tenancy evidence matches the connected workspace
but who lacks a current OpenMeld identity link is recorded as a connected
Message Channel member. The frozen native-delivery request keeps the provider
display name and typed Message Channel identity with null OpenMeld profile and
on-behalf-of user identity. A participant with missing or mismatched tenancy
evidence remains an external provider participant. A stale identity link whose
OpenMeld member no longer exists is removed before applying one of those
provider-evidence boundaries. The ingress or native-delivery ledger must not
mint Better Auth membership, a Human Profile, role authority, or
represented-member identity from the provider participant id. It must also
never interpret two missing tenant keys as a match. For Lark and Feishu, the
first fully verified provider event may atomically bind an otherwise unbound
connection to its non-empty tenant key; a concurrent or later different value
fails closed before event normalization.

Slack identity-link tokens are one-time authentication artifacts, not member
or native-delivery authority. Core stores only the token digest plus the exact
Organization, Slack workspace, Slack user, display-name snapshot, issue time,
expiry, consumption time, consuming OpenMeld user, source native-delivery id,
an internal per-consume nonce, private delivery scope, claim owner and time, and
continuation retry generation. Active-token reads require a non-null
Organization scope and a supported private delivery scope. New tokens use
`slack_direct_message`; the legacy `slack_ephemeral` scope remains readable
only so an unexpired private action survives a mixed-version rollout. Tokens
previously exposed in a public Slack thread remain unusable. Core atomically
claims an active token for one signed-in OpenMeld user before Auth may write
Organization membership. A competing account therefore fails before
enrollment. A claimed or consumed token is readable only by that same OpenMeld
user until expiry so a lost Web response can retry without transferring the
setup to another account. The same user may resume an unconsumed claim after an
Auth enrollment failure. Issuing a fresh private setup action atomically expires
earlier unconsumed tokens for the same Slack identity before inserting the new
one, including abandoned claims. An explicitly requested non-continuing setup
action supersedes only an older non-continuing action; it never invalidates a
source-bound action that is still waiting to continue another request. Final
consumption rechecks the current workspace Binding and signed-in Organization
membership in the same D1 transaction that consumes the claimed token and
writes the explicit identity link. If that exact Slack account is mapped to
another member, the same
Slack-private proof atomically replaces the canonical mapping. The transaction
classifies replacement from the canonical pre-upsert link, conditionally records
the replacement audit, and derives the returned `replacedExistingLink` from that
same audit write; no pre-transaction projection may decide any of those facts.
The consume nonce binds the audit and link write to the exact successful consume,
including same-millisecond retries. A successful response reports that
transaction's receipt rather than reclassifying it from a later canonical-link
read. If the workspace moves, membership disappears, or required audit insertion
fails during that operation, neither the token nor the identity link changes.
Token plaintext appears only in the private direct-message action delivered to
the exact Slack user and must not enter public messages, logs, or diagnostics.

For post-result Slack guidance, an active source-bound token is also the durable
at-most-once publication fence. A callback replay never creates a second
direct-message action while that token remains active. A known Slack API rejection
expires the just-issued token so required guidance may retry with a fresh one.
An ambiguous network outcome keeps the token active and emits bounded
diagnostics; Core does not republish an ambiguously delivered direct message, so it
does not risk showing the member duplicate private actions. This fence governs
guidance publication only and never changes the already confirmed task result.

Lark and Feishu use the same authority model through the generic Message
Channel identity-link ledger. D1 stores only the token digest, provider,
connection, exact provider user, Organization, source native-delivery id,
`continue_request | optional_setup` purpose, issue/expiry/consumption times, an
internal per-consume nonce, and continuation retry generation. The private card
carries the plaintext token to that provider user and uses a deterministic
provider publication UUID. Final consumption, canonical link replacement,
conditional replacement audit, and the returned replacement fact use the same
D1 transaction and exact consume nonce, matching the Slack invariant above. A
consumed token is readable for response-loss or continuation retry only when the
explicit provider identity link resolves to the same signed-in OpenMeld user.
The source delivery is correlation evidence, never execution authority; the
continued verified-member delivery receives its own idempotency key,
working/final publication lifecycle, and Native Delivery outcome. Migration
`0096_lovely_roland_deschain` backfills legacy tokens as non-continuing optional
setup so old rows do not acquire request-continuation authority. The same
migration adds the signed-in-user claim fence before Auth enrollment and
backfills consumed claims only from the exact existing provider identity link.
Migration `0097_last_squirrel_girl` adds the frozen membership requirement to
both Slack and provider-neutral tokens. Existing rows are `allow_enrollment`;
only a newly agent-selected current-member target is written as
`current_member`. Migration `0129_far_luminals` adds the nullable consume nonce;
old rows remain readable, while only a new consume may authorize its
transaction's audit and canonical link write.

The Organization Message Channel connection projection is also the read owner
for People account mappings. It projects each canonical link with an opaque
derived id, provider, mapped OpenMeld user, provider display name, and connected
time; raw provider user ids and link-token material do not cross the HTTP
boundary. A self or Channel-manager disconnect re-resolves that opaque id under
the active Organization, deletes only the exact mapping, records the human
audit action, and returns the refreshed projection. It never writes Auth
membership or provider connection state.

Core also owns the durable Organization Message Channel setup-request record.
One open row is unique to Organization, requester, and provider; it is the
deduplication and resolution truth for an ordinary member's explicit **Ask an
admin** action. Inbox owns only the recipient projection for current owners and
admins. Connecting that provider resolves the open request and its Inbox items;
failure to reconcile an already successful external connection is logged with
Organization and provider context and never turns the provider connection into
a false failure.

### Agent-assisted account-connection evidence

The initial agent-assisted flow adds no Candidate ledger, background scanner,
Inbox projection, email notification, copied directory, score store, or model-
rationale store. The current live Remote Agent turn may reason over the sender's
own provider account summary and the ordinary Organization directory response.
Only its final optional `connectToUserId` crosses back to Core.

Core treats that id as untrusted routing input. It authorizes the exact active
native delivery, rechecks that the user is a current member of the same
Organization, and stores the id only by pre-claiming the existing one-time
identity-link token. The token remains bound to provider, connection, provider
user, Organization, source delivery, purpose, issue time, expiry, and a
`current_member` membership requirement. Generic sign-in or sign-up tokens use
`allow_enrollment`. A later user claim never changes this frozen requirement.
No new identity table or authority projection is introduced.

Preview and consumption accept only the token's claimed OpenMeld user. A
different signed-in account receives the existing generic invalid-action
response before any member identity is revealed or mutated. Consumption then
rechecks current membership, provider connection, source delivery, and link
conflicts through the existing owner path. A missing or failed Auth projection
is dependency unavailability, not membership loss, and never deletes an
existing link. If a `current_member` target has left the Organization, preview
and consumption fail closed instead of reenrolling that account.

Observability records only the existing bounded token issuance, claim,
consumption, conflict, expiry, provider-publication, and continuation events.
Provider email, Organization-directory email, model prompts, model rationale,
and token plaintext must not enter logs or diagnostics.

The continuation idempotency identity is derived from the source native
delivery plus the consuming OpenMeld user, never from the one-time token. A
callback retry that issued another token therefore still converges on the same
verified-member delivery generation.

The token's source native-delivery id is a correlation fence, not execution
authority. After Auth has established membership and Core has consumed the
token, Core re-reads the source delivery and verifies the exact Organization,
provider connection, provider user, channel, and thread. New actions are issued
only after the source is completed. A narrow rollout-compatibility exception
applies to an earlier action when the source is still `accepted` or
`retry_observed` with
`finalPublicationState = outcome_unknown`: the current signed-in user must have
consumed the exact private, source-bound token. That evidence authorizes only
the new continuation; it does not settle, rewrite, or republish the source
delivery. The
native-delivery ledger's existing durable execution-recovery request supplies
the original Core-authored turn context; the terminal worker request remains
cleared as before. Core creates a new verified-member native delivery with an
idempotency key derived from the source delivery and consuming OpenMeld user.
Concurrent consumption and response-loss retry therefore converge on one
continuation and one original provider result surface. A known terminal
continuation failure may atomically advance the token's retry generation and
derive one new deterministic key. That counter only coordinates retry
submission; the native-delivery ledger remains the execution and final-outcome
truth. A source-recovery exception after membership and identity linking is
logged with bounded identity and delivery context and returned as a linked,
retryable-continuation result; it must not roll back or misreport the completed
setup.

The existing Slack event ingress ledger remains the Slack authority until the
separate Slack adapter release passes fixture parity and real Slack smoke. The
generic ledger and legacy Slack ledger must never both claim the same event.

## Slack Event Ingress Ledger

Gateway owns Slack signature verification and HTTP acknowledgement; Core owns
accepted-event processing. Gateway returns 2xx only after the shared Cloudflare
Queue accepts the normalized event. A missing producer binding or failed send
returns retryable non-2xx, preserving Slack's retry contract instead of
claiming durability that does not exist.

`openMeldRemoteAgent_slack_event_ingress` is Core's durable ingress ledger. The
Slack event id is the idempotency fence. A consumer atomically claims one event,
persists its exact Remote Agent submission request before calling the worker,
and replays that same request after an ambiguous outcome. Duplicate Slack
retries cannot create a second logical turn or a second initial failure message.
Consumer retry remains bounded and explicit; exhausted rows retain the failure
code, attempt count, timestamps, Gateway request id, and Slack retry headers.

The minimum Slack scheduling diagnostic chain is:

```text
Slack event id
-> Gateway request id and enqueue acknowledgement
-> ingress ledger claim/attempt
-> native delivery id and conversation id
-> Routine mutation audit and Routine id, when the turn creates a Routine
-> Run id and scheduler claim
-> worker submission/callback
-> Space signal id or Slack message timestamp
```

Structured evidence and stranded-ingress monitoring must distinguish: rejected
signature, enqueue unavailable, queued but unclaimed, claim retry, submission
outcome unknown, terminal ingress failure, Routine authorization/validation
failure, and final publication failure. Event text, prompts, tokens, and Slack
credentials are never diagnostic fields.

The dedicated Message Channel Queue delivery budget and Core's terminal ingress
attempt budget are one operational invariant. Repository verification must keep
Cloudflare `max_retries + 1` equal to the application attempt budget so a final
provider failure is durably settled instead of being abandoned between Queue
and ingress ownership.

## Slack Thread Context Cursor

Slack remains the source of truth for thread message content. Before an
accepted `app_mention` enters native delivery, Core first reads the exact
current message through `conversations.history` to hydrate its provider-owned
text and file metadata. It then reads one bounded `conversations.replies` page
through the Organization-bound Slack credential and adapts earlier messages
into the provider-neutral `ChannelContext` contract. The hydrated current
mention remains the turn request and is excluded from the untrusted historical
records.

`openMeldRemoteAgent_slack_thread_context_cursors` stores only the last
successfully admitted Slack message timestamp for one Organization, workspace,
channel, thread, and workspace-connection generation. It never stores message
text, Slack profiles, blocks, attachments, tokens, or provider response bodies.
The cursor advances only after the Remote Agent accepts the turn, never after a
failed or outcome-unknown submission, and its database update is monotonic.
Moving or reconnecting a Slack workspace starts a fresh cursor generation
instead of reusing context synchronized under an older Organization Binding.

The initial read is a snapshot through the current mention. Later reads are
deltas strictly after the admitted cursor and through the new current mention.
Core makes one exact current-message read, one bounded thread-context read, a
bounded recent-channel read for a root mention, and at most three exact reads
for Slack message permalinks present in the current request. Quoted messages
are transient untrusted reference context, not new requests or authority. A
partial provider page is marked `truncated` and resumes from its last admitted
message on a later turn. Forbidden, rate-limited, timed-out, and otherwise
unavailable reads do not block the current request, do not advance the cursor,
and carry an explicit non-complete retrieval status and limitation note to the
Remote Agent.

The opt-in forwarded-message reproduction diagnostic records only Slack
message identifiers, provider field names, counts, lengths, and lookup status.
It never records message text, URLs, credentials, or raw event/response bodies,
and it remains disabled outside a bounded reproduction window.

## Opportunity Data Boundary

`organization_opportunities` is the Core-owned product truth for one
recipient's Opportunity identity, bounded safe evidence, recommendation
content, current decision, and creation/decision provenance. Core is its only
writer. The unique Organization, recipient, and stable-key tuple is the replay
fence; an exact retry returns the existing record, while changed content under
the same key fails closed.

Opportunity records never store transcripts, provider responses, credentials,
private local paths, Changelog entry copies, or downstream permission. The
creating Center Agent profile and source native-delivery id are descriptive
provenance only. Reads and decisions bind to the represented current member;
another member receives not found rather than existence disclosure.

The same D1 batch creates the initial `organization_opportunity` Inbox update.
It is normal importance and not action-required, so it does not enter proactive
browser or email delivery. A later decision updates only Opportunity truth.
Inbox read or clear state never mutates Opportunity truth, and an accepted
decision never invokes a Routine, Task, App, Channel, Space, or local Agent
operation. Those owners keep their independent authorization, audit, and
execution evidence.

The Self-Evolution Opportunity Ledger remains Organization Document content.
Remote Agent state, Organization Documents, Inbox, Changelog, client caches,
and future Local Agent reports must not become alternate Opportunity stores or
writers. Any later ingestion path requires an explicit Core contract rather
than direct table access.

## Center Agent Tasks

Core owns the canonical Center Agent Task record and append-only product event
stream defined in `developing/product/center-agent-tasks.md`. Phase 1 storage
includes stable Task and event identities, verified requester attribution, typed
origin, one derived product state/phase/outcome projection, one monotonic
version, native-delivery attempt links,
and idempotent control operations. Task list is cursor-paginated; Task detail
returns the full current product event and attempt history. The Remote Agent
owns private runtime-conversation history and compaction under the stable Task
conversation id.

Logical database routing follows those owners even while every accessor maps to
the same physical D1 database. Canonical Task records, attempts, and events use
`localStateDb`; native-delivery execution and publication evidence uses
`wakeEvidenceDb`; Task-derived Inbox items use `inboxDb`. A projector may read
an exact native-delivery fact and idempotently write the matching Task or Inbox
projection, but no path may use one owner's database accessor as a shortcut for
another owner's data. This separation is required before any future
observability-only physical split.

Runtime-generation rollover follows the same boundary. The Task owner exposes a
bounded typed continuity projection before one exact trigger event, including
the canonical actor-to-author meaning. Remote Agent consumes that projection;
it does not read `center_agent_task_events` directly. Space rollover continuity
likewise comes from the Space Durable Object, which verifies the exact dispatch
identity and its frozen main-or-thread placement before returning bounded
Signals. A generic Space timeline query cannot substitute for that projection.

The Task owner writes `center_agent_task_authorized_readers` as the current
read-authorization projection. Inbox source targets carry only the canonical
Task id. Inbox list, count, read, mutation, and email queries join the owner
projection and never copy access authority into Inbox JSON or join the private
`center_agent_tasks` table. Interactive Inbox requests still require current
Auth-owned Organization membership. Urgent-email redrive rechecks that
membership through the Auth Organization Directory contract; unavailable
directory reads retry, while a verified revocation suppresses the delivery.

Task state is not execution state. RuntimeCoordinator, native delivery, and
controller-native owners remain authoritative for exact execution lifecycle;
Agent Task Coordination remains authoritative only for exact subscriptions and
declared continuations. Task storage keeps typed links and reducer evidence. It
must not copy mutable execution rows into a second executor or settle a Task from
generic Agent availability, Agent Activity, Dispatch Ledger, stale progress, or
model prose.

Task list, detail, and mutation responses resolve the active attempt link
against `wakeEvidenceDb`. The native-delivery owner returns only exact,
requester-matching accepted/running evidence inside its freshness window. That
freshness comes from the dedicated worker-acceptance or forward-progress
lifecycle timestamp. After full native-delivery identity and active-status
validation, each new worker stream sequence advances that timestamp and a
monotonic sequence fence in `wakeEvidenceDb`; repeating the same delta or tool
part does not refresh freshness. Space projection and Message Channel provider
publication consume that accepted evidence but do not own it. Message Channel
connection and credential reads remain on `localStateDb`, while card progress
claims and stream evidence remain on `wakeEvidenceDb`. Publication claims,
probes, Inbox projection, retries of the same provider card update, and other
ledger bookkeeping never refresh execution evidence. A terminal, stale,
mismatched, or unavailable owner read cannot be projected as `Working`; the
canonical Task stays `Active` without a phase and the failed evidence read
remains observable.

Core appends one Task event and advances its projections atomically. Stable
client/provider operation ids deduplicate retries. Mutations that change
canonical Task state use an expected revision; stale callers receive the current
snapshot and a typed conflict rather than last-write-wins. Task events are
immutable, while list, board, compact-window, and Inbox rows are rebuildable
projections.

`center_agent_task_admission_outbox` is the Core-owned durable conveyor from an
accepted Task mutation to one exact native-delivery admission. Initial Task
creation commits the Task row, Task event, queued attempt, active-generation
projection, and pending outbox row in one D1 batch; later attempts commit the
same set without recreating the Task row. The outbox freezes the stable
operation identity, Task event, requester, instruction, parent delivery or
submission, attempt generation, and delivery id. Minute recovery redrives only
a still-queued exact attempt with the same native-delivery idempotency key.
Transient pre-owner errors keep the row pending. Only a durable native-owner
acceptance, rejection, or ambiguity receipt settles it; terminal or
already-advanced attempts reconcile without creating another execution. This
outbox is delivery coordination, not a second Task event writer or execution
authority.

Accepted-operation replay validates the exact stored payload, event, attempt,
and admission identity before current admission authorization, so a response
retry returns the original result even after a later policy change. Reusing an
operation id with different input fails as a conflict. Any new or still-pending
admission rechecks the current requester membership, active Center Agent
designation and managed Profile, primary hosted Binding and runtime identity,
canonical Organization identity, runtime and Organization policy, and current
model route before external admission. A failed recheck cannot mutate or
redrive the Task.

The shared Task schema is the only reducer from the stored lifecycle literal to
the client-facing `state`, `phase`, and `outcome` fields. Clients consume that
projection directly and must not maintain their own board-lane mapping. The
stored lifecycle literal remains the mutation reducer input, not a parallel
product-state source.

One Task owns one logical runtime conversation lane. Independent Tasks may
execute in parallel. Execution attempts link exact owner handles without taking
execution authority. Stop and Retry keep stable Task-level operation identities;
a future Recovery operation requires its own exact recoverability projection and
identity. Late or duplicate owner evidence is retained for reconciliation and
cannot overwrite an authoritative Stop or terminal attempt.

The native-delivery admission watchdog must idempotently project any exact
terminal ledger row before treating the admission as already settled. This
repairs the crash window where native-delivery settlement committed but Task or
Agent Task Coordination projection did not. A missing exact delivery row fails
fast. Task Stop recovery separately retries the fenced delivery for a bounded
window; timeout moves the Task to requester-visible Needs action with diagnostic
code `center_agent_task.stop_confirmation_timeout`, while preserving the Stop
fence and prohibiting a new Retry attempt until authoritative settlement.

Task access is fail-closed and rechecked for delayed projection, list, detail,
mutation, Inbox delivery, and any future live invalidation. Provider-native
visibility does not grant OpenMeld access. Task event content, compact summaries,
and logs follow the privacy boundary in the product owner and never store raw
reasoning, tool payloads, credentials, paths, or provider transcript copies.

## Agent Task Coordination

Core owns the coordination records that connect one exact Agent task to a later
continuation. The shared `AgentTaskHandle` identifies an execution in its owning
domain:

- one Space Wake intent by Space, source client message, and target profile;
- one hosted native delivery by delivery id;
- one controller-native task by controller, host, and task id.

Core routes every coordination read, write, redrive, discovery, and retention
operation through the logical `agentTaskCoordinationDb` accessor. It currently
maps to the shared `OPENMELD_DB` aggregate. It must not route through
`wakeEvidenceDb`; a future observability-only physical split must not move
execution-continuation state with Wake evidence.

An Agent Profile id by itself is never a Task Handle. Availability, process
presence, Agent Activity, and a generic Agent status cannot settle a
subscription.

`agent_task_completion_subscriptions` records the exact watched task, exact
observer task, explicit completion condition, frozen continuation, idempotency
key, and continuation claim. `agent_task_terminal_outcomes` is a coordination
projection of an authoritative terminal event. The first valid terminal
observation for one Task Handle is immutable; duplicate and reordered events
must not create another continuation.

Interaction-needed and terminal RuntimeCoordinator observations first enter a
durable observation delivery record keyed by exact Task Handle and event
identity. The record exists independently of whether a subscription has
already been registered, so an interaction that precedes `watch` settles the
later `needs_attention` subscription. Immediate D1 projection, Durable Object
alarm processing, and Queue redelivery all consume that same record
idempotently. If projection and `setAlarm` both fail, the Queue copy remains the
autonomous trigger after Durable Object eviction; no user event or private
processor call is required. The delivery is complete only after the
coordination observation is durable. Parent continuation is then claimed from
the existing subscription ledger exactly once.

A resume continuation stores coordination intent, not delivery routing. Its
observer Task Handle points to the parent Native Delivery whose ledger row is
the sole owner of requester attribution, `conversationKind`, frozen Space or
provider locator, thread placement, and publication identity. Core derives each
new continuation delivery from that observer row. New subscription writers do
not copy `spaceId`, source signal, thread context, or provider locator into the
continuation JSON. Readers retain bounded compatibility for historical rows
that contain the former Space destination fields, but those fields do not
override the observer ledger.

`center_agent_wake_publications` is the durable publication outbox for the
initial Space message that starts delegated child work. It stores the exact
validated publication command before delegation preparation and uses the Space
`clientMessageId` as its publication identity. `pending` and `accepted` rows
are redriven by the Core minute scheduler. A bounded D1 claim lease fences
concurrent immediate and scheduled attempts; an expired claim is recoverable.
Space posting, delegation preparation, child activation, and audit writes are
individually idempotent, so an interruption at any boundary converges without
duplicating the Wake or spending another Agent turn. The outbox records
coordination progress; it is not Space message truth or execution authority.
Once Space accepts the publication, the outbox retains the validated returned
signal envelope. Completed command replays therefore return the original Space
acceptance evidence without another network read or post. Every external post
attempt has a bounded deadline below the claim lease; timeout remains
outcome-unknown and redrives the same `clientMessageId`. Before treating a
later definite Space rejection as terminal, Core reads the Space's exact
idempotency record for that client-message identity. An existing signal wins;
an unavailable reconciliation remains retryable; only an authoritative miss
atomically creates a Space-owned rejection tombstone and permits cancellation.
Every later idempotent post checks that tombstone before publishing, including
a request that was already in flight but had not reached the Space. The minute
redrive also wraps each whole publication execution in the remaining
45-second batch budget, so multiple slow publications or a publish followed by
slow reconciliation cannot consume the scheduler's full minute or starve later
scheduled work.

The same subscription table serves two creation paths. Delegation creates
subscriptions together with explicit parent-child topology. General Task Watch
creates a subscription for an independent exact task without a delegation row.
Both paths use the same claim, idempotency, redrive, and continuation ledger
semantics. Stopping a general-watch observer cancels its continuation
subscription but does not transfer cancellation authority over the watched
task.

The coordination tables do not own execution truth. RuntimeCoordinator still
owns workstation Wake execution and finalization. The native-delivery ledger
still owns hosted execution evidence. A controller-native adapter still owns
the mapping from its provider lifecycle event to its exact Task Handle. Core
may use a low-frequency reconciliation pass to recover a lost event, but Agents
and model turns must not poll task state as the normal continuation mechanism.

`agent_controller_tasks` stores the accepted exact task registration together
with its Organization, owner, Runtime, host, controller, registration source,
and immutable Task Handle. `agent_controller_task_lifecycle_events` is the
replay-safe event ledger for registration, completion, and needs-attention
callbacks. Its processed marker means Core has converted the event into the
coordination observation; it is not provider execution state. An event id may
be reused only with the same immutable payload.

Before cloud delivery, the Local OpenMeld Service uses a separate bounded
controller-task outbox under its lane root. The outbox retains retryable
transport, membership, registration-order, and rollout failures with bounded
backoff. Permanent rejections are removed from retry and summarized in a
bounded local diagnostic. Neither the outbox nor its diagnostic is another
cloud task ledger.

Controller-task history is bounded without deleting live coordination:

- processed lifecycle events and stale unprocessed lifecycle events expire
  after 30 days when no active subscription or delegation references the task;
- terminal controller-task registrations and their terminal projections expire
  after 90 days when no active subscription or delegation references them and
  no unprocessed lifecycle event still requires the registration;
- unterminated controller tasks, active subscriptions or delegations, and
  recent recoverable callbacks are never deleted from a guessed wall-clock
  timeout;
- pending and accepted Center Agent Wake publications are retained without a
  wall-clock timeout; completed or failed publication rows expire after 90 days
  only when their delegation is no longer active;
- each scheduled deletion pass is bounded and uses the Agent Task Coordination
  database owner, not the Wake-evidence or future observability-only database.

RuntimeCoordinator execution, publication, retry, and terminal projection
evidence uses the Wake-evidence database owner. The exact Space Wake terminal
task outcome uses the Agent Task Coordination database owner, including direct
Space finalization, final-claim recovery, failure publication, Wake Stop notice
projection, and retry exhaustion. A future physical Wake-evidence split must
not move parent-child continuation inputs into the observability database.

Pre-head terminal failure publication uses a separate Core operational outbox.
It freezes the secret-free Space notice command and redrive envelope while
keeping claim, attempt, due-time, completion, and version fields explicit for
compare-and-set recovery. Pending rows have no time-based retention: Queue and
the minute scheduler must be able to recover them after any Wake-evidence
retention horizon. Scheduler enqueue does not postpone the publication due
time; only the publication claim excludes concurrent consumers.
`openMeldDaemon_ops_decisions` may record an audit projection but must never
own the publication claim, retry schedule, completion gate, or the only copy
of the frozen command. A future observability-only split keeps this outbox on
the authoritative Core database.

When accepted-result publication exhausts its repair window, Space first owns
the atomic visible-outcome choice. Its existing final claim wins, or Space
persists and claims one explicit publication-failure notice. Only that claimed
notice permits Wake evidence and Agent Task Coordination to project
`publication_failed`; the task outcome records the notice's signal id while the
original accepted result remains retained diagnostic evidence. A failed or
invalid Space RPC and a failed projection reread remain distinct observable
errors, never a synthetic missing record. Final-claim recovery reads back the
immutable Agent Task outcome after its idempotent insert; if that stored outcome
differs from the Space-derived outcome, Core records a reconciliation conflict
and keeps the durable retry instead of silently advancing other authorities.
Publication exhaustion checks any existing immutable Agent Task outcome for
compatibility before writing RuntimeCoordinator terminal authority or its
Wake-evidence projection. It records and propagates a new Agent Task outcome
only after those execution-authority writes agree, so a continuation cannot run
ahead of RuntimeCoordinator terminal truth.

The Local OpenMeld Service exposes controller callbacks as a distinct
diagnostic channel in `openmeld activity status` and
`openmeld activity health`: pending callback count, callbacks waiting for
retry, and bounded recent permanent rejections. Permanent rejection details
retain only safe controller/task lifecycle metadata, cap their history at 200
records, and never include prompts, notification text, transcript paths, tool
arguments, or provider payloads.
Malformed callback or diagnostic records are quarantined before replacement
and surface as bounded `invalid_outbox_record` evidence. Only a missing file is
treated as absent; permission, device, and filesystem failures remain explicit
so health output cannot silently report a clean callback channel after losing
diagnostic evidence. Health reads reconcile recognized quarantine entries back
into the bounded diagnostic ledger, so an interruption after quarantine cannot
make damaged callback evidence look healthy. Recovered diagnostics are ordered
by occurrence time and stable event identity before the newest 200 are retained;
filesystem enumeration order never decides which evidence survives.

`agent_delegations` and `agent_delegation_children` store parent-child topology,
barrier generation, child role, and coordination outcome. A continuation is a
new execution linked from the settled subscription; it never reopens or mutates
the terminal parent or child execution. One-shot barriers elect one ready
subscription as the durable winner before completing the delegation. A
claimed continuation must match the delegation generation, claim id, and
non-stopped parent before each external admission boundary. `on_each_terminal`
uses one subscription per exact child. Earlier outcomes may remain pending
until the barrier completes, but every terminal child outcome is retained in
the delegation projection and included in the bounded continuation snapshot.

Fallback children begin in `planned`; primary children alone become active
after the initial Space message is accepted. Authoritative primary failure
readies a separate fallback-activation subscription. Primary non-failure marks
the fallback `skipped`. Parent Stop changes planned and active children to
`cancelled`, cancels pending or claimed subscriptions, and leaves execution
cancellation to the existing Space Wake Stop and native delivery authorities.
Continuation idempotency keys remain discoverable after cancellation so a
transient missing Stop target or transport failure can be retried without
creating another continuation. Historical subscription rows remain valid
observer evidence for idempotent terminal replay after their state becomes
`settled` or `cancelled`; active-state filtering must not suppress unfinished
Stop propagation. Parent Stop attempts every known child and continuation
target before surfacing an aggregate retryable failure.

## Remote Agent Native Delivery Ledger And Usage Evidence

Native delivery (the hosted Center Agent runtime,
`developing/product/remote-agent-runtime.md`) records each interaction in a
Core-owned native delivery ledger, separate from the wake Dispatch Ledger. Like
the Dispatch Ledger it records what happened (submission, callback, runtime
policy rejection, failure code, bounded sanitized failure detail, `onBehalfOf`,
durable callback publication context such as thread placement, the exact source
`clientMessageId` for a Space Wake, and the published reply pointer) and is not
in-flight execution authority. The exact source client-message identity is
written by the native delivery owner from its durable admission request;
terminal coordination must not reconstruct it from Dispatch Ledger. The ledger
exists so trace and diagnostics cover native delivery with the same
deterministic-evidence rule as wakes.

For legacy Slack result surfaces, the ledger also records an optional shared
Working-status turn identity used only to derive provider presentation. One
ordinary delivery derives its effective identity from its idempotency key and
leaves this override null. Multiple deliveries that are intentional fan-out
from one user turn share an explicit override across recovery. When a new Core
replays or continues a fan-out admitted by an older Core, it compare-and-sets
nullable siblings under the same exact Slack trigger, conversation scope, and
explicit idempotency-parent lineage to that shared identity. A late legacy row
that remains nullable derives the same effective identity only when exactly one
explicit parent lineage matches; conflicting parent lineages fail closed. This
field groups lifecycle evidence but does not own execution, conversation, task,
or authorization truth. Older nullable rows remain replayable and readable as
single-delivery turns during rollout.

`openMeldRemoteAgent_conversation_generations` is the Core-owned routing
projection from one Organization-scoped logical Center Agent conversation to
its active Remote Agent runtime generation. Core is its only writer and uses a
compare-and-swap advance so concurrent rollovers converge. The row records the
generation, deterministic runtime route, rollover delivery, and lifecycle
timestamps needed for diagnostics. It is not a transcript, summary, memory,
Task lifecycle, native-delivery ledger, or execution authority. Deleting or
rewriting it must never be used to repair conversation content or publication.

The durable worker request is also the model-routing execution truth. Version 2
records the complete primary and auxiliary model route resolved at admission,
including capacity, reasoning, modalities, catalog timestamp, preference kind,
and the explicit no-fallback policy. A later Organization preference or system
default change never rewrites an accepted row. Recovery reuses the stored
request, and an exact-task continuation inherits the observer's stored active
or recovery request rather than resolving the current preference. If retention
has cleared both request copies, continuation fails with
`remote_agent.task_continuation.original_model_route_unavailable`; absence is
not permission to create a version-1/default-model request. A new, independent
turn resolves again.

`openMeldRemoteAgent_work_loop_attempts` is the append-only diagnostic history
for automatic continuation inside one native delivery. Each row archives the
exact prior idempotency key, worker submission id, durable worker request,
structured checkpoint, next idempotency key, attempt number, and continuation
time before the active ledger row advances. The native-delivery row remains the
single current delivery projection and the only finalization/publication
owner; the history table is neither a second execution state machine nor a
second conversation transcript. Core changes both records in one transactional
D1 batch. A duplicate old callback reads this history and converges without
resubmission, while mismatched identity or checkpoint evidence fails closed.

Model ids, friendly names, capacity values, reasoning levels, and the auxiliary
model id are non-secret diagnostic metadata. Raw image bytes, base64,
image-understanding descriptions, prompts, provider responses, and user message
content must not enter model-routing logs or Analytics Engine. Usage evidence
attributes the effective primary model. The auxiliary image call is part of the
same admitted turn, not a second Center Agent delivery, preference, or fallback
ledger. Worker process registries use an Organization-and-route-scoped provider
identity so concurrent turns cannot exchange capability metadata, Gateway
headers, or usage reporters.

When exact-task coordination resumes a hosted Center Agent, the observer
Native Delivery is also the continuation destination authority. Space and DM
continuations reuse its Space identity and thread placement. Legacy Slack
continuations reuse its Slack team, channel, and thread locator. Generic
Message Channel continuations reuse its typed locator and mint a new
deterministic provider publication key for the new delivery. The coordination
subscription cannot redirect any of these result surfaces.

For a connected Message Channel member, the frozen worker request inside the
native-delivery ledger is the provider-scoped attribution source. It records
the Core-authored sender and Message Channel identity without creating a Better Auth member,
Human Profile, or second identity registry. Core resolves each
connected-member tool call through `agentControllerConversationId` and matches
that exact delivery before authorization. A successful audited read stores a
reference to the source native delivery; readers follow that reference to the
provider, connection, provider user, and display name instead of copying or
reconstructing those facts in the Center Agent audit journal. Existing
verified-member audit attribution remains unchanged.

Organization-shared App reads and policy-approved non-destructive writes use
that same source-delivery reference. The connector operation stores the shared
connection snapshot and source native-delivery id, while the delivery remains
the single provider-member attribution record. Audit readers resolve the human
display from that frozen delivery and label the action as initiated from the
connected Message Channel. They never present the shared connection's installer
as the requester or imply that the provider member has an OpenMeld account.

For a verified member acting through a Space-native delivery, Core also derives
the source Space from that exact delivery after the same identity checks. The
first connector-operation audit row freezes the nullable `sourceSpaceId`; later
completion, failure, and replay rows reuse it instead of accepting a caller's
current Space. The field is provenance for bounded follow-up lookup, not
authorization or permission to merge conversation histories. Audit readers opt
in through action set `v20`; older action sets omit the field entirely.
Only a native delivery whose `conversationKind` is `space` may populate
`sourceSpaceId`. Legacy Slack and generic Message Channel deliveries keep their
external conversation identity in their owning locator and leave
`sourceSpaceId` null; an external conversation ID must never be reinterpreted as
an OpenMeld Space ID.

For a native delivery created from a Space Wake, the native-delivery ledger
remains the authoritative hosted execution record while the Dispatch Ledger is
the public Wake trace projection. Core closes that projection only from a
confirmed terminal native-delivery record: success after final reply
publication, failure after final failure publication, or an authoritative Stop.
Publication failure or an ambiguous provider outcome must leave the Wake trace
unsettled and preserve retry or outcome-unknown evidence instead of claiming a
terminal visible result.

Inside the Remote Agent Durable Object, one private durable execution record
atomically owns successful terminal state and its bounded final answer. The
shared execution query remains a status projection and does not expose reply
text. Callback context receives the same answer as a recoverable delivery
projection; an instance restart may repopulate it from the execution record and
retry the ordinary Core callback. Partial stream text, failed execution,
cancellation, and observability records cannot become this answer authority.
Every observer and reconciliation path derives its callback from the terminal
compare-and-set winner. A stale or conflicting callback-context answer is
replaced by the execution record's exact normalized answer before publication;
a legacy callback-only answer cannot repair a completed execution that has no
owner answer. That invalid legacy owner state is durably changed to failure,
and either side of a restart can repeat the same explicit-failure projection.
One terminal-outcome projector maps completed, failed, aborted, and missing
execution outcomes into callback payloads for both observation and
reconciliation. If the callback projection itself is missing, reconciliation
fails with `remote_agent.terminal_callback_projection_missing`, leaves the
execution owner unchanged, and remains retryable and diagnosable through the
Core reconciliation path instead of silently reporting terminal success.

The active Space Wake read model may project an accepted native delivery as
`running` only before Core has received its terminal callback and before final
publication has started. Callback receipt or a claimed final publication
projects `publishing`. A permanent `outcome_unknown` final publication projects
the terminal presentation phase `publication_unknown`, preserves its machine
reason, and tells the user to inspect the destination before trying again. It
must not project `retrying` or keep an active spinner because Core will not retry
that ambiguous provider outcome automatically. The final visible Space signal
closes the active presentation.

Terminal provider failures keep one stable machine reason and the sanitized
provider detail that justified it. For example, a context-window rejection
records `remote_agent.turn.context_window_exceeded` plus the provider-reported
requested and supported token counts. Public failure copy remains
OpenMeld-owned; diagnostics may show the durable detail but must not recover it
from logs or infer it from a generic failure notice.

Remote Agent tool results are bounded before they enter Flue conversation
persistence. Large file reads use a model-visible segment and continuation
offset and retain only allowlisted bounded file metadata before crossing that
boundary. Missing decoded text fails explicitly without preserving the raw
provider payload, while any other oversized direct result becomes the stable structured
tool outcome `remote_agent.tool_result_too_large` instead of the original
payload. If an older or unexpected path still reaches the Durable Object's
SQLite size limit, the terminal native-delivery failure uses that same stable
reason and OpenMeld-owned public explanation. The raw SQLite error is bounded
diagnostic evidence only; it must not become Space copy.

Ledger creation is not a prerequisite for a visible result. If Space native
delivery fails before its ledger row can be created or read, Core uses the
original durable dispatch envelope to publish the standard persisted
`terminal_failure` notice to that Space. It does not invent a successful ledger
row. The queue message is acknowledged only after that failure publication
succeeds; otherwise the thrown publication failure preserves retryability and
diagnostic context.

The native delivery ledger is also the diagnostic read projection for result
surface routing. It records `conversationKind`: `space` rows publish through
the Space standard send path, while legacy `slack` rows record
`slack_team_id`, `slack_channel_id`, and `slack_thread_ts` and publish back to
that Slack thread. New generic rows use
`conversationKind = "message_channel"` and freeze the provider, connection id,
typed locator JSON, provider publication idempotency key, and provider
publication result id. Only the adapter selected from that locator may publish.
A malformed or incomplete locator fails closed; readers never infer a provider
from the conversation-id prefix. A ledger row describes one result surface
only, and external provider results are not mirrored into a Space timeline or
another connected provider.

An interactive Center Agent turn may read a bounded self-diagnostic projection
of its own current native-delivery row and recent rows from the same requester
on the same conversation surface. Core derives the current row only from the
trusted `agentControllerConversationId`; the model cannot supply a delivery,
dispatch, submission, user, channel, or Space selector. Previous rows must
match the same Organization, Center Agent profile, requester identity, and
surface. Slack direct-message history is scoped to the same workspace and
channel rather than one thread so separate top-level requests remain
diagnosable. Every row carries its typed conversation source and an explicit
current-conversation comparison, so this broader read never erases thread
provenance. A malformed historical source remains unattributed instead of
being relabeled as the current thread. The projection returns identifiers,
lifecycle timestamps, raw
recorded status, bounded sanitized failure evidence, final-publication state,
and the provider result pointer. It never returns prompt text, reply text,
tokens, raw provider payloads, another member's history, or Routine history.
Execution status, failure evidence, and publication are independent facts; a
reader must not infer any one from the others or from user-facing copy.

For an interactive Center Agent turn, that self-diagnostic projection also
joins bounded exact runtime evidence by the native-delivery submission id. Core
reads each distinct frozen runtime conversation represented in the bounded
history, so a conversation-generation rollover does not hide evidence for an
older Slack or Message Channel turn. The Remote Agent Durable Object owns this
per-turn evidence and expires it after seven days. It records only structured
milestones and decisions: provider
request preparation and response headers, first model event, first visible
assistant content, model completion, model and tool counts, capability search
and describe results, the source of each tool call, and whether the per-attempt
tool budget was exhausted. It never records prompt text, reply text, model
reasoning, tool arguments, tool results, tokens, or provider payloads.

Core reports runtime evidence as `available`, `not_recorded`, or `unavailable`.
`not_recorded` means the exact runtime was reached but has no retained evidence
for that turn, including turns created before this contract shipped.
`unavailable` means Core could not read the exact frozen runtime conversation.
Readers must preserve that difference and must never reconstruct either state
from answer wording, elapsed time, or publication outcome.

For Lark-platform final replies, the same native-delivery row also owns the
frozen provider payload, attempt count, next-attempt time, provider-progress
sequence, and ambiguity deadline. The first standalone reply attempt starts
Core's conservative 60-minute UUID recovery window; if its result is ambiguous,
Core persists the deadline anchored to that pre-I/O attempt time. Core may retry
only the exact persisted payload, typed locator, and deterministic provider UUID
while that deadline remains open. Concurrent callbacks remain fenced by the
final-publication claim, and callback or queue replay returns the durable
remaining `retryAfterMs` without terminalizing the delivery or its Agent Task
subscription. At the deadline, an unresolved ambiguity becomes the single
permanent `outcome_unknown` result, the frozen payload is removed, and only then
does the Agent Task projection settle as `publication_failed`. CardKit
finalization freezes its provider sequence before provider I/O but does not
borrow the reply API's recovery duration. No second retry table or
provider-specific execution ledger may own these facts.

For Task-owned native delivery, the final result text is retained in the native
ledger only as a replay bridge until the Task owner has durably appended the
canonical terminal event. The projector then erases that payload from the
native ledger. If the Task row or attempt does not exist yet, projection keeps
the exact payload so a later replay can still create the canonical Task event;
it never substitutes a generic success message while exact text remains
available. Core's bounded minute recovery scans these retained Task-owned
terminal payloads after Task admission and Stop recovery, then re-enters the
same Task projector; correctness never depends on the worker sending a duplicate
callback. Owner-store failure or a still-missing attempt leaves the exact payload
in place for the next recovery tick. Every bounded scan records its Task terminal
projection attempt on the native ledger and orders never-attempted rows first,
then least-recently attempted rows. A permanently missing attempt or temporary
owner-store failure therefore cannot monopolize the oldest batch and starve a
later recoverable Task result. Once the Task attempt exists, a Stop fence,
a superseded generation, an existing conflicting terminal outcome, or an active
`needs_attention` state
is a durable Task-owner rejection rather than a replayable gap. Those paths
erase the exact staged payload without rewriting Task truth, while preserving
the non-sensitive delivery metadata needed for diagnostics. A Task or Inbox
store failure fails the projection and retains the payload for retry instead of
turning an unavailable owner into an implicit rejection.

Routine deliveries add a `routineRunId` association and use the frozen
Routine destination: `conversationKind = "space"` for an OpenMeld Space or
`conversationKind = "slack"` with its team/channel/thread locator. Their canonical diagnostic entry is
`organizationId + routineId + runId`, which resolves the Run, native delivery,
recorded destination snapshot, worker submission/callback evidence, and
published Space signal or Slack timestamp without pretending the Run is a Wake
dispatch. A skipped Run has no native delivery and no destination publication.
A failed Run keeps its failure-publication retry evidence visible until the
destination outcome is known.

When the initial Routine turn registers its one allowed all-terminal resume,
its accepted worker request retains the original Core-authored Routine envelope
until that initial callback is recorded. The continuation copies the frozen
destination and delegated-member audit identity, attaches exact child terminal
evidence, and atomically replaces `routine_runs.native_delivery_id`. The initial
delivery may become terminal but cannot publish or terminalize the Run. The
final continuation clears its worker request at terminal settlement like other
native deliveries. A deterministic pre-execution rejection may terminalize that
delivery first, but the Run remains submitted until the Workflow accepts the
exact terminal continuation event and its retryable finalization step validates
that failed delivery and projects the Run. A caller may perform the same
idempotent projection for low latency, but Workflow completion never depends on
that caller write succeeding. Replaying the terminal delivery reconciles the
already-finalized Run without sending another event to a completed Workflow or
admitting a second worker turn.

The ledger may retain the reauthorized delegated member as an audit snapshot,
but the Routine worker request itself keeps `onBehalfOf = null`; the turn
envelope's `sender.delegatedBy` is the worker-visible delegation truth. A
structured worker admission rejection records its bounded reason code and
message on the Run and native-delivery ledger immediately. It is distinct from
`submit_outcome_unknown` and must not age into
`remote_agent.worker_ack_recovery_expired`. Thrown RPC and transport errors do
not prove rejection and remain eligible for bounded idempotent recovery.

The same worker-admission rule applies to ordinary Space, Slack, Routine, and
member-research submissions. Every entry point parses the shared success-or-
rejection response union, persists the exact worker request before submission,
and reuses its idempotency key when the result is unknown. Only a structured
rejection or a confirmed missing RPC receiver is an immediate admission
failure; transport errors and invalid response payloads do not prove that the
worker rejected the task.

Accepted native delivery has no elapsed-time terminal transition. The legacy
`remote_agent.delivery_expired` code is retained only to reconcile rows written
by older Core deployments. When a matching late callback arrives, Core clears
the false terminal state and records the retired failure code, its published
notice pointer, and reconciliation timestamp before publishing the real result.
Those fields are durable incident evidence; they must not become a second final
outcome or be erased after reconciliation.

Accepted-delivery recovery preserves the same ownership split. Core's durable
probe invokes the Remote Agent's additive `reconcileExecution` RPC for the exact
delivery and submission, then rereads the native-delivery ledger. Remote Agent
alone maps Flue's durable submission projection into OpenMeld worker
execution state and durable callback context; Core alone accepts that callback,
updates the ledger, and publishes the visible result. Missing receiver or
transport evidence is a retryable capability gap, not success and not terminal
failure. An exact execution-identity mismatch cannot self-heal. Core moves its
failure through the existing durable final-publication claim and retained
payload. A known transient publication failure releases the claim back to the
original accepted state without losing that payload, and the renewable probe
plus scheduler compensation retries the same idempotent publication. Core
stops renewing the probe only after publication is confirmed or fenced as
outcome-unknown. Rollout is Remote Agent receiver first, then Core caller;
rollback removes Core first.

The native-delivery ledger stores a renewable accepted-probe next-due time.
Every successful initial enqueue and self-requeue moves that time forward; the
first-enqueued timestamp is immutable audit evidence, not proof that a Queue
message still exists. Core's minute scheduler scans null or expired due times
and conditionally moves one row to a bounded lease before sending compensation,
so overlapping scheduler invocations cannot enqueue the same recovery
concurrently. A send failure releases only that exact lease when Core knows the
preceding operation stopped. If a reconciliation RPC timed out, send failure
keeps the processing lease until expiry because the underlying RPC may still be
running. A process failure is likewise recovered after lease expiry.
Cloudflare Queue's finite retry budget therefore cannot permanently strand an
accepted delivery. This due time and lease remain reconciliation projections;
neither owns execution or authorizes a terminal outcome.

Core also owns `openMeldRemoteAgent_daily_admissions`, with one row per
`organizationId + dayUtc`, and the native-delivery ledger's
`dailyAdmissionDayUtc` idempotency marker. A D1 batch couples the single atomic
`INSERT ... ON CONFLICT ... DO UPDATE ... WHERE count < limit RETURNING`
decision with the ledger marker. This makes the count authoritative under
concurrency and makes ambiguous replay idempotent without reviving the retired
guardrail table. The counter covers all five native-delivery trigger types,
resets by creating the next UTC-day row, never refunds an admitted downstream
failure, and has no tenant exemption. Core is the only writer; diagnostics may
read the bounded counts and ledger marker, but neither is in-flight execution
authority.

The Organization Usage overview is a read projection over this daily counter
and the canonical Routine repository. A missing row for the current UTC day
means zero admitted wakes; it is not an error and does not create a row. The
projection resolves the daily limit through the same Core configuration owner
used by admission, returns the next UTC midnight as the reset instant, and uses
the shared single 50-Routine definition limit. All 50 definitions may be
enabled; paused definitions still count because this is a definition limit, not
an execution reservation. The projection is readable by any active Organization
member and cannot mutate, reserve, refund, or otherwise influence admission or
Routine policy.

The serialized worker request used for ambiguous Routine submission recovery is
sensitive staging data. Core writes it as a versioned private storage envelope
whose request member must satisfy the shared worker-request schema. A reader may
accept an unversioned historical value only when that whole value still
satisfies the current strict schema. Malformed JSON, an unknown storage version,
or a legacy value that lacks current identity or routing fields is explicit
invalid recovery evidence: it must not abort the batch scanner, be logged as raw
payload, or be repaired by inventing authority. Core terminalizes the linked Run
and publishes its ordinary visible failure to the frozen destination. The
staging value may support bounded recovery but must not become a query payload,
log dump, prompt archive, or second Routine definition.

Slack terminal publication, for both successful replies and failed-callback
notices, records a fenced publication substate: `claimed`, `published`, or
`outcome_unknown`. The main delivery remains nonterminal while publication is
merely claimed. Only a non-empty Slack message timestamp finalized by the same
claim id may settle the delivery as `completed` or `failed` with a published
result; provider-ambiguous results and expired claims move to `outcome_unknown`
and are not automatically republished. These fields coordinate one
result-surface write and remain separate from native-agent execution truth.

New generic Message Channel publication uses the same fenced substate with a
provider publication idempotency key and bounded provider result id. The frozen
typed locator chooses the adapter and destination before the claim.
Lark-platform standalone reply ambiguity follows the bounded 60-minute
same-UUID recovery contract above. Provider operations without a documented
deduplication window, including CardKit mutation ambiguity, become
`outcome_unknown` immediately; neither a Queue retry nor a worker callback may
republish them automatically or select another connected provider.

Native-delivery admission also freezes the originating recovery destination
and controller normalization evidence in the native-delivery ledger. The
snapshot contains the Space thread, Slack channel/thread, or Lark/Feishu typed
locator needed by publication and recovery. Inspect and execute read that
historical snapshot; they never recalculate it from the current mutable
Binding, caller surface, or current connector selection. Retained final payload
and provider publication identity stay on the same delivery row so Tier 1
replay uses the original Slack metadata or Lark/Feishu UUID. A legacy or
incomplete row fails closed instead of silently becoming a Space destination.

Connector writes append durable Center Agent audit phases through Core:
`execute_connector_action`, followed by
`complete_connector_action`, `fail_connector_action`, or
`record_connector_action_outcome_unknown`. The resource id correlates service,
provider action, and OpenMeld operation id without copying Issue bodies,
provider responses, credentials, or prompt text. Audit journal readers opt in
with `actionSet=v5`; older action sets exclude these entries so strict deployed
clients never receive unknown enum values.

### Lark-platform connection and credential ownership

Core owns Lark and Feishu Personal Agent registration, connection lifecycle,
identity links, and provider credentials. One non-secret connection row is
unique by Organization and provider, and by provider and App ID. Lark and
Feishu are explicit provider values even though the repositories share the
`openMeldRemoteAgent_lark_platform_*` table family.

A short-lived registration-attempt row stores the encrypted device code,
expected provider, current provider account domain, due time, interval, expiry,
poll lease, requested permission-bundle version, canonical lifecycle status,
and bounded failure reason in the Core local-state domain. Core's independently
isolated, bounded minute tick lists due attempts from that owner database, and
each continuation may make one provider operation only after atomically
claiming a due lease. Every provider operation has a total deadline shorter
than that lease. An open Web wizard may request the same continuation for
faster feedback, but the lease keeps the scheduler and Web on one write path.
`slow_down` advances the interval; expiration, denial, brand mismatch, and
unknown response fail closed. Web owns no in-memory poll process, and closing
or reloading it cannot stop a durable attempt.

Before each scheduled continuation, Core reads the canonical Organization
Personal classification. An unavailable or malformed classification fails
closed before any provider operation and quarantines the attempt as consumed
`repair_required` with `organization.context_unavailable`. This releases the
bounded scheduler batch instead of letting permanently unreadable rows starve
later registrations; after Organization classification is repaired, the user
starts or repairs registration through the ordinary guarded path. A Personal
Workspace classification consumes the attempt with the bounded reason
`<provider>.organization_required`; if that attempt had already created a
`configuring` connection, the same D1 batch marks that connection
`repair_required`. This prevents a registration started before enforcement
from completing through the minute tick while preserving a visible connection
projection that the owner can disconnect.

Core derives the active-registration read projection directly from these owner
rows. It filters to the active Organization and currently enabled providers,
returns at most one safe non-terminal summary per provider, and does not decrypt
or return the setup URL, credentials, or initiating profile. Its viewer-specific
`canResume` capability is derived from current Organization permission and the
attempt's existing continuation authority; it does not create a new authority
or expose another installer's identity. The projection is read-only UI state,
not another registration ledger, continuation authority, or connection-status
fact. The canonical connection row remains the only source for connected,
repair, revoked, and disconnected presentation.

When the provider setup page fails without returning a protocol error, the
installer may explicitly restart a still-pending attempt. Core obtains a fresh
provider registration first, then atomically consumes the exact old pending
attempt and inserts its replacement under the existing one-active-attempt
unique constraint. The old row remains readable as `repair_required` with the
bounded reason `<provider>.registration_restarted`; it is history, not a second
active state source. Normal begin requests continue to resume the existing
attempt, and credential/configuration states cannot be restarted through this
path.

The provider device-flow expiry governs only acquisition of the App
credentials. Once Core atomically saves those credentials and creates the
connection, it advances the active attempt to a seven-day, Core-owned
configuration window. An explicit repair of a `repair_required` or `revoked`
connection creates one new `configuring` attempt bound to the same connection
and credentials, while the failed attempt and its bounded reason remain
historical evidence. The repair batch clears the connection's previous
bot/capability projection and Webhook proof so the first repair poll must
reconfigure and verify the provider App. It neither creates a second connection
nor calls the provider device-registration endpoint. The new attempt records
the manager who initiated this repair; the connection keeps its original
installer identity. Configuration and Webhook-wait retries use bounded
exponential backoff from five seconds to five minutes across the seven-day
window. Missing credentials, a different current connection state, or another
unrelated active attempt fails closed. A stale Repair request after another
manager has already restored the connection reports the existing
already-connected fact; it does not reclassify the healthy connection as an
unrepairable App. Retry projections retain the latest bounded failure reason so
clients can explain continued automatic verification without creating a second
retry authority.

Before configuring an unconnected App, the live configuration-claim owner
replaces only callback secrets exceeding the provider's 32-character limit.
The encrypted replacement and clearing both URL-verification proofs are one
guarded D1 batch. A lost or expired claim, changed credentials, or a connected
App prevents replacement and provider configuration. The App Secret and valid
callback secret values are preserved. This also repairs legacy credentials
when an existing App re-enters configuration through Repair; it is not a bulk
credential migration. URL-verification writes compare the encrypted token used
to authenticate the challenge with the current credential row, so an in-flight
challenge authenticated before replacement cannot restore obsolete proof.

The App Secret, Webhook verification token, and event encryption key live in a
separate encrypted credential row. The connection and credential write is one
D1 batch, so failed encryption or persistence cannot produce a connected
projection. Tenant access tokens are minted and cached only within their
provider lifetime inside one Worker isolate and are never stored in D1.

Webhook readiness is connection-owned evidence, not a generic provider flag.
The provider's encrypted URL-verification challenge may omit all three
signature headers. Core may decrypt that envelope only into a URL-verification
challenge and must match its verification token before recording reachability.
Partial or invalid signature headers are rejected. Ordinary encrypted events
still require a valid signature; this exception never admits an event or starts
a Center Agent turn.
Core records the Event Subscription URL challenge and Message Card Request URL
challenge separately. A Webhook connection becomes `connected` only after its
application configuration has supplied the bot identity and both surfaces have
answered a verified challenge. One surface never stands in for the other. The
second challenge atomically completes the active registration attempt only when
both surface proofs were received before that attempt expired; late and
out-of-order proofs cannot be combined to revive it. If an unfinished attempt
expires first, Core moves the attempt and only its exact Organization-,
provider-, installer-, and permission-bundle-matched `configuring` connection
to `repair_required`. Historical connection rows keep their existing readable
status while the new evidence columns remain nullable.

Lark-platform event delivery has four total Queue attempts. The final failed
attempt writes the ingress ledger to a durable `failed` terminal state before
the Queue message is acknowledged. It does not enqueue a fresh envelope that
resets the attempt count. The retained row keeps the provider event, Queue,
Gateway request, attempt, timestamp, and bounded failure evidence.

Provider images are transient admission inputs. A retry whose delivery was
already accepted returns the existing Native Delivery result and deletes the
newly prepared duplicate object before returning. Cleanup failure is recorded
without changing the already accepted delivery result. An admission whose
outcome is still unknown keeps the exact durable request and its object
available for a safe replay.

Provider user identity is application-scoped. Every link key includes provider,
connection id, and provider user id before mapping to one current Organization
member. Display names and matching email addresses never establish identity.
Only a current provider-private proof token, consumed by the intended signed-in
OpenMeld account, may create or move a link. One provider identity maps to at
most one OpenMeld member at a time. Self-service or Channel-manager detachment
deletes only that canonical relationship; it does not mutate the provider
connection or Auth membership. Historical `email_auto` source values remain
readable compatibility data but are never written as new identity authority.

Development and production credentials and connections are disjoint. A
development registration or callback host may not be written into a production
connection, and diagnostic output never contains a secret, access token, raw
scope response, device code, or message body.

### Slack workspace connection credentials

Core owns Slack workspace installation state and credentials. The
`slack_workspace_tokens` table is keyed by Slack team id, keeps one
organization-scoped installation record, and stores only an AES-GCM encrypted
bot token plus the normalized granted bot-scope set, bot user, installer,
organization, and timestamps. A null granted-scope set means a legacy or manual
installation whose current capabilities are unknown; it never proves direct
message readiness. The
workspace Binding and encrypted token write are one D1 batch so a failed token
write cannot leave a connected Binding without its credential. Disconnecting
deletes both records in the same batch.

This capability projection uses an additive rollout contract. The OAuth
installation input accepts an omitted scope set from an older Gateway and
stores it as unknown; the Web projection keeps direct-message readiness
optional for an older Core. Apply the nullable D1 migration first, then deploy
Core, Gateway, and Web in that order. New Gateway is not deployed before Core
because an older strict Core does not accept the new scope field. Rollback
removes Web and Gateway callers before Core and retains the nullable column.

Moving a workspace between organizations uses one D1 batch to compare-and-swap
the expected previous Binding to the destination organization, update the
encrypted token record's organization ownership, add the destination connection
audit, and add a visible move audit to the previous organization. The batch
turns a zero-row compare-and-swap into a transaction failure before any token or
audit write. A failure in any statement rolls back the whole move; Core must not
expose a half-bound or half-owned workspace. A changed or missing previous
Binding fails closed instead of moving a different current owner.

`slack_oauth_states` stores only a digest of a short-lived opaque state token,
bound to the organization, user, actor profile, Web return path, and nullable
expected previous organization for a confirmed move. Core
atomically consumes the row before Gateway exchanges the Slack code; expired,
tampered, and replayed states fail closed. Abandoned expired rows are removed
when a new state is created.

When Slack returns an exact authenticated installer user id, the installation
batch also upserts that provider identity as an explicit link to the state-bound
OpenMeld installer. This link is part of the same created, unchanged, or moved
workspace transaction as the encrypted token. A welcome action therefore never
depends on a second identity-link setup after OAuth succeeds.

Slack Web API calls resolve credentials in this order: the encrypted
per-workspace record, then the legacy global `SLACK_OPENMELD_BOT_TOKEN` only
when no workspace record exists. A present record that cannot be decrypted is
a visible failure and must not silently fall back to the global token.

`slack_channel_introduction_runs` and
`slack_channel_introduction_items` are the durable multi-channel publication
manifest. The run freezes the workspace, Organization, requester, private Slack
conversation, optional Organization invite URL, and acknowledgement outcome.
Each ordered item freezes one selected public channel and owns its own claim,
attempt count, and submitted/failed/outcome-unknown checkpoint. Remote Agent
native-delivery idempotency includes the interaction and channel ids. A
provider-accepted native delivery whose item checkpoint is temporarily
unavailable remains `submitting`; stale-claim recovery reuses that exact
native-delivery identity and never writes a contradictory failure. A stale
submitting claim may be reclaimed, while a submitted or provider-ambiguous item
is never automatically replayed. The private acknowledgement carries the
interaction id as Slack message metadata. If Slack confirms publication but the
run checkpoint cannot be written, the run remains `ack_pending`; scheduled
recovery finds that exact message through Slack history, persists its timestamp,
and only then releases the frozen channel items. If no exact message exists,
recovery moves the run into a durable private-retry-notice state instead of
risking a duplicate. That notice has its own claim, attempt count, stable Slack
metadata, confirmed timestamp, and ambiguous-outcome checkpoint. Only one claim
may publish it; a known non-publication is retried a bounded number of times,
while a provider-ambiguous result is never replayed. A confirmed acknowledgement
is never converted to a terminal failure because a later D1 write failed.

`slack_installation_welcome_deliveries` is the durable publication ledger for
the installer welcome DM. Its identity includes Slack workspace, OpenMeld
Organization, recipient Slack user, workspace-connection generation, and
welcome version, so moving or reconnecting a workspace creates a new welcome
without duplicating one connection's message. A claim is persisted before the
Slack call. Confirmed non-publication becomes `failed` and may be retried on a
later OAuth reauthorization. The scheduler never reclaims that `failed` row on
its own: reauthorization first changes the matching failed preparation to an
explicit retry-authorized ready state, and only that state may reclaim the
publication row. Provider-ambiguous publication becomes
`outcome_unknown` and is never retried automatically. A stale `pending` claim
is classified as `outcome_unknown`, not reclaimed. The ledger stores only
bounded outcome metadata and Slack's published message timestamp, never the
welcome text, blocks, token, or provider response body.

`slack_installation_welcome_preparations` is the separate durable work ledger
that gates publication on completed member research. It owns the installer,
workspace-connection generation, research-task link, and queued/researching/
ready/completed/failed lifecycle. The member-research task stores the bounded
accepted report result (`evidence_backed` or `insufficient_evidence`) beside its
lifecycle; it does not copy findings or the report body. Slack onboarding reads
that structured result and never reclassifies evidence by scanning rendered
Profile Report Markdown. A preparation can
become ready only when the task's Profile Report Organization Document and the
exact Center Agent Computer file evidence join successfully. The publication
ledger remains the only Slack-send authority; preparation readiness never
means that Slack received a message. A research or report-file failure uses the
same publication ledger to send one plain failure-aware welcome with an inline
“try again” CTA before the preparation becomes terminal; it does not add a
second notification authority or store message copy in D1.

`center_agent_member_research_computer_files` proves that Remote Agent wrote
Core's exact rendered Profile Report content to the Center Agent's private
Computer. It binds one research task, Profile Report document, subject user,
submission, and path. The row is completion evidence, not a second document
body or a new source of Profile Report truth. Core remains the only Markdown
renderer and Organization Documents remains the formal reviewable document.

`slack_teammate_invitation_deliveries` is the idempotency and onboarding ledger
for native Slack teammate selection. Its publication identity is the Slack
view interaction plus selected target user. It records only target identity
metadata already returned by the live Slack workspace directory, bounded
outcome state, Slack message timestamp, and later joined-member research
linkage. A provider-ambiguous send is never retried. The joined-member flow
advances only after exact normalized email matches a current Organization
member with an active Human Profile; Slack display names and titles never
establish identity. Every invitation carries its interaction-and-recipient
delivery identity as Slack message metadata. If Slack confirms publication but
the `delivered` checkpoint cannot be written, Core reports the real delivery
outcome and leaves the row pending. Scheduled invited-member onboarding
reconciles stale pending rows against that exact metadata before claiming a
joined member. A match restores `delivered` and `waiting_for_join`; confirmed
absence becomes `outcome_unknown` without blindly sending a duplicate.

The retired Remote Agent guardrail table and breaker columns remain in the
schema and historical migrations because old rows are durable evidence. Active
Core code no longer reads or writes those fields, does not refresh AI Gateway
REST Logs, and does not add usage columns to the native delivery ledger. Runtime
containment is the global Remote Agent kill switch plus the optional
per-organization blocklist in Worker configuration. The active daily admission
counter is separate storage and must never read from or write to the retired
guardrail table.

Usage evidence for the Flue Remote Agent lives in the Remote Agent worker:
per-turn usage records are normalized from model usage, stored in the worker's
OpenMeld-owned records, emitted to Analytics Engine, and exposed to operators
through `readUsageDiagnostics`. Analytics and usage diagnostics are read models;
they do not decide route ownership, retry, timeout, or final execution state.

Successful Flue conversation compaction is operational evidence, not a second
conversation or memory store. During compaction, the worker may retain one
conversation-scoped start record containing only submission identity, event
index, reason, estimated token count, and timestamp. Completion updates the
already-required submission callback context with one safe versioned checkpoint:
completion time plus the number of successful compactions observed for that
submission. The temporary start record is then removed. A normal turn performs
no compaction-specific storage read or write.

Flue remains the only private conversation and compaction owner. Its checkpoint
schema keeps observed historical facts, current status, and pending plans in
separate sections. A current or planned statement cannot erase an observed
event, and temporal or target scope cannot be widened during summarization.
Before each compaction, Flue rebuilds one bounded action-evidence read projection
from the active path of its canonical conversation events. That projection
contains tool names, call and error or non-error result counts, and first and
latest timestamps, but no arguments or result content. The runtime strips any
older projection from the model-authored summary and appends exactly one fresh
projection. This is not another transcript or writer, and a non-error result is
not independent proof of an external provider effect. OpenMeld does not copy
the generated checkpoint or action-evidence projection into D1, Agent memory,
Task events, callback context, Signals, or Analytics Engine.

Structured compaction events record only correlation IDs, timestamps, duration,
message counts, estimated token count, Flue reason, checkpoint count, and
bounded issue codes. The issue codes are `missing_start`,
`message_count_not_reduced`, and `repeated_in_submission`. Logs, callback
context, native-delivery evidence, final Signals, Agent Activity, and Center
Agent memory must not contain the compaction prompt, generated summary, message
text, or transcript. A failed compaction emits diagnostic evidence but does not
author a successful checkpoint.

Remote Agent runtime evidence uses the shared Cloudflare projection separately
from the existing usage row shape. `remote_agent.openmeld.rpc` records bounded
service-binding RPC outcomes, including structured admission rejection and
already-running conversation outcomes. `remote_agent.openmeld.turn` records one
completed Center Agent prompt outcome with duration and a bounded reason code
for success, provider failure, or submission timeout. The first Analytics
Engine blob distinguishes runtime evidence from `remote_agent.turn_usage.v1`;
neither row shape may include prompts, message text, provider response text, or
tokens. These events explain worker observations only and cannot become a
second admission, in-flight execution, native-delivery, or retry authority.

The pre-replay conversation-footprint guard is also numeric evidence, not a
transcript read model or execution authority. It may emit conversation and
submission correlation IDs, batch count, serialized canonical bytes, largest
batch bytes, and `normal | soft_limit | hard_limit`. It must not select, copy,
log, or project message text, summary text, prompts, attachments, or tool
results. Its only mutation effect is the shared hard-limit admission rejection;
it does not rewrite Flue history or decide an already-admitted submission's
final outcome.

Hosted external tool usage is a separate Analytics Engine projection named
`remote_agent.tool_usage.v1`. It records the organization, Space, submission,
tool name, provider, operation, outcome, wall duration, bounded input/output
byte counts, provider request count, and Browser Run milliseconds when
available. Research records OpenRouter server-tool request counts, Browser Run
records `X-Browser-Ms-Used`, and Cloudflare Sandbox records each filesystem or
shell adapter operation. Stateless Code Mode records one outer Dynamic Worker
execution with bounded generated-code input and result byte counts plus the
number of inner tool calls. Each inner call keeps its existing capability-owned
usage record. Generated code, tool arguments, commands, tool results, logs, page
content, screenshots, prompts, provider response text, credentials, and file
contents must not enter the Analytics Engine row. These are raw usage and
reliability observations, not prices, credits, quotas, pilot budgets, admission
authority, or billing truth. Pricing and packaging remain a later product study
after production usage observability exists.

No-progress protection is separate short-lived worker state, not execution or
effect authority. The Remote Agent stores one expiring record per submission
with a total call count and at most sixteen recent observation fingerprints.
The fingerprints cover canonical tool name/input and result values; raw tool
arguments and results are never stored in this record. It expires after one
hour, cannot authorize or replay an action, and applies unchanged-result
detection only to definitions explicitly classified as observation-only.

## Space Agent Stream Projection

Center Agent reply streaming for a Space is short-lived presentation data owned
by the Space Durable Object. The active snapshot is returned with the Space
bootstrap snapshot so a browser can rebuild a temporary reply on room entry
without a second read. The conversation-state read model remains a compatibility
surface for older deployed clients. The projection expires after the bounded
window and is not a Space message, native-delivery status, or final-outcome
record.

Closing a stream removes the active snapshot and leaves only a bounded terminal
guard that rejects late deltas. A terminal WebSocket frame is therefore not
durable history. The persisted Space reply, stopped notice, or failure notice is
the final visible outcome and must remain independently queryable after refresh.

For privacy-bounded tool lifecycle parts, Space may keep a draft keyed by the
active stream. The draft contains only tool call identity for deduplication,
tool name, lifecycle state, and timestamps. It must not contain arguments,
results, raw errors, or Agent text. Before publishing a successful final reply,
Space projects the matching draft into optional durable Signal metadata that
contains only ordered tool names, lifecycle states, and truncation evidence.
After publication, closing with `final_message` moves the timestamped technical
summary under the published Signal ID and gives it a 14-day expiry; every other
terminal outcome deletes the draft. The durable display projection remains with
Space history, while the timestamped record is read only by Message details and
expires independently of the Signal. Space deletion removes both with the
owning Durable Object state.

## Center Agent Memory Data Boundary

Core owns the OpenMeld memory model. D1 stores the Organization enabled policy,
member/organization subject identity, provider references, deletion lifecycle,
and deletion errors. Zep Cloud stores the semantic episodes and search index
behind Core's `CenterAgentMemoryAdapter`; no client, worker, or tool may use Zep
as an authorization, scope, or policy owner.

Member memory and organization memory are separate subjects. The product rules
for when each subject may be written live in
`developing/product/organizations-and-center-agent.md`. Core alone resolves
those rules, performs provider reads/writes, and projects a bounded memory list
into the Remote Agent turn envelope. The worker consumes that projection and
must not query provider state directly.

Each Zep episode carries structured OpenMeld provenance metadata: the stable
memory source, capture method, source conversation and message references,
occurrence time, and the Message Channel provider when applicable. Raw source
references remain inside Core's provider metadata boundary and must not be
included in new episode text used for semantic fact extraction. Existing
episodes without structured metadata remain readable through their original
bounded OpenMeld episode headers during the rollout.

During edge search, the adapter resolves every associated episode within the
bounded provenance-read limit. The earliest valid occurrence is the original
source; later episodes are reaffirming or invalidating evidence and do not
rewrite it. Equal occurrence times use the episode UUID only as a deterministic
tie-breaker. Missing, unreadable, invalid, or over-limit associations make that
fact unavailable instead of allowing array order or the current recall surface
to invent provenance. Diagnostics retain bounded edge/episode correlation and a
reason code without recording memory text.

Memory search has one Core-owned query and latency contract. Turn assembly
preserves the current request first, then uses any remaining query budget for
the most recent relevant channel context. The memory service reapplies the
query bound at the provider-adapter boundary so Routine and future callers
cannot bypass it. The recall deadline covers both semantic search and the
provenance reads required before a fact is safe to project; it must not expire
after search while routinely preventing valid provenance from completing.
Provider rejection or deadline exhaustion leaves memory unavailable for that
turn and emits bounded diagnostics without memory text.

Core projects only the source, Message Channel provider when applicable,
subject, and bounded model-facing fact text into the Remote Agent turn envelope.
The bounded text includes the episode occurrence time. Core does not project
provider episode IDs, source conversation IDs, or source message IDs. A fact
that contains an exact raw source reference, or whose associated episodes have
no complete valid provenance, is omitted and diagnosed instead of entering the
model prompt or being assigned a guessed source.

The native delivery ledger is not a second memory store. Any message text kept
there for delivery or diagnostics is sensitive staging data: it must not be
used for recall, and it requires explicit retention and erase semantics rather
than inheriting the lifetime of ledger metadata. Member and organization memory
deletion must also clear memory-related ledger text and preserve a diagnosable
failure state when provider deletion fails.

## Information Protection Data Boundary

Core D1 owns the optional
`organization_information_protection_policies` row. The Organization ID is the
primary key; the bounded policy text, updating user, and timestamps are source
truth. Only an owner or admin may read or write it through the shared Core RPC.
Deleting the row represents clearing the optional policy. This state is neither
Center Agent memory nor an Organization Document and must not be copied into
either store.

The policy text is sensitive configuration, but it is not a secret-storage
boundary. The management surface is owner/admin-only, while a compatible
runtime handling a turn receives a transient projection for enforcement. An
operator of a member-controlled local runtime may be able to inspect that
execution payload or prompt, so the policy may contain only category names or
document types, never credentials, secrets, or sensitive record contents.
Logs, audit rows, analytics, dispatch traces, Diagnostic Reports, Agent
Activity, and runtime observation frames must not contain the policy. Workstation
prompt traces fingerprint the complete prompt for correlation but replace the
exact policy text in the bounded preview. Failure logs may record only the
Organization/Space correlation and a bounded single-line error description,
never the policy content or SQL bind values.

Remote Agent prompt context and capability-fenced Runtime Transport delivery are
transient projections, not additional policy stores. Remote Agent reads the
current policy for every model turn. It may reuse cached Organization Brief and
title projections when that read fails, but it must drop any cached policy and
degrade to the built-in information-protection guidance. Workstation delivery
does the same when the optional policy read or Space-to-Organization projection
is unavailable. Both failures remain observable without failing the Wake or
native conversation.

## Organization Document Data Boundary

Core D1 owns `organization_documents`, including approved Markdown, the one
replaceable Center Agent draft, document identity, kind, member subject, and
timestamps. Core D1 also owns `organization_document_folders`, including each
folder's optional parent edge. Database constraints enforce one Brief per
organization, unique Profile Report titles within one organization, subject,
report date, and report type, sibling folder-name uniqueness, the closed kind
set, draft metadata coherence, and the 20,000-character body limits. Profile
Report history is append-only across learning runs; Core assigns a dated base
title and a human-readable ordinal suffix for additional same-day reports. Core
prevents cross-organization parent edges and
folder cycles, preserves child folders and documents when a folder is deleted,
enforces the 50-folder and 50-document knowledge caps, and verifies that Profile
Report subjects are current organization members. Web and Gateway consume this
hierarchy as a projection; neither owns a parallel folder tree.

Approved content and draft content are separate fields with separate mutation
paths. For Organization Brief and knowledge documents, approval is the only
operation that copies a pending draft into approved content; discard clears only
the draft. A Profile Report is the deliberate exception: a version-fenced human
content save accepts the visible provisional body and clears its draft fields,
including when the body was not edited. The same successful mutation resolves
the matching Inbox projection; reconciliation is recovery rather than the
normal resolution path. A separately authorized direct-save path may create or
update approved ordinary knowledge, but it cannot target a document while a
draft is pending. Prompt context reads approved content only. Neither Gateway,
Web, nor the Remote Agent worker owns a second document store or may infer
approval from a draft timestamp.

The Center Agent Computer may contain a read-only, versioned projection of all
approved Organization Documents. Core produces the complete snapshot and its
content-derived revision; Remote Agent materializes that snapshot before an
authorized turn can use Computer tools. If the current context plan disallows
Organization Documents, Remote Agent clears any projection left by an earlier
turn before exposing Computer tools. The projection manifest maps stable
document ids to filesystem paths but is not mutation authority, document
identity truth, or an approval record. Computer edits occur only in separate
working copies and must re-enter Core through the existing draft or explicitly
authorized direct save boundary.

Remote Agent keeps each writable Computer working copy's Core Document id and
source `updatedAt` in the trusted turn-local projection obtained from Core. It
must not recover that identity or version from a manifest, sidecar, or other
Agent-writable Computer file. Remote Agent rematerializes the complete snapshot
on every turn before tools become available, including when the revision is
unchanged, so Agent-written projection drift is repaired. Core rechecks the
trusted source version in the same conditional write that creates the pending
draft. A stale or untracked file therefore cannot silently replace a newer
approved body or pending draft; the caller must check out the latest projection
and deliberately reapply any still-useful edits.

Center Agent catalog reads, body reads, draft submissions, folder management,
document moves, and direct approved knowledge saves are delegated Core operations
and write `center_agent_audit_journal` entries with document, folder, or catalog
resource identity. Core D1 owns
`center_agent_organization_document_operations` as the retry ledger for Center
Agent mutations. It binds an operation id and request signature to the
organization, Center Agent profile, represented human, action, and deterministic
target identity; it is idempotency state, not document or execution authority.
Its insert creates the first expiring mutation claim. Only the current claim id
may complete the operation. A concurrent exact request observing an unexpired
`pending` claim reports that the operation is still in progress and must not
repeat the mutation. After expiry, one compare-and-set claimant may resume the
same deterministic target and desired mutation; idempotent audit insertion and
claim-fenced completion make a crash after the document mutation recoverable
without allowing a stale claimant to replace the stored replay response. A
completed exact request returns that stored response.
Authorization failure performs one final exact-completion read so a request
that completed concurrently remains replayable after its accepted turn closes.
Human reads and writes use the authenticated organization-member/owner-admin
contracts rather than the Center Agent audit identity.

Core D1 also owns `center_agent_member_research_batches` and
`center_agent_member_research_tasks`. These rows are the durable serial
orchestration record for a human-requested member-research batch: one running
task per batch, explicit per-member failure, and continue-on-failure progress.
The request may originate from the authenticated Web action or from the hosted
Center Agent representing the verified speaker of an interactive conversation;
both enter the same batch/task writer, audit path, and single-active-batch
invariant. Conversational self-research derives the subject from the represented
speaker instead of persisting model-selected identity.
Slack onboarding batches also carry one nullable acceptance idempotency key,
unique within the Organization. The installer or invited-member scheduler uses
its stable onboarding identity for that key. A retry therefore returns the
exact previously accepted batch and task after a downstream task-link
checkpoint failure, including when the task has already become terminal; this
key is orchestration recovery evidence, not a second execution authority.
They do not replace the Remote Agent worker's in-flight execution truth or the
native-delivery ledger. Core advances a running task only from that ledger's
terminal outcome. At the Organization Document draft boundary, Core binds the
Remote Agent submission and task id to the assigned Profile Report and records
that task id on the Organization Document in the same statement that writes the
draft. This document-owned origin evidence survives a human approving or
discarding the reviewable draft before the next scheduler tick, without making
the review state or approved content an execution authority. Retrying the same
task and Remote Agent submission returns that correlated document without
rewriting a draft a human may already have approved or discarded.

Every accepted per-member task appends a `research_member` Center Agent audit
row in the same D1 batch as the task, attributed to the requesting human. Prompt
text and research findings are not copied into the batch, task, or audit rows;
the reviewable draft remains in `organization_documents`.

## Observability Model

Observability must diagnose one real user action from a stable selector.

For Web-authored Wake messages, the stable user-action key is `clientMessageId`,
but `clientMessageId` alone is not enough for the current user-scoped trace path
because one message can Wake multiple targets.

Canonical Wake selectors are:

| Selector         | Required shape                                | Meaning                                              |
| ---------------- | --------------------------------------------- | ---------------------------------------------------- |
| `client_message` | `spaceId + clientMessageId + targetProfileId` | User-action selector for a Web-authored Wake target. |
| `source_signal`  | `spaceId + sourceSignalId + targetProfileId`  | Direct Space signal selector.                        |
| `dispatch`       | `spaceId + dispatchId`                        | Exact dispatch selector after lookup.                |
| `claim_lease`    | `claimLeaseId`                                | Legacy diagnostic selector, not execution authority. |

Any future broader lookup must resolve back to the same canonical selector
before reading dispatch facts.

## Correlation Chain

Correlation answers:

```text
How do all evidence records connect?
```

The canonical Wake chain is:

```text
spaceId
clientMessageId
sourceSignalId
targetProfileId
dispatchId
runtimeCoordinatorExecutionId
latestAttemptId
claimLeaseId
bindingId
openMeldServiceRuntimeId
agentControllerRef
resultRef
publishedSignalId
replySignalId
cloudflare.cfRayId / cloudflare.traceId / cloudflare.requestId
```

Every field must be derived from an existing fact source or from a
RuntimeCoordinator-written query projection.

The correlation object is a read model only. It must not write facts, create
facts, or become a second source of truth.

`runtimeCoordinatorExecutionId` is a correlation field and stable execution
record id. It is not a token, credential, or execution authority. Observability
must not infer it, create it, or use it to decide execution outcomes.

## Final Visible Outcome

The final user-visible Space message is not always the same fact as
`correlation.publishedSignalId`.

Consumers that need to answer:

```text
What did the user actually see?
```

must use the trace's final visible message and final visible outcome fields, not
reinterpret a publication pointer as the visible outcome.

This protects the product contract: a Wake is understood by its visible reply or
explicit visible failure, not by an internal publication reference alone.

## Trace Read Models

OpenMeld has multiple diagnostic surfaces, but they must share one observability
model.

CLI trace, operator trace shortcuts, dispatch trace reads, Web Wake waterfall,
Diagnostic Reports, and claim execution diagnostics all read or derive from the
same Wake correlation model. They must not invent separate selector rules,
separate field priority rules, or separate observability schemas.
Dispatch and attempt status validation uses the shared trace schemas directly.
A legitimate cancelled dispatch or profile-queue wait must not disappear from
diagnostics because a reader maintains an older private status list.

For Remote Agent dispatches, runtime diagnostics use the exact runtime
conversation identity frozen in that dispatch's native-delivery request. The
logical Space id is correlation context, not a Durable Object selector after a
conversation rollover. A missing or inconsistent frozen identity fails closed;
diagnostics must not guess the active generation or maintain a second generation
pointer outside Core.

Detailed CLI trace is the supported handoff to local agents and operators. A
caller supplies the normal Space and dispatch selectors; Core resolves the
frozen runtime conversation identity and returns the bounded runtime diagnostic
projection. Callers must not query D1 or supply a runtime generation identity.

When a controller exposes official context telemetry, task-result and local
runtime observation may retain only bounded numeric token counters, the reported
model context window, and a compaction-observed flag. They must not retain prompt
text, response text, summaries, cache keys, or provider payloads. Context
telemetry may explain latency and context pressure, but it is not proof that an
instruction was installed, not Wakeability, and not execution or
publication authority.

Web Wake waterfall is a projection only. It reads existing Space signal,
dispatch outbox, dispatch lookup, dispatch ledger, attempt, claim, result, and
reply facts, then reports which steps are found, pending, missing, failed, or
degraded. It must not write facts or create a second trace truth.

Derived trace phases and outcomes use structured fact kinds, event types, and
statuses. Human-readable reason codes and details remain diagnostic context;
their words must never be searched for fragments such as `publication` or
`finalization` to decide which phase failed.

CLI trace is a user-operable diagnostic surface. Operator shortcuts may wrap it,
but they must stay thin wrappers and must not become direct D1 readers or a
second trace system.

`EvidenceSyncHealth` is an owner-only diagnostic read model for explaining
whether the evidence channels behind Wakeability were read, missing,
stale, degraded, or blocked. It may compose Agent Profile identity, Binding,
Runtime registration, route catalog, service compatibility, execution authority,
provider account, provider conversation, and recent Wake impact evidence.

`EvidenceSyncHealth` is not public Wakeability, not the final compatibility
`AgentExecutionReadiness` projection, and not a Space Wake outcome. Public
badges and Wake preflight continue to use the Core-owned Wakeability projection.
Diagnostic surfaces such as CLI trace may show `EvidenceSyncHealth` to owners
and operators so they can understand which evidence channel needs attention.

## Diagnostic Reports

A Diagnostic Report is a user-submitted event.

The report event belongs to the Diagnostics domain. Wake pointers attached to
the report are derived from existing Space and Dispatch facts.

A Diagnostic Report must not become a second Wake trace truth. It should help
support and operators find the relevant facts, not replace those facts.

Web should send only the minimal approved report input. Core derives Space
thread, reply, and Wake pointers from existing facts.

Operator tooling may use a Diagnostic Report ID as an entry point, but only to
resolve derived Wake pointers and then call the same OpenMeld trace/read models. It
must not read dispatch truth directly or create a parallel trace model.

The internal Diagnostic Report helper may read Diagnostics-owned report rows and
derived Wake pointers, then print `ops:trace` and Cloudflare runtime evidence
commands derived from those Wake pointers. It must not use a Diagnostic Report
ID as a Wake correlation field, and it must stay a resolver into the shared
trace model, not a second Dispatch Ledger reader.

## Setup Failure Diagnostics

A prepare-session step failure may carry a bounded, whitelist-only diagnostics
bundle collected by the CLI: support code, step id, CLI version, OS
platform/release, the stable OpenMeld-internal device id from the local service
contract, daemon lifecycle journal tail (with only whitelisted metadata keys
kept), filtered daemon-system-service.log tail, inventory anomaly codes, and
service-manager job evidence. The bundle is best-effort failure evidence for
production diagnosis only:

- Core emits one JSON object with `message: "[prepare.diagnostics]"` and
  `event: "core.openmeld.setup.step_failed"`, including failures without a bundle
  (`diagnosticsAbsent: true`). Do not prepend text to serialized JSON: Workers
  Logs must index the object's fields, not bury them in a message string.
  Each event includes server-verified `ownerUserId`, `prepareSessionId`,
  `connectionEpoch`, `sessionRevision`, `deviceId`, `stepId`, and `reasonCode`.
  The bundle is not persisted. It never enters prepare-session snapshots, events, D1,
  or any projection.
- It must never feed availability, readiness, or Wake decisions.
- `packages/schemas` owns the diagnostics bundle content contract and shared
  redaction helper. The transport field remains a bounded string for published
  CLI compatibility; Core parses the string, validates the parsed JSON against
  the shared schema, strips unknown keys, and logs only the validated object.
- Unknown bundle keys are stripped, not rejected, and `bundleVersion` is any
  positive integer rather than a pinned literal. Version drift is exactly when
  setup diagnostics are most useful, so a v1 bundle from an un-upgraded CLI and
  an enriched newer bundle must both validate: Core deploys the shared schema
  before a new CLI ships, and older Core deployments keep the known safe fields
  from a newer bundle.
- The device id lets Workers Logs correlate a machine's failures across prepare
  sessions when the session snapshot device id is null; it is an internal UUID,
  not user-identifying data. A missing or empty daemon-system-service.log is
  reported explicitly (`serviceLogTail: null` with a `serviceLogNote`) so a
  never-spawned service is distinguishable from an uncollected log.
- If Core cannot parse or validate the bundle, it still emits the same
  `[prepare.diagnostics]` log prefix with `diagnosticsRejected:
"invalid_json" | "schema_invalid"` and `diagnosticsLength`. It must not log
  the raw diagnostics string or schema error text.
- Collection is whitelist-only and size-capped, never includes env vars,
  tokens, or content from files outside the named OpenMeld-owned sources, and users
  can opt out with `OPENMELD_NO_DIAGNOSTICS=1`.
- Free-text diagnostic fields are redacted on both sides. CLI redacts while
  collecting local log tails and lifecycle entries; Core applies the same
  shared redaction again after validation and before logging.
- The attach is best-effort end to end: the base step-failure report must not
  depend on diagnostics collection or delivery succeeding.

Setup opens its Prepare diagnostic connection before waiting for maintenance or
recovering an interrupted account transition. These early failures use the same
failed-step write; they do not require the damaged old Computer credential.
When available, `nativeFailure.osStatus` preserves the immediate macOS error
through wrapped exceptions without uploading the exception text. This optional
field is stripped safely by older Core versions.

For support, resolve the reported email to its verified Auth user ID, then filter
Workers Logs by `event = core.openmeld.setup.step_failed` and `ownerUserId`.
Use the Prepare session and connection epoch to distinguish retries; inspect
the reason code, native status, CLI version, inventory anomalies and lifecycle
evidence together. Never infer revoked credentials from `session_token_unavailable`.
For proactive triage, group this event by reason code and CLI version, then
count affected owner/device IDs rather than heartbeat volume. No email is copied
into the diagnostic event. Collection opt-out omits the bundle, not the ordinary
server-side failure record. Failures before the bootstrap can contact Core, or
while the network is entirely unavailable, cannot be claimed as cloud evidence.
Workers Logs retention is bounded (currently up to seven days); it is not a
permanent audit archive. Retain incident evidence through the approved diagnostic
workflow before it expires.

## Cloudflare Runtime Evidence

Cloudflare runtime evidence is operational evidence attached to the same Wake
correlation chain.

Cloudflare identifiers such as request id, trace id, and ray id help explain
what deployed Workers observed while handling the same user action. They do not
replace OpenMeld facts, RuntimeCoordinator facts, Dispatch Ledger facts, or Space
truth.

Cloudflare runtime evidence should be projected through the shared runtime
evidence model. It must keep the same correlation fields so production diagnosis
can move from OpenMeld durable trace to Cloudflare evidence without changing
selectors.

Analytics Engine is the historical runtime evidence table, not the full runtime
event schema. Its fixed columns are a compact projection of the main Wake chain
and must stay within Cloudflare's physical column limits. Full runtime event
fields may still appear in structured Worker logs when useful, but Analytics
Engine must prioritize selectors and root-cause pivots: `clientMessageId`,
`dispatchId`, `runtimeCoordinatorExecutionId`, runtime identity, result and
final visible outcome pointers, and `requestId`.

The single Analytics Engine index should prefer one-user-action selectors before
broader scope: `clientMessageId`, then `runtimeCoordinatorExecutionId`,
`dispatchId`, `sourceSignalId`, `requestId`, and only then `spaceId` or Worker
identity. `spaceId` stays a blob for filtering, but it is too broad to be the
primary index for investigating one reported message.

`wrangler tail` is a live stream only. Historical production diagnosis should
start with OpenMeld durable trace and then use the Analytics Engine query tooling for
Cloudflare runtime evidence around the same IDs.

Cloudflare evidence query tooling must derive its field order from the shared
runtime evidence contract. Do not hand-maintain a second Analytics Engine schema
inside scripts or runbooks.

Center Agent performance uses a separate Analytics Engine projection named
`openmeld_center_agent_performance` in local and development environments and
`openmeld_center_agent_performance_prod` in production. The Organization is the
index; milestone, exact trigger source, model id, status, source client, and
bounded correlation ids are dimensions. Numeric fields contain admission-to-
milestone latency, stage duration, tool-exposure counts, and provider status.
Prompt text, reply text, model reasoning, tool arguments, tool results, and
provider payloads must not enter this projection.

This projection answers aggregate questions such as p50, p95, and p99 by
channel and model. Analytics Engine may sample rows, so aggregate queries must
weight counts, averages, and quantiles by `_sample_interval`. It must never be
used to decide what happened in one specific turn; exact turn diagnosis starts
with the Core projection backed by the Remote Agent Durable Object record.
`pnpm ops:cf:center-agent-performance` is the supported aggregate query entry
point and derives its physical field order from the shared schema.

## Structured Log Events

Web application errors use `web.openmeld.application_error` in Workers Logs.
Web is the sole intake/log owner; `packages/schemas` owns the additive browser
report contract. Browser reports are untrusted diagnostic evidence. The intake
accepts only bounded same-origin JSON, validates and minimizes fields, and caps
log volume. Raw exception text, full stacks, actual page URLs, user content,
credentials, and local paths must not enter this report. Error categories,
code-template route IDs, build asset positions, build IDs, source SHAs, and
Cloudflare request correlation support diagnosis without product payloads.
This does not create another product audit or execution ledger. Coverage,
retention, source-map handling, and manual queries are documented in
`docs/web-application-errors.md`.

Structured logs at service and runtime boundaries must stay searchable and
correlation-friendly:

- Event names identify service, domain, and action, such as
  `gateway.openmeld.space.signal_posted`, and stay stable once shipped.
- Entries carry IDs, status values, reason codes, counts, and selected target
  IDs — enough to join the correlation chain without payload dumps.
- Use warn level for unexpected but handled diagnostic states.
- Use explicit error codes and reason codes instead of prose-only failures.
- The sensitive-data rules below apply to every log entry.

## Sensitive Data Boundary

Diagnostics must not leak sensitive data.

Do not log, persist, or include in diagnostic payloads:

- access tokens
- one-time tokens
- passwords
- cookies
- full message text
- prompt bodies
- arbitrary request or response payload dumps

Use non-sensitive identifiers, counts, status values, reason codes, and bounded
sanitized pointers.

Runtime Agent Controller reporting follows the same minimization rule. Local
command paths, launch arguments, provider account email/labels,
controller-provided model or skill inventories, and free-text local probe
messages stay on the computer. The cloud read model may persist only the shared
allowlisted ACI projection defined in `shared-contracts.md`; it must not treat a
rich local snapshot as safe merely because that snapshot passed schema
validation.

The designated Center Agent Dispatch History tool may expose `errorMessage`
only as a bounded, sanitized vendor-error summary: the vendor error code, type,
and one-line description. Additional vendor detail is limited to operator
structured logs under the payload-dump prohibition above; it must not be stored
in D1, returned by RPC, or included in a public Space notice. No other Center
Agent tool or public diagnostic surface may read this summary unless this owner
contract explicitly designates it.

If a diagnostic surface needs a pointer that users or support may use later, the
pointer must be sanitized and must not include message text, secrets, or raw
payloads.

The Web client keeps one such sanitized pointer for the most recent Wake:
`localStorage["openmeld.space.last-wake-diagnostic"]`. It may include `spaceId`,
`clientMessageId`, `sourceSignalId`, and target profile IDs, and must never
include tokens, passwords, Space passwords, message text, or prompt text.
Production Wake diagnosis can start from that pointer and feed the shared trace
selector.

## Owner Boundaries

This document owns data ownership and observability boundaries.

Use scoped owner documents for related rules:

- `developing/product/product-model.md`: product promise and user-visible loop.
- `developing/product/center-agent-routines.md`: Routine and Run product
  semantics, authority, scheduling, and result-surface rules.
- `developing/product/center-agent-tasks.md`: canonical Task and Task Context,
  access, lifecycle, execution linkage, concurrency, and recovery semantics.
- `developing/architecture/agent-transport-contract.md`: execution authority,
  readiness, Wake finalization, and final outcome contract.
- `developing/architecture/shared-contracts.md`: shared schemas and reusable
  projection helpers.
- `developing/clients/web.md` and `developing/clients/cli.md`: client-specific
  presentation of trace, reports, and diagnostics.
- `developing/engineering/development-workflow.md`: local database commands,
  validation workflow, and operational runbooks.

## Architecture Invariants

- Every durable state has one authority owner.
- Writer, reader, source-of-truth, projection, and rebuild rules must be
  explicit before adding storage.
- A projection must not become its source of truth.
- Space Board execution rows are read projections; `Working now` requires
  current RuntimeCoordinator evidence and explicit freshness.
- D1 is the only Routine definition and Run-history truth; `nextDueAt`, native
  delivery linkage, and client caches remain projections.
- Routine and native-delivery writers must prove the canonical frozen-destination
  invariant through worker execution and every publication path; a stored
  snapshot is not proof by itself. Ordinary timestamps remain nonnegative;
  signed Run `scheduledFor` is reserved for the strict quarantine combination.
- Dispatch Ledger records Wake execution facts; it does not own in-flight
  execution authority.
- RuntimeCoordinator owns execution decisions; Dispatch Ledger projects them.
- `clientMessageId` is the Web-authored Wake user-action key, but trace lookup
  must include the target profile for user-scoped Wake diagnosis.
- Correlation is a read model, not a writer or authority.
- Final visible outcome must be read from final visible outcome evidence, not
  inferred from a publication pointer alone.
- CLI trace, Web waterfall, Diagnostic Reports, and operator trace must share
  the same Wake correlation model.
- Diagnostic Reports are user-submitted events, not second Wake trace truth.
- Cloudflare runtime evidence explains runtime observations; it does not replace
  OpenMeld facts.
- External tool usage evidence is a raw read projection; it does not set
  pricing, budgets, quotas, or execution authority.
- Analytics Engine is a compact historical projection; it must not drift from
  the shared runtime evidence contract or exceed Cloudflare physical limits.
- Sensitive data must not be logged or persisted for diagnostics.
