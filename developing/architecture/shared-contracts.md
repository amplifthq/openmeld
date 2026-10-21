# Shared Contracts

## Agent Context

- Purpose: Define cross-client and cross-service shared contract ownership for
  schemas, runtime policy, API clients, Gateway contracts, shared database
  contracts, Space Board and reply context, Space reply streaming, Center Agent
  Opportunities, Routines and memory, weekly evaluation reports,
  reusable Space policy, and reusable Agent Profile semantics.
- Read this when: You are changing cross-boundary payloads, shared schemas,
  `packages/agent-runtime`, `packages/agent-profile`, `packages/space`, API
  client contracts, Gateway contracts, Space Board or reply metadata, Space
  streaming, Opportunity RPC contracts, Routine HTTP/RPC/turn envelopes,
  Organization Skill registry and exact-release delivery, Center Agent memory, evaluation report payloads, Space password
  handling, or logic that might otherwise be
  duplicated in Web, CLI, Core, daemon, or adapters.
- Update this when: A shared package changes ownership, a cross-boundary
  contract moves, a schema source of truth changes, streaming or memory payloads
  change, reusable policy changes, or duplicated cross-client logic is
  consolidated.
- Do not use this for: Single-client UI behavior, local daemon lifecycle,
  RuntimeCoordinator state-machine details, Space product semantics, database
  operation runbooks, TypeScript style guidance, package directory indexes, or
  one-off implementation notes.
- Source of truth: This file owns the durable boundary for shared OpenMeld contracts
  and reusable policy.

## Public read throttling compatibility

Gateway may return HTTP 429 with `Retry-After: 60` and
`gateway.public_read_rate_limited` before resolving credentials on public-readable
Space routes. The existing error envelope is unchanged. Older clients that do
not recognize this code still receive the HTTP failure; they must not infer
success or retry without delay. Ordinary reads below the limit, authenticated
writes, setup, Wake, Stop and transport streams keep their existing contracts.
This requires Gateway's new native limiter binding with the same release.
Web's Gateway proxy preserves the edge-provided `CF-Connecting-IP` as
`x-real-ip`. Cloudflare uses that header to derive `CF-Connecting-IP` for
same-zone subrequests; Web and Gateway must remain in the same Cloudflare zone.
SSR boundary reads retain the edge IP when constructing their internal request
and use the same proxy transformation as browser-originated API requests.
Caller-supplied `x-real-ip` and `X-Forwarded-For` are not trusted or forwarded.
Local requests without an edge IP do not manufacture one. This reuses Gateway's
existing limiter and does not introduce another counter or identity authority.
Web's public CLI download throttle uses HTTP 429 and the same retry header;
CLI release manifests and binary contents do not change. Core Slack retry pacing
reuses `receivedAtMs` in the existing v1 message and introduces no wire fields.
No Service or CLI contract version change or required local update is needed.

## Message Details thread opt-in

Message Details also accepts `includeThreadContext: true`. Only this opt-in
returns `threadContext`: the canonical thread and root IDs for either a root
or a reply, or `null` for an unthreaded readable message. An omitted field means
the receiver does not support this projection; callers must not treat omission
as permission to create a thread. Existing access checks and personal deletion
visibility apply before resolving placement. This authoring projection does not
change a running Wake's conversation scope when a thread is opened beneath it.

Deploy Core, then Gateway, before distributing the CLI that consumes this
opt-in. Old clients keep their unchanged response. New CLI against an old
receiver fails without posting; old CLI remains usable after the receiver
upgrade. This is an available CLI fix, not a required Service or Skills update.
Setup, Wake, Stop, daemon transport and managed Skills contracts are unchanged.

## Message Details delegation opt-in

Message Details accepts optional `delegationVersion: 1` and an opaque
`delegationCursor`. Only an opted-in response includes `delegations`; its
children reuse Wake progress, frozen task-context, terminal-outcome, and
completion-policy schemas. A page has at most ten declared groups. Unreadable
children cannot carry content, input, or source/result locators.

Older callers receive the unchanged response shape. Older Gateway/Core code
ignores the new reader opt-in and the new Web accepts an absent projection.
Update Web and Gateway readers before Core emits the opted-in field. CLI,
Service, managed Skills, setup, Wake admission, Space mutations, Stop,
result recovery, and trace contracts are unchanged. No local-component epoch
or required update is introduced by this read projection.

## Bounded message reads

`messageReadQuerySchema` and `messageReadPageSchema` own the new
`GET /v1/messages/query`, Core `readMessages`, and hosted
`remoteAgentReadMessages` contracts. Search and chronological reads reuse the
Space SQL query owner. Space authorization, viewer redaction, personal deletion
boundaries and recalled-message exclusion run for every page. Workspace discovery
does not grant access. Hosted callers additionally require the current designated
Center or their admitted personal Remote Agent execution. The active execution
owner derives the requester from its admitted turn, never from tool arguments.
Personal Agents and Agent-requested turns are restricted to that execution's
Space. Center member/routine reads require both the Agent's current Space access
and the requester's current Human membership and history visibility on every page.

A server `limit` bounds each page. The Agent checkpoint owns the total reading
goal, subtracts delivered items before each page and retains the continuation
when that goal is reached. Increasing the total resumes from that position.
The server emits at most 100 items and
24 KiB per page; the default request budget is 16 KiB. Preview reads locate
matching text. Full reads segment long text at Unicode-safe UTF-16 offsets.
Items are bounded message projections, not complete publishable envelopes.
System history retains the original signal type and public notice/status text.
Attachments and exact handoff evidence use the existing source readers.
Text search selects text messages; `includeSystem` extends chronological reads.

Every response reports partial, complete or indexing coverage, a replay
`pageCursor`, and a `nextCursor`. An empty partial/indexing page is not proof
that no message exists. Workspace order is Space ID, then newest source row;
it does not claim global relevance. Cursors bind the query, actor, Organization
and personal history boundary, and freeze the upper time/row boundary. They
are read positions, never authority or a preserved historical copy. A changed
or unavailable in-progress message fails instead of joining different versions.

Compatibility audit: these are additive cloud endpoints. The existing search,
Inbox, Space signal and exact-evidence response contracts remain available.
Core receivers must precede the new Gateway, Web and Remote Agent callers;
remove callers before rolling receivers back. Existing CLI, Service, Skills,
setup, Wake and diagnostics payloads are unchanged; no local contract floor
or release stamp is needed. There is no database migration. The existing Space
FTS index and retained Remote Agent storage remain their respective owners.

## Storage and migration references

Plugin approval message context is an opt-in HTTP projection
(`includeMessageContext=true`). Older strict clients retain the previous request
view. The new private batch reader uses shared schemas and filters by the
authenticated Organization/member and accessible Space. A message-scoped read
selects explicit message IDs; the composer tray omits that filter to read all
pending requests, independently of scroll position. Space owns the batch
message-location projection; it reads persisted Thread placement, not the
conditional new-Task affordance. Missing or recalled messages do not hide a
request that still needs a decision.
The Plugin request owns its persisted continuation intent; Space and
RuntimeCoordinator retain message admission and execution authority.
Guest Space readers have no Organization context and do not query private
approval endpoints. Approved continuations resolve the original Human Profile
from the retained source and verify account ownership before applying existing
Space and execution guards. A different selected profile in Inbox does not
change the continuation author. Reconcilable operation receipts keep continuation
pending; recovery pages past running requests rather than revisiting only the
oldest 100 rows.

The trusted connector completion protocol optionally accepts
`githubIssueCompletion` for a completed `github.update_issue`. The adapter
extracts it from the provider response, never from a model-supplied observation.
Core verifies the exact input signature and issue identity and stores the narrow
observation atomically with the completed operation. The original attempted
operation's Space provenance owns Task synchronization through the existing
provider reducer. Normal member Task mutation permissions do not change.
If synchronization fails, provider status stays completed; retrying the same
operation repairs Task state without admitting another provider execution.
`includeGitHubTaskSync` opts in to the synchronization status and terminal Task
IDs; Tasks waiting for review are excluded. Legacy completed operations without
provider evidence cannot invent it from the requested input.
Apply nullable `center_agent_connector_action_operations.github_issue_observation_json`
before Core, and deploy Core before the updated Remote Agent caller. Historical
D1 imports omit the native-only column. Older Core RPC receivers ignore the new
request fields and can record provider completion without Task synchronization
evidence; the rollout cannot rely on rejection of a new caller. Old callers
receive no new response field. Rollback must retain the
column and compatible receipt readers. This adds no model tool or Gateway route
and does not alter CLI, Service, Skills, setup, Wake, or diagnostic wire contracts.

Apply the additive nullable `plugin_action_requests.continuation_json` migration
before Core, then deploy Gateway before the new Web caller. Remove the Web caller
first on rollback and retain the nullable column. Once new requests contain
message provenance in `request_json`, Core rollback must retain the extended
intent reader: an older strict reader rejects those new records. Use a compatible
Core rollback or a forward fix; do not strip stored provenance to downgrade.
The historical import
baseline includes this native-only column. Existing CLI/Service/Skills setup,
Wake, trace and diagnostics retain their previous wire contracts. Task source
attribution uses version 3 and requires compatible local Task readers as
described below. GitHub issue observations accept an optional closure
reason; older observations without a reason update external status without
guessing Done or Canceled. Deploy that Core receiver before Remote Agent.

Space membership notifications add `space_joined` to Inbox kinds. Space summary
adds optional `messageUnreadCount`; exact unread-target receivers also get
optional `joinedItems` when they request item IDs. Existing message targets,
scopes, and message totals keep their meaning. The Space membership projection
outbox owns retries; Inbox owns read state. No client membership or read ledger
is introduced. Deploy the database migration and receiving Core/Gateway before
the new Web client and writer. Inbox item-kind version 2 opts in to the new kind
and the two membership fields. Summary version 3 predates these fields and does
not enable them. Core RPC sends membership kinds and fields only when
`includeMembershipNotices` is explicitly `true`; absent or false opts out.
Gateway explicitly opts in to Core, then projects HTTP output using item-kind
version 2. Missing, older, and unknown HTTP versions omit `messageUnreadCount`
and `joinedItems`, and receive the existing generic update kind with the same
title and Space target. The shared schema owner holds the two response
projections; storage, message counts, and read state retain their meaning.
Deploy Core before the updated Gateway: older strict Core request schemas reject
the new opt-in. This narrow projection does not prove other Inbox source-target
or request contracts. Historical migration/import baselines are read.
Older CLI, Service, and Skills retain their previous Space, setup, Wake, and
diagnostic contracts; no local component update is required by this addition.

Production shared relational storage is PostgreSQL. Numeric migration references
from the original D1 rollout describe historical schema dependencies already
absorbed into the native baseline; they are not D1 commands to run now. New
changes use the native journal and scoped database release in the
[PostgreSQL workflow](../engineering/postgresql.md). Receiver-first service and client compatibility requirements still apply.

## User time context

`packages/schemas/src/user-time-context.ts` owns the common IANA timezone
observation and accepted request context. Web observes browser `Intl`, Desktop
observes Electron main-process `Intl` at its shared cloud-request boundary, and
the CLI/OpenMeld Service observes its own process `Intl`. All use the same
`x-openmeld-user-time-zone` and `x-openmeld-user-time-zone-source` headers. Web
SSR only forwards the browser observation; it must not substitute server time.
Gateway binds a valid observation to the authenticated caller. The source is a
claimed client environment, not extra authority or a user identity selector.

Core freezes `requestTimeContext` with accepted Space input. It contains the
server `submittedAtMs` and resolved timezone/source/observation time. The
text-signal acceptance boundary fills missing context for HTTP and legacy
WebSocket authoring from Core's generated signal time and verified actor.
WebSocket sessions retain the Gateway principal through hibernation; legacy
human sessions use their verified owner after the existing live access check.
Client payload timestamps, identities and time blocks do not supply authority.
Already captured RPC and Queue context is retained. The shared
dispatch snapshot, Remote Agent turn envelope and exact-execution input carry
that same optional object. Queue promotion and retries keep the accepted anchor;
active Steer gets its own anchor. Relative dates use this anchor.
Delegated Wakes and task continuations, including watch admission retries, read
the original request's retained turn envelope and preserve this same context.
Core's internal Space writer passes it as a verified publication option, never
as public message data. Space validates it with the shared schema before
publication; new ordinary input still freezes its own accepted time.
Workstation delivery renders that retained context into the existing source
text before removing the optional object from the installed Service's strict
snapshot. Hosted and workstation prompts use the shared renderer in
`packages/schemas`; this does not add a Service field or change its version floor.
Each model request gets one fresh UTC runtime-clock data message at the end of
its outgoing provider payload, with the same static system guidance across requests,
without changing retained history. Explicit timezone in a user's request takes
precedence; saved Routine schedules retain their timezone.

The canonical user row and observation precedence are defined in
[Data And Observability](data-and-observability.md#user-time-context).
Missing or invalid context uses explicit `UTC`/`utc`/`null` fallback. No local
current time is transported or persisted, and no online laptop is needed.

Contract impact: headers and time fields are optional. New receivers accept old
requests; older Gateway ignores the observation headers. New Core omits the
hosted-only time field from workstation dispatch snapshots, so existing Service
receivers keep their strict wire contract. Wake, setup, status, traces, Space
actions, CLI commands and helper skills keep their existing contracts; no local
contract epoch bump or required-client update is needed. Updated Desktop/Service
artifacts are available updates. Cloud rollout is receiver-first: Remote Agent,
then native migrations `0029_user_time_context` and `0030_user_time_account_guard`,
Auth and Core, then Gateway/Web and
client artifacts. Remote Agent callbacks do not change, so this order introduces
no reverse dependency. Rollback removes newer callers before their receivers and
retains the additive table. No historical backfill is required.

## Personal cloud Computer operations

`cloudComputerSchema` and `cloudComputerOperationSchema` own the account Computer
identity and file/command operations. Core derives ownership from the authenticated
request or persisted hosted delivery. The public `/v1/computer/cloud` endpoint
does not accept an owner or provider resource ID. `GET` resolves the identity;
`POST` performs one operation. `observedAtMs` dates that response, not a cached
online flag. Legacy file reads/writes are bounded to 2 MB at this JSON boundary.
Official file operations retain the SDK's limits and pagination.

Additive `describe`, `files`, `browser` and `preview` operations use the same
authenticated route. `files` carries the official SDK tool name and parameters;
`describe` publishes those exact schemas. Command start adds backend, environment,
stdin and JSON input; exit may include a JSON result. The three backends are
container, worker-shell and worker-javascript. Stop may select a native signal.
The existing default Linux command behavior and legacy file operations remain
valid. New actions fail explicitly against older receivers; deploy the Remote
Agent receiver and Core/Gateway schemas before the updated CLI/Skills caller.
No Service, Wake, setup, Space action or controller protocol changes. No contract
epoch bump is needed; updated CLI/Skills are optional available artifacts in a
later coordinated release. This feature PR uses deferred release readiness.

Command operations use an invocation ID and stable key. Local invocation IDs are
namespaced separately from hosted submissions. The Computer holds the command
receipt and native execution ID. Poll and Stop address that receipt; a retry
must not allocate another process. Different invocations may run concurrently.
Optional command `collection` metadata describes automatic observation attempts,
not command execution. `unconfirmedAttempts` counts consecutive checks without
confirmed native evidence, reserved before external I/O; a caught error never
counts its attempt twice. `nextAttemptAtMs` is the next check time; null after
the budget is exhausted means later checks paused. Completed or unavailable
receipts also have no next check. Existing running/completed statuses and normal
list rows retain their contract. Detailed list rows are opt-in through
`includeReceiptDetails`, introduced in the same command-reference feature. Their
strict receiver must know the optional collection schema before that feature is
exposed. Single-result readers retain the existing extensible object contract.
Schema receivers must precede callers that request detailed rows; removing that
capability requires rolling back those callers first. No Service, Wake or
RuntimeCoordinator contract changes are introduced by this scheduling metadata.
File `edit` compares exact old text under the Computer's mutation queue; `write`
can require `expectedContent`. Arbitrary shell writes are outside that queue.

Contract impact: the new CLI route is additive and does not change workstation
Service, Wake or dispatch schemas. Core must receive the database migration and
new RPC before the new Remote Agent or CLI uses personal Computers. An older
Core cannot satisfy `includeComputer`; the runtime fails that capability
explicitly. Earlier hosted context versions retain their cleanup address and
cannot silently acquire a personal Computer. Existing CLI/Service clients keep
their prior local operations. No production rollout is implied by this contract.
The command and managed Skill are additive, with no CLI/Service/Skills epoch
bump. Feature verification uses deferred release readiness; a later authorized
release must rebuild and stamp affected local artifacts as `available`.
Deploy the Remote Agent Computer RPC receiver before exposing the new CLI route
to users; roll back callers before removing that receiver. Existing setup, Wake,
Space actions, Service status, trace and self-rescue contracts stay compatible.

## Task permission inheritance

Native permission inheritance is the default for new Codex and Claude tasks
without explicit access preferences, regardless of requester ownership.
`ExecutionContextRequest.ownerRequested` is accepted only for compatibility with
persisted older snapshots; new snapshots do not write or use it.
An assignment may carry `permissionSource: agent_settings` only with workspace
access. Absence preserves the previous bounded-task contract. The Service uses
its current Computer policy and Profile-native permission intent; this field is
not a full-access grant. `executionContextPermissionInheritance` is an explicit
adapter capability, separate from workspace protocol versions. Core checks it
before delivering such an assignment.

Working-copy selection uses the existing independent `workspace` preference.
New Web and CLI Project/copy choices omit `access` unless a restriction was
explicitly selected. No payload, schema version, or context epoch changes.
Core preserves the source's workspace mode when a native-permission task forks.
The updated Service derives an ephemeral allowlist for a verified managed copy
from the current Computer policy; older Services may reject such a copy when
only its source folder is allowed, but must not bypass that policy.
Codex selected-folder profiles also retain the existing native `:minimal` read
baseline so system commands can start; this uses the already-supported permission
profile contract and does not add user folders or change approval modes.

Contract impact: deploy the Core fork-default correction before exposing the
new independent-copy callers, then publish the updated CLI/Service as available
and expose the Web choices. Old callers keep sending their explicit restrictions;
existing tasks, setup, Space actions, trace and diagnostics remain compatible.
The Service update is advisory because older versions fail closed for unsupported
policy placement. Roll back the new callers before rolling back the Core fix;
retained assignments keep their existing permission source. Rebuild and stamp
local components through the normal release owner during an authorized release.

Core derives the per-Wake `requesterIsAgentOwner` delivery projection from current
identity or recorded Center delegation. It is prompt context, not authorization.
It is sent only to a Service advertising `verifiedRequesterContext`; older
services receive the existing payload. The Service combines this fact with the
existing caller, owner, and Space audience context on every turn, including resume.
An unverified original requester remains unknown; names or message text never
establish ownership. This does not alter Plugin or account-access authorization.

Ordinary Plugin delegation is an additive constraint on the existing recorded
Wake publication command (`pluginActions`). Core alone resolves the original
human and one-hop task chain. Local clients privately forward the admitted
`executionTokenEcho`; RuntimeCoordinator's read-only authorization RPC validates
that proof without transferring execution truth to the dispatch ledger. Remote
clients opt into `includePluginDelegations`; responses omit the projection for
old callers. Missing proof or an older receiver rejects the new delegated path.
These additions require a new packaged CLI/Service for delegated Local use and
Core before the new Remote caller; they do not alter ordinary human-source
calls, token issuance, token retirement, or finalization ownership.

## Direct Message opening and publication

The shared `openDirectMessageSpaceBodySchema` accepts an optional idempotent
Human–Center session `creationId`, an exact DM `spaceId`, and an optional message
(`clientMessageId`, `text`, explicit `wake`). The response retains
`memberProfileId` as the initiating Profile, echoes a requested `creationId`,
and includes a published text signal when requested. These response additions
are optional and omitted from legacy requests. The API client requires the
matching creation/message receipt before reporting a requested effect, because
older Core RPC receivers can ignore newly added arguments during rollout.

Wake publication requires the `spaceId` returned by an earlier open-only call.
Opening a session and publishing work are separate requests so the caller has
the Space, author, target and client message ID before work can start. A pinned
send cannot include `creationId`; the Space transaction verifies its Organization,
participant pair and unconverted DM status before publication. The CLI exposes
`space.send.request` before submitting work and retries with `--space` and the
same message ID. Native tools open first, then send using that receipt. There
is no second cancellation store: the existing Space Stop fence owns late sends.

Center Agent self-authored DM Stop uses its canonical identity and
current designation; represented-member fallback for UUID messages requires an
existing source signal. It never creates a pre-send fence under a different
author. Personal Remote Agent routing follows the
[Direct Message Conversion Contract](#direct-message-conversion-contract).

Core resolves both participants canonically; Gateway, native Agent tools, CLI
and dispatch tools share this contract. The Space owner serializes DM
membership verification with ordinary idempotent message publication, so
conversion cannot widen a pending private send's audience. Native tool calls
verify the current execution/Center identity; Local dispatch tools freeze the
calling Profile and resolve the source Organization through the public Space
entry contract. They do not record a terminal Space Action. No runtime or
Service contract epoch changes: existing Wake, setup and recovery continue to
work. Deploy Core receivers before Remote Agent callers and publish the new
CLI/Skill after the cloud accepts their optional fields.

Contract Impact Audit: old CLI, Service and Web callers omit the new fields and
keep their existing response shape. New callers require the optional receipt,
so an older Core that ignores an argument cannot report the requested send or
new session as successful. Deploy Core, Gateway and shared Web readers before
Remote Agent and CLI/Service/Skill callers; roll back those callers first.
The managed Skill requires the next CLI release (at least 0.3.238). Existing
setup, Prepare, Wake, final Space Actions and diagnostic contracts are unchanged;
all three local component updates can remain advisory (`available`). This
feature PR defers version and manifest stamping to the authorized release.

## Desktop platform contract

`computer-connection.ts` owns the account-bound native Connect/Disconnect
requests, progress events, and connection result. These IPC additions ship with
their bundled renderer. Progress accepts the CLI's existing verbose and compact
Agent View envelopes. Failed Connect results may include a local redacted
diagnostic-file path; it is not a cloud URL or credential.

The existing strict `computer-connection-v1` review output is unchanged, so old
Desktop builds can still read new CLI versions. The additive reviewed
`computer disconnect` CLI command requires updated Tools; an older CLI refuses
it without stopping or logging out. Existing cloud setup, Wake, Space actions,
status, diagnostics, and self-rescue contracts are unchanged in both rollout
directions. No execution epoch or cloud minimum-version increase is needed.
Publish the compatible CLI update before shipping this Desktop capability;
local-component stamping remains deferred to the authorized release worktree.
The explicit-device Forget route already uses Core account authorization.

Windows account-checked Service control adds a local-only
`account-checked-service-control-v2` capability response identifying the native
Node executable and verified active JS entry. The macOS v1 response remains
byte-shape compatible. Old Windows v1 responders are not accepted as support;
unknown process identities and unknown lock entries retain a fail-closed fence.
Prepare, Wake, Space actions, Service status, trace, and cloud transport schemas
are unchanged. The CLI/Service update must precede Windows Desktop activation;
no cloud execution epoch increase is required to discover this new local
capability. Release metadata is stamped only in the authorized release lane.

`desktop-updater.ts` owns main/renderer update snapshots, action names and the
request-scoped restart preparation reply. Existing trusted-window authorization
applies before every updater IPC call. Renderer replies contain only the main
request ID and whether existing owners saved their work. Main alone selects the
fixed production feed and starts download or installation. These local IPC
additions ship with the matching bundled renderer; cloud, CLI, Service, Skills,
Core and Gateway execution contracts and their version floors do not change.

`desktop-release.ts` owns immutable candidate metadata and one promoted pointer
per platform. The macOS pointer, DMG/ZIP paths, legacy JSON and feed keep their
existing shapes; older DMG-only candidate links remain readable, but macOS
promotion requires the ZIP. Windows x64 and ARM64 candidates require SHA-512 and
the configured Authenticode publisher for their immutable installer, reject ZIP
metadata, and use separate platform pointers and strict platform feeds. The
selected page, default download and updater derive from that same platform's
pointer; an absent Windows release never falls back to macOS. Artifact paths are
derived from validated metadata, never arbitrary request or stored paths.

Windows signed build receipts add optional `windows` metadata to the existing
production source receipt. Mac receipts remain byte-shape compatible. Deploy
the additive Web readers before publishing Windows candidates; old strict readers
cannot serve the new platforms. The installed Windows app independently matches
its architecture, fixed feed and configured publisher before enabling NSIS
updates. No separate latest manifest, provider web-installer package, or signing
identity from downloaded metadata is accepted. These are Desktop release
contracts; they add no Core/Gateway Wake epoch or Service readiness owner.

`desktop-notifications.ts` owns additive renderer/native Inbox reference,
test-request and delivery-result contracts. Only the current trusted window
can request delivery. Native credentials reread the recipient-authorized Core
item; callers cannot supply notification text or navigation URLs. Shared
API-client notification policy derives eligibility from those Inbox facts.
Refresh IPC is a signal to the existing reader, never a separate snapshot.
The renderer projects its current delivery context (account, Organization,
enabled preference, and existing rendered-conversation locator). Shared
API-client matching and current native focus/visibility suppress the exact
conversation immediately before submission, after asynchronous reads. Context
invalidation cancels and settles submitted but unacknowledged native attempts;
late native events cannot turn cancellation into delivery. Delivered alerts
retain click-back across Organization switches; account invalidation clears all.
This is a delivery permit, not account or Inbox authority; native
session and recipient-authorized Core reads remain mandatory.
The optional nullable categorized `attention` object in the same context
projects Core's mute-aware attention summary for the macOS menu bar. It carries
ordinary unread, unread mention, unread urgent-update, and unresolved-action
counts; native Main derives the bounded title and tooltip and never accepts
arbitrary tray text. The deprecated nullable `unreadCount` remains accepted only
for older matching renderers and is ignored by current Main. Account identity,
context generation, and session invalidation fence late results. Unknown
attention hides the title. The existing native refresh signal refreshes the
shared summary without introducing another polling owner or unread store.
These additions ship with the matching local renderer and require no cloud,
CLI, Service, Wake or runtime contract change. Existing Desktop bundles retain
their existing behavior; cloud rollout does not require a new Desktop floor.

Installed Desktop contract version 1 uses the strict compatibility response at
`GET /v1/desktop/compatibility` and `x-openmeld-desktop-contract: 1` on fixed-origin
business requests and streams. The Web admission layer accepts this version
independently of source-build fingerprints, rejects unsupported versions before
business handling, and never grants authentication from this header. Packaged
renderer/native fingerprint and target agreement still protects local assets.
Private development clients retain their matching-build requirement.

Installed target metadata lives in `packages/schemas/src/desktop-client.ts`.
The production/private/disposable Auth mapping is owned by
`packages/schemas/src/desktop-auth-identity.ts`. Registered worktree loopback
origins derive an exact per-worktree/port callback under the private namespace;
only configured Web origins, never browser input, select that identity. Auth
trusts exactly that callback and native uses the same identity. Production and
disposable client IDs/schemes are unchanged. Development adoption requires a
coordinated Web/Auth restart and app rebuild, not a production version-floor change.
`desktop-development.ts` owns the strict, non-secret build-only worktree coordinates
used for OS launches without a terminal environment. It grants no authentication,
ownership, Service connection, or Wake authority. Existing CLI/Core/Gateway/Service
contracts and execution epochs do not change. Production
compiles `https://openmeld.ai`; runtime renderer or lane configuration cannot
select a different endpoint. Native owns SDK credentials and strips response
cookies from renderer output. Generated server functions and generic Auth APIs
remain unavailable to installed renderers.

The same schema file owns the bundled Desktop Space-stream IPC events. A close
event carries its required numeric WebSocket close code and reason from native
Main through preload to the matching renderer. Preload rejects incomplete or
extra shapes, and the renderer adapts a validated close into `CloseEvent` for
the existing shared Space consumer. This is transport evidence, not another
source of Space access or live-state truth. Because Main, preload, and renderer
ship as one Desktop bundle, this expanded internal shape requires no installed
contract-version bump and changes no cloud, CLI, Service, Core, or Gateway
payload.

`GET /v1/cli/release` projects only `channels.stable.version` from the existing
public CLI binary manifest. `cliReleaseSchema` and the shared API client own its
portable representation. It adds no release source, update writer, fallback,
or installation capability. Missing or invalid published metadata stays an error.

Contract Impact Audit: Web/Auth must support the installed identity and contract
before app distribution. Compatible Web deployments preserve version 1; older
private clients still require their corresponding Web build. Browser clients keep
their normal authorization paths. CLI, Service, Skills, Core, Gateway, Prepare,
Wake, and Space action payloads and minimum versions are unchanged. Installing
this entry does not establish Service readiness or authorize local setup.

### Desktop Working folder

`desktopLocalComputerSchema` owns the bounded native IPC projection of the CLI's
account-aligned device and lane. It exposes no credentials or previous-session
identity. Desktop admits only that target for the existing picker/discovery and
the additive PeopleComputer Project connect-candidate, connect-declared-path,
set-default, and Profile workspace routes. Gateway reuses strict shared request
and response schemas; Core reuses the existing business writers and validates the
exact owned Service session and capability. Account-current routes remain blocked
in Desktop. An authentication change while admitting a request refuses it before
forwarding; the shared auth boundary clears account-scoped queries on session
changes.

Contract Impact Audit: the IPC projection and Gateway/Core routes are additive.
Deploy Core and Gateway support before distributing the new Desktop caller (or
Web callers using the explicit mutations). During mixed versions, unsupported
routes fail without falling back to another Computer. Existing CLI/Service
picker, Project and workspace requests, Prepare, Wake, Space actions, Skills,
status, diagnostics and recovery commands are unchanged. Capabilities continue
to reject old Services that cannot perform an operation; no semantic CLI/Service
epoch, minimum-version, or Desktop contract-version bump is required. Shared
schema paths still trigger the repository's Service release classification;
the integrated release must complete local-component stamping and release-ready
verification. Leaf development does not establish that artifact evidence.
Old Desktop builds keep their existing restrictions. Rollback removes the new
caller before removing these additive cloud receivers.

### Desktop candidate distribution

`packages/schemas/src/desktop-release.ts` owns the strict immutable candidate
manifest and derived artifact locations shared by the publisher and Web download
route. The signed production source record is owned by `desktop-client.ts` and
reuses the installed production target schema. A candidate hash is an artifact
selector, never a credential or an arbitrary R2 path. Candidate manifests do not
write or project the default update channel.

Contract Impact Audit: this adds an opt-in public download selector and new
candidate metadata only. Existing download/update requests and installed runtime
contract version 1 retain their behavior. CLI, Service, Skills, Core, Gateway,
Auth, Prepare, Wake, Space actions and diagnostics gain no new required fields
or minimum versions from this leaf. Web must deploy the candidate route before
advertising its URL. Runtime production compatibility remains the integration
release owner's separate acceptance responsibility.

### Account session read

Auth owns `GET /v1/account/session`, defined by the strict `accountSessionSchema`
in `packages/schemas`. It returns only `user.id`, `email`, `name`, nullable
`image`, `emailVerified`, ISO `createdAt`, and `session.id`. The user creation
date preserves the Account Joined display. The session ID identifies the current
row in Web Account Settings; it is never a credential or revocation authority.
No vendor object, token, cookie, session dates, IP address, user agent, membership,
or preference enters this projection. The route accepts no identity selector.

The existing Auth session resolver bypasses its cookie cache for this read and
checks the current local user. Missing or expired authentication returns 401;
local-state failure remains 500 and unavailable Auth remains 503. Invalid required
source facts fail rather than producing an invented session or date. Responses,
including authentication failures, are `private, no-store` before session
resolution. No Organization reads or new account/session writer are involved.

This read preserves Better Auth's existing session renewal at the HTTP boundary.
The authenticated HTTP middleware's cookie sink on the same session resolution forwards only the vendor's
separate `Set-Cookie` headers after local-user validation succeeds, or its
deletion cookies when the vendor reports no session. Local verification errors
and stale-local-user refusals emit no successful renewal. The Web proxy preserves
these headers; the Desktop transport keeps them out of renderer responses.
No second session read, cookie rewriting, or independent session writer is added.
Internal identity-only callers without a cookie sink use the vendor's
`disableRefresh` query option so they cannot consume renewal before an HTTP
caller can return it. Existing cache-bypass and local-user checks remain intact.
HTTP business failures retain their original status/body and separate renewal
or deletion cookies, with private/no-store responses. Native SDK response-cookie
handling precedes status handling; its pinned patch is documented in the Desktop
owner document. Neither a business error nor cached vendor data grants identity.

The shared Web/Desktop account query uses the shared API-client decoder and the
same `userQueryKeys.session`. Only 401 maps to null; backend, transport, and
malformed-response errors remain errors. SSR captures each request's cookie and
uses the configured Auth origin through the same standalone fetch transport.
Native Desktop entry and account fences retain their narrower session bridge;
they do not populate the shared account query. Web-only session/device management
continues using its existing credential-bearing contracts.

Contract impact: deploy the additive Auth endpoint and exact Web GET proxy before
the new consumers. Old clients keep working. There is no new store, writer, data
migration, CLI/Service/Skills/Core/Gateway epoch, or setup/Wake/Space action change.
Remaining browser entry server functions and pilot matching-build admission are
unchanged; this read does not establish general cross-build compatibility.

### Account Organization context

The shared fetch transport invokes its injected fetch as a standalone callable,
without assigning the transport options object or another arbitrary receiver.
This supports Worker global fetch and preserves explicitly bound injections;
cancellation, timeout and structured failure semantics remain unchanged.

Auth owns `GET /v1/account/organization-context`, a credential-free read
projection defined in `packages/schemas`. It returns the authenticated account's
display fields and user ID, normalized membership Organization summaries, and
the resolved default Organization ID. It accepts no identity selector. Auth
reuses its session resolver (bypassing the cookie cache), membership-list API,
and existing account preference repository; no new identity or preference store
is introduced. Responses are private and not cacheable.

Default selection remains: member-matched `lastSelectedOrganizationId`, then
member-matched session `activeOrganizationId`, then the first membership.
Missing authentication is 401; unavailable backend state stays an error. An
authenticated empty list has a null default. Web/shared client code owns URL
construction, login redirects, and the authorized/denied route projection.

`accountOrganizationContextQuerySchema` owns the optional
`deferSessionRefresh=true` query. A caller that observes the existing Account
Session HTTP query may opt in to a current identity and membership read without
synchronous session renewal. Auth still bypasses the session-data cookie cache
and checks expiry, revocation, account existence, and membership. Missing or
expired sessions retain 401 and the vendor's deletion cookies. Invalid opt-in
values return a private, non-cacheable 400 without resolving the session.
Omitting the query preserves renewal for older Web and Desktop clients.

Web keeps the existing Account Session query observed in the authorized shell.
Mount, focus, reconnect, and completed path navigation refresh it according to
its existing stale time without blocking the current page. Only this new caller
opts out of renewal in the Organization context read; no new session writer,
storage, endpoint, or cached authorization fallback is introduced.
Account Session reads forward Query cancellation to HTTP, including account
changes and observer teardown.

The API client generates an `x-request-id` before sending either account read
and retains it on failures before response headers or during body consumption.
Web forwards it to Auth; it is diagnostic correlation, never identity or authority. The
existing application-error query diagnostic adds the
`account_organization_context` and `account_session` categories. Route and
manual Organization-context error reports retain the same sanitized request ID.

Rollout remains additive: new Web works with old Auth (which ignores the opt-in
and continues renewal), and old Web/Desktop work with new Auth (missing opt-in
retains renewal). New telemetry categories require the matching Web report
receiver; an older receiver may reject that diagnostic report without changing
the application outcome. CLI, Service, Skills, Core, Gateway, and Wake/setup
protocols remain compatible in both directions; no contract epoch or required
local update is introduced. Shared schema/API-client paths still select the
Service bundle verification gate. The CLI carrier and Service declare an
`available` update in `release/local-components-policy.json`, with existing
required floors and the Skills policy preserved. Publication computes artifact
hashes from the eventual release source.

Contract impact: this additive Auth route must be available before releasing
the new Web/Desktop consumers. Old clients retain their existing reads and
preference writes. CLI, Service, Skills, Core, Gateway, setup, Wake, Space
actions, diagnostics, and contract epochs are unchanged. No data migration or
local component release is required by this slice. Other pilot reads still use
matching-build server functions; this route alone does not establish full
cross-build compatibility or relax pilot admission.

### Runtime client environment and Profile reads
`packages/schemas/src/client-environment.ts` owns the Web runtime publication
`GET /v1/client-environment`. Its strict response contains only `gatewayHost`,
normalized from the served Web environment's existing `OPENMELD_GATEWAY_URL`.
It has no account, session, credentials or caller-selected configuration. Web
returns `Cache-Control: no-store`; clients do not persist it. This metadata
selects the existing account/profile-Space history namespace and grants no
authorization. SSR retains its request-aware server boundary and reads the
same runtime setting directly.

Web also forwards only `GET /v1/profiles` to Auth's existing profile-list
endpoint through its established Auth-owned request proxy; it does not expose
generic Auth session operations.

Deploy the additive Web routes before clients that depend on them. Existing
HTTP/RPC payloads and old clients remain unchanged; an unavailable or malformed
response fails the new dependent operation without an RPC/default fallback.
CLI, Service, Skills, Core and Gateway require no protocol or version-floor
change. The Desktop fingerprint and request admission rules remain in force.

### Remaining pilot transport

Auth's cookie-write guard preserves the exact `DESKTOP_APP_ORIGIN` before URL
origin normalization and then checks the existing environment trust set. Only
the configured environment admits that exact origin. Custom-scheme near matches, callback origins,
opaque/null origins, and custom-scheme Referers are not substitutes. Configured
HTTP(S) Web origins and the existing HTTP(S) Referer behavior remain supported;
session and membership checks still apply. No native Origin rewriting is used.

`packages/schemas/src/desktop-client.ts` owns the Desktop origin, build header,
sanitized session identity, and platform metadata. The native process owns
credentials; renderer session responses contain no session token. Existing
CLI, Service, Core, Gateway, Wake, and Space action payloads are unchanged.

The development-only pilot uses matching compiled Web server functions for
existing reads and shared `/v1` APIs for business writes. A build fingerprint
mismatch is rejected before handling either. This coupling is an explicit
pilot limitation, not a durable API contract. See
[Desktop](../clients/desktop.md#cloud-transport-and-compatibility) for the
transport and account boundaries. Old production clients remain on their
existing paths; the pilot cannot target production or a Vite dev registry.

## Service Execution Host IPC

Provider admission uses an optional correlated acknowledgment on the existing
RuntimeCoordinator lifecycle report. The shared lifecycle acknowledgment schema
binds request ID, dispatch, attempt and connection generation; only Core emits it.
The `x-openmeld-execution-admission: 1` handshake negotiates the corresponding
registration response field. New Hosts fail closed with older servers that do
not acknowledge this capability. Old clients receive the previous response shape.
This adds no execution authority, task-state owner, or automatic provider retry.
Positive acknowledgments include `validForMs`, bounded by the Coordinator's
existing next watchdog observation and token expiry. The Host measures the
entire request round trip with its monotonic clock, beginning before send, so
network or IPC delay cannot extend that bound and wall-clock skew is irrelevant.
Each confirmation retry has a new correlation ID; a delayed old reply cannot
borrow the new request's freshness. An expired positive reply leaves the same
execution waiting for fresh confirmation, not failed or restarted.

This admission check does not promise transactional exactly-once effects in an
external provider or atomic revocation of an already-started OS process. Unknown
outcomes retain the existing recovery fence; they do not authorize replay.

Reference boundaries: [Ray actor fault tolerance](https://docs.ray.io/en/latest/ray-core/fault_tolerance/actors.html)
distinguishes at-most-once invocation from a known outcome and quarantines
unavailable actors. [Temporal Activity execution](https://docs.temporal.io/activity-execution)
uses task-scoped tokens and cooperative cancellation; a server timeout is not
proof that the worker stopped. These principles support the existing Coordinator
and Host owners; neither framework is an additional runtime dependency here.
Unlike a [resource-enforced fencing token](https://docs.hazelcast.com/hazelcast/5.0/data-structures/fencedlock),
our admission acknowledgment cannot fence arbitrary external filesystem/API
effects after provider start. Do not describe it as that stronger guarantee.

`service-execution-host.ts` owns the strict, versioned supervisor/Host protocol,
method-specific inputs and outputs, bounded frames, Host-incarnation identity,
health observations, and private process-recovery receipt. Both processes ship
in one CLI/Service artifact. An inherited pipe is necessary but not sufficient:
initialization also checks the current parent, account/session, installation,
device, lane, endpoints, and Service contract generation. No bearer credential
or arbitrary executable is supplied through this protocol.
Requests and replies are validated against their fixed method schemas. Methods
cannot select arbitrary paths, commands, ports or URLs, and Host execution
frames cannot register or heartbeat a Computer. Matching supervisor and Host
artifacts are required; they are not independently upgraded.

Execution frames retain their original RuntimeCoordinator, lease, attempt, and
Space identities. Host request timeout is an observation failure, never proof
that accepted work was cancelled or safe to repeat. Socket generations fence
late frames and authentication failures; a reconnect does not create new work.
Health and control capacity are bounded independently of normal requests. Host
snapshots report local facts only; the connector continues to publish the
existing `acceptingDispatches` and runtime capability contracts.
Long drain observation may have no total deadline. Process/channel loss is
unconfirmed execution, not an empty registry or permission to replay prompts.
The live route shape retains working-folder facts rather than relying on a
lossy persisted route cache.

Only a Project-connection change opts into `syncActivity.refreshIntegrations`.
The Host reuses its existing coalescing integration scheduler to register the
lane and install managed observers after a zero-Project startup. Ordinary `{}`
Activity sync remains sync-only. This private optional flag adds no public
control field, caller-selected installation path, or new installer/lifecycle
owner. Integration refresh errors retain their existing diagnostics and do not
block connector control.

Contract Impact Audit: existing Core/Gateway/Web/Desktop, Prepare, CLI control,
Service v1 file, and cloud execution payloads are unchanged. No cloud epoch or
minimum-version increase follows from this internal split. The new private
Host-owner receipt is not written into old strict files. CLI and Service still
ship together through the verified local-component pipeline; development defers
publication metadata, not packaged-build validation. Rollback requires both
processes quiescent because older binaries cannot enforce the new private
recovery fence. Signed/platform/cutover acceptance remains required before
release. No AHP, new browser capability, or second lifecycle writer is introduced.

### Center Agent Computer care observations

The optional `executionHost` runtime capability carries a bounded, path-free
supervisor observation. It is diagnostics only, never a scheduling grant or
proof of cancellation. Existing ServiceRuntime records retain it; there is no
new database, polling loop, or recovery owner.

Contract Impact Audit: the CLI requests Computer-care negotiation in the
`x-openmeld-computer-care: 1` stream header. Gateway forwards that recognized
header; Core acknowledges `computerCare: true` only to opted-in clients.
The CLI sends the optional observation only in subsequent heartbeats after
that acknowledgement. Old Gateway/Core omit the acknowledgement, so the new
CLI keeps sending the old strict payload. Old CLI registration responses stay
unchanged. New Core accepts missing observations as unknown. CLI command,
execution epoch, Skills, and Service file contracts do not change.

The owner-private Center Agent response adds optional `care` and filtered
`localRuntimes` fields. Deploy the new Remote Agent receiver before enabling
the new Core response; an older strict Remote Agent receiver cannot consume
the added response fields. Existing Web/CLI payloads and team-safe Computer
projections are unchanged. No production release is implied by local testing.

### Explicit Computer file-access refusal

The Service emits `computer.file_access.owner_declined` only when its pending
permission request receives the exact Cancel run option. Expired or interrupted
waiters and invalid responses retain distinct failure reasons. The older
`owner_cancelled` reason included ambiguous cancellations; Core never upgrades
those retained results into evidence of an explicit user decision.

After normal token-fenced durable result acceptance, RuntimeCoordinator routes
an explicit refusal through its existing accepted-result Stop publication. It
verifies the receipt, attempt, run, token, Space and target before Space elects
the existing atomic final claim. The existing stopped notice, cancellation
projection, task outcome, result acknowledgement and replay owners are reused.
No additional task-result variant, Stop RPC, outcome enum or PostgreSQL migration is
introduced; a failed publication stays retryable, not falsely completed.

Contract impact: deploy the matching Core behavior before distributing the new
Service to obtain stopped semantics. Old Core can still read the new string
reason and fails closed using its legacy failure presentation; new Core does
not reinterpret ambiguous old-Service records. Core's own Space/Hub versions
use the unchanged Stop RPC, so mixed-version rollout can temporarily show the
older stopped wording without changing authority. Gateway, Web, Desktop,
Skills, Prepare, public control contracts and version floors are unchanged.

## Local Service account admission

`computer-connection.ts` owns the opt-in CLI review/intent and fixed Desktop
connection request/result. Review exposes an exact non-secret session identity
and optional owner-validated device/lane reuse evidence. Desktop does not derive
that identity from credentials or Service files. Generic Prepare writes remain
blocked in the renderer; the native fixed operation uses existing cloud APIs.

Contract Impact Audit: the CLI gains an opt-in connection command/flag and the
Desktop bundle gains an IPC method. Existing CLI setup, Wake, Space actions,
status, diagnostics, Service transport, Skills, and Core/Gateway/Prepare payloads
remain compatible in both directions. The shared binary artifact extraction
preserves existing update and signature behavior. CLI/Service changes are
advisory `available`; no global command/Service/Skills floor changes. The binary
channel must contain the new CLI connection protocol before distributing this
Desktop capability. Older binaries cannot be treated as capable from version
strings and must pass the explicit review probe after managed installation.
No cloud migration or new Computer/Profile/Service owner is introduced.

`packages/schemas/src/service-account-admission.ts` owns the expected-account
request and local admission record. The authenticated local shutdown payload
has an optional `accountAdmissionId`; ordinary shutdown requests are unchanged.
The unpublished admission shape contains one current command and at most one
accepted-start receipt referencing current canonical facts. Later reservations
preserve that receipt. The established strict Service v1 file stays unchanged,
so its older readers do not interpret a new field as a missing contract.
The Service contract, Gateway transport, Prepare, Wake dispatch, Space actions,
status, and trace schemas are unchanged. New CLI/carrier pairs support the
opt-in operation; older carriers reject its unknown startup argument or strict
shutdown field. Callers must surface that refusal and must not retry unguarded.

Cloud-facing contracts are unchanged in both directions. Updated local writers
honor the pending reservation; older CLI writers do not implement that guard.
The updated carrier's final auth-mutex identity check still refuses a mismatched
account before admission. Older CLIs/carriers do not implement the new guarded
operation and cannot be treated as capable from a preceding status read. The
updated Service also binds credentials for ordinary carrier execution, not only
opt-in commands; same-account renewal and setup candidate visibility retain
their existing owners.

Only an explicit pre-commit coordinator refusal permits Stop autostart rollback.
Generic transport/persistence errors, including unsupported-carrier errors,
remain uncertain and keep autostart disabled. The CLI reports that partial
outcome. A later Desktop caller must require the capable CLI and carrier before
exposing controls. No cloud deployment or global local-file-reader floor is
introduced for this opt-in capability. The pilot enables guarded Start/Stop
after its read-only pair capability query. `serviceControlCapabilitiesSchema`
owns the separate CLI response; `account_control_capabilities` is an additive
authenticated control request with explicit carrier support. Older readers keep
their existing strict status responses; older carriers reject the unknown read
without lifecycle effects. No existing request starts emitting new status fields. The
release is deferred to the normal clean-main local-component release; no
contract epoch, command-contract floor, or feature-branch manifest stamp is
introduced. See the
[owning admission semantics](local-openmeld-service.md#account-checked-service-start-and-stop).
## Agent Space reply placement

Space owns the durable per-dispatch output destination. The native delivery's
frozen `threadContext` remains source context for authorization and continuity.
Core resolves the output through `rpcResolveNativeReplyPlacement`. The Center
Agent can explicitly select it through `centerAgentSetReplyPlacement`; personal
Remote Agents use `personalRemoteAgentSpaceTool` with a `reply_placement`
operation. Both require an authenticated active submission. Local Agents may select it with the
optional `placement` field on a final `post_message` Space Action; old clients
omit that field, and Core applies the shared default: existing Thread first,
then main for a Direct Message or exactly one human and one Agent, otherwise
the triggering message's Thread. A choice is locked before final publication
and reused for recovery. Routines and external channels retain their
contracts. Source `threadContext` continues to govern authorization and
continuity independently of output placement.

Thinking and transient progress callbacks do not resolve or allocate output
placement. They retain execution/source identity without creating a Thread.
Explicit placement selection and the first answer text resolve an editable
Space-owned destination. Center and personal Remote Agent tools may reselect
until final publication begins. Final publication alone locks it. Existing
locked records from older workers remain fixed through completion and recovery.
Source authorization and private-context boundaries do not change.

Wake progress readers opt in with `includeReplyPlacement=true` to receive the
optional `replyThreadRootSignalId` and `replyPlacementRevision` on each dispatch.
The revision belongs to the same Space-owned placement record and increases
only when the destination changes. Progress merges preserve the greatest
placement revision independently of lifecycle timing, so late polling cannot
move live work back. Older readers omit the flag
and keep the previous response shape. A selection change emits the existing
`wake.progress.changed` invalidation; readers fetch this canonical projection.
Web applies it to status and existing live drafts before building either
conversation, so a placement change does not wait for the next text delta.
Space also projects its current selection onto stream callbacks, bootstrap,
replay, and terminal frames. Invalidation never becomes routing authority.
The internal placement record accepts legacy records without a revision. The
selection RPC keeps its previous response shape for existing Remote Agent
workers. A Core rollback must retain this additive record reader or drain the
affected turns before rollback; older Core readers reject the stored revision.

Agent stream identities add optional `replyThreadRootSignalId`: a root means
Thread output, `null` means main output, and absence preserves legacy source
alignment. Current HTTP readers advertise `x-openmeld-agent-reply-placement: 1`;
WebSocket readers advertise `hello.capabilities.agentReplyPlacement`. Gateway
and Space omit new Thread live streams for older readers and remove the field
from main streams. Durable Thread messages remain available to both readers.
Current Web uses the explicit destination through deltas, reconnects and terminal
frames, rather than deriving output location from the trigger's source scope.

Roll out Core and Gateway before Remote Agent and Web. A new Remote Agent tool
against old Core reports unavailable rather than posting an independent answer.
Old Remote Agent workers still receive the new default from Core, but need the
new tool to select main explicitly. Local reply placement is an additive shared
Space Action field. Deploy Core before publishing a CLI or Service that can
emit `placement`; old clients omit it and receive the new Core default. Roll
back the emitting local component before rolling Core back, or its new field
may be rejected by old Core. Existing setup, Wake admission, status, trace,
and recovery payloads remain valid. The local component release requires the
normal base-aware stamp and readiness verification; no forced local contract
epoch is needed for the optional field.

## Center Agent session title generation

`generateCenterAgentSessionTitle` is an additive, internal Core-to-Remote-Agent
service-binding RPC. Its strict request and response live in `packages/schemas`.
Space supplies bounded persisted message text and filenames; the receiver returns
a validated short title or no topic. It has no tool, session, or Wake authority.
The existing Space name and index projection carry the result, and existing
metadata invalidations refresh readers. Auth personal titles retain precedence.

Deploy the Remote Agent receiver before Core and Web. New Core with an older
receiver keeps message publication working and leaves the default title when
the optional RPC is unavailable. Older Core does not call the new receiver.
Rollback Web/Core before removing the receiver. No public HTTP, WebSocket,
native delivery, CLI, Service, or Skill payload changes; old and new clients
retain setup, Wake, Space actions, and diagnostics interoperability. No database
migration, contract epoch, or new binding is required. Packaged shared-input
changes still follow the base-aware local-component stamp and publication rules
in [Production Release](../engineering/production-release.md); an unchanged
wire contract does not exempt changed bundle inputs from release readiness.

## Hosted preparation admission acknowledgement

`remoteAgentCoreAdmissionCallbackSchema` in `packages/schemas` owns the exact
Remote-to-Core admission callback identity. The native execution sends it before
resource preparation. Core validates the frozen delivery identity and persists
the same admission through its existing conditional ACK writer. The existing
callback response schema reports acceptance or rejection; no new public response
fields, execution states, or authorization grants are introduced.

Deploy the Core RPC receiver before its Remote caller; remove the Remote caller
before rolling back the receiver. New Core accepts old Remote submission ACKs.
New Remote fails preparation explicitly against old Core. Core-to-Remote submit
payloads and all Web, Gateway, CLI, Service, Skills, setup, Wake transport,
Space Action, and diagnostic contracts are unchanged. No local component epoch
or database migration is required.

## Hosted reply recovery rollout

The optional `replyRecovery` field on Remote Agent submit requests is owned by
`packages/schemas`. It retains the original dispatch and recovery operation;
Space recovery also requires a result reference. The Worker persists that policy
in its callback context and removes all executable capabilities. Core alone
creates the field after exact Execution Recovery inspection.

Deploy the new Remote Worker before Core enables recovery. Older Workers reject
the unknown request field rather than executing it without restrictions. Normal
requests remain unchanged, and no CLI, Service, Skills, setup, Wake, or diagnostic
epoch changes. Before rolling Core back, let accepted recovery deliveries settle;
an old Core cannot read requests with this new strict field. No database migration
or local component release is required.

## Personal Remote Agent evidence

Personal Remote evidence reads add `evidence` and `thread` variants to the
existing `personalRemoteAgentSpaceTool` request/response union. The source
identity and version use the current context-manifest `sourceRef`; the source
Space remains fixed by the admitted delivery. Evidence continuations require
the original version. Thread continuations use the Space-owned after-signal
query and never advance past messages omitted by the context budget.

Deploy the Core receiver before the Remote tool producer. Old Remote producers
continue to use the unchanged variants. An old Core rejects the new variants;
Remote must not fall back to latest content or a different conversation.
This increment adds no stored grant, database migration, CLI command, Service
transport, Prepare payload, or Wake envelope field. Existing workstation setup,
Wake, Space Action, status and diagnostics contracts remain unchanged. Shared
schema changes still require normal local artifact verification before delivery.

## Shared Agent Plugins

Connector execution admission uses the existing operation record and audit
journal. For a Core-derived task identity, the operation row identity includes
the exact effect signature rather than the model's chosen operation ID. A
duplicate ID for that same task/effect resolves to the original operation and
cannot issue another provider request. Read effects do not use this fence.
A later explicit request has a different task identity.

`includeExecutionPermit` opts Remote consumers into a per-call execution permit
and the shared `connectorActionReplayPermissionSchema`. Only a durably recorded
unknown outcome can permit replay. The operation owner atomically inserts one
unique replay-attempt journal row, conditional on the original 24-hour window,
before permitting provider execution. Concurrent requests and process recovery
cannot renew that allowance. A lost claim response consumes the attempt rather
than permitting an unrecorded retry. Old consumers may initiate new operations;
recovery without the explicit permit capability fails closed. Core must precede
the new consumer. No second quota store or database migration is introduced.
`plugin-connection-reply` reads persisted connection links through one shared
parser used by Web presentation and Core continuation validation. Production
root/App origins and staging root/App origins are explicit, separate compatibility
pairs so pre-migration replies remain actionable, including after rollback.
The returned navigation URL uses the current configured Web origin. This does
not admit an Auth origin or grant connection permission: organization, service,
scope, original requester, message provenance, and continuation authorization
remain with their existing owners. No wire fields or stored replies are rewritten.

`packages/schemas` owns `plugin-access`, `plugin-actions`, and `plugin-runtime`.
The Gateway exposes connection access reads/updates and the Local Agent plugin
action endpoint. Core authenticates organization membership, the acting Profile,
requester identity, connection ownership, permissions, and durable operation
admission. The Remote Worker executes provider actions through its service
binding; it receives a named connection and Core-authorized effect, never a
client-selected provider URL or credential. Center Agent tools and personal
Remote Agent tools share this provider runtime.

The shared `connectorConnectionScopeAllowed` policy admits member/shared
ownership for a service. It is not OAuth readiness or an Agent grant. Core
enforces it before creating a shared authorization, selecting a connection,
executing a named connection, or adding Agent access. Legacy incompatible
connections project all-none access but remain readable and disconnectable.
Revocation audits retain the actual stored previous policy. This changes
authorization behavior without adding wire fields or moving credentials.

Plugin connection continuation uses the original admitted request and the actual
published reply Thread. For workstation requests, RuntimeCoordinator exposes a
strict internal read over its retained command state: execution, account, target,
source message, Binding, admission time, source Thread and canonical message
envelope digest. This projection contains no message body, token, Space password
or protected information. It proves admission only. Space separately requires
the RuntimeCoordinator `reply_published` outcome and its matching published reply,
then checks the current original and reply inside the insertion transaction.
The retired dispatch conveyor is not retained or reconstructed for this check.
Native continuation keeps its retained native execution request. Missing or
mismatched evidence, edits and recalls fail closed. Neither path grants Plugin
access. This additive Core-to-Core read does not change Service/CLI payloads,
setup, Wake, publication or diagnostic contracts; no epoch bump or client update
is required. Deploy the Core receiver and caller together.

Access responses include the canonical connection scope and policy revision.
The access list contains active Core connection records and does not require a
successful provider inventory request. A provider outage must not prevent an
owner from revoking Agent access. Updates compare revisions and atomically append
an access event. Each new invocation rechecks current access and active status.

Local requests choose an explicit account and identify a logical operation.
Confirmation binds the exact operation signature and access revision for fifteen
minutes. Retries return the original ledger status without resubmitting; unknown
provider outcomes remain unknown. Wake provenance is read through the Dispatch
application boundary. It does not establish execution liveness or replace
RuntimeCoordinator authority. The local account and Service remain the local
trust boundary; a dispatch identifier is not a secret execution capability.

Local non-read calls reuse a Core-verified original request. Direct human Wakes
use the immutable Space message identity. Recorded Center delegations use the
parent native delivery identity. Current execution admission, membership, exact
delegated input, selected account, connection version, and Plugin permission are
checked again. A continuation or specified child shares that root; changing an
operation ID or executor does not create another write for the same task/effect.
The original operation and account remain the receipt owner. Only its original
executor can claim the one provider replay, preserving its idempotency key.

A manual Local call without verified request provenance creates one exact private
Inbox request. `includeRequestAuthorization` opts into the shared
`authorization_required` projection. Other callers receive an actionable error.
`plugin-action-requests` owns read/approve/reject DTOs. Approval requires the
authenticated account principal to match the request owner and a Human Profile.
A delegated Agent principal cannot approve, even if it supplies a Human Profile
identifier. This uses the existing account credential boundary; it does not
claim to distinguish a human from an Agent given that human's full credentials.
No email code or separate factor enrollment is added. An approved manual request
supplies `plugin-request:<id>`; its exact actor, account and input remain bound.
A genuinely new manual request can be approved separately without resolving an
older unknown result.

Inbox source-target capability 10 adds `plugin_action_request`; version 9 retains
account-scoped notifications but directs users to current Web for this detail.
Rollout requires migration 0192 and current Gateway/schema readers before Core
creates these rows, followed by Web/CLI consumers. The unreleased email-code
prototype is removed from Auth, schemas and Web. Replay readers must understand
`original_executor_required` before Core emits cross-executor receipts. The
fifteen-minute destructive token remains distinct from the one-hour manual
request and the operation's single replay within its original 24-hour window.

### Contract impact and rollout

- Migrations 0171 and 0172 add nullable policy/revision, access events, and
  confirmation records. Apply them before the corresponding Core code. Existing
  rows preserve previously shipped Center/Remote access and grant no Local access.
- Existing setup, Prepare, Wake, Service transport, and Space action contracts
  are unchanged. No epoch increase or required CLI upgrade is introduced by this
  additive feature. Old CLI/Service pairs continue their existing workflows;
  the new CLI commands require the new Gateway/Core/Remote implementation.
- Deploy the Remote provider runtime before enabling Local Agent invocation.
  Deploy the cloud producer/consumer changes as one coordinated release. Old
  Remote clients that omit `includeAccessPolicy` receive the original strict
  connection-selection shape. New clients opt in to the permission projection.
- Legacy batch-write audit admission now requires the selected connection name.
  Updated Remote producers supply it. During a mixed-version window an old
  producer is rejected before the write, rather than bypassing policy.
- Build and verify CLI/managed skills in deferred release mode on feature
  branches. Stamp and publish their final artifacts from the clean-main release
  lane. Publish the matching public CLI guide in that lane; do not rewrite the
  signed public skill channel from a feature branch.
- Rollback the Web/CLI entry points before cloud handlers. Additive database
  columns may remain, but rolling back Core enforcement also removes the new
  policy guarantee: revoke affected provider connections before such a rollback.

## Space message link previews

`@openmeld/schemas` owns the additive GET
`/v1/spaces/:spaceId/link-previews?signalId=...` input and result, including the
message revision and bounded metadata. The existing Space access boundary
authorizes the canonical Signal before and after remote reads. Callers cannot
submit arbitrary URLs. Recalled messages cannot return previews.

`@openmeld/protocol` owns link recognition shared by plain-text rendering and
Core extraction. Core fetches public HTTP(S) metadata outside the Space Durable
Object, validates destinations and redirects, and returns bounded raster data
without forwarding viewer credentials. Its Space-scoped cache is disposable
derived metadata, never message or access authority.

Contract impact: deploy Core and Gateway before Web; roll back Web first. Old
clients keep their existing behavior. No stored Signal, CLI, Service, Skills,
setup, Wake, diagnostics, or local component version contract changes.

## Space pin contracts

`@openmeld/schemas` owns the strict message/file pin mutations and read models;
`@openmeld/api-client` owns their GET/PATCH transport. Gateway authenticates
`/v1/spaces/:spaceId/message-pins` and `/v1/spaces/:spaceId/file-pins`, then Core
RPC delegates to the owning Space Durable Object. Mutations require an active
human member whose owner matches the authenticated actor, and only the original
pinner can unpin. Public and password-protected Space access still uses the
existing Space authorization boundary.

These are additive endpoints; existing message, file, and metadata wire models
are unchanged. Web consumes both APIs and refreshes after existing
`space.meta.changed` notifications, file changes, and stream reconnects. CLI,
local Service, Desktop, and Agent execution contracts do not change. Delivery
requires Core and Gateway before Web; no local component upgrade is required.

## Space Task contracts

`assign` accepts optional `reviewerProfileId` and `wakeAssignee`. Reviewer
changes require the requester or Space owner; preserving the existing reviewer
needs no additional authority. `wakeAssignee: true` requires an Agent assignee
and a To do Task, and queues the initial handoff in the assignment transaction.
The Remote Agent's `delegate` tool action requires an explicit reviewer choice
and translates to this mutation with an idempotent operation identity. It does
not call the generic Wake tool or infer that execution has started.

For assignment, reviewer, and brief mutations only, Core may project a human
requester from the designated Center Agent's live, authorized native delivery
in this same Space. This projection is recomputed at the public RPC boundary;
caller-supplied representation is discarded. Space rechecks current human
membership and ownership, and only the Task's requester can confer these
management permissions. Routines, Agent-authored requests, other conversations,
and unverified senders confer no such permission. Result submission and review
retain the acting assignee/reviewer identity and cannot use representation.
Task activity keeps the Center Agent as the actor and names the represented
requester's Profile in the existing event detail. Representation failures
remain fail-closed; they do not retry with the actor's independent permissions.

Contract impact: the mutation fields are optional and Task/event/read payloads
are unchanged. Existing CLI, Service, Skills, Gateway, and Web readers remain
compatible, including setup, Wake, dispatch-owned Task tools, and diagnostics.
Old Core rejects the new write fields, so deploy Core before the Remote Agent
caller. No CLI/Service/Skills contract bump, database migration, or runtime
lifecycle change is required. The shared schema is a Service bundle input, so
the base-aware release owner must rebuild, stamp, and publish an available
CLI/Service artifact while preserving the existing required floors. Old cloud
accepts its unchanged local commands, and new cloud accepts the existing local
Task tools and source snapshot contract. Dispatch context uses that existing
text snapshot on both runtime families. Follow the Task receiver-first release
profile with the original pre-feature base through artifact preparation.

`@openmeld/schemas` owns the strict Space Task, actor, result, review, event,
create, mutation, list, detail, receipt, Project-set, and provider-typed
`externalWorkItems` contracts. `externalWorkItems` and `projectIds` default to
`[]`, so stored Task JSON written before these fields still parses. GitHub
items retain owner, repository, and number; Linear items retain provider UUID,
identifier, team UUID, optional provider project UUID, and URL. Linear observed
state remains null because no Linear subscription owns it. Gateway authenticates
`GET/POST /v1/spaces/:spaceId/tasks` and
`GET/PATCH /v1/spaces/:spaceId/tasks/:taskId`; Core RPC delegates to the owning
Space Durable Object. Writes require an active human or Agent member whose
profile ownership matches the authenticated actor. Member reads use the same
actor boundary; public and shared-link reads use the existing read-only Space
access contract. Direct Messages support the same Task workflow. Private writes
require active conversation membership; observing an owned Agent's conversation
does not grant the human owner mutation access. Agent tools use the current
conversation ID and retain the same Core actor and membership checks.

Create and mutation requests carry an operation id. Mutations also carry an
expected revision. The Space Durable Object compares `expectedRevision` in the
workflow before writing; a stale revision is typed `space_task.revision_conflict`
HTTP 409. The SQL `UPDATE` is not a second concurrency authority. Replaying
the same operation returns `applied: false`; reuse for different input is
`space_task.operation_conflict` HTTP 409. Attaching too many external issues is
`space_task.external_work_item_limit`; detaching or observing a missing link is
`space_task.external_work_item_not_found`. Reviews additionally require
`expectedResultRevision`, identifying the submitted result the reviewer
actually read. A different result is `space_task.result_revision_conflict`
HTTP 409, even when the Task revision is current. New results use their
submission's Task revision as their result revision, so reopening or
reassigning a Task never reuses an earlier result identity. Those codes belong to
`gatewayErrorCodeSchema` so mixed-version Gateways pass them through instead of
wrapping them as `upstream_error`. Other Space Task codes such as
`space_task.not_found`, `space_task.forbidden`, and `space_task.invalid_action`
stay wrapped until a caller needs to distinguish them from generic upstream
failures. Callers refresh the Task after a revision conflict and require a new
decision before resubmitting a semantic change. They do not replace
`expectedRevision` and blindly replay a stale brief or review. A provider
observation may retry once with a refreshed revision because it reports
provider-owned state rather than approving a changed Task.
`set_projects` is a revision-checked Space Task mutation. Core validates each
active Project against the Space's Organization before the Space writer accepts
the association; the Task's owning Space still writes the only Task state.
The Task Project set is work scope, not another Task writer or an authorization
grant. A new external write cannot take a destination from the set's list
order. Existing Tasks remain unassociated until a new scoped mutation succeeds.
Project detail's recent Task response contains at most twenty currently
authorized Task summaries. Core first reads bounded Project link keys from
PostgreSQL, then rereads each Task through the owning Space with the current Human
Profile. Missing, inaccessible, or no-longer-associated Tasks are omitted;
the response never exposes candidate counts or implies complete history.

`GET` detail returns the legacy Task and event shape by default. A client may
request `includeAffordances=1` to receive `allowedActions` and `pendingActions`.
The former is projected by the same Core workflow preconditions used for
mutations; it is a current affordance snapshot, not a permission grant. The
writer rechecks actor, phase, revision, and action-specific input. Public
readers receive no mutation actions or internal delivery status. Clients treat
absent fields as empty and fail closed against older Core responses.
`pendingActions` is a read projection of Task delivery intents with pending or
failed status. It never reports that a Wake has actually stopped or that a
provider update occurred merely because a Task changed phase. A canceled Task
may request Stop for an exact recorded Wake when its retained cancellation
actor is still an active, Auth-verified member; provider observations grant no
such Stop authority. Stale handoffs are fenced when their Signal is persisted.

List responses are bounded to 500 Tasks and report `truncated` rather than
silently claiming complete history. GitHub issue association refuses to treat a
truncated miss as "not found": it does not create another card and does not skip
close-sync. The additive
`space.tasks.changed` WebSocket
frame is only a refresh signal. Web rereads the Task projection and never
derives Task state from the frame.

GitHub issue association is additive Remote Agent plus Space Task contract.
Creating an issue from a shared Space records a linked Task through the
existing create/mutate RPCs when the Task list can confirm whether that issue
is already linked; the GitHub issue remains GitHub-owned. Closing
the issue through `github_update_issue` or a verified GitHub App webhook
settles still-active linked Tasks through the Space writer: `completed` becomes
Done, or In review when a reviewer is assigned; `not_planned` and `duplicate`
become Canceled. Unknown reasons preserve the current phase. Completing or
canceling a Task does not PATCH GitHub from Core. Old Remote Agent builds
simply omit the association.

Confirmed Linear creation may add an exact reference to one eligible source
Task through the same Space mutation RPC. An issue-creation receipt and its
Task-reference write are separate effects: a confirmed provider creation with
failed association reports the partial result and recovers only the Task
mutation. Linear references do not enter the GitHub webhook link projection or
GitHub close-prompt policy.

New Task fields and the Linear variant are strict-reader changes. Deploy
consumers that understand `projectIds` and both provider variants before Core
begins returning them. Version 2 supports these fields. Updated clients send
`taskContractVersion=3` on Task
read/write routes. For an older client, Core omits the empty new field from a
legacy Task and returns `space_task.contract_update_required` (HTTP 426) when
current Project or Linear facts would otherwise be lost or rejected. Older
clients reject an unsupported Task rather than flatten it to one Project or
recode a Linear issue as GitHub. The
published CLI and OpenMeld Service compatibility audit covers the Task
read/write path before this producer is enabled.

Version 3 adds `{ provider: "github" }` attribution to Task results and events.
This is not a member actor and grants no mutation, Wake, or Stop authority.
Every GitHub observation event uses this attribution, including open-state
observations. Versions 1 and 2 receive HTTP 426 for results or event history
they cannot represent; mutation admission checks current state and replay
receipts before side effects. Member-only Tasks remain compatible with version
2. This requires a coordinated Core/Gateway and Web/Remote Agent/CLI/Service
rollout: new clients send version 3, which old receivers reject with HTTP 400;
old clients receive HTTP 426 once provider facts appear. There is no separate
producer switch or zero-interruption mixed-version guarantee. Install the
receivers and promptly update consumers before exposing the new workflow.
Persisted Tasks, events, receipts, and delivery intents
require the version 3 reader on rollback; do not roll back to a reader that
rejects provider attribution. No historical attribution is inferred or rewritten.

Gateway `POST /github/app/webhook` forwards the raw body and GitHub delivery
headers to Core `verifyGitHubAppWebhook`. Core verifies
`X-Hub-Signature-256` with `GITHUB_OPENMELD_WEBHOOK_SECRET`, accepts `ping`,
ignores uninteresting events, and enqueues `kind: "github_app_webhook"` on
the existing daemon-dispatch queue. The Space Durable Object
`rpcApplyGitHubIssueObservation` path has no member context and does not
start a model turn. Verify the native schema originating in historical D1 migration 0180 before Core and Gateway
consumers. A missing webhook secret fails closed. Old Gateway builds simply
lack the route; old Core builds reject the new RPC. The version 3 attribution
change requires updated local-component Task readers as described above.

The exact-result review change is not compatible with old review producers:
new Core/Gateway reject review requests without `expectedResultRevision`.
Old strict readers remain compatible because they do not request the optional
detail fields. Deploy Web and Gateway consumers before Core, then the Remote
Agent review producer. A new Web against old Core receives no affordances and
shows no Task controls until Core is upgraded. New review producers fail closed
against old strict receivers, so keep the mixed-version window short. The CLI
command contract is bumped and the CLI update is required before the new Core
release admits that capability.
Do not infer a result revision on behalf of an old caller. Existing stored
Tasks remain readable; their result revision is preserved until another
result is submitted. Wake execution, finalization, Service carrier, and
dispatch action-record contracts do not change.

GitHub observation and cancellation operation IDs include a stable provider
event identity. Retries of one event reuse its operation ID; distinct events
for the same issue and state must not reuse a lifetime-wide operation ID. The
shared operation ID limit is 512 characters so valid long GitHub owner and
repository names still fit alongside a Task ID and event identity; deploy
schema consumers before producers that emit longer IDs. Remote Agent uses the
GitHub response's `updated_at` when present, or durably retains the first
observation time under the provider write operation. Replaying that write must
reuse both its event identity and observation time. A tool-driven issue close
without a stable provider operation identity fails the Task association closed;
the observation timestamp is never used as a substitute operation identity.

The local Space Action MCP adds non-final Task tools alongside its one required
final Space action. Task review requires the exact-result CLI contract above
and the normal local-component release audit. Remote Agent exposes the
same Space-owned HTTP/RPC contract. Neither surface changes Agent Task Handles,
RuntimeCoordinator envelopes, Wakeability, or final action receipts.
`space.tasks.manage` is the additive privacy-safe Agent Activity key for the
Remote Agent tool. Deploy schema consumers in Web, Gateway, and Core before the
Remote Agent producer; an old Remote Agent simply lacks the Task tool.

## Boundary

### Dispatch Space Action receipts

`@openmeld/schemas` owns `dispatchSpaceActionToolResultSchema` and its inferred
types for the local recorder's MCP result. Its `receipt.status` is
`proposal_saved_locally`, `rejected_closed`, or `outcome_unknown`. All variants
leave Coordinator acceptance and Space publication `unconfirmed`; a local
process cannot infer either fact from expiry, a saved file, or an error.
Saved receipts carry the original context/dispatch/attempt identity, action
type, and recording timestamp. Context nonces remain private to local records.

Exact receipt recovery after local expiry is read-only. It retains runtime
identity checks and record nonce validation and cannot create a different
action, upload a file, renew execution, or bypass RuntimeCoordinator or Space
publication. Corrupt or unreadable evidence is preserved with an unknown
receipt. New actions remain subject to the existing active-context writer.

This is an additive MCP output contract with retained text content. On-disk
context/action formats, CLI JSON, Service/Coordinator payloads, setup, Wake,
trace, and diagnostics contracts are unchanged. Old cloud/Service and new CLI,
or new cloud/Service and old CLI, can interoperate; older MCP clients may read
the text, and consumers must not require structured receipts from older CLI
versions. No migration, mandatory version floor, or cloud deploy order is
introduced. A future CLI/Service release may deliver this as an available
update; release manifest stamping stays with that release.

The same dispatch-owned MCP server exposes `read_history` for a bounded Space
text window. `dispatchSpaceHistoryRequestSchema` accepts no arguments;
`dispatchSpaceHistoryResultSchema` owns its strict output with `spaceId`,
`sourceSignalId`, literal `beforeCount: 20` and `afterCount: 0`, at most 21 text
signals including the anchor, and `nextCursor`. Space, anchor, and acting Profile
come from the active dispatch, never model input. Existing public Space readers
still enforce access, and the local bridge rechecks active dispatch identity
after the read. Wrong-Space, non-text, oversized, or expired results fail closed.
The tool does not read local project files, grant shell access, or publish an
action. It is an additive local MCP contract using existing cloud history
receivers; it introduces no backend endpoint or data migration. Older local
components retain their existing history commands. Scoped bootstrap guidance
uses the MCP reader because native file isolation can prevent loading a local
CLI and its dependencies.

`read_evidence` accepts `spaceMessageEvidenceRequestSchema` and reads exactly
one message through that same current-Agent Space API. Local and Remote readers
share the context-manifest materializer in `@openmeld/protocol`: source version,
materialized hash, Unicode offsets, and the 4,000-character bound have one
implementation. Continuing a source page requires its original version. Missing,
recalled, or changed evidence fails explicitly; it never selects the latest
version in place of a requested version. This adds a local tool, without adding
a cloud route or granting access to another Space.

Exact message evidence also accepts a visible `signal.system_notice`. The
materializer returns its public text, system author and reply anchor through the
existing manifest shape. It does not disclose diagnostic supplements, change
Space authorization, or treat a notice as task approval. Center, personal Remote
and local dispatch readers share this selection; status and presence signals
remain outside message evidence. Existing text source versions are unchanged.

Large local tool results remain transport snapshots. Before `read_result`
discloses each cached page, it reruns the original source read with the original
arguments and compares the result with the snapshot. Revocation, source changes,
or an inaccessible old Files revision invalidate the page. The active Wake is
also checked after the read. A cached result is never an authorization grant.

The local `read_result` request optionally accepts a case-sensitive literal
`query` against the retained serialized JSON. Its bounded `search` response
contains up to two original-text excerpts and a cursor for subsequent matches;
it is not a complete read or a semantic absence proof. Omitting `query` preserves
the original complete pagination contract. Search uses the same Wake, connection,
source-version, and access checks as paging. The schemas live in
`packages/schemas`; this is a locally advertised tool extension, not a cloud
payload change. Older local components continue to advertise ordinary paging.
No setup, Wake, action, diagnostic, or native conversation contract changes;
there is no required contract-floor bump or cloud rollout ordering dependency.

### Thread continuation and file working context

Space owns retained quoted-message lookup and the last explicit human thread
Wake. Thread readers opt into `includeWakeContinuation=true`; only these readers
receive the optional `wakeContinuation` projection. Its optional
`automaticTargetProfileId`, requested with `includeWakeContinuation=conversation`,
reflects the complete retained Thread authors plus the current viewer. Legacy
`includeWakeContinuation=true` readers retain their original response shape.
Space applies one-human/one-Agent automatic addressing when
accepting a plain human Thread reply, through ordinary Wake authorization and
publication. Group replies require explicit addressing. Web does not insert an
automatic Composer token; it shows recommendations only for group conversations.
The `threadWakeContinuation` marker prevents automatic follow-ups from changing
the last explicit human selection. This intentionally changes plain Thread reply
behavior for older clients too, matching Direct Messages. Explicit targets remain
authoritative. Core and Gateway must ship before Web to accept the new projection
request. No Service, CLI, or runtime payload
changes are needed: the resulting Wake uses the existing explicit envelope.

Internal dispatch snapshots may carry quoted-message context and pinned-file
metadata. `@openmeld/space` renders these consistently for native and workstation
delivery. Core flattens them into the existing text field and removes the new
fields before the Service transport boundary, preserving installed strict
Service readers. Reply placement and RuntimeCoordinator execution ownership do
not change.

File update settings use an additive GET/PATCH endpoint with shared strict
schemas. Space SQLite owns versioned consent and the revision notification
outbox; the existing message publication, Inbox, and Wake paths own delivery.
Core and Gateway must precede Web. Existing file descriptors and write requests
remain unchanged, as do CLI, Service, Skills, setup, and diagnostics contracts.
File maintenance prefills the existing Routine contract without a new scheduler.
Rollback the new Web callers before their receivers; no local component release
or execution-contract epoch bump is required for these additive capabilities.

### Optional Space bootstrap readiness enrichment

`GET /v1/spaces/:spaceId/bootstrap` accepts `includeAgentReadiness=false`.
Only this explicit opt-in returns `includesAgentReadiness=false`; omitted or
true requests retain the existing full response without a new marker. Gateway
forwards the option to Core. Access checks and member identity remain present,
while runtime readiness reads and liveness observation writes are skipped.
Missing readiness is unknown, not an offline result. Clients must keep this
identity-only snapshot out of the authoritative members Query cache and load
that projection independently.

Both additions are optional in `packages/schemas`. Old callers retain the full
response, and new callers accept an unmarked full response from older cloud
components. The normal Web, Gateway, Core rollout order is compatible: an older
Gateway never forwards the opt-in to Core. CLI, Service, setup, Wake, Space
publication, and diagnostic contracts are unchanged; no local component epoch
or required-update floor changes.

### Direct Message conversion member snapshots

The conversion request may opt into `includeMemberSnapshots`. The Space-owned
transaction returns its existing add-members `items` in that case; the response
field is optional so readers can still accept older Core responses. Calls that
omit the option retain the original strict response shape. These snapshots
confirm membership, not Wakeability; Web does not invent Agent availability.

Web applies the confirmed members, counts, and conversion metadata before
navigating, then reconciles through the normal authoritative reads. Deploy Core
and Gateway before the Web caller. An older Gateway rejects the new request
field before mutation; an older Core behind the new Gateway returns the legacy
success response, retaining the previous refresh behavior. Roll back the Web
caller before its receivers. CLI, Service, Skills, setup, Wake, Space actions,
and diagnostics keep their existing contracts; no migration or local component
release is required.

### Personal Agent owner Inbox activity

Inbox source-target version 6 adds optional `agentOwnerActivity` to Space targets.
Version 5 retains DM routing but omits this marker; earlier readers retain their
existing projected shapes. Deploy Web, Gateway, then Core before the producer
writes this additive field. Core owns recipient qualification and unread totals:
only current personal Agent ownership qualifies, never managed-role or Center
Agent administrative ownership. Space canonical members supply delivery candidates;
Space Index and current identity authorize subsequent Inbox reads. No database
migration or CLI/Service contract change is required. Older API clients receive
compatible projected targets. Preserve upgraded receivers when rolling back a
producer after version 6 rows exist.

### Space directory visibility

The shared Space metadata PATCH schema accepts optional `visibility` (`private`
or `public`). The Space Durable Object owns this setting and requires the same
Space management authority as renaming. Direct Messages reject metadata changes.
Changing visibility preserves link access, organization identity, and converted
Direct Message metadata. Web refreshes the owning status and directory queries
after saving; it does not infer access from directory visibility.

This is an additive Web/API-client/Gateway/Core mutation. Existing clients and
CLI/Service/Skills setup, Wake, Space actions, and diagnostics remain compatible;
no storage migration or local component release is needed. Older Gateway/Core
receivers reject the new field, so the new control works only after both are
updated. For a combined Inbox release, preserve its documented receiver-first
ordering; the visibility control must not be treated as available until its
receivers are current. Reverting Web is safe; reverting a receiver makes new
visibility writes unavailable without changing saved access policy.

Personal native Agent creation and the Core/Remote private collaboration RPC
use shared schemas, including the explicit `personal_agent` V4 identity. See
the [personal Remote Agent contract audit](review/2026-09-08-personal-remote-agent-contract-impact-audit.md)
for mixed-version behavior, receiver ordering, and rollback constraints.

### PeopleComputers

`peopleComputersResponseSchema` is the owner inventory and connection-evidence
contract. `PeopleComputerTarget` always names a device and Service lane; Core
checks the authenticated owner and exact current transport session. Saved
Binding preference is not connection evidence. CLI-local device proof belongs
only to `peopleComputerCliInventorySchema`, never to a browser-derived claim.
The shared legacy inventory adapter accepts an explicitly supplied target and
does not recompute connection or readiness.

Center Agent reads the same inventory through `centerAgentReadPeopleComputers`.
This model-facing projection omits full capability and local-agent catalogs
from execution targets: those include large model and installation reports
that can exceed the tool-result safety limit. Identity, connection evidence,
and dated target metadata remain unchanged; focused candidate and installation
tools provide their own details. This is payload selection, not another
readiness calculation, and does not raise the tool-result safety limit.
The verified requesting member owns the read; the hosted Profile owner does
not select its account. Without an explicit device/lane target, the response
contains no selected-computer diagnostics and makes no browser identity claim.
Selected diagnostics retain Core readiness and path-free File Access summaries.
Tools updates, maintenance, and local-installation selection use distinct
PeopleComputer RPC methods requiring an exact target. New producers never fall
back to old current-target methods: an old receiver could otherwise ignore the
target and operate on another computer. Deploy Core before Remote Agent.

`buildLocalAgentConnectionCandidateId` in `packages/agent-runtime` identifies
one controller on an exact device, lane, and reported Service runtime. Web
creation and Core candidate projections share this encoding. The identifier
is selection evidence, not authorization; Core revalidates the owner inventory
and current candidate before binding. A missing selected catalog never permits
falling back to another computer.

Each candidate carries current connection and Service-update reasons plus its
own controller capability reasons. Execution-target reasons summarize all
enabled controllers on that Runtime and must not be copied into an individual
candidate. One controller's sign-in failure does not establish another
controller's authentication state or override its ready report.

PeopleComputers HTTP/RPC endpoints coexist with supported current-target
endpoints. New clients must deploy after their receivers. Shared optional fields
are not assumed safe for an old strict parser: the new inventory has a separate
endpoint, and the CLI output change has a new command contract. See the
[PeopleComputers audit](review/2026-09-07-people-computers-contract-impact-audit.md)
for mixed-version direction, required CLI policy and evidence limits.

### Center Agent Session Creation, Listing And Selection

The Flue 2 candidate adds `POST /v1/organizations/current/center-agent/sessions`
with the strict shared `{ creationId: UUID }` body. Core resolves Organization
membership and the actual Human/Center Agent pair. The resulting private DM
Space ID is deterministic for that pair, Organization and creation key;
independent keys cannot collapse through the old open-or-reuse path. No caller
supplies a member identity or Computer identity. Retrying membership setup
converges in the existing Space owner after metadata initialization.

`GET /v1/organizations/current/center-agent/sessions` uses the shared bounded
`limit` and opaque `cursor` query schema. Core resolves current membership and
designation, then reads the Space index for the exact Organization and pair.
Keyset pagination orders creation time and Space ID descending. The cursor
must match that Organization and pair; it grants no authority and the query
always repeats those filters. Responses preserve a missing creation time as
null. The shared response includes `sessions` and a nullable `nextCursor`.

`GET /v1/organizations/current/center-agent/sessions/:spaceId` returns the
existing Center DM projection only for that exact current-member pair and
Organization; unavailable selections return a null projection. There is no
fallback to another chat. The SDK exposes `createSession` and `getSession`.
Existing `/dm-space` consumers retain the default open/read behavior.

Context Manifest requests may supply `spaceId` using the same shared selector.
Core verifies the pair before reading Signals or recording a manifest. A
foreign or missing selected conversation returns the existing unavailable
conversation error; it never reads the default chat. Older callers that omit
the selector retain the existing default behavior. New session consumers must
pass their exact selection. The Local Agent `source.sessionId` remains
attribution only and is not this selector. Deploy Core/Gateway receivers before
clients use these additive routes and fields. None of these projections owns
runtime history, execution authority, or Computer isolation.

### Flue 2 Runtime Diagnostics

Text-message metadata may name `centerAgentExecutionInput` with the original
dispatch and Center Agent Profile. The authenticated Space owner accepts this
only for the same verified Human Profile's private Center Agent execution.
It never creates a second Wake. The shared `receiveExecutionInput` and
`readExecutionInput` RPC contracts carry an exact execution target and stable
input ID. Runtime receipts distinguish durable receipt, canonical application,
and unconfirmed application when the execution has ended. Neither receipt nor
message metadata grants new tool or member authority. Deploy Remote Agent's
receiver before Core's sender, then Web's metadata producer. Older clients
continue the ordinary message path; do not remove the receiver while a Space
has undelivered inputs. This additive contract does not change workstation
RuntimeCoordinator or installed Service contracts.

Remote Agent emits runtime diagnostics version 2 against Flue 2's actual
submission store: `maxAttempts` counts total attempts, `joinedInto` identifies
an absorbed delivery, and joining/joined are explicit lifecycle states.
The removed beta recovery-request field and attempt-marker table are not
reported as fabricated empty evidence. Core accepts versions 1 and 2 during
the beta cutover; deploy that receiver before the Flue 2 producer. Version 1
remains readable only for the still-deployed beta runtime. These bounded
diagnostics are observations, never proof that an entire deployment target is
drained or that pending callbacks and delegated work have finished.

The dispatch-trace HTTP response can embed this diagnostic contract when the
caller explicitly requests runtime diagnostics. Dispatch-trace response
contract 4 admits both runtime diagnostic versions. Gateway requires version 4
for the opt-in path; older clients receive an explicit update instruction and
can still request ordinary traces. Contracts 2 and 3 retain their existing
ordinary-trace projections; an omitted version retains the legacy projection.
Core transports all three negotiated versions without dropping the selector.

Roll out the Core receiver and Gateway negotiation first, then the CLI that
requests contract 4, then the Flue 2 producer. The new CLI cannot request version
4 from an old Gateway; do not publish it ahead of that receiver. During rollback,
restore the beta producer before removing its v2 diagnostic receiver. Keep the
Gateway negotiation receiver while published clients request version 4.
Ordinary traces without runtime diagnostics do not carry the changed payload.
Do not discard the diagnostic error or invent beta fields to make an old
validator accept new evidence. This ordering is a release gate, not deployment
evidence.

Official CLI Skill content uses the signed Markdown channel contract in
`packages/schemas/src/official-cli-skill.ts`, separately from Organization
Skills. The optional local component `skills.contentRelease` reports the
selected independent revision and minimum CLI version. Core retains required
Skill contract checks and local installation errors while accepting aligned
independent hashes. Deploy strict report receivers before bridge producers;
see [Official CLI Skill delivery](../engineering/official-cli-skill.md).

Shared contracts prevent semantic drift across OpenMeld clients, services, packages,
and processes.

A rule belongs here when separate implementations would create a second truth
for the main product chain:

```text
Space Wake -> RuntimeCoordinator -> local OpenMeld Service -> local agent -> Space reply, stopped outcome, or explicit failure
```

This document does not make shared policy an execution authority. Shared schemas
and shared policy define common language and eligibility projections. They do
not reserve leases, start execution, accept results, publish replies, or decide
final Wake outcomes.

### Model Catalog Creation Policy

`packages/schemas` owns the authored catalog and Git-backed update-evidence
schemas. The optional local-controller `creationDefaults` is Core-owned
creation policy, not runtime selection or availability evidence. Core's
`readAuthoredModelCatalog` reads it for first-use creation preferences;
`readModelCatalog` omits it from all public/catalog projections so existing
strict clients continue to read the version-1 response. The existing resolved
creation-preferences response remains unchanged. Remembered user choices take
precedence, including explicit model-default reasoning. No Binding, Wake,
Service lifecycle, or dispatch contract changes.

### Reviewed Model Retirement

The optional authored model `retirement` is reviewed policy, not scraped evidence
or a time-triggered status. `announced` stays advisory; `withdrawn` requires an
exact applicable controller/provider/sign-in scope. Model-catalog callers opt in
with `?retirement=1` (or the optional Core RPC read preference); legacy strict
version-1 projections omit it. Unknown scope never becomes a global unavailable
flag. Share `model.retired` and `model.unavailable` reason semantics across Core,
local routing and recovery; the public verdict remains `Unavailable`.

The model owner feeds the existing Inbox source contract and current Core
Wakeability. Neither projection mutates a Profile's manual enablement or model
selection. Deploy accepting cloud readers before new local routing reasons. The
model-selection owner document records the complete rollout and native-session
limits; a catalog change alone does not upgrade old executable behavior.

### Organization Working Language Contracts

`packages/schemas` owns the canonical BCP 47 language tag, `automatic` and
`selected` modes, Center Agent mutation RPC, Remote Agent turn-envelope field,
and Runtime Transport delivery field. Inputs are strict and language tags are
canonicalized at the boundary. Callers never supply Organization identity,
role, actor attribution, revisions, or audit authority.

Core owns authorization, durable state, conditional automatic observation, and
audit. `packages/agent-runtime` owns the stable, provider-neutral language
judgment instructions and rendering of the optional per-turn advisory. Remote
Agent and Local OpenMeld Service consume those contracts; they do not persist a
second preference or convert advisory guidance into permission or execution
truth. The additive rollout deploys the PostgreSQL migration and cloud receivers before
Core emits the optional fields, then publishes the local Service producer.
Older receivers ignore no new required field; new receivers admit an omitted
field as no guidance.

### Organization Skill Contracts

`packages/schemas` owns strict Organization Skill list, detail, import preview,
mutation, immutable release, runtime snapshot, CLI Agent View, and delegated
exact-release descriptor shapes. Cross-boundary inputs carry an Organization
selector or stable Skill identity as required by the transport, but never
caller-supplied roles, maintainer authority, R2 keys, or credentials.

Core is the only writer and authorization owner. Gateway, Web, Center Agent
tools, CLI, Remote Agent, and Local OpenMeld Service consume the same Core
contracts. A runtime or delegated snapshot names exact Skill and release ids
plus a content digest; `latest` is never a valid execution descriptor.

Skill detail reads accept an optional `releaseId`. Only that explicit request
adds `selectedRelease` (the immutable runtime release bundle) to the response;
the ordinary `skill.activeRelease` and `skill.bundle` still describe the active
release. Core rechecks enablement for exact loading and scopes the release to
the authorized Organization and Skill. Deploy Core, then Gateway, before CLI
callers of `skills load --release`; older receivers must not cause latest-release
fallback. Existing requests and in-flight runtime snapshots retain their semantics.

The portable `SKILL.md` frontmatter remains an Agent Skills content contract.
OpenMeld ownership, enablement, maintainers, source provenance, audit, and
release state stay outside portable frontmatter in Core-owned schemas.

### Agent Activity Session Inventory Contracts

`packages/schemas` owns the strict Local Agent Session provider, status,
origin, capability, coverage, reconciliation-page, paginated read, CLI JSON,
and Center Agent tool shapes. The five provider values are `codex`,
`claude-code`, `cursor`, `opencode`, and `grok-build`; consumers cannot add a
provider or reinterpret a capability locally. Every provider value has exactly
one canonical built-in Agent Controller ref, and strict reconciliation,
coverage, and read schemas reject mismatched pairs.

Core owns Organization authorization, public owner/Project/Computer joins,
atomic publication, stable keyset pagination, staleness, and the read-time
Agent Profile Binding projection. OpenMeld Service owns provider discovery and
maps native evidence into the shared observed-Session shape before transport.
Web, CLI, Local Agents, and Remote Agent may filter or render the response, but
they must not rebuild Session identity, status, title, Binding, origin,
Computer liveness, or Resume/Fork capability.
Pagination cursors bind both the complete filter set and the authorized
Organization, so a cursor issued in one tenant is invalid in another even when
all visible filters match.

The stable product identity is `(owner, agentControllerRef,
nativeSessionId)`. The public contract intentionally contains the native id and
never contains an OpenMeld-generated Session id, internal device id, Service
runtime id, local connection id, absolute path, transcript locator, or mutation
token. Every later operation re-authorizes its complete target; possession of a
read response grants no execution authority.

The Agent Profile Binding ensure body has an additive optional
`sessionInventorySelection` for Resume. It carries only Organization, Owner,
Project, public Computer, provider, and native Session ids; its native id must
equal the Binding conversation id. Gateway forwards the strict shape unchanged,
and Core accepts the Binding write only while the matching canonical inventory
row remains current, fresh, authorized, resumable, on the submitted runtime
device, and not actively bound to another Agent Profile. Callers without this
field retain the existing Binding contract.

Reconciliation pages are bounded and ordered. Core stages one source's pages
under a reconciliation id and makes no user-readable change until the terminal
page succeeds. A complete terminal page replaces that source's current set.
Unsupported, error, and disconnected outcomes are explicit terminal facts,
not empty arrays with implied success.
For a folder shared across Projects, `partial` pages may carry only Sessions
with an exact accepted Project attribution and must carry
`project_attribution_ambiguous`. Core publishes those rows at the terminal
page while leaving the source in error coverage, so omitted native Sessions
cannot masquerade as an empty complete inventory. Old readers already accept
the existing `error` coverage state; old writers that do not know `partial`
fail closed rather than flattening this result to `sessions`.

The current-session Profile lookup is a separate narrow HTTP/RPC contract over
the same Binding identity. Its strict query contains one exact controller ref
and provider-native Session ID. Core derives the owner from authenticated
context, performs one owner-scoped reverse Binding read, and returns
`not_found`, `unavailable`, or the exact Agent Profile identity plus whether it
belongs to the active Organization. It never accepts caller-supplied owner
identity, grants mutation authority, or replaces the Session inventory.

## Contract Rule

### Space author read confirmation

The optional literal `authorHasRead: true` in authored text metadata and thread
send requests confirms only the current Human author's exact message. Web
composers supply it; CLI and automation omit it by default. Core resolves the
author's current Human ownership and suppresses only that recipient's Inbox
candidate in the message's durable publication transaction. This is not an
authorization claim or a conversation read-through position. Unconfirmed own
messages remain ordinary updates, including self mentions and self thread
replies. Inbox remains the only unread owner.

Contract impact: existing CLI, Service, Skills, setup, Wake, and diagnostic
contracts remain supported; no local component floor or stamp changes. Older
clients omit the optional confirmation and receive normal read-through
behavior. Older signal readers may discard the additive metadata. Deploy Core
and Gateway receivers before the new Web producer because an older strict
thread request parser rejects the new optional request field. Roll back Web
before those receivers. No database migration or historical unread backfill is
required.

Any payload that crosses a service, package, process, HTTP boundary, RPC
boundary, WebSocket boundary, CLI JSON boundary, or diagnostics boundary needs a
shared contract before integration.

`packages/schemas` owns the strict account last-selected Organization mutation
input, success response, and failure response. Every failure uses the standard
Gateway error envelope with one of the bounded `auth.invalid_origin`,
`auth.unauthenticated`, `invalid_payload`, `organization.membership_required`,
`upstream_error`, or `upstream_unreachable` codes. `auth.invalid_origin` covers
the route's trusted-cookie-origin guard. `upstream_error` covers Auth session
verification or preference-write failures; `upstream_unreachable` covers Auth
session resolution or Web failing to reach the Auth upstream.
Web preserves the stable code and renders the message instead of exposing an
unparsed upstream body. Auth owns the preference and exposes it as a server-owned
user field on the existing session response; Web does not define a parallel
local-storage or entry-fetch contract. The Auth session HTTP boundary projects
this field from the canonical PostgreSQL user row after Better Auth resolves the
session, so production secondary-storage or cookie snapshots cannot make the
entry preference stale. This projection stays inside the existing session
request and preserves Better Auth's underlying session failure semantics.

Local Agent bridge commands read that same server-owned field at top-level
command admission, resolve it through the current Auth Organization membership
list, and freeze the resulting target. `packages/schemas` owns the strict
`CenterAgentOrganizationScope` Agent View projection with only `selection` and
`target`; it must not expose a mutable or locally cached `active` Organization
as a second machine-readable truth.

The initial rollout applies additive migration `0109`, deploys Auth, and then
deploys Web. New Auth remains compatible with old Web; new Web must not ship
while the old Auth worker still lacks the preference endpoint. Rollback restores
Web before Auth and leaves the nullable preference column in place rather than
deleting durable account data as a shortcut.

Do not start cross-boundary behavior with loose TypeScript types, local parsing,
or caller-specific object shapes.

The contract should define:

- accepted input
- emitted output
- error shape
- reason codes
- boundary cases
- source-of-truth owner
- compatible read/write behavior across consumers

If the contract is shared, one package owns it. Clients and services may adapt
source-specific facts before calling the shared layer, but they must not rebuild
the same business rule locally.

### Center Agent Context Manifest

`packages/schemas` owns the versioned Center Agent Context Manifest HTTP and CLI
JSON contract. V1 exposes only a `messages` view: a token- and count-bounded
projection of user-visible text Signals from the authenticated member's
canonical Center Agent Direct Message. Every entry carries its author, visible
text, occurrence time, stable `openmeld://` source ref, canonical source-version
hash, materialized-content hash, and explicit redactions. Pagination uses an
opaque versioned cursor and reports why a response was truncated.

Core owns authorization, projection, budgeting, pagination, source refs,
manifest persistence, and audit. Gateway validates the shared request and
response. API clients and CLI consume the contract without reading Space
history directly or inventing summaries. A cursor, conversation id, Local Agent
session locator, manifest id, or source ref is never identity or authority; each
read rechecks the current member and exact requester-private conversation.

The manifest is not a Flue session, conversation continuation, fork, memory,
checkpoint, or model-injection receipt. V1 excludes system prompts, hidden
reasoning, provider-private runtime state, secrets, attachments, and content
outside the requester's visible Center Agent Direct Message.

### Center Agent Context Load Receipt

`packages/schemas` also owns Context Load Receipt v1. A Local Agent reports
either every materialized manifest entry or an explicit subset of exact
`sourceRefId + materializedContentHash` pairs. Core reauthorizes the current
member, scopes the manifest to that Human Profile and Organization, requires
the reporting client to match the requesting client, and computes counts and
estimated tokens from server-stored manifest materializations rather than
trusting caller totals.

One manifest has at most one immutable receipt. An exact retry is idempotent; a
different client or selection requires fresh context. The receipt contains no
local session locator and is not proof that the model attended to or relied on
every loaded message. Audit action set v16 exposes separate prepared-manifest
and reported-load projections without returning message bodies or private
session metadata.

### Center Agent Context Scope Plan

`packages/schemas` owns the optional `contextScopePlan` carried inside the
Remote Agent turn envelope. V1 is a strict bounded object containing the frozen
interaction environment, requester identity class, result audience, and one
handling value for member memory, Organization memory, Organization Documents,
Organization Skills, protected information, and authentication secrets.

Core is the only current producer. `packages/agent-runtime` owns the pure
derivation and equality rules shared by Core and Remote Agent. Remote Agent may
derive a plan for a legacy envelope that lacks the optional field, but when the
field is present it must match the authoritative sender and destination facts
exactly or admission fails. A plan is disclosure policy, not member authority,
tool authority, a conversation id, or a substitute for source authorization.

### Inbox contracts

`GET /v1/inbox/notification-observations` and Core `observeInboxNotifications`
use the strict shared Inbox observation query, response and cursor schemas.
Core derives the recipient/Organization from active membership, validates cursor
scope and current source access, and reads a bounded insertion-ordered page from
existing `inbox_items`. Initial requests return an empty baseline; continuation
pins a finite upper row position until that window is consumed. Occurrence time
is not an insertion position. Inbox uses soft clearing; this volatile cursor is
not a durable cross-database-rebuild checkpoint. Browser reload starts a new
baseline while its existing pending delivery ids remain recoverable.

This endpoint is a read projection, not an unread writer or cross-device delivery
lock. It returns current source facts and targets; no existing list/get/summary
response changes. Web retains eligible ids in its existing scoped pending ledger
before advancing. Browser delivery receipts require `show`, and aborting the
current feed closes unacknowledged attempts. Storage availability is client-local
capability, never a replacement for account preferences or Core read state.

Contract impact: deploy **Core, then Gateway, then Web and the matching Desktop
renderer**. New callers require the new receiver; do not expose them first or
fall back to the lossy first-page reader. Roll back callers before the endpoint.
Old Web/Desktop continue using unchanged APIs. No database migration, new Inbox
table, CLI/Service/Skills contract floor, Wake/setup/trace change, or native IPC
change is required; existing workstation execution can continue unchanged.

The additive `/v1/inbox/feed` and `/v1/inbox/feed/state` endpoints use the shared
`inbox-feed` HTTP/RPC contracts. Filters, counts, rank, group identity, request
category and status dot are server-owned facts; old list and summary callers
retain their existing semantics. A mutation takes a server-issued snapshot id,
optional group key, and read/Dismiss operation—not a caller-selected recipient,
arbitrary item array or timestamp cutoff. Core verifies current Organization
membership, binds the snapshot to that account and Organization, and rechecks
source permissions. SQLite migration 0176 adds expiring snapshot membership
referencing canonical items; deleting a snapshot never deletes Inbox items.

Feed queries add optional `peopleOnly` and `conversationType` filters.
The optional `includeSelectionUnreadCount=true` query requests the exact
category-and-filter-scoped `selectionUnreadCount` across all pages. Unversioned
callers retain their strict response shape and the existing global filtered
counts. Web uses this number in the bulk-read label and freezes it alongside
the snapshot id when opening confirmation; unknown counts disable the action.
Migration 0179 adds matching snapshot columns with unfiltered defaults, so old
queries and existing snapshots retain their behavior. Filtered pagination must
match those stored values; bulk read/Dismiss reuses the frozen membership and
current source access. No source-target, notification, CLI, Service, Wake or
permission contract changes. Apply the additive migration, then deploy Core,
Gateway and Web in that order. New filter callers must not precede the strict
receivers; rollback removes callers first and retains the additive columns.

Source-target version `8` adds optional, strict `sourceFacts` to canonical Inbox
items. The source records actual Agent relevance, personal-Agent mentions,
persistent first-contact identity and merged recipient reasons independently of
legacy urgency and request resolution. List, direct-item and mark-read RPCs
return it only with `includeSourceFacts: true`; Gateway strips it for version `7`
and older clients without dropping their existing reply/target fields. Deploy
the additive Core reader before the Gateway writer. Stored source facts require
retaining compatible readers during rollback; never discard/recreate items to
undo a projection. The additive PostgreSQL migration also narrowly repairs the retired
owner-awareness writer, and Space schema v43 persists publication/contact and
projection-selection receipts in the source transaction boundary.

Human thread reply awareness adds optional `replyToRecipient` to Space Inbox
targets without adding an Inbox kind or changing urgency. Space emits true only
for a different Human account replying to the recipient's retained thread root,
after existing recipient filtering. Browser notification policy reads this fact
instead of parsing the title or equating thread membership with addressing.

Source-target version `7` exposes this field. Gateway strips it for version
`6` and older clients while preserving each version's existing target fields.
List, direct-item, and mark-read RPCs also accept optional
`includeReplyToRecipient`: Core omits the field unless the Gateway explicitly
opts in. This protects an older strict Gateway even after Core persists new
rows. New Gateway opts in and owns the separate browser-version projection.
Unlike earlier ungated source-target additions, this field can roll out
**Core, Gateway, Web**, matching the message-preference API below. Deploy Core
before a Gateway that sends the new RPC option. No new migration or local
component contract bump is required for the reply marker. Retain compatible
Core readers on rollback while stored rows or projection intents contain it.

Message notification preferences use the new strict
`GET/PATCH /v1/inbox/message-notification-preferences` and matching Core RPCs.
GET optionally accepts a Space id and returns the account default, nullable
conversation override, and Core-resolved effective mode. PATCH writes either
the account default or one conversation override; null removes the override.
Core derives the user and Organization from verified active membership and
rechecks indexed conversation membership/current personal Agent ownership for
conversation reads and writes. Client-supplied recipient ids are rejected.
The existing urgent-email preference and Inbox payloads remain unchanged.

Contract impact: apply additive migration `0174_pretty_meggan` first, then
deploy the Core receiver, Gateway routes, and Web caller in that order. New Web
must not be exposed before both receivers; missing support is a visible error,
not a fabricated default. Roll back Web first, then Gateway/Core, retaining
the additive tables. Already-open old Web tabs keep the old message policy
until reloaded; they cannot honor newly saved overrides. Desktop now uses the
same shared API-client policy and re-reads message preferences in its native
process. Publish the matching Desktop/Web build after the Core and Gateway
receivers are available; existing Desktop installations need an app update to
honor the new preferences. Native IPC request shapes remain unchanged. Setup, CLI, Service,
Skills, Wake execution, Space publication, and diagnostics payloads do not
change and require no local-component contract bump. Message preferences only
filter browser delivery of authorized Inbox facts; they cannot alter source
recipients, unread state, action resolution, urgency, or email eligibility.

Organization invitation requests use `organizationJoinRequestInputSchema` for
Web and CLI and a separate trusted RPC envelope for Auth-proven account identity,
link sponsorship, and successful-delivery acknowledgement. Client payloads cannot
set reviewers, approval status, or membership. The Inbox request target carries
only a request ID; its owner checks current authority on every review.

The invitation-approval rollout adds Auth HTTP/Core RPC actions, a scoped link
field, an Inbox target, and an optional transactional-email purpose. It does not
change setup, Wake, Service status, trace, or self-rescue contracts. Existing local
components remain safe: request-mode links fail closed at direct acceptance with
`organization.join_link.approval_required`. Explicit administrator direct links
use the same Auth membership writer after verified recipient consent. CLI and
managed Skills updates are advisory (`available` at release); no runtime contract
epoch changes are needed. New clients require the new receivers. Use the existing
`space-invitation-receivers-first` coordinated release: additive Database
migrations, Core, Auth, then Web and CLI. Keep the receiver/client transition short;
old Web cannot operate the new Inbox request target. Rolling clients back must
not change a stored link's mode or remove the additive request data.

Direct invitation links add stored `mode` and `expiresAt`, exposed only to HTTP
management/preview callers requesting `responseVersion=3`. Legacy management
requests continue addressing request-mode links. Ensure-on-behalf RPC retains its
old strict response shape. Recipient-request fulfillment adds optional
`applicantUserId` and `joinedAt` plus the Auth-only `join_complete` RPC action.
Auth opts into Core response version 2; Web opts into HTTP response version 2.
Older request callers retain the email-invitation flow and legacy response shape.
An approval is not a membership claim: Auth fulfills membership and optional Space
access first, then Core records completion and resolves reviewer Inbox items.

Contract impact: this changes Auth HTTP, Auth/Core RPC, and additive shared PostgreSQL
data only. Existing CLI, Service, Skills, Gateway, and Remote Agent remain
compatible for setup, Wake, Space actions, status, and diagnostics; no local
component epoch or artifact change is required. The receiver-first release order
is Database, Core, Auth, then Web. Roll back Web before Auth, and Auth before Core;
retain the additive columns and the original modes of all issued links.

`packages/schemas` owns Inbox item, counts, list-filter, direct item read,
read/unread and Dismiss mutations, delivery preference, structured source
target, source-event write, and Auth urgent-email RPC contracts. Attention and
importance are separate enums and clients must not infer either from title,
preview, or source kind. Dismiss returns only the dismissed item id; it writes
the Inbox-owned clear timestamp and cannot report or mutate source resolution.

Core is the only Inbox writer and authorization owner. Source modules adapt
their authoritative facts into the shared source-event write contract. The
idempotency fence is the exact recipient plus source event key inside one
Organization; producers and clients must not invent a second dedupe rule.
Recipient identity and account existence remain Auth-owned inputs. A source
adapter may reuse exact recipient identity already proven by its owning domain
or consume an explicit owner-approved projection; sharing one PostgreSQL database does
not authorize it to query Auth-private `users` or `members` tables.

Web, future Desktop, and future Mobile clients consume the same list, direct
item, count, preference, and mutation contracts. The source target is a
discriminated, structured locator rather than an arbitrary or Web-only URL.

Inbox summary version `1` adds `unreadUrgentUpdateCount`, disjoint from
`unresolvedActionCount`. Core derives both from the same recipient/access-filtered
query; clients never count a list page to reconstruct them. The additive field
is optional only for receiver-first interoperability: absent means unknown.
Current API clients send `x-openmeld-inbox-summary-version: 3`; Gateway keeps
the urgent summary field for versions `1` through `3` and removes it for older strict clients,
including already-open Web tabs. Version `2` also exposes `chatUnreadCount`,
`chatUnresolvedActionCount`, `chatUnreadUrgentUpdateCount`, and grouped `attention`
on Space summaries. These are recipient/access-filtered Core aggregates across
all current DMs; the three totals do not inherit the unread grouped-row limit.
Missing fields mean unknown, not zero. Gateway strips the four additions for
older summary clients. Version `3` adds the opt-in `presentation=attention`
list, summary, and mark-all projection plus `unreadMentionCount` and
`ordinaryUnreadCount`. Core filters only muted ordinary conversation updates at
read time; raw rows, read state, source truth, and delivery policy are unchanged.
The `mentions` list view prevents older unread structured Human mentions from
being displaced by recent ordinary updates. Gateway retains Space-summary
version `2` conversation counts for old clients while version `3` adds only the
Inbox attention fields. Only `presentation=attention` removes mentions from
`recent_updates`; unversioned legacy/raw callers retain them because those
clients do not query the separate `mentions` view. The UI waits for known values without a Checking badge.
Deploy compatible Gateway first, Core second, and Web last. New Gateway accepts
old Core output; new Web reports unknown if the field is absent. The new
`urgent_updates` and `recent_updates` preview list views are available only after Core and Gateway support them;
unsupported queries fail visibly, with no empty-list fallback. Rollback Web
and Desktop before Core, then Gateway; retain the compatible Gateway while Core
emits the fields. Receiver-first order is schemas/API and Gateway, then Core,
then Web and the matching Desktop bundle. No database migration or local
component epoch is required. CLI, Service, Skills, setup, Wake and Space action
contracts are unchanged.

Each client maps only supported targets to its canonical navigation surface.
Space unread readers opt into additive source identities with
`includeSourceKeys=true`; strict legacy responses omit them. `sourceKey` names
the actual publication or reaction occurrence, while `signalId` remains the
navigation anchor. Visible-source reads use `read_sources` with exact Signal IDs
and occurrence times. Space checks its retained publication intent and current
recipient eligibility; Core creates and reads the same canonical Inbox row
atomically. This RPC does not resolve source requests or accept client-supplied
Inbox content. Task review attention uses the existing system-attention source
kind and Space target; Task's durable delivery outbox remains its writer.

Deploy Core and Gateway before Web starts using the new read operation and
source-key query. Old Web, CLI, Service and Skills retain their existing request
shapes. Roll Web back first if these receivers must be rolled back. This slice
adds no persisted schema, target discriminator, RuntimeCoordinator state, Wake
authority, or local-component epoch. Feature verification uses deferred local
release readiness; a later integrated component release owns stamping.

Unknown target kinds fail closed and remain visible without creating an
arbitrary URL. A Slack `message_channel` target is the bounded exception for an
external canonical source: it carries exact provider ids and a permalink that
the shared schema restricts to HTTPS `slack.com` hosts. Core resolves that link
through Slack `chat.getPermalink`; clients never construct or accept a
recipient-authored external URL.
An Agent Interaction target carries the stable source Space signal when known
and an exact nullable Space thread ID for every new RuntimeCoordinator
projection, so resolved interaction history remains navigable and clients can
identify the exact visible source conversation. A string identifies one thread;
explicit null identifies the main timeline; an absent field means legacy
unknown context and must not be interpreted as main. Readers remain compatible
with older targets that do not yet contain either additive locator. Existing
resolved targets may be migrated to the already-supported Space target shape;
open interactions retain their interaction target.

The additive Agent Interaction thread locator rolls out receiver first: deploy
Web, then Gateway, before Core begins emitting it. Source-target version `4`
identifies a thread-aware client. Gateway removes the additive thread locator
for version `3` clients, while preserving the remaining Agent Interaction
target; missing or older version headers continue through the existing legacy
target projection. The historical-data migration rewrites only resolved items
to the existing Space target shape, so it remains readable by old and new
strict consumers during the Database-to-Core deployment window.

Additive strict Inbox source-target changes use the
`inbox-source-target-receiver-first` release profile. The persisted-row reader
inventory is: Core parses `source_target_json` into the shared Inbox item and
validates the RPC response; Gateway validates that response again; and the Web
API client validates it before rendering. Inbox access, count, Space-summary,
document-reconciliation, and urgent-email SQL either inspect only a known target
kind or do not select source-target JSON, so they do not introduce another
strict runtime reader. Remote Agent does not read Inbox rows. Core is both a
strict reader and the only writer of these targets.

Deploy Web and verify it, then deploy Gateway and verify it, and only then deploy
Core so it may emit a new source-target discriminator or field. The guarded
release planner recognizes both Message Channel and RuntimeCoordinator Agent
Interaction writers, adds all three scopes automatically, and rejects an
explicit scope that omits any one of them. New receivers continue to accept
every older target before the writer changes; after Core changes, every deployed
strict receiver accepts both old and new rows. An already-loaded Web tab is a
separate mixed-version reader: source-target version `5` receives the complete
current target, including the optional `directMessage` flag on Space targets.
Version `4` keeps thread locators but omits that flag; version `3` receives Agent Interaction targets without the
thread locator, and missing or older versions retain the legacy projection.
That legacy projection maps unsupported `message_channel` and Agent Profile
creation targets to `{ kind: "center_agent" }`. Gateway applies the projection
after validating Core's current response for list, direct-item, and read-mutation
operations. The projection never rewrites the durable row or weakens the
canonical schema.

The DM target flag is emitted only from the Space-owned current DM classification
(purpose, conversion state, and active member count), never from message wording.
Its rollout follows Web, Gateway, Core. Old CLI, Service, and Skills continue
through Gateway's version projection; setup, Wake, Space actions, runtime transport,
status, and diagnostics contracts are unchanged. No local-component release or
required-version floor change is needed. Retain compatible Core and Gateway
readers while durable rows contain the additive flag; do not roll them back to
strict readers that cannot parse those rows.

The Human Mention Inbox kind follows the same receiver-first rule without
reusing source-target versioning. The additive Database migration accepts both
the retired `space_reference` discriminator and current `space_mention`; it
does not rewrite existing rows during the live migration window. Current Core,
Gateway, and API-client readers normalize either discriminator to the canonical
Human Mention domain kind before product behavior. Current Inbox clients send
`x-openmeld-inbox-item-kind-version: 1`; Gateway returns `space_mention` only to
that version and projects it to `space_reference` for an older or already-loaded
strict Web client. The projection changes only the wire discriminator and never
changes notification behavior, title, source target, or durable data.

The guarded rollout applies the additive Database migration, deploys Web, then
Gateway, and only then deploys the Core writer that may create
`space_mention`. This keeps old Core readable before the writer switch, lets new
Gateway accept either old or new Core output, and keeps an older Web tab from
losing its entire Inbox. Rollback removes the new writer before removing these
compatible readers. A later cleanup may remove `space_reference` only after no
supported reader, writer, or persisted row needs the compatibility window.
Core keeps the durable Slack terminal-delivery ledger as the repair owner when
permalink resolution or Inbox projection fails. The same bounded repair detects
legacy Slack rows whose source identity still points to the former
`{ kind: "center_agent" }` target and replaces only `source_target_json`; item
identity, read time, action resolution, dismissal, and occurrence remain
unchanged. Migration `0128_massive_blur` adds the nullable last-attempt
field and index used to rotate a failed provider lookup behind never-attempted
repairs rather than starving the bounded batch.

`message_channel` rows remain in PostgreSQL after the producer stops. A normal rollback
therefore stops emission with a forward Core change that retains the new reader,
then keeps the new Core, Gateway, and Web readers deployed. It must not restore
an old Core, Gateway, or Web reader while any new row can remain. A complete
reader rollback is allowed only after an explicit, verified compatibility
migration or retention process proves that no persisted row uses the new
discriminator. Manual PostgreSQL rewrites or deletion are not a normal rollback path.

The additive Dismiss method rolls out receiver first: deploy Core, then Gateway,
then Web. Old clients do not call the new method and remain compatible. During
rollback, remove the Web caller and Gateway route before removing Core's RPC
method. No database migration is required because the canonical clear timestamp
already exists.

Space unread uses three additive Inbox contracts. The grouped summary returns at
most 500 accessible Space ids for the current member, with unread message
counts and latest unread Signal occurrence watermarks. Account Space Index
remains the owner of names, visibility, and ordering facts. The exact-target
read returns at most 500 accessible unread projections for one Space, including
the source Signal id, occurrence watermark, and nullable thread-root Signal id;
it does not copy message content or create another unread owner. Read-through
accepts one exact Space id, a nonnegative source occurrence watermark, and an
optional thread-root Signal id. Core verifies current human Space membership,
advances either the main-conversation watermark or that exact thread watermark
monotonically, and marks only matching Space message projections at or before
it read. Agent interaction requests are not part of this message timeline, and
reading never resolves source work. Inbox insertion consults the matching
scope's watermark so delayed older projections do not reappear unread. Existing
Center Agent summary and read-through contracts remain available during
mixed-version rollout and use the main-conversation watermark ledger. The
canonical Center Agent target contains both `spaceId` and `signalId`; the legacy
target with neither remains readable during rollout, while a target with only
one is invalid.

The grouped summary also carries the optional `ordinarySpaceUnreadCount`
aggregate. Core derives it across every accessible unread message in an ordinary
Space before applying the 500-Space grouped-row limit, using the Account Space
Index projection to exclude current Direct Messages and legacy welcoming
Spaces while retaining converted Direct Messages as ordinary Spaces. The
Center Agent summary uses the same Space Index classification in the opposite
direction: it counts only current, unconverted Direct Messages, so one unread
item cannot activate both outer-rail destinations. The field does not duplicate
names, ordering, or Space metadata. Web uses only this complete aggregate for
the outer Spaces navigation dot and fails closed while an older Core omits it;
it never intersects two independently bounded lists to guess the total. Roll
out the optional strict-response field consumer first: Web, then Gateway, then
Core. Rollback removes the Core producer first, then Gateway and Web consumers.

The account active Wake summary is an additive read contract scoped by
`gatewayHost` and `selectedProfileId`. The shared schema owns both the public
query and Gateway-to-Core RPC input. Core returns `generatedAtMs` with the
summary, and the shared schema owns its 45-second maximum presentation age so
Web does not reinterpret retained cache data as current execution evidence.
During mixed-version rollout, an older Gateway may omit `gatewayHost`; the Core
receiver derives the same normalized host from its configured Gateway URL.
Current Gateway builds send the request host explicitly, and malformed or
missing receiver configuration fails closed instead of inventing a scope.

`packages/schemas/src/schemas/http/inbox.ts` also owns the private Center Agent
attention impact, request, response, and RPC contracts. Remote Agent supplies
one bounded title and prompt plus `response_needed`, `work_blocked`, or
`material_failure_risk`; it cannot supply recipient, Organization, source
Space, importance, notification channel, or resolution. Core resolves those
facts from the exact accepted native delivery and writes the source request and
Inbox projection atomically. `response_needed` maps to normal importance; the
other two map to urgent. One submission id is the idempotency fence. The new
Core receiver and shared work-activity key deploy before the Remote Agent caller;
rollback removes Remote Agent first. The member's next represented Space reply
resolves the source requests and their Inbox items without routing through
RuntimeCoordinator.

Phase 1 has no Inbox live-invalidation contract. Web uses bounded polling and
refetch-on-focus to re-read Core. A future realtime transport must introduce its
producer, transport, consumer, and shared refresh-signal contract together; a
schema without that end-to-end owner must not imply live delivery exists.

The Auth urgent-email RPC accepts a user id, stable delivery id, bounded
subject, text body, HTML body, and canonical OpenMeld link. Auth resolves the
current account email privately and returns a schema-validated sent or failed
result containing no address. Core never copies Auth's user table or logs email
content. The receiver must be deployed before Core begins calling the additive
method; during rollback, stop the Core caller before removing the Auth method.

## Space Message Mutation Contract

`POST /v1/spaces/:spaceId/messages/:signalId` and `SpaceApi.mutateMessage` share
`spaceMessageMutationBodySchema` / `spaceMessageMutationResponseSchema`.
The body discriminates `edit`, `recall`, and `restore_draft`. Edit and recall
require the caller's `expectedRevision` (zero for old messages). Core checks
writable Space access, active Human membership, and exact sender identity.
Clients cannot author `messageRevision`, `editedAt`, `recalledAt`, or
`changedMessageId` through normal message posting.

The Space owner changes the existing signal and version atomically. Recall
keeps only a safe tombstone in its public payload, and stores the last published
content in `space_recalled_message_drafts`, accessible only through the
sender-authorized recovery action. Message retention cleans up this private
snapshot. Legacy quote previews are updated in the same transaction.

Restored composer drafts persist `restoredFromSignalId` and include it in the
normal message metadata or thread reply body. Both publication paths validate
the recalled source's sender and consume recovery in the publication transaction:
mark the source with server-owned `repostedAt`, increment its revision, and delete
the private draft. The new persisted message also lets live/catch-up clients hide
the recovery action before the source's refreshed history arrives. Pending or
failed outgoing messages never consume recovery.

A durable system `signal.text` with purpose `space_message_changed` records only
the affected message ID, never a content revision. It advances incremental
readers and Agent observation guards without adding a conversation row, thread
reply count, Inbox notification, or sidebar message preview. Incremental Space
updates return the current affected message alongside this cursor event.
Visible history pages exclude cursor events. Web merges message versions
monotonically so stale history responses cannot resurrect recalled content.

Mutation broadcasts preserve original thread placement. Existing dispatch
records remain execution history; edits do not rewrite or restart executed
work. This contract covers native Space messages, not Slack/Lark message sync.

An edit may add `messageEnvelope` recipients and `addedFiles` resolved by the
Space file owner. Existing Wake targets are immutable. A message without a prior
Wake may gain its first explicit Wake: the Space validates current targets and
admission, creates the normal durable outbox snapshot, and updates the original
message in one synchronous transaction. The message ID, sent time, and thread
placement stay unchanged. Subsequent edits cannot rearm work, including after a
failed Wake. Revision checks fence concurrent edits; admission failure rolls
back both the edit and handoff. The outbox retains the content and file revisions
accepted at that edit even when the message changes later.

These optional request additions require the new Gateway/Core receivers before
the Web caller. Old edit requests and existing CLI/Service dispatch and result
contracts are unchanged; no local-component floor changes are required. Roll
back the Web caller before removing receiver support.

## Web Organization Request Context

An Organization-scoped Web request uses a two-stage contract: the browser
selects an Organization, then the server verifies it. The URL and API request
context are selectors, not authority.

`packages/schemas` owns the canonical requested-Organization selector as an
exactly-one union: `{ organizationId }` or `{ organizationSlug }`.
`packages/gateway-contract` owns only its untrusted ingress header encoding,
`x-openmeld-requested-organization-id` and
`x-openmeld-requested-organization-slug`. Web sends exactly one selector. An
Organization-scoped API client binds the Organization id resolved for its route
query or mutation. A generic Web API client must not infer that selector from
`window.location` at fetch time because route intent preloading and delayed
requests can run while another URL is visible. `packages/api-client` reserves
both headers so an individual call cannot override the owning request context.

Web exposes separate Organization-scoped and explicitly unscoped API
foundations. The Organization-scoped foundation requires the shared
exactly-one selector at construction time and validates it before fetch. The
unscoped foundation is reserved for account, device, public-link, or
resource-identity entry points that do not take their Organization from an
explicit `/o/{orgSlug}` route. Do not add an optional Organization parameter
back to one generic foundation: every caller must make the scope decision
explicit so a new Organization route cannot silently fall back to Session
state.

An explicit requested-Organization selector is authoritative over any
`activeOrganizationId` carried by an API method's request context. In
particular, a route slug must not be replaced by a Session-derived or actor
request-context Organization id. Core compares any request-body
`expectedOrganizationId` with the verified request Organization through the
shared expected-Organization guard. Domain-specific error codes remain stable,
while the mismatch meaning and user-facing reason are maintained once through
`ORGANIZATION_REQUEST_CONTEXT_MISMATCH_MESSAGE` in `packages/schemas`.

The Web proxy may forward those requested-selector headers, but it must strip
browser-supplied trusted request-context headers, including
`x-openmeld-active-organization-id`. Gateway parses the headers into the shared
selector and passes that one nested fact to Auth. The shared Auth RPC schemas
also own the request, claims, result, method, and Organization-context source
vocabulary; Gateway and Auth must not recreate those shapes locally.
Direct Profile resolution and the combined auth-plus-Profile hot path use the
same strict Profile input and result schemas; a successful result always carries
one valid `resolvedProfile`. Auth joins
the requested Organization to the signed-in user's current membership and
returns the canonical Organization id with
`organizationContextSource: "request"`. Gateway rejects the request unless that
source is confirmed, then builds the existing trusted downstream request
context. A selector that does not resolve to a current membership returns
`organization.membership_required`; it must never fall back to the Session
Organization.

Organization-owned Auth HTTP mutations use this same selector and the same
Auth membership resolver even when they do not pass through Gateway. The
explicit request selector wins over Better Auth Session
`activeOrganizationId`; Session fallback exists only for older callers that
send no selector and must not be reintroduced into an Organization-route Web
flow. Auth Agent Profile creation and managed-Profile ensure are current users
of this contract. Their Web callers require the Organization id before the
request, send it only through the standard gateway-contract header encoding,
and keep it unchanged through later Profile configuration.

`packages/schemas/src/schemas/http/profiles.ts` also owns the optional Agent
Profile creation `idempotencyKey`. A new interactive caller generates one
opaque key per identity intent and keeps it stable across retries. Auth scopes
the durable unique claim to the Profile owner, returns the existing committed
Profile for an exact replay, and rejects reuse for different creation fields.
The Web submit lock is not a write authority and cannot replace this Auth
constraint. The field remains optional only for mixed-version compatibility:
land the additive nullable Auth migration and unique index, deploy Auth, and
then deploy Web. Old Web continues to work against new Auth. New Web must not
precede Auth because old Auth rejects the new strict request field. Rollback
removes the Web sender first and leaves the nullable Auth column in place.

`packages/schemas/src/schemas/http/agent-profile-binding.ts` owns
`AgentProfileCreationPreferenceSelection`, the shared cross-client selection
for Default Project, model, reasoning effort, Agent Controller Permission Mode,
Agent Controller Collaboration Mode, and controller-specific permissions.
Web, CLI, Local Agent, and Center Agent creation reuse that selection rather
than defining surface-specific subsets. The Agent Profile Creation Request adds
only execution targeting; Core reuses the existing Binding and Default Project
owners. Legacy `authorizeForOrganization` remains a required-looking
compatibility boolean on serialized requests and responses during the rolling
retirement window. New clients send the fixed value `true`, and new Core
versions ignore it completely; there is no product preference or authorization
effect behind the field. This keeps old readers and writers schema-compatible
until the consumer-retirement release is fully deployed. The model-visible
Center Agent input carries a cloud Project ID and never a local path.

Auth also owns the shared `resolveOrganizationAccountIdentity` RPC projection
used by Slack and generic Message Channel ingress, identity-link previews, and
source-bound continuations. Its strict result keeps Organization identity,
optional account identity, current Organization membership, and the account's
active default Human Profile as separate facts. Human Profiles are account
scoped, so Auth selects the default Human Profile only with
`organization_id IS NULL`; a consumer must not join it to the current
Organization id or fall back to a non-default profile. Consumers select the
account by normalized email, canonical user id, or an account-scoped Human
Profile id. Core validates the shared result and fails closed when the method
or projection is unavailable;
it must not reconstruct the same decision from Auth private tables. Deploy the
additive Auth receiver before Core consumers and roll back Core consumers
before removing the Auth method.

When no explicit selector exists, Auth may return the Better Auth Session active
Organization with `organizationContextSource: "session"` for non-Organization
entry points and older callers. That Session value is a default preference, not
the current Organization authority for `/o/{orgSlug}`. Web route navigation
must not mutate it to open an Organization. This separation is what permits two
tabs in one signed-in browser to use different Organizations safely.

The selector originated at the Web ingress, and its Auth RPC representation is
a strict cloud contract. Organization-targeted CLI calls may reuse the same
Gateway headers after resolving a member-selected Organization, but they must
bind the selector once when the top-level command starts rather than infer it
during a delayed request. This does not change OpenMeld Service, daemon,
Prepare, Wake dispatch, Space action, or diagnostic contracts. Deploy Auth,
then Gateway. During the short mixed-version window, old Gateway
Organization-scoped calls receive an explicit `bad_request` from new Auth
because their retired flattened selector cannot be verified; Auth must not
silently fall back to the Session Organization. New Gateway then sends the
nested shared selector. Web does not change. Roll back Gateway before Auth.

## Machine Output Code Naming

Result, error, and progress codes in machine-readable output (CLI agent view,
diagnostics payloads) are dot-separated, and every segment uses `snake_case`:
`space.add_members.arguments.required`, `cli.command_retired`.

- Never mint a new code containing hyphens.
- Existing hyphenated codes (the `space.add-agents.selector_*` /
  `space.add-members.selector_*` family) are grandfathered: do not migrate
  them — renaming a shipped code breaks every machine consumer that matches
  on it, which is worse than the inconsistency.
- New code families (for example a future `invite.*`) must follow this rule
  from their first release.

## `packages/schemas`

The PostgreSQL foundation adds no product HTTP/RPC/WebSocket or Service wire
contract. Storage adaptation must preserve existing shared contracts; driver
row types and SQL schemas do not replace `packages/schemas`. The isolated
infrastructure probe returns HTTP status only and accepts no caller SQL/data.

`packages/schemas/src/schemas` is the single source of truth for shared payload
schemas.

Use it for cross-service, cross-package, HTTP, RPC, WebSocket, CLI JSON,
diagnostics, and shared external error contracts.

Shared types must derive from schemas, usually through `z.infer`. Do not create
a separate hand-written shared type that can drift from the runtime schema.

`openMeldDaemonAcceptedDispatchSnapshotSchema` is the additive internal Core
contract carried by RuntimeCoordinator head acceptance. It contains only the
accepted workstation execution-target identity and the fingerprint of the
Space-owned dispatch payload; it never duplicates prompt text, attachments,
reply placement, or thread context. Head reacceptance returns the original
snapshot, and a same-lifecycle request with a different payload fingerprint
fails closed. These fields are not added to the Service delivery controller
snapshot, so an older strict Service continues to receive the established
dispatch shape during a Core rollout.
Mixed Core versions fail closed at this boundary. A request without the field
cannot reaccept a head that already stores it, and a head without the field can
adopt it only while the same primary dispatch is provably still queued with no
execution or token authority. Both incompatible directions return the existing
strict `retry_later` response shape, without the additive field, so an older
caller can parse and retry safely.

### Device-waiting Wake contract impact

`protocol/wake-device-wait` owns the selected Binding/Runtime, target Profile,
absolute deadline, and bounded Space access-check RPC. Normal message and thread
write schemas accept an optional top-level `deviceWait` field. Space persists
`signal.data.deviceWait` as the sole signal authority and copies the selected
target's intent into its outbox; RuntimeCoordinator freezes it in
the accepted dispatch snapshot. It is not forwarded as a new local Service
delivery field or execution token claim.

Client-authored `meta.deviceWait` is rejected, including when a top-level field
is also present. Normal and thread authoring populate the same canonical field.
Admission, outbox construction, and internal progress reads never fall back to
metadata. Only the public read encoder creates a read-only `meta.deviceWait`
mirror and removes the top-level field from serialized history, replies, message
edit/recall/restore responses, and live
frames so existing strict history clients remain readable. This wire projection
must not be reused for persistence, authoring, or dispatch. Retained outbox and
accepted snapshots from earlier feature builds keep their exact intent; a
metadata-only signal does not authorize a new wait.

Normal message callers use `postDeviceWaitingSignal`, an explicit Core RPC
receiver, so a mixed-version Core missing this method rejects the feature.
Plain `postSignal` rejects top-level waiting requests as well; both entrypoints
delegate internally without exposing an unguarded alternate RPC method.
Older strict HTTP/thread write receivers reject the new request field. New Web
offers the option only when the current member snapshot exposes a
`deviceWaitTarget`. Those opaque target selectors grant no access and disclose
no local path or controller conversation. Computer names keep their existing
owner-only disclosure policy.

Wake progress adds optional `deviceWait` reason/deadline data only for callers
that request `includeDeviceWait`. Existing phase enums and legacy readers remain
compatible. Old CLI, Service, and Skills continue setup, ordinary Wake, Space
actions, status, trace, and recovery unchanged; they cannot author the new Web
option. Existing Service permission and working-folder checks still run before
provider work. No local contract epoch or required local update is needed.

Trace response version 5 adds post-reconnect readiness, observed
`daemon.service.draining`, and `wake.device_wait.access_check_unavailable`
boundaries. Access checks use `space_access_unavailable`, not device readiness.
Versions 1–4 retain the truthful
`waiting` lifecycle and omit that unsupported boundary, rather than inventing an
offline route or exposing an enum an older reader cannot parse. Current Web
receives reason/deadline details through opted-in Wake progress; updated CLI
Trace can also explain those boundaries. The older root-cause projection may
therefore report the generic `runtime_coordinator.head_waiting`; this is a
deliberate compatibility tradeoff. Expiry uses `send_new_wake` in current
no-execution decisions and publication intent. Trace v3/v4 map this unsupported
action to `check_status` while preserving the expiry reason; earlier frozen
contracts omit no-execution details they cannot represent. These read projections
never schedule a retry. Public recovery classifies expired/revoked requests as
`request_ended`, not automatic system retry.

Trace response v6 adds optional `nativeDeliveryTrace` for an exact Space dispatch
that has only a native-delivery ledger record. It is mutually exclusive with a
workstation `trace`; identity, final visible messages, and correlation are
validated by the shared schema. Responses negotiated as v2–5 retain their
existing shape and never include the new field. Deploy Gateway and Core v6
receivers before publishing a CLI that requests v6; an older Gateway rejects
the unknown version header. No retry fallback, migration, execution contract
epoch, or required Service/Skills update is introduced. Existing setup, Wake,
Space actions, status, and recovery remain compatible. Rollback the new CLI
caller before removing v6 receivers.

Deploy Core receivers and owner storage logic before Gateway and Web enable
device-wait producers; this feature overrides the usual generic cloud order.
Rollback removes the producers first. Already accepted waits must continue to
be handled by a compatible Core. Older Core builds cannot parse canonical
device-wait signal data: retain the compatible reader while those records remain
in history, even after all waits settle. Rolling producers back is supported;
rolling Core back past that reader requires a separately validated data
compatibility plan. No database migration or new Cloudflare resource is
introduced. Local component packaging verification, if selected by the path
gate, uses deferred release mode and leaves the published manifest unchanged.

### Delivery Evidence Contracts

`packages/schemas/src/schemas/ci/final-candidate.ts` owns the strict versioned
Final Candidate evidence exchanged between the local runner, hosted runner,
merge-group runner, workflow artifact, PR comment renderer, and status
publisher. The contract
keeps candidate validation and evidence-publication failures separate, bounds
recorded command output, and makes head, base, and tree identity mandatory for
success. Each check result records whether it executed or reused an identical
deterministic task-input fingerprint; reused evidence also names the earlier
exact head, base, tree, completion time, and original duration. Candidate kind
explicitly distinguishes one pull request from GitHub's
synthetic merge group; a merge group cannot claim one PR identity. It also owns
the runtime projection of GitHub's pull-request candidate facts; the repository
fixture is captured from the GitHub REST API rather than shaped from runner
assumptions.

These delivery-control schemas are engineering contracts consumed directly
by repository tooling. They are not exported from the package-wide runtime
schema index and are not packaged into the CLI or OpenMeld Service. Changes
under `schemas/ci` or `schemas/release` therefore require their behavior and
workflow contract tests, but do not by themselves create a local-component
release. Product-facing and runtime schemas elsewhere in `packages/schemas`
remain release-sensitive.

### Prepare Connection Progress Observation Contract

Prepare connection progress uses a versioned, strict observation payload with
operation and attempt identity, producer sequence, timestamp, semantic phase,
state, and optional bounded detail or measured byte transfer. Terminal may send
the observation only for its authenticated Prepare Session and current
connection epoch. Core relays a latest-only value to Web without a PostgreSQL event,
Prepare mutation, or `sessionRevision` change. Receivers treat unsupported
progress as optional and retain the existing coarse snapshot experience.
The relayed payload retains the Terminal connection epoch. Core accepts only
the current epoch and increasing producer sequence, retires cached progress
when the Terminal is replaced or the session ends, and isolates each optional
Web observer write. An observer delivery failure cannot become a Terminal
write failure or reject an authoritative Prepare step. Web binds observations
to the epoch in its current snapshot; producer timestamps never arbitrate
between attempts.

### Prepare Diagnostics Lifecycle Journal Contract

`prepareStepDiagnosticsLifecycleEventTypeSchema` is the strict shared allowlist
for daemon lifecycle journal entries that the CLI may attach to a failed
Prepare step. The CLI writes this diagnostic bundle and Core validates it only
for bounded logging; rejection must not change Prepare completion, setup truth,
Wakeability, or execution state.

Adding an event type is therefore backward-compatible for product behavior but
not forward-compatible for diagnostic logging: an older Core rejects the whole
diagnostic bundle when a newer CLI includes an unknown type. The guarded local
release lane publishes the CLI/Service channel before aligning Core, so this
short window is an explicitly accepted loss of best-effort failure diagnostics,
not a consumer-first claim. The same resumable release must immediately deploy
the matching Core projection and verify final R2, npm, and Core alignment.
Rollback keeps the matching Core consumer while any published CLI can emit the
new type; removing that consumer first would recreate the diagnostic gap.

### Local Machine Recovery Contract

`packages/schemas/src/schemas/local-machine/recovery.ts` owns the strict,
versioned `LocalMachineIssue` contract and its CLI Agent View error event. The
contract carries one stable code, the failed local operation, the recovery
policy, a plain-language summary, one primary action, and bounded diagnostic
detail. It does not carry Service readiness, Wakeability, execution
state, or authority to mutate local state.

The CLI is the classifier and writer. Prepare, Desktop, and Web are consumers:
they may choose the appropriate control for the declared recovery policy, but
they must preserve the issue meaning and must not rebuild error-code matching
from platform-specific messages. The same module owns the exhaustive
`LOCAL_MACHINE_RECOVERY_POLICY_BY_CODE` mapping. A client that only receives a
reason code, such as Web through a Prepare blocker, reads that mapping instead
of treating every `local_machine.*` code as retryable.

The runtime schema rejects an issue whose declared recovery policy differs from
that mapping. The Agent View event also requires its top-level code and rendered
message to match the nested issue. Producers use the shared message formatter,
so code, policy, structured diagnostics, and user copy cannot describe
different recovery paths.

This is an additive command and diagnostic contract. An older Desktop ignores
the new Agent View event and retains its generic setup failure fallback. An
older Web client still renders the Prepare blocker message and its existing
reconnect action. A newer Desktop or Web client receiving output from an older
CLI retains its legacy fallback because no `local_machine.*` code is present.
No cloud service or Wake transport payload became stricter, so these clients
and the CLI can roll out in either order.

### macOS Keychain Helper Contract

`packages/schemas/src/schemas/local-machine/macos-keychain-helper.ts` owns the
strict private request and response contract between the packaged macOS CLI
and its short-lived Keychain helper process. Version 2 supports only `store`,
`read`, and `delete`, bounds every field, and rejects unknown fields. A `read`
request and the `store` and `delete` mutations must all declare
`authenticationInteraction: "disallow"`. The access token is carried through
stdin rather than argv. This contract never crosses the computer boundary and
carries no Space, Agent Profile, Wake, Service readiness, or
RuntimeCoordinator authority.

The parent CLI owns the five-second deadline and kills a helper that does not
return. The helper owns the one synchronous Security.framework call. Before a
Security.framework call, the helper disables Keychain user interaction for its
process and also applies modern and legacy noninteractive query policies. An
operation that needs approval therefore returns an explicit local storage
failure instead of opening a system authorization window that can outlive the
helper. The helper restores the previous process interaction setting after the
call. The timeout remains a final crash or platform-hang backstop; it is not the
way OpenMeld cancels authentication UI. Parent and helper are always the same
packaged binary version, so no mixed-version rollout exists at this private
boundary.

### Project Workflow Contracts

`packages/schemas/src/schemas/http/projects.ts` owns versioned Project
issue-routing, repository-association, and Common Agent configuration
contracts. Gateway exposes separate authenticated Project subroutes; Core
persists each setting on the existing Organization-scoped Project row and
reuses creator-or-Organization-owner management authority. Existing strict
Project list responses retain their original shape. Repository URLs are
canonicalized and fingerprinted by Core; the legacy Project repository fields
project the optional default for older consumers, while additional URLs
remain separate associations. Neither a repository association nor Common
Agent membership authorizes file, provider, Space, or Agent execution access.

For an OpenMeld-controlled new issue action, the action owner sends its exact
proposed provider target to Core. GitHub issue and batch claims may also carry
`issueDestinationAuthority: explicit_request`. The Agent declares this only for
the verified interactive member's explicit authorization of that exact
repository and issue-creation effect, interpreted from the complete conversation.
Core rechecks the admitted active delivery, Organization, Agent, submission,
verified Human sender and represented member. Explicit requests also call the
existing execution-access owner before admission, retaining its live Binding
and source Space membership checks independently of Project routing. Retained
delivery/sender evidence alone never replaces those current checks.
Core admits that request without consulting optional Project metadata; current
connection policy and provider repository permission remain enforced by their
owners. An absent declaration,
Routine, Agent sender, or missing/mismatched requester evidence cannot use this
path. Inferred, incomplete, or conflicting destinations retain confirmation.
The declaration is included in both the operation input digest and the immutable
batch manifest digest, and is never forwarded to GitHub. A changed declaration
cannot resume a batch's remaining writes. Existing Plugin requests keep their
decision authority on retry, including after a Project default changes. Fresh
direct/default claims reuse the Plugin request owner's SQL execution guard to
recheck request absence in the operation/audit transaction; an approval request
that appears after preparation prevents unconfirmed admission.

Otherwise, Core verifies the active delivery and current
Task associations, returning either `project_default` or `confirmation_required`.
Message text and object references are never parsed into write authority.
The operation claim carries a complete structured `issueDestination`; Core
recomputes its routing decision rather than accepting a caller-authored default
revision. New GitHub, Linear and batch creation claims without this target and
the correct write effect fail closed. A default-based claim uses the verified
Project revision and exact destination. The PostgreSQL transaction
locks and checks the active Project row before inserting the operation and its
attempted audit receipt. A stale claim writes neither an operation nor false
attempted evidence. GitHub batches claim one frozen batch
operation before writing their durable manifest. Other new issue claims reuse
`plugin_action_requests` and the private conversation/Inbox approval flow. The existing
request digest binds the actor, operation, connection, complete target and action
input identity. Only its Human recipient can approve; the claim's SQL guard
rechecks approval state, expiry, membership, connection generation and access
revision before writing operation/audit evidence. The internal request intent
records `purpose: issue_destination` and its exact Agent consumer; retained
intents without `consumer` preserve their existing Local Agent meaning. This
adds no second consent table or automatic provider retry. A replay reads its
already accepted operation and retains its
frozen provider, account, target, and idempotency key rather than re-resolving
from a later Project edit. The Project rule never substitutes for current
connection and actor authorization. Local Plugin calls use their verified
dispatch source Task or the same exact-action Inbox confirmation; direct third-party tools outside
OpenMeld are not covered by this boundary.

The optional authority field changes the hosted Remote Agent-to-Core request
only. Deploy Core before Remote Agent for the direct-admission behavior. Old
callers omit it and retain Project/default confirmation behavior; old Core
ignores the new field in its explicit input projection and still requires its
existing confirmation. No response enum, stored intent, database migration,
CLI/Service/Skills contract floor, setup, Wake, Space action, or diagnostic
payload changes. Local Plugin calls retain their existing dispatch/confirmation
path. Shared-schema packaging impact must be checked by release readiness;
this change does not publish a local component. Rollback preserves the existing
operation and approval owners and exact-input replay identity. Legacy batches
without a declaration keep their original digest. An older Remote Agent cannot
resume a batch created with explicit destination authority: its immutable
manifest comparison fails closed before remaining writes. Restore the compatible
caller to resume that operation; never replace its ID to bypass the mismatch.

Apply PostgreSQL migration `0027_project_workflow` before the Core readers and
writers. Historical D1 migrations remain unchanged. The
Core issue-resolution and operation receivers must be available before Remote
Agent callers. Earlier draft callers that send `issueRoutingDecision` instead
of `issueDestination` are rejected before new issue writes; new callers reject
the earlier text-derived resolution bases. The existing Inbox view/command
shape remains unchanged. Linear target mapping requires the supported catalog's
`team_id` and `project_id` fields and rejects target-field drift before execution.
The local Service still resolves its
existing route observation, then uses a frozen per-Context Project repository
selection when one is present. An older Service is rejected at Context
admission for this selection. Local Project Control accepts an optional
repository fingerprint only after Core verifies it against the active Project
association. A same-Organization shared-folder use needs a separate, stale-safe
share confirmation token; the move token cannot authorize sharing. The new
Project subroutes remain additive to the legacy Project list contract.

Receiver-first Core deploys pin the published local-components manifest. When
that manifest declares `runtime-transport-epoch-2026-09-space-files-1gib`
(including Service 0.3.248), Core accepts that exact epoch and the new
`runtime-transport-epoch-2026-09-project-work-v1` epoch. Previously released
Antigravity permission modes remain writable. The earlier image-geometry
receiver transition retains its existing writer hold only when that epoch is
explicitly pinned. Unknown or invalid pinned manifests do not authorize an
additional epoch. Ordinary published-Service Wakes, setup and diagnostics
remain compatible during the transition; explicit Project-work admission
still requires Execution Context capability v4. The CLI, Service and Skills
publication follows the receivers. Once Core switches to the new manifest,
the normal current-epoch requirement applies. No new payload or database
contract is introduced by this rollout correction.

### Center Agent Project Tool Contracts

`packages/schemas/src/schemas/http/center-agent-projects.ts` owns the
represented-member Project tool RPC inputs and safe model-visible responses.
The contracts cover bounded list, create, update, Default Project selection,
prepare-remove, and confirmed remove. They reuse the canonical Project name,
slug, and Repository URL constraints but intentionally expose a smaller
Project projection with no creator identity, Organization authority,
repository fingerprint, Local Project Connection, computer identity, or path.

The verified speaker member, execution mode, and Core-originated request context
cross the Remote Agent/Core RPC boundary; callers do not supply Organization or
role authority. Every mutation carries a stable operation ID. Prepare-remove
returns an opaque, short-lived confirmation token rather than writable
authority fields. Routine create, update, and Default Project selection use the
same represented-member contract as interactive calls and carry no free-text
permission evidence. Routine Project removal is unsupported in both Remote
Agent and Core and returns `routine_destructive_action_unsupported` before any
Project mutation. Interactive removal may consume the bound token in the same
turn when the user already authorized the exact removal. Trusted
navigation uses the shared `projects` and `project` Navigation
Action targets; the model never constructs an OpenMeld origin, Organization
slug, route, or Project path.

### Changelog Read Contracts

`packages/schemas/src/schemas/http/changelog.ts` owns the versioned published
entry, generated index, bounded query, source metadata, shared read response,
and represented-member private RPC input. The source entry Markdown remains the
authoring authority; this schema validates its generated projection at runtime
and does not create another writer.

Remote Agent supplies only filters, the verified speaker, and the
Core-originated request context. It never supplies repository identity,
Organization authority, publication status, or evidence. Core admits the
current designated Center Agent and represented member, reads the canonical
GitHub projection, and returns at most the shared result limit with explicit
newest-first offset pagination. The additive rollout deploys the Core RPC
receiver before the Remote Agent caller. Old Remote Agents call nothing new; a
new Remote Agent against an old Core fails closed. Rollback removes Remote Agent
first. Reusing the existing `documentation.read` work activity avoids a new
stream enum and keeps Web, CLI, and OpenMeld Service contracts unchanged.

The public `GET /v1/changelog` Gateway route uses the same query and response
schemas and the same Core reader. `packages/api-client` owns its repeated-filter
URL encoding. Web calls it through a server function so repository credentials
never enter the browser; anonymous visitors do not need Organization or profile
identity. The route is read-only, keeps failures in the shared Gateway error
envelope, and never turns a public read into Changelog write or publication
authority.

### Opportunity Contracts

`packages/schemas/src/schemas/http/opportunities.ts` owns the strict shared
Opportunity projection plus the three represented-member Center Agent RPC
contracts: recommend, list, and respond. Inputs are bounded, reject unknown
fields, require the verified speaker and Core-originated request context, and
never accept Organization identity, recipient selection, role, execution
permission, destination Channel, or downstream capability input from the
model.

Core admits the current designated Center Agent and represented current member,
then scopes every read and write by both Organization and recipient. Recommend
requires a stable key, observation, benefit, next step, and bounded evidence.
Respond accepts only `accepted`, `deferred`, or `dismissed`. The response
explicitly states that acceptance does not execute work. Remote Agent keeps all
three tools out of Routine turns and permits at most one recommendation per
interactive turn through its model guidance.

This additive rollout is migration and receiver first: apply the PostgreSQL migration,
deploy the Core RPC receivers, then deploy Remote Agent callers. Old Remote
Agents call nothing new; a new Remote Agent against old Core fails closed.
Rollback removes Remote Agent callers before Core receivers or the table.
Gateway, Auth, Web HTTP APIs, CLI, OpenMeld Service, daemon, local components,
Changelog contracts, and RuntimeCoordinator contracts are unchanged.

### Organization Directory Contracts

Center Agent's `openmeld_read_organization_directory` projects the authorized
Core response into `centerAgentOrganizationDirectoryPageSchema`. Pages preserve
complete records, expose total member/Agent counts and an Organization-bound
`nextCursor`, and stop at a combined record or serialized-byte budget. Follow
pages until `nextCursor` is null before asserting absence or a unique identity
match. Each page rechecks current Core authorization; cursors grant no access.
Returned member IDs accumulate only within the exact submission for subsequent
member diagnostics, whose Core authorization still applies. This is output
pagination, not database pagination or a second identity/readiness store: the
existing full Core RPC and Web/CLI directory contracts remain unchanged.
Directory changes between calls are not an immutable snapshot; a removed cursor
record requires restarting the read.

Auth owns the private Organization Directory identity projections.
`resolveOrganizationDirectoryMembers` returns current membership, account
identity, and the account-scoped default Human Profile.
`resolveOrganizationDirectoryAgentProfiles` returns Auth-owned Agent Profile
identity only for profiles owned by the Organization. Core must not request or
merge additional cross-Organization Profile ids from legacy authorization
state.

Core combines the Auth projections with Core-owned Center Agent designation and
readiness. When a caller explicitly
requests `includeMemberLastActiveAt=true`, Core also overlays its own optional
member `lastActiveAt` projection. This ISO timestamp is tied to the member's
current Human Profile and advances only from an accepted, persisted Human text
Signal in that Organization or an explicit authenticated Web activity write.
The Web write must prove the caller is the active member, uses a Human Profile,
and selected that member's current active Human Profile before Core writes the
same monotonic projection. A missing or stale-profile projection is omitted;
CLI use, Computer heartbeat, login/session refresh, inferred presence, and
Agent Activity are not fallbacks. Core must not reproduce the
member, user, Human Profile, or Agent Profile identity joins from Auth private
tables. A missing method, failed result, malformed payload, or mismatched
Organization id fails the Directory read closed with
`organization.directory_unavailable`; there is no direct-table fallback. The
public `OrganizationDirectoryResponse` adds only the optional member-level
`lastActiveAt` field. Gateway strips it unless the query opts in, so older Web
and CLI clients continue to receive the prior strict shape during rollout.

The broad `OrganizationDirectoryResponse` remains a compatibility contract.
Its opt-in `centerAgentOnly=true` scope preserves member authorization and the
response schema, omits members, and resolves runtime readiness only for the
designated Center Agent. Omitted or unknown query parameters retain the full
directory behavior. Web keeps the scoped result under a distinct cache key.
Current Web People and Agents use two narrower Core-owned read projections so
identity is never blocked by runtime fan-out. `OrganizationProfileDirectoryResponse`
contains Auth-owned member and Agent Profile identity, Center Agent designation,
the optional member-activity overlay, and member-visible primary Agent Controller
configuration. It does not read Runtime
Transport or RuntimeCoordinator. `OrganizationAgentRuntimeOverviewResponse`
contains readiness and Agent Profile Operational Context keyed by Profile id.
Core resolves its inputs in bounded owner batches: one route batch, one owner
Service read, and one local-runtime display inventory per owner, with bounded
per-Profile readiness work. Splitting transport does not split authority: Auth,
Core Wakeability, Binding, and RuntimeCoordinator remain the same owners, and
the browser never derives or writes either projection.

Profile Directory callers can opt into the optional `modelSelection` field with
`includeModelSelection=true`. Core reads `model_id` and `reasoning_level` in the
existing bounded primary-Binding query (49 exact Profile/owner pairs, at most
98 bound parameters; owner-kind literals are server-selected constants),
preserving exact Profile/owner selectors
and Organization membership checks. It returns only the same member-visible model
configuration already exposed by `publicProfileConfiguration`; no conversation,
device, credential, permission mode, or execution evidence is added. Configured
values never grant Wakeability or claim eligibility.

An omitted field means not requested or unavailable; null with a Controller means
the default model, and null without a Controller means no primary Binding. Failed
or malformed Binding reads preserve identity while omitting model configuration.
Core emits the field only on explicit opt-in, and Gateway also strips it for
legacy callers. New Web accepts older receivers that omit it as unknown without
starting a full runtime query. Core/Gateway support should be present before Web
uses the field for the complete experience. Mixed versions remain readable; there
is no CLI, Service, Skills, Wake, or Prepare payload change, migration, or local
component contract bump.

Within one overview request, Core shares in-flight Runtime Registry and
Controller-report reads for identical database and Runtime/Controller keys.
Missing results and failures are shared only for that request; the next request
reads fresh facts. Profile-specific Binding, organization eligibility, provider
evidence, route evidence, and final Wakeability still use their owning checks.
No cross-request readiness cache or client-derived verdict is introduced.

Overview readiness also reads the existing Auth Profile facts in bounded batches
and validates each batch's complete key set and identity mapping before use.
Unavailable or malformed batches remain unavailable evidence; they do not
trigger scalar retries. Explicit missing and disabled Profiles retain their
normal policy outcomes. Conflict targets outside that initial set still receive
a current Auth lookup.

Within that request, concurrent primary Binding, controller-conversation conflict,
and organization-context reads use bounded PostgreSQL batches grouped by physical
database. Each repository retains its exact SELECT, owner predicates, conflict
ordering, exclusion rules, and row validation. This batches database round trips,
not policy decisions or result caching: subsequent reads still execute against
the database. A failed or incomplete batch rejects its reads and follows the
existing unavailable-evidence path. Other readiness callers retain scalar reads;
the owner and per-Profile concurrency limits are unchanged. This uses existing
Auth RPC and PostgreSQL contracts and introduces no Web, Gateway, CLI, Service, or Skills
payload change. Core requires Auth's existing `resolveProfilesByIds` capability;
a receiver without it yields unavailable identity evidence, never guessed facts.

Organization Directory readiness is permission-scoped before serialization.
The Agent owner receives the normal owner projection. Another active member
receives the public four-state Wakeability status with private readiness facts
and actions replaced by neutral placeholders. The only additional blocker fact
on that projection is the exact structured `usage_exhausted` reason, rendered
as **Usage Limit reached** with no action. This explicit allowlist does not
expose provider or account identity, Computer or Space detail, route or Binding
evidence, controller or conversation identity, task content, raw errors, or an
owner recovery action. Every other reason code remains omitted.

`POST /v1/organizations/current/member-activity/web` is an additive
Gateway-to-Core contract. It accepts no client-selected user, member, Profile,
Organization, or timestamp; Gateway and Core derive those values from the
authenticated request context and Core returns only the validated
`organizationId`, `userId`, and `lastActiveAt`. Rollout deploys Core and Gateway
before the Web caller. Older Web clients and every CLI, OpenMeld Service, Skills,
RuntimeCoordinator, and Space contract remain unchanged because they do not
call this route.

`POST /v1/spaces/:spaceId/member-activity/web` uses the same authenticated Web
activity writer and response. The browser supplies only the destination Space;
Core derives the active Human identity and server timestamp, advances the
Organization projection, then records that same timestamp in the owning Space.
The Space verifies its Organization and active Human membership/owner before
writing `space_member_web_activity`. A failed Space write remains an error; the
already recorded app visit is still valid. Hidden tabs do not report activity.

Human Space `lastSeenAt` is the latest explicit Web visit or persisted Human
text Signal. Socket entries, background reconnects, system notices, and message
read cursors are not substitutes. Historical socket-derived `lastEnteredAt` is
not migrated into visit history; without trustworthy evidence, the time is
omitted. Human `liveNow` additionally requires a live connection and a foreground
report within six minutes (Web reports every five minutes). Agent availability
contracts are unchanged. Space SQL v30 adds the visit table without rewriting
members, messages, or cursors.

Deploy Core, then Gateway, then Web for this additive route. Existing callers,
responses, CLI, Service, and Skills remain compatible; old Web tabs do not gain
foreground reporting until refreshed. The shared schema is included in the
packaged Service, so release it through the normal compatible CLI/Service patch
lane before Gateway and Web. Runtime compatibility does not exempt packaged
shared files from the local-component version and bundle-hash release rules.

`organization-computers.ts` owns the strict team-safe Organization Computer
projection. Core authorizes the active Organization, resolves its current
members, and projects their registry-backed Computers independently of Agent
Profile creation. The contract permits only opaque Computer identity, owner,
display/platform/last-seen metadata, coarse per-computer Service state, and
bounded local-agent availability. Its optional local-agent `details` object is
a sanitized projection of canonical Agent Controller Interface evidence and
permits controller state, native interface, installed version and update
status, launch status and install count, model display names and optional exact
model IDs, native capability
flags, check status and timestamps, and sanitized provider Usage Limits. Each
Usage Limit contains only its stable key, label, 0–100 used percentage when
known, reset time when known, observation time, and status. Controller accounts, executable or
installation paths, launch arguments, update commands, diagnostic messages,
private skills, local policy, credentials, and raw lookup failures are not
members of this schema. Owner-scoped local runtimes remain authoritative for
the signed-in member's complete inventory and controls.

The Center Agent single-member Computer read reuses this exact response schema
and adds only the requested `memberUserId`. Its optional
`includeUsageLimits=true` request selects the same sanitized list that Web
selects. Core first verifies that exact user is a current member, then builds
the same filtered team-safe projection; it does not introduce another Computer
query, state store, or visibility policy. The RPC is additive and audited
behind Center Agent audit action set `v19`, so older strict audit readers
exclude the new action row.

The Organization Agent Runtime Overview also accepts `includeUsageLimits=true`.
Only opted-in responses include `readiness.usageLimits`, using the same sanitized
Usage Limit schema as Computers. Core resolves the exact Profile Binding's
Runtime and Controller before applying the owner/observer projection. Provider-scoped
controllers expose only the selected model's provider. Expired reports and usage
observations remain explicitly stale; missing evidence yields an empty list.
This field is equally visible to authorized Organization members. It does not
expose Binding, account, path, conversation, or Runtime identity to observers,
and it does not change Wakeability or execution admission. Web must consume this
projection rather than joining redacted readiness fields to Computer inventory.
Older callers omit the opt-in and retain their exact response shape; older
Gateway/Core omit the field for new Web, which displays unknown usage. Deploy
Core, Gateway, then Web for this additive projection. CLI, Service, Skills, setup,
Wake, Space actions, and diagnostics retain their existing contracts; a shared
schema bundle change still follows the local-component release policy.

The CLI `org computers` Agent View and strict `organization.computers` JSON
envelope use this same current-Organization HTTP response. They explicitly
request Usage Limits and preserve the team-safe projection; they do not call a
provider, scrape Web, expose Computer controls, or define a second schema.

Its optional `openMeldTools` object is also a sanitized live-session
projection. It permits component installed/latest versions, required Service
version, update status/policy, Wake-blocking state, bounded reason codes, and
managed skill target count. It may also include the computer-owned OpenMeld
Tools maintenance preference as `maintenance.automaticUpdatesEnabled` plus a
bounded `ready | needs_help` status. When an OpenMeld Tools update exists, the same
object may include the Service-owned safe operation projection: opaque id,
phase, request source, target version, urgency, and timestamps. The operation
shape remains unchanged. A fully-prefixed, allowlisted update failure code may
travel through the existing CLI component `reasonCodes`; Core carries only the
first recognized code when the associated operation is `restored` or
`needs_help`. It drops the code when the operation is absent or non-terminal,
and drops every other Service-provided diagnostic string. Web maps the surviving
code to fixed user-safe copy under the same terminal-phase gate. Raw stderr and
diagnostic error text remain local. Core does not create another update state.

`local-components.ts`, `daemon/runtime-transport.ts`, and
`http/local-runtimes.ts` also own the strict OpenMeld Tools control contract.
The request surface has only two operations: request the current computer's
update, or set its automatic-update preference. Web and Center Agent requests
carry a bounded source value; Runtime Transport binds the request to the
authenticated owner and exact current device/lane before the Service accepts
it. The result reuses the same maintenance and update-operation schemas shown
in Computer diagnostics, so clients never invent a parallel progress state.

`http/center-agent.ts` wraps those owner controls with the verified represented
member and active Organization. It also reuses the current-computer local-agent
installation list and selection contracts. Listing is read-only. Selection
requires the exact installation id and literal confirmation, and Core resolves
the represented member's own current Computer instead of accepting a device id
from the model. The model-safe result includes friendly installation names and
details, never executable paths or commands.
Setup commands, component hashes, runtime lanes, local paths, raw errors,
credentials, and actions are not members of the Organization schema.

Both `details` and `openMeldTools` are additive optional response fields. The
optional `usageLimits` member inside `details` is additionally protected by the
explicit `includeUsageLimits=true` query or Center Agent tool input. New Web
and Remote Agent readers plus the CLI `org computers` reader opt in; older
strict readers omit the flag, so new Core keeps returning their legacy shape.
New readers against older Gateway/Core
receive the existing response without usage evidence. The new Remote Agent
deploys after Core because old Core rejects the new strict tool input; Web,
Gateway, and Core otherwise roll independently through the opt-in. Core only
projects existing canonical registry evidence into the team-safe read model.

Owner Local Runtimes keeps old published CLI readers compatible through the
optional `includeUsageLimits=true` query. New Web and CLI readers request the
field; Core omits it for callers that do not opt in, so their older strict ACI
schema continues to parse the otherwise unchanged owner response. This is a
versioned projection choice on the same Core-owned read model, not a second
Usage Limit store or payload authority.

These Auth methods and schemas are additive private contracts. Deploy Auth
before Core, and roll back Core before Auth. New Core against old Auth exposes
an explicit unavailable Directory instead of guessing identity; old Core
continues to run against new Auth during the rollout. Gateway, Web, CLI, local
Service, Wake dispatch, and diagnostics payloads do not change.

`packages/schemas/src/schemas/http/organization-member-openmeld-service-status.ts`
owns the strict
`GET /v1/organizations/current/member-openmeld-service-statuses` response. It
returns the active Organization id, one generated-at timestamp, and exactly the
coarse `{ userId, state }` projection needed to join the result to Directory
members. The states are `connected`, `needs_attention`, `not_connected`, and
`unknown`. The contract intentionally excludes device identity, device names,
operating-system details, Service versions, timestamps per member, and failure
reasons.

The same module owns the strict Center Agent single-member request and response.
The request accepts only `{ memberUserId }`; the response returns the active
Organization id, one generated-at timestamp, and one coarse
`{ userId, state }` member projection. Core verifies that the target is a
current member of the active Organization before it reads Runtime Transport.
The Remote Agent tool never accepts or returns device-detail options.

This is a separate projection from `OrganizationDirectoryResponse`: failure to
read current Service liveness must not make Directory identity unavailable, and
adding a transient status must not churn the stable Directory contract. Core
reads Runtime Transport owner-service lookup as the liveness authority. Web may
join the result by `userId` and choose display copy, but it must not infer Agent
Profile readiness or replace `unknown` with `not_connected`. The endpoint is
additive, so old clients continue unchanged; a new Web build against an old
Gateway fails only this optional query and keeps member cards visible. Deploy
Core, then Gateway, then Web; roll back Web before Gateway or Core.

The single-member Center Agent RPC is an additive private Service Binding
method with one additive Agent work-activity key. Deploy Core, then Web, then
Remote Agent so neither the RPC caller nor the work-activity producer precedes
its consumer. An old Remote Agent never calls the method; a new Remote Agent
against an old Core fails closed as an unavailable tool. Audit readers remain
strictly compatible through action set `v12`: older action sets exclude the new
`read_member_openmeld_service_status` row. Rollback removes Remote Agent before
Web or Core.

`packages/schemas/src/schemas/http/organization-space-directory.ts` owns two
strict Organization Space Directory responses. The legacy
`/v1/organizations/current/spaces` response keeps its exact existing shape.
The versioned `/v1/organizations/current/spaces-with-member-counts` response
adds nullable `activeMemberCount` evidence. Core projects every public Space in
the active Organization plus private Spaces the current account has joined.
Both responses carry the Core-owned `joined` fact. Web may group, search, and
present those facts but must not infer visibility, membership, or member counts
from browser history or local cache state. A null member count means the
projection has no count evidence; clients must present it as unavailable rather
than as zero.

Web and CLI consume this contract through `packages/api-client`. CLI exposes
the member-count directory as `space list --organization`; it must preserve the
server-projected visibility and `joined` facts. Explicit `--json` emits the
strict versioned `space.list.organization` envelope, reusing the directory item
schema while adding only CLI-owned pagination summary fields. That version 1
JSON envelope retains the directory field name `visibility`; Human and Agent
Views label it `Organization visibility` so it cannot be confused with link
access. Self-service
membership uses the existing shared `POST /v1/spaces/:spaceId/join` client
method and remains a separate operation from opening a local interactive Space
session. When the user supplies `--password`, the API client carries the
normalized Space password header through Gateway and Core to the existing
Space-owned join authorization boundary; Gateway and Core must not infer or
mirror the Space access mode.

`packages/schemas/src/schemas/http/space-members.ts` owns the atomic
Organization Directory profiles-to-Space mutation body. Web and CLI submit the
exact, unique Directory Profile ids they displayed and, when selected, the
displayed Center Agent Profile id. Core verifies the active Organization membership, the
Space's Organization, every selected active Directory Profile, and the current
Center Agent designation. The Space Durable Object verifies the caller's active
Space membership immediately before the synchronous member write, so a caller
cannot add Directory profiles after losing membership between a separate read
and mutation. Human Profile ids must resolve to the default human Profile
exposed by the Directory; another active human Profile owned by the same member
is not a Directory candidate. Gateway must not resolve these ids through the
caller-owned Profile API, and clients must not split one mixed human/agent selection
into independent writes. The Web Space picker and CLI explicit selector consume a bounded candidate
projection and must not display or search member email, Organization role, or
other Directory administration fields.

The old Space Directory HTTP/RPC shape remains unchanged. The nullable count is
available only through the new Core method and versioned Gateway route, so
existing Center Agent and Remote Agent consumers remain compatible. The member-count
route can opt into `includeMemberPreviews=true`. Core reuses the bounded Space
Index member projection for already authorized directory candidates; the default
response omits previews for strict older receivers. Web resolves appearance through
the existing Profile Directory and reuses Space member avatars. Deploy Core
first, then Gateway, then Web; roll back Web before Gateway or Core. These cloud
additions do not change CLI, OpenMeld Service, daemon, Prepare, Wake dispatch,
Space action, or diagnostic semantics.

### Direct Message Conversion Contract

The Center Agent private-chat open and session-creation contracts resolve an
authorized conversation and initialize its metadata and membership when needed.
They do not publish introductory messages. Setup, Organization entry, Routine
destination preparation, and member research reuse that same message-free open
contract. Existing HTTP and RPC response shapes remain unchanged; old Web,
Gateway, CLI, and Service consumers can use the new Core behavior. No database
migration, local-component contract bump, or client deployment order is required.
Historical welcome signals remain readable through the ordinary Space history
contract. New-chat guidance belongs to the shared client introduction surface.

Personal Remote Agent `wake_progress` and `wake_stop` operations accept an
optional `spaceId` in `personalRemoteAgentSpaceToolRequestSchema`. Omission
preserves the admitted conversation; an explicit target is checked against
the admitted Organization and then authorized by the ordinary Space owner.
Responses, source identity, reply placement, and other conversation tools do
not change. Contract impact: deploy Core before Remote Agent so the receiver
accepts the new optional selector. An old Core rejects that selector explicitly;
it must not silently route the request to the original conversation. Roll back
the Remote Agent caller before Core. No CLI, Service, Gateway, Web, Prepare,
RuntimeCoordinator, database, or execution-contract change is required by this
selector.

`packages/schemas/src/schemas/http/space-direct-message.ts` owns both Direct
Message open and explicit conversion contracts. Conversion uses
`POST /v1/spaces/:spaceId/direct-message-conversion` with a valid Space name
and one bounded list of Organization Directory Profile ids. Gateway forwards
the shared shape; Core verifies current Organization and Space scope, resolves
every selected Profile, and calls one Space Durable Object method. No client or
Gateway layer may emulate conversion with a name mutation followed by ordinary
member additions.

The Space Durable Object is the conversion authority. It verifies a current
human member and current unconverted non-Center-Agent DM, then synchronously
records the immutable `directMessage.convertedAt`, `members_only` access, the
new Space name, and all selected members in one storage transaction. Generic
member addition rejects a third participant with
`direct_message.conversion_required`. Current DMs also reject member removal,
leave, delete, lifecycle, metadata, access-mode, and password mutations. Web
hides those rejected surfaces and presents the confirmation before it calls the
dedicated contract.

`SpaceStatus`, Account Space Index, and the Space Index projection carry the
optional conversion timestamp. Current DM classification must use that marker
with DM origin and the exact active-member count; a client must not reconstruct
conversion from route shape or a cached list. The field additions and endpoint
are additive. The PostgreSQL column lands before Core projects it; then deploy Core,
Gateway, and Web. Old Web ignores the field and never calls the new route; new
Web against an old cloud stack receives an explicit failed conversion rather
than a partial member write. Rollback removes Web and Gateway callers before
Core. CLI, OpenMeld Service, daemon, Prepare, RuntimeCoordinator, Wake dispatch,
Space actions, diagnostics, and local-component contract versions are
unchanged.

Account Space Index also supports the additive
`includeDirectMessageProfileIds=true` opt-in. For an unconverted two-party
Direct Message it returns the canonical two Profile ids already present in the
Space Index pair key; other rows return `null`. This is a bounded presentation
projection for resolving sidebar identity through the Organization Profile
Directory, not membership or access authority. Strict older clients omit the
flag and keep their prior response shape. Roll out schemas, Core, Gateway, and
Web receiver-first; rollback removes the Web flag before the Gateway and Core
field support. No PostgreSQL, CLI, Service, daemon, runtime, or local-component contract
change is required.

### Organization Logo Contracts

`packages/schemas/src/schemas/http/organization-logo.ts` owns the Organization
logo upload MIME and byte limits, normalized output dimensions, immutable asset
address, public path, Auth prepare/commit RPC envelopes, mutation failure codes,
and HTTP success response. `buildOrganizationLogoObjectKey` and
`buildOrganizationLogoPublicPath` are the only constructors for the R2 key and
public route; Gateway and clients must not duplicate those templates.

Auth owns the nullable `organizations.logo` current reference and is the only
writer. Gateway owns image validation, transformation, R2 writes, public reads,
and superseded-object cleanup. A mutation writes a versioned object first, then
Auth compare-and-sets the current reference; a failed commit attempts to delete
the new object and surfaces any rollback failure, while a successful commit
deletes the previous managed object. The old object must remain readable until
the new reference commits.

Provision the R2 buckets first, then deploy Auth, Gateway, and Web in that order.
This intentionally puts Gateway before Web instead of using the default
Auth-before-Web-then-Gateway cloud order because the new Gateway consumer calls
additive Auth RPC methods that older Auth workers do not expose. New Auth remains
compatible with the old Gateway, and the Web UI must not ship until Gateway can
accept the new HTTP routes.

The mutation contract is Organization-only and owner-only in its initial
release. Personal organizations use the account avatar and must be rejected by
both the client surface and Auth boundary. Generic Better Auth Organization
create/update calls may not write `logo`; the dedicated Gateway/Auth path is the
single writer. Organization metadata is also system-managed so callers cannot
remove personal classification before using the dedicated path. The Auth commit
compare-and-set rechecks the prepared slug and metadata atomically with role and
logo state. This is a cloud-only contract and does not affect CLI, OpenMeld
Service, daemon, Prepare, RuntimeCoordinator, or local-component versions.

### Account Avatar Contracts

`packages/schemas/src/schemas/http/account-avatar.ts` owns the Account avatar
upload limits, canonical 512 x 512 WebP output, immutable public address,
Auth prepare/commit RPC envelopes, mutation failures, and HTTP success
response. The safety limits and accepted MIME types come from the shared
identity-image constants also used by Organization logos.

The signed-in account's active default Human Profile is the avatar identity.
Auth owns the nullable `users.image` current reference and is the only writer;
Human Profile, session, Organization Directory, loaded Space member/bootstrap,
outer-rail, and Personal workspace avatar reads remain projections of that
value. A nullable Space member avatar is a complete projection: `null` means
the current image was removed and must not fall back to a historical message
snapshot. Gateway owns image validation, transformation, R2 writes, public
reads, rollback cleanup, and superseded managed-object cleanup. The immutable
public path includes the default Human Profile id, and Auth compare-and-set
rechecks that the same active default Human Profile still belongs to the actor
before committing.

An upload writes a versioned object before the Auth commit. A failed commit
must remove the uncommitted object or surface the cleanup failure. Removal
commits the null current reference before deleting a previous OpenMeld-managed
object. External OAuth image URLs may be replaced or cleared but are never
treated as OpenMeld-managed storage. Web must invalidate every account,
Profile, Organization-directory, and loaded Space member/bootstrap projection
after success instead of maintaining another avatar state.

Auth refreshes the signed session-data cookie after the compare-and-set write,
and Gateway forwards that cookie on the mutation response for session
compatibility. Session data is not an avatar read authority. Authenticated
`GET /v1/account/avatar` reads the canonical nullable reference and default
Human Profile id through the Auth repository. Web Account, outer-rail,
onboarding, and current-user message surfaces consume that read. Core Space
member/bootstrap snapshots batch-project `users.image` by Human Profile owner
id and must not prefer a live or historical Profile avatar over that canonical
value.

The original upload and removal path is an additive cloud-only contract and
deploys Auth before Gateway, then Web. A correction that adds the canonical
Gateway read and changes the existing Core Space member avatar projection
deploys Core, then Gateway, then Web; the new Web must not ship until Gateway
can serve the read. Existing CLI, OpenMeld Service, daemon, Prepare,
RuntimeCoordinator, Wake, Space action, and diagnostic contracts are unchanged.

### Legacy Space Attachment Contracts

This JPEG/PNG attachment contract remains a read and runtime compatibility
surface for messages authored before canonical chat files. New Web and CLI
Composer uploads must use the Space File contract below. No migration or
dual-write projects old attachment objects into Files.

Attachment downloads use the owning Space's current read authorization, including
anonymous public reading and Space-only Guests. Core derives the Organization
from the authorized Space, never the reader's selected Organization. Download
responses use `private, no-store`; upload and deletion retain their existing
authenticated membership requirements.

`packages/schemas` owns the shared Space attachment descriptor, upload query and
response schemas, Core RPC metadata payloads, MIME and size limits, and
attachment error codes. The initial contract accepts only JPEG and PNG images
up to 5,242,880 bytes. A message may reference at most four attachments, but
the upload record alone does not authorize a message reference.
`buildSpaceAttachmentObjectKey` is the single shared constructor for the
private R2 key; Gateway and authorized internal consumers must not duplicate
the key template. `detectSpaceAttachmentMimeType` is the single shared JPEG/PNG
magic-byte detector for Gateway and Remote Agent consumers. Organization logo
validation reuses it and keeps only its additional WebP signature locally.

`signal.text.data.attachments` and the normal-message HTTP body carry an
optional array of strict message attachment descriptors. Each descriptor embeds
only `id`, `mimeType`, `sizeBytes`, optional `width`, optional `height`, and
optional `fileName`; attachment addressing does not belong in
`messageEnvelope`. Before persisting a message, Core must resolve every
attachment ID through the Core-owned metadata table for the current
organization and Space. A missing or cross-Space reference rejects the whole
message as `attachment_reference_invalid`; Core persists the canonical metadata
subset rather than trusting client-declared MIME, size, dimensions, or file
name. The signal remains JSON in the existing Space payload ledger, so this
message contract does not add a Space DO table migration.

Timeline, history, live signal projections, and Wake dispatch source snapshots
preserve the structured attachment array. The snapshot carries metadata only,
never image bytes or credentials. Runtime Transport forwards that optional
array to a workstation route only when the route reports
`imageInputCapability: local_file_path`; it omits the array for legacy or
unsupported routes. The local service then uses the existing authenticated
attachment download route and provides validated local file paths to the Agent
Controller. Hosted Center Agent native delivery has a separate explicit
image-input contract. Legacy Message Channel attachment records remain bounded
compatibility inputs: Core copies their metadata references into
`remoteAgentWorkerTurnMessageSchema.attachments`, and Remote Agent derives their
private object address from the request's existing Organization and Space
identity. Current Space messages use canonical Space File references instead:
Core reauthorizes the exact immutable revision through the owning Space Durable
Object and sends its private object key to Remote Agent. Remote Agent reads the
exact source, creates a bounded transient WebP derivative, and sends only that
derivative to the auxiliary image-understanding route. Flue's persistent primary
conversation receives escaped text observations and immutable file metadata,
never source or derivative image bytes. Clients must not derive image rendering
from Markdown or relax the Markdown image policy.

The shared Space signal history query treats `aroundSignalId` as an inclusive
anchor. `beforeCount` and `afterCount` count only neighboring signals, so both
may be zero when a caller needs exactly the anchored signal and no surrounding
history. Gateway and Core must preserve that meaning instead of rejecting the
zero-neighbor window as empty.

Remote Agent browser screenshots reuse the same attachment contract in the
opposite direction. The worker asks Core to create organization- and
Space-scoped attachment metadata under the represented member context, writes
the image bytes to the existing private R2 object key, and persists only the
strict attachment descriptor in its submission callback context. The completed
worker callback may carry the optional bounded attachment array. Core resolves
every callback attachment against its own metadata before publishing the final
Space message. A failed R2 write or callback-context update compensates the
object and metadata record; it must not publish an untracked image or trust
worker-declared scope.

Space attachment uploads use a raw binary request body. `Content-Type` declares
the image MIME type, while optional `fileName`, `width`, and `height` metadata is
encoded as query parameters. File names are reduced to their final path segment
before storage. Width and height are positive integers no greater than 20,000;
they are client-declared layout hints and are not decoded or verified by the
Workers upload path.

Gateway must validate the shared byte and MIME limits and the image magic bytes
before asking Core to record metadata. Core owns membership authorization and
the durable metadata descriptor. Clients consume the shared upload response and
construct only authenticated Gateway download paths; the contract does not
define a public attachment URL.

### Space File Contracts

**Published execution-result reads.** `spacePublishedDispatchResultSchema` owns
the additive CLI result variant for a canonical published message. Existing
archived-result HTTP/RPC payloads remain unchanged. After a precise missing
archive response, the CLI reads existing cross-runtime final-publication facts
and then the exact authorized Space signal. The trace is a read projection,
not an execution writer or a substitute message body. The result retains the
canonical signal and visible reply/failure/stopped outcome. No duplicate archive,
state ledger, or publication path is introduced. A missing or mismatched message
fails visibly. CLI publication requires normal artifact rebuilding and stamping;
old Core/Gateway/Service contracts remain interoperable, without an epoch or
database migration. Old CLIs keep their archive-only behavior.

**Bounded text reads.** The shared Files MIME resolver recognizes `.diff` and
`.patch` as text. Generic `application/octet-stream` may use the known filename
mapping, including on existing immutable revisions. Explicit non-text MIME types
remain authoritative. Read eligibility is separate from browser edit eligibility;
CLI and hosted readers share strict UTF-8 decoding and reject binary NUL bytes,
while retaining ANSI logs and form-feed text. Reads retain the 1 MiB bound and original authorization and revision
checks. There is no stored metadata rewrite or new extension-classification owner.

**Contract Impact Audit — text attachments.** This changes the existing Core and
CLI read implementations and shared MIME policy, without changing request,
response, Service, Skills, or execution wire shapes. Old clients and services
remain interoperable; old readers may still reject historical generic MIME files.
Deploy Core and publish the updated CLI to enable their respective readers. No
compatibility epoch or database migration is needed. The packaged CLI must be
rebuilt and stamped by the normal release process. Rollback restores prior read
limitations without changing files or command state.

**Revision image geometry.** Revision descriptors and message file references
may include `imageDimensions: { width, height }`. Both positive integer axes must
be present, at most 32,768 each, with at most 128 Mi pixels of area. Absence is
valid for historical, unsupported, or unsafe metadata; zero, partial, or guessed
geometry is not valid. These are display-oriented dimensions, not an EXIF-blind
raw rectangle. Existing raw-byte writes, download routes, authentication, and
file/revision identities are unchanged.

All stored producers converge on the Space Durable Object's final revision
commit. After initial authorization and before the transactional commit, it
reads at most 128 KiB through at most 16 private R2 ranges of the exact immutable
original. It then rechecks access and the existing revision fence. JPEG, PNG,
and WebP EXIF orientation is normalized; GIF geometry is supported. Unsupported
container transforms, invalid metadata, and exhausted metadata budgets remain
unknown. Transport failure is not disguised as corrupt metadata. Original bytes
are neither decoded nor rewritten. Restore reads the copied original through
the same path; mutation replay preserves the already committed geometry. Browser
selection uses the same bounded reader only for local presentation, never as
server authority. Core rebuilds message references from their authorized stored
revision, ignoring untrusted supplied geometry.

**Contract Impact Audit — image geometry (#1200).** The producer is Core's Space
revision owner. Consumers include Web, API client response parsers, Gateway,
CLI and Service execution/result readers. Remote Agent does not consume display
geometry. Core projects it out of Remote Agent file-tool and Space-context RPC
responses, including nested revisions and message file references, while
preserving original bytes and canonical Space records. The private native-file
write RPC applies the same projection. Gateway-facing RPC methods return geometry
only for `spaceImageGeometryVersion === "1"`. Gateway declares that version to
Core and independently checks `x-openmeld-space-image-geometry-version: 1` on
HTTP callers. Missing or unknown versions receive the legacy shape. API clients
declare this header for file and message reads/mutations, including search.
WebSocket readers declare `spaceImageGeometry: true` in the existing hello
capabilities; the Space session persists that declaration across hibernation.
Origin capability negotiation remains independent. The shared geometry projection
preserves non-JSON RPC resources and never changes stored revisions or messages.
Client authoring requests omit display geometry even when the local preview has
it. Gateway also removes it before forwarding authoring requests to Core. Core
reconstructs file references from authorized canonical revisions, so this does
not trust client geometry or alter the visible result. A new client can safely
author against an older strict receiver without retrying a rejected request.

Native delivery already resolves Space files into explicit original-byte
attachments before freezing submit-turn requests. Those attachment descriptors
contain identity, MIME type, object key and byte size, not display geometry.
The frozen request, execution-recovery copy and replay retain that compatible
shape. No rejection-triggered fallback or Remote Agent capability is needed.
The optional field is backward-compatible for new readers of old data, but old
strict readers can reject new responses and signals. Therefore the CLI command
and Service compatibility identities are both advanced to
`2026-09-image-geometry-v1`, and the daemon execution epoch advances to
`runtime-transport-epoch-2026-09-image-geometry`. Skills content is unchanged.
These markers flow through the existing local-component compatibility and
execution-admission machinery; they do not assert that a release was published.

Rollout may deploy Core before Gateway and Web: old Gateway receives legacy RPC
output from new Core; old Web/CLI receives legacy HTTP or WebSocket output; new
readers accept missing optional geometry from old servers. This composes with
short-query Core/Gateway receivers before Web and private evidence Core receivers
before Remote Agent callers. The signed CLI release publishes compatible local
components before activating its Core execution-epoch projection. Existing local
component identities and admission fences remain authoritative.

Gateway/Web/CLI readers may roll back while the negotiated Core boundary stays
in place. Do not roll Core back below this compatibility bridge after geometry
has been persisted in messages: old internal readers are not certified for that
canonical shape. Recover with the bridge retained, or a forward fix. Never erase
canonical geometry, drop the nullable column, or rewrite stored messages for a
rollback. No PostgreSQL migration or new public image transport is introduced.

`packages/schemas` owns the Space File entry and revision descriptors, mutation
bodies and responses, raw upload query, list query, content limits, error-code
set, R2 key constructor, common extension-to-MIME inference, and Center Agent
tool inputs. `packages/api-client` owns the host-agnostic Web/CLI adapter over
those schemas. Web, CLI, Gateway, Core, and Remote Agent must not hand-build
alternate file shapes, paths, or MIME maps.

The shared file contract uses stable entry ids and immutable revision ids.
Content writes carry `baseRevision` (`null` only when creating a file) plus a
client mutation id. The canonical response returns the committed revision. A
stale base is `space_file.conflict`. A create write with `baseRevision: null`
atomically resolves an occupied case-insensitive sibling name to the first
available `name (n).ext` and returns that canonical name. Explicit folder
creation, rename, move, and restore keep `space_file.name_conflict` as a
separate outcome because those mutations express an exact organization request.
Invalid parents and missing entries remain separate explicit outcomes. Upload
and download bodies are raw bytes, not base64 JSON. Agent-facing text reads and
writes adapt through Core but preserve the same ids and revision fence.

`packages/schemas` also owns the private Core-to-Space File audit event. The
strict envelope carries only canonical scope and identity ids, operation,
request and operation correlation, result, and a bounded failure code. It never
carries a file name, content, byte count, object key, or raw error. Core and the
Space Durable Object use this one envelope for R2 outcomes and Space-owned
metadata mutations instead of constructing separate log shapes.
The audit event identity includes the request correlation and, when it differs,
the operation id. Multiple file writes in one request therefore remain
distinct, while an exact replay of one operation remains the same logical
audit event. New event ids use a versioned, length-delimited tuple so delimiter
characters inside either correlation id cannot alias another operation. During
rollout, an exact replay also reuses a matching legacy
`<operation>:<requestId>` event instead of appending a second audit row; a
different operation id that previously shared that legacy key remains a
distinct event.

The list contract names either the active tree or Trash. Trash reads and all
restore mutations require active Space membership. Entry restore clears Trash
on the same id and preserves every immutable revision. Revision restore copies
the selected immutable bytes into a new conflict-fenced current revision; it
never rewinds or deletes history. Retrying the same prepare/write mutation after
an uncertain response returns the already committed file before another R2
write, while reusing a mutation id for different inputs fails explicitly.

`signal.text.data.files`, normal-message bodies, thread-message bodies,
dispatch source snapshots, Center Agent Space posts, and Local Agent Space
Actions share one optional bounded array of canonical file references. Each
reference contains `fileId`, `revision`, and a send-time presentation snapshot
of `name`, `mimeType`, and `sizeBytes`. Before persistence, the Space Durable
Object resolves the requested file and exact revision from its own SQLite
repository and replaces all presentation fields with canonical values. Missing
files, trashed files, or missing revisions reject the whole message. Message
bytes are never copied, and renaming or revising the current file never rewrites
the historical signal.

For hosted Center Agent admission, Core reauthorizes each referenced JPEG or
PNG revision through the owning Space Durable Object and passes its immutable
object key through the private Remote Agent worker contract. Remote Agent reads
those exact bytes from the existing private Space object store, creates a
bounded transient WebP derivative, and feeds only that derivative through the
frozen auxiliary image-understanding route. The persistent primary conversation
receives one bounded escaped observation plus the immutable file reference; it
never receives or stores the original bytes, their base64 encoding, or the
transient derivative. This applies even when the primary model advertises image
input. Remote Agent does not copy the image into the legacy attachment
namespace, mint a second attachment record, create a Space File revision for a
derivative, or delete the canonical revision after admission. Text files remain
available through the Space File read tool; unsupported binary formats remain
visible by metadata and available to Human and Local Agent download.

The current image-input contract accepts up to ten canonical Space File images
in one message while preserving the legacy maximum of four attachment records.
Remote Agent opens the immutable R2 source as a replayable stream and prepares
one derivative at a time. Each transient WebP has a 4 MiB ceiling, prefers a
2560-pixel longest edge at quality 88, and never falls below 1600 pixels. One
auxiliary request contains at most five images, 8 MiB of derivative bytes, and
an estimated 20 megapixels of rendered image input; reaching any one budget
closes that batch. Four- and five-image batches reserve up to 8,192 output
tokens, while smaller batches reserve up to 4,096. Larger turns are split into
ordered batches whose prompt labels every global image index and filename. The
primary model receives all labeled batch observations in one admitted turn and
owns their final cross-batch synthesis; auxiliary batches never become durable
conversation turns. These are model-materialization limits, not Space File
storage limits, and they never replace or mutate the original revision.

A text signal may have empty text only when it carries at least one canonical
Space File. Web and CLI may therefore publish a file-only
message without synthetic text. CLI creates canonical Space Files before
message publication; a message-send failure may leave those ordinary uploaded
files visible in Files. A multi-file upload failure is narrower: CLI moves only
files confirmed as newly uploaded by that same not-yet-published invocation to
recoverable Trash and reports exact ids for any cleanup that fails. Cleanup
never infers ownership from a file name or removes pre-existing files.

Web file selection first creates a temporary
Composer Upload in private object storage. That upload has no Space File id,
folder entry, revision, audit event, Files invalidation, or message reference.
It is scoped to the authorized Space member, expires after 24 hours, and is
discarded explicitly on removal or successful send; Core periodically deletes
expired objects.

Send publishes each ready Composer Upload through an idempotent mutation. Core
reauthorizes the Space and actor, validates the frozen name, MIME type, byte
size, scope, and expiry, then creates the canonical root Space File through the
ordinary prepare, immutable-object-write, and commit contract. Web uses only
the returned canonical revision reference in the message. Send captures the
attachment batch while staging finishes. A failed stage or publication preserves
the entire message for retry with the same upload and mutation identities; text
and other files are not posted with a missing attachment. Web bounds publication
requests and releases the send queue after failure. A message-send failure after
publication may leave the
now-ordinary Space File visible in Files because Send was the explicit publish
boundary. This remains one canonical file with one message reference, not an
atomic file-and-message transaction or a second message-owned byte copy.

This additive contract rolls out receiver first: deploy Core's staging,
publication, discard, and expiry-cleanup receivers; then deploy Gateway's HTTP
routes; then deploy Web's Composer caller. Existing Web and CLI clients keep
using the canonical Space File upload contract throughout. New Web must not ship
until both cloud receivers are available; rollback removes the Web caller before
the Gateway and Core receivers.

`space.files.changed` is an additive invalidation topic. It carries no file
metadata and grants no access. Clients refresh the shared file-list contract.
Older clients safely ignore the topic and continue to observe current state on
their next read.

The file-content GET/HEAD surface supports single byte ranges for media.
`spaceFileStreamOptionsSchema` and `spaceFileStreamMetadataSchema` own the optional
fourth argument and metadata for Core's streaming RPC. Authorization precedes
range resolution and size disclosure. Satisfiable ranges read only the R2 slice
and return 206 with exact Content-Range and length; unsupported, multiple, or
unsatisfiable ranges return 416. HEAD opens only storage metadata. A strong
revision ETag owns If-Range; a mismatched or weak validator selects the full
representation. Private cache policy and storage scoping do not change.

Legacy RPC callers that do not opt in retain their old response shape. Deploy
Core's optional receiver before Gateway's caller, then Web/Desktop media UI;
roll back callers before receivers. Gateway fails closed if an old Core omits
stream metadata rather than mislabeling a full response as partial. MIME
inference adds MP4, M4V, MOV and WebM extensions, not a universal codec guarantee.

Space Files accept individual files up to 1 GiB. The single-request
compatibility path remains capped at 10 MiB; larger files use the shared
resumable multipart contract rather than buffering larger requests in Gateway:
Core-authorized upload
sessions, streamed R2 parts, exact size and part-integrity verification, atomic
Space File commit, abandoned-session cleanup, and the same idempotent canonical
response for Web, CLI, and Agents. Browser text editing remains limited to UTF-8
text files no larger than 1 MiB; that editor working-set boundary does not limit
upload or download. There is no public object URL, per-file ACL, Resources
projection, automatic Computer materialization, CRDT, or live character stream
in this contract.

The resumable contract uses one server-owned lifecycle for creates and new
revisions:

1. `start` carries the exact target, requested name and folder when creating,
   MIME type, expected byte size, up to 128 per-part SHA-256 digests, base revision, and client mutation id. The
   owning Space reauthorizes the actor, freezes that metadata, and returns an
   client's opaque upload-session id plus the R2-compatible part policy.
2. The owning Space creates or resumes the R2 multipart upload under a private
   session object key. The R2 upload id and object key remain server-only and
   never become client authorization.
3. Each numbered part is reauthorized through the upload session and streamed
   from the Gateway request body through Core to R2 without whole-file buffering.
   Core verifies its length and digest and stores the canonical part number and ETag.
   Web persists the original File and session identity with its Composer draft;
   completed parts are read from Core, not a second browser ledger. CLI reads
   bounded slices from disk. Both retry only missing or
   failed parts and can report byte-accurate progress.
4. `complete` carries the session identity. Core uses its persisted ordered part
   list to complete R2 and verifies the object size against the frozen session.
   The owning Space then atomically commits the immutable revision through the
   existing base-revision and mutation fence. A create collision receives the
   server-assigned numbered name in this final canonical response.
5. A stale base revision, changed frozen metadata, invalid part list, size
   mismatch, or reused mutation with different upload evidence fails explicitly.
   It never creates a visible partial revision. A temporary busy response is
   retryable when an earlier request still owns the session lease.
6. Explicit cancel aborts the multipart upload. Expired sessions are aborted by
   the owning Space alarm after 24 hours. Private session objects are retained
   until expiry for completion retries. A failed canonical metadata commit
   removes its uncommitted revision object; committed mutations remain idempotent.
7. Small files may retain one raw streaming PUT as an optimization, but they use
   the same prepare, authorization, immutable-object, commit, idempotency, and
   canonical-response semantics. The threshold is an implementation choice,
   not a user-facing file-size rule.

The product may enforce Organization storage policy and the backing store's
hard object limit, but it must not invent a lower context-driven per-file limit
or ask the user to compress an original. Media preview and model-input
compression operate on separate derivatives after the original revision is
stored. Shipping this protocol requires shared schemas, Core Space upload
session state and cleanup, Gateway multipart routes, API-client streaming
operations, Web draft resume, CLI stream upload, and captured R2 multipart
contract verification in one receiver-first rollout. Downloads stream through
Core and Gateway; CLI downloads stream to disk. The existing buffered internal
read RPC remains capped at 10 MiB and rejects larger reads explicitly.

The 1 GiB policy widens existing strict file descriptors. An older client can
still upload small files but can reject a response containing a file above its
previous 250 MiB ceiling. Release updated readers before enabling larger-file
producers: local components and Remote Agent readers, then Core and Gateway
receivers, then Web and CLI authoring. Already-open Web clients must refresh.
Deploy the Remote Agent video tool and Workers AI binding before Core begins
including the video-inspection hint in hosted submissions; its file RPC calls
use already-existing Core methods during that brief mixed-version interval.
Setup, Service lifecycle, Wake routing, and execution authority are unchanged.
Rollback disables new producers first and keeps readers capable of reading
existing large files. The CLI and Service contracts and runtime execution epoch
advance because old dispatch validators reject file references above 250 MiB.
Both local components are required updates before receiving new dispatches;
Skills are unchanged. Publish their compatible channel before deploying Core's
new epoch. This avoids accepting a Wake that the old Service cannot decode.
Existing in-flight work retains its normal coordinator finalization path.

The canonical Space File rollout is receiver-first across strict boundaries:

1. Release schemas and local components that accept dispatch source `files`.
   Old Core continues to omit the optional field; an old strict Local Service
   would reject a file-bearing dispatch, so Core must not produce it first.
2. Deploy Remote Agent with the Space File tools and file-aware Space post
   input. Against old Core those new tools fail explicitly and old turns remain
   unchanged.
3. Deploy Core's Space File RPC methods, Durable Object repository, canonical
   message-reference validation, dispatch preservation, and Center Agent
   receiver. Then deploy Gateway's raw upload/download and mutation routes.
4. Release Web and CLI authoring after the cloud endpoints exist. Older clients
   keep reading and writing file-free messages; already-open strict Web clients
   may require refresh before consuming a new file-bearing live signal.

Rollback removes Web/CLI producers first, then Core's dispatch producer, then
the Remote Agent and Local Service consumers. The contract adds optional
fields but changes strict mixed-version behavior, so unchanged version
constants are not evidence of compatibility. No PostgreSQL migration or new public R2
bucket is introduced: each Space Durable Object lazily owns its SQLite tables,
and immutable bytes use the existing private Space object-store binding.

Workstation dispatch tools expose a bounded `read_file` operation for text
attachments. Its input is the existing file ID and optional revision; its
response follows `readSpaceFileTextResponseSchema`, the public CLI text-read
shape. Space and acting Profile come from the active dispatch context, and the
existing public file API still owns access checks. This additive local tool
does not change cloud file routes, dispatch envelopes, or execution authority.
Old CLI/Service installations retain their existing file commands; new local
components interoperate with the existing Core and Gateway file receivers.

#### Historical attachment rollout

The original attachment rollout was an exception to the default cloud deploy
order: apply historical D1 migration 0020, deploy Core's new attachment RPC methods, deploy
Gateway's routes and R2 binding, and only then release a client that calls the
new endpoint. Existing clients remain compatible because no existing route or
payload changes.

The image-message rollout is a second cloud-only ordering exception. Deploy
Core's attachment-reference validation first, then Gateway's normal-message
forwarding, and then Web's attachment authoring UI. Old Web builds continue to
send attachment-free messages to the new cloud code because the field is
optional. New Web must not reach an old Gateway/Core pair because the old strict
normal-message schema cannot accept the attachment field. Keep the final Web
rollout window short because an already-open old browser tab may not understand
a newly authored attachment-bearing live signal; refreshing the tab loads the
new consumer schema. That initial rollout did not affect CLI, OpenMeld Service,
daemon, Prepare, RuntimeCoordinator, or local-component contract versions.

The retired CLI attachment authoring path was a later consumer of the same
deployed upload and normal-message contracts. It validated selected JPEG/PNG
files, uploaded every attachment before posting, and failed instead of silently
publishing an attachment-free message. Current CLI releases use
`space send --file <path>` and canonical Space File references; `--attach` is
not a second authoring path.

The multi-file reliability rollout deploys Core's per-operation Space File
audit identity before publishing the corrected CLI and managed Skill. Old CLI
releases remain compatible with the new Core behavior. A corrected CLI against
an old Core may still hit the old second-write audit collision, so cleanup is
recovery behavior rather than a substitute for that deploy order. No shared
schema or local runtime contract version changes.

The hosted-image rollout is a third cloud-only ordering exception. Deploy the
Remote Agent worker with its optional attachment consumer and read-only R2
binding before deploying Core's attachment-producing native-delivery path.
Old Core remains compatible with the new worker because attachment references
are optional and the Flue `images` field is omitted when empty. New Core must
not send attachment-bearing turns to an old worker because the old strict turn
message schema rejects the new field.

The browser-screenshot output rollout is consumer-first in the other direction:
deploy the shared callback schema and Core attachment-aware callback publisher
before deploying the Remote Agent callback producer and R2 writer. Old Remote
Agent workers omit callback attachments and remain compatible with new Core.
New Remote Agent workers must not send attachment-bearing callbacks to an old
strict Core receiver.

The workstation-image rollout is consumer-first. Deploy Core and Runtime
Transport support before publishing the CLI and Service that report
`imageInputCapability`. The previous strict capability schema rejects that new
nested field, so a new local service must not register against old cloud code.
After the cloud consumer is deployed, old local services remain compatible:
the field is optional, Core omits attachments for routes that do not report
`local_file_path`, and existing Wake work stays text-only instead of failing.
The optional attachment array does not require a runtime contract epoch bump,
but the Core-first mixed-version window and the later local-component publish
must remain explicit release steps.

The workstation tool-activity rollout is also Core first. New Core accepts the
optional `daemon.dispatch.tool_activity` frame while old local services continue
to use the existing register, heartbeat, Wake, result, Space action, status, and
diagnostic contracts unchanged. An older strict Core rejects the new frame with
an uncorrelated `schema.invalid` error; the new local service must log that error
without rejecting an unrelated register or heartbeat waiter, and must continue
the Wake and final result path without live activity. This graceful feature loss
does not require a runtime contract epoch bump. Deploy Web and Core before
publishing the CLI and Service producer, keep the mixed-version window short,
and stamp the local component `available` rather than blocking existing Wake
work.

### Center Agent Model Contracts

`packages/schemas` owns the strict Center Agent model preference, choice,
summary, frozen route, HTTP configuration, and worker-submission schemas.
`packages/agent-runtime` owns pure catalog resolution. Core remains the
configuration and admission owner.

The public configuration projection contains the Organization, current
preference, effective friendly model, available choices, management capability,
and Binding `configurationRevision`. Each choice may include the catalog-owned
`badgeLabel`; a missing field means there is no badge. The update request carries
the complete preference plus `expectedConfigurationRevision`; Core rechecks
current owner/admin permission and performs a compare-and-set Binding update.
Members receive the same readable projection with `canManage: false`.

`remoteAgentWorkerSubmitTurnRequestV2Schema` requires the full
`centerAgentModelRouteSchema`. Core writes that exact request into native
delivery before worker admission. Recovery reuses the stored request unchanged,
and exact-task continuation inherits it from the observer's active or recovery
request. The worker must not reconstruct a route from the current catalog.
Version 1 remains an accepted compatibility input for already-durable and
old-Core submissions; new Core always produces version 2. New-producer types
make `modelRoute` required so an omitted route cannot accidentally synthesize a
new version-1 request. An exact-task continuation may preserve a real stored
version-1 request, but if privacy retention has removed both the active and
recovery request it fails explicitly rather than reconstructing or defaulting
the model route.

The route embeds the primary and auxiliary image-understanding model metadata
and requires `automaticModelFallback: false`. Both hosted routes currently
require provider `openrouter`. Catalog and route resolution reject an
unavailable primary, a missing or non-image-capable auxiliary model, invalid
capacity values, or an unsupported reasoning level before provider admission.
Space dispatch terminalizes that model-resolution error without a lookup
retry. Slack posts one explicit settings-directed reply, while Lark/Feishu
settles the ingress with a model-unavailable rejection instead of retrying the
same invalid configuration.

Contract Impact Audit:

- Deploy Remote Agent first so it accepts both v1 and v2. Deploy the Gateway and
  Web badge receivers before Core adds `badgeLabel` to the strict configuration
  response. The new receivers accept old responses because the field is
  optional; old receivers reject the new field, so Core must not lead this
  additive projection rollout.
- Old Core remains compatible with the new worker through v1. New Core is not
  compatible with an old strict worker because v2 is a new request variant;
  therefore Core must not lead the rollout.
- The badge changes presentation metadata only. It does not change the selected
  model, frozen route, image routing, reasoning level, Binding preference, or
  configuration revision behavior.
- Badge rollback removes Core's additive field first, then the Web and Gateway
  receivers. Frozen-route v2 rollback removes its Web and Gateway callers first,
  then Core's v2 producer, and only then the worker's v2 consumer. Keep v1
  acceptance while any old durable delivery or recovery request can exist.
- CLI, OpenMeld Service, daemon, Prepare, RuntimeTransport, workstation Wake,
  Space action, diagnostics, and local component contract versions are
  unchanged. No PostgreSQL migration is required because the existing hosted Binding
  model field and configuration revision remain the single preference store.
  The shared-schema source mechanically changes the packaged Service bundle
  hash, so this feature branch defers the manifest update; the next clean release
  worktree may restamp it as advisory `available` without forcing an update.

### Space Live Invalidation Frames

`packages/schemas/src/schemas/protocol/envelope.ts` owns Space live WebSocket
frames that cross Core/Space and browser clients. Live invalidation frames such
as `space.members.changed`, `space.meta.changed`,
`agent.readiness.invalidated`, and `wake.progress.changed` are transport
signals, not durable state.

Rules:

- Core/Space may emit an invalidation frame after a membership, metadata,
  readiness, or RuntimeCoordinator Wake-progress owner changes facts.
- Clients may use the frame to trigger a targeted read-model refresh.
- The authoritative facts remain the Space members snapshot, Space status
  snapshot, Core Wake/readiness projections, and their shared schemas.
- Clients must not derive final membership, Wakeability, Agent Profile
  Binding, local service liveness, or execution outcome directly from an
  invalidation frame.
- The frame version must be monotonic for a Space across Durable Object
  hibernation, restart, and deploy. A restarted Space object must not emit a
  lower version than a still-open browser tab has already observed.
- A missed invalidation frame must be recoverable by the next snapshot read.
- `space.meta.changed` triggers a Space status and Space Index refresh. It does
  not carry metadata state and does not imply that membership changed.
- `wake.progress.changed` may carry only selectors such as Agent Profile IDs
  and client message IDs. It never carries a phase, outcome, interaction,
  eligibility decision, or user-facing status. Web uses it to refresh the
  Core-owned active Wake progress projection.

The Space-name request field and `space.meta.changed` topic are additive,
cloud-only contracts. Deploy Core first, then Gateway, then Web: an older Core
would ignore a name forwarded by a newer Gateway and could otherwise return a
misleading success. Older Web and CLI clients safely ignore the new
invalidation topic and continue to read the canonical name on their next
snapshot refresh. CLI, OpenMeld Service, daemon, Prepare, RuntimeCoordinator,
workstation Wake, Space actions, diagnostics, and local-component versions are
otherwise unchanged.

### Space Entry Brief, Board, And Reply Staleness Contracts

`packages/space-mesh` owns the shared Space Entry Brief renderer and compact
dispatch action guidance. The renderer composes already-owned Space, profile,
guide, and command facts; it must not create another membership, role,
readiness, execution, or publication-policy source.

`space-mesh/collaboration-context` owns runtime-independent task-material trust
guidance, Agent identity formatting, and source-scoped Wake participant wording.
Local consumes these exports alongside the existing Entry Brief and continuity
renderers. The participant list comes only from canonical activation targets,
not membership or reference targets; it does not assign ordering or work and
does not imply that a participant has produced a result. The acting profile is
described as activated only when its ID is present.

Adapters supply the instruction for reading source-scoped outcomes and the
existing Entry Brief `needMore` instruction for live Space Board access. These
are in-process renderer inputs, not a new transport protocol. Cross-service
source, Board, and result data continue to use their existing schemas. No local
private context, access rights, or execution state is exported by this module.
Remote adoption must supply its own authorized read tools and native delivery
contract; Local action-proposal/CLI rules must not replace Remote automatic
publication or Center native execution rules. This extraction does not integrate
Center execution or guarantee conflict-free multi-agent execution. Personal
Remote Agents now consume these renderers and expose authorized Board and
bounded public update tools through the personal Space-tool RPC. Version 4
submission optionally carries the existing canonical message envelope for Wake
participant context. Deploy Remote Agent before Core: older strict receivers
reject the new submission field. The admitted field's presence enables the new
read tools; requests admitted by older Core retain the existing tools, so the
new runtime does not call unsupported Core operations during rollout. No
workstation protocol, permission, or local-component version changes.

`packages/schemas/src/schemas/http/space-board.ts` owns the strict Space Board
HTTP/RPC response. Space/Core compose the response from the Space room
projection and the RuntimeCoordinator execution query projection. Gateway and
CLI consume that shared shape instead of rebuilding member counts, Center Agent
presence, running work, terminal outcomes, or profile labels locally.

`signal.text.data.meta.staleness.newMessagesDuringComposition` is optional,
server-authored reply context. Space derives its positive count when the final
reply is published from public text signals after the dispatch source, excluding
the replying profile, system messages, and transient messages. Core strips a
caller-authored staleness field before persistence. Consumers must treat absence
as no marker, not invent a count, execution verdict, or ordering rule.

`post_message.observedThroughSignalId` is an optional Agent reply observation
cursor. A current OpenMeld Service sets it to the newest relevant public Space
signal the Agent saw before choosing its final action. Older producers may omit
it during mixed-version rollout. Core preserves the cursor through the
publication plan; the Space Durable Object checks it against public text and
status collaboration signals in the same main-timeline or thread scope inside
the same synchronous transaction that inserts the reply. A missing cursor keeps
legacy behavior. A present but missing or stale cursor fails closed and the
proposed reply is not persisted. This cursor is publication safety evidence,
not execution authority, message ordering, or a replacement for the
server-authored staleness display marker.

The current local producer performs bounded pre-publication observations: each
read returns at most 20 relevant public signals after its cursor in the same
main timeline or thread. A non-empty delta may continue the exact controller
conversation to replace only its final Space action, then read again. There is
no fixed replacement-turn limit: every review advances from the latest cursor,
and each delta remains bounded independently. The Agent may choose
`stay_silent` only when its own current judgment finds that no distinct, useful
contribution remains; the harness must not force that outcome because a room
changed an arbitrary number of times. The replacement keeps the new cursor; a
read failure keeps the prior cursor so Space remains the fail-closed authority.
Consumers must not infer task ownership, Agent ordering, or delegation topology
from the cursor.

Roll this additive field out receiver-first. Deploy the shared schema and Core
publication receiver before publishing an OpenMeld Service that emits the field:
new Core accepts an older Service that omits it, while an older strict Core may
reject the new action shape. The local update is advisory `available`; older
Services keep ordinary Wake, setup, status, trace, diagnostics, and Space Action
behavior but do not receive concurrent-reply reconsideration or the atomic
observation guard until updated.

### Agent Context Envelope And Progressive Reads

`packages/schemas/src/agent-context-envelope.ts` owns the strict Zod schema and
versioned prompt vocabulary used to compose already-owned Agent context facts:

```text
Task
Environment
Rules
Action
```

The Agent Context Envelope is an ephemeral render model, not another sender,
Space, Organization, task, reply-placement, or execution source. Local Agent
Entry/Dispatch Brief facts and the Remote Agent turn envelope remain their
respective owners.

The shared `agent_context.v1` rule requires narrow-to-broad retrieval: provided
context, exact source or thread, bounded delta, then broader Space history only
when still necessary. The Center Agent Space-context RPC keeps its legacy broad
bootstrap response when no scope is supplied and adds exact `source`, `thread`,
`delta`, and `history` responses for new callers. Exact responses return only
bounded signals plus explicit `truncated` evidence. A new Remote Agent can
therefore use exact reads against a new Core while an old Remote Agent continues
to receive the unchanged legacy response. A `source` response also returns the
exact nullable thread reference resolved by Core, so a caller can move from one
signal to its thread without reading the Space directory into model context.
The stable Local and Remote Agent prompt guidance renders this retrieval order
as a model-facing rule. An Agent must not begin with broad Space history merely
to decide whether it was assigned work, and a clear reference/candidate
activation must terminate before any history read or tool call.

### Weekly Evaluation Report Contracts

`packages/schemas/src/schemas/eval-report.ts` owns the strict Space Durable
Object metrics request and response plus the stored Organization weekly metrics
shape. Core and Space must use those schemas instead of maintaining separate
rate, count, period, or schema-version shapes.

These schemas validate an observability read model. They do not make the weekly
snapshot an execution owner, make Space Index attribution canonical, authorize
the report publisher, or define the lifecycle and mutation policy of the
`OpenMeld Quality` Space. Those boundaries belong to the data and Space product
owners.

### Agent Stream Contracts

Hosted model recovery uses a typed `recovery` stream part from the native runtime,
with waiting/recovered/exhausted state, retry number, maximum retries, and next
retry timestamp. It shares the stream's sequence, dispatch identity, reply
placement, and terminal guard. The Space cursor persists this presentation
projection; it does not own retry admission or execution truth. Provider error
text is excluded. Bootstrap includes this optional presence field only when
the caller requests `includeAgentStreamRecovery=true`; older strict readers
receive the original presence shape. Older live readers ignore unfamiliar part
types without dropping the connection. Deploy Web and Gateway readers, then
Core, then the Remote Agent producer. CLI, Service, and local Skills require no
new contract floor for this hosted-only capability.

Shared schema surfaces define the hosted Center Agent and workstation Local
Agent Space-stream paths:

- `packages/schemas/src/schemas/runtime/remote-agent-worker.ts` owns the
  worker-to-Core sequenced text/public-progress snapshot and tool-part callbacks plus
  their shared response. Core accepts the legacy text-only callback while the
  current producer emits the typed callback. Public progress is transient and must not
  enter callback-context storage or the final completion callback. This schema
  also owns the durable execution query and targeted
  cancellation request/response unions for one native-delivery submission.
  Execution identity includes Organization, Space, submission, and idempotency
  key; a mismatch fails closed. Completed callback text uses the product-wide
  `MAX_TEXT_LENGTH` ceiling. The Remote Agent producer shortens a larger model
  result at that boundary, preserves a natural-language truncation notice
  inside the same ceiling, and never relies on a downstream provider to
  silently drop text. The deprecated submit deadline field remains optional
  for mixed-version parsing but current workers ignore it.
  The same module owns a distinct callback-event union for structured
  work-loop checkpoints. `continuation_required` carries only the exact callback
  identity and a versioned positive tool-call limit; it is not a completed or
  failed callback body and cannot carry assistant text. The turn envelope owns
  the matching continuation attempt, previous submission id, and reason. Core
  retains this consumer for existing checkpoint recovery. Current workers do
  not emit a new checkpoint on normal tool-budget boundaries: assignment-wide
  safety exhaustion produces the existing failed callback with shared reason
  `remote_agent.tool_call_budget_exceeded`. The private worker execution record
  owns a legacy checkpoint before callback projection; its public execution
  status remains `completed` for that internal submission, not for the entire
  native delivery. Failure and cancellation override checkpoint recovery.
  Older final callback bodies remain valid; no CLI/Service protocol version or
  PostgreSQL migration changes. Rollback must drain new private worker state as described
  in the Remote Agent runtime owner document.
- `packages/schemas/src/schemas/daemon/runtime-transport.ts` owns the Local
  OpenMeld Service-to-Core privacy-bounded tool-activity frame. The frame
  carries RuntimeCoordinator execution identity, current execution-token echo,
  daemon session and lease evidence, source message identity, sequence, and one
  safe tool part. A current producer attaches the shared semantic `work` object
  only after mapping the provider event to one admitted work key and, when
  useful, one explicitly safe bounded subject label. It never carries tool
  arguments, results, raw errors, command text, paths, or private Agent text.
- `packages/schemas/src/schemas/http/local-agent-reasoning.ts` owns the account
  reasoning-stream preference, live status, and negotiated Service header.
  `daemon.dispatch.reasoning` uses the existing tool-activity execution identity
  with a separate bounded thinking snapshot, never a durable tool part. The
  preference is default-on, owner-controlled, and account-wide. Optional live
  reasoning status is not execution truth; clients must not infer model support
  or a stuck execution from silence. Old Service/Gateway combinations do not
  negotiate the header and therefore continue without live reasoning.
- `packages/schemas/src/schemas/protocol/envelope.ts` owns the optional
  `stoppedReplyText` on a system notice envelope. Space attaches only its accepted
  public text snapshot for the same Space, dispatch, target Profile, and source
  message. The existing terminal guard can retain that bounded snapshot until
  notice publication; its existing expiry still applies. This is display data,
  never successful completion or execution authority. Older envelope readers
  ignore this additive field and still parse the unchanged strict notice data.
  New Web also accepts old notices without a partial reply. No Service, CLI,
  setup, dispatch, trace, or recovery contract floor changes are needed.
- `packages/schemas/src/schemas/protocol/agent-stream.ts` owns Space live text,
  thinking, public-progress, tool-part, and terminal frames plus the active stream presence,
  active text snapshot, and durable privacy-bounded Agent reply work
  projection. Text frames preserve the legacy wire shape. The active presence
  contains only stream identity, sequence, gap, and timing evidence; it carries
  no reply text or private thinking. Thinking and public-progress frames are active-stream-only
  refresh data: Space may advance the shared sequence cursor and expose its
  privacy-safe presence, but must not store either transient tail in SQL, bootstrap,
  conversation snapshots, Message details, or final Signals. The optional
  versioned `work`
  object is the only user-presentation meaning: it contains an admitted
  semantic key and, optionally, an explicitly safe subject kind and label.
  Technical tool names remain transport compatibility evidence and must not be
  used to derive product copy. The durable projection contains only ordered
  admitted work, lifecycle states, technical compatibility names, and
  truncation evidence. These contracts deliberately exclude call IDs,
  arguments, results, raw errors, commands, paths, and Agent text from durable
  display data.
- `packages/schemas/src/schemas/http/space-bootstrap.ts` owns the room-entry
  snapshot, including the optional active text projections delivered with
  recent history and the mixed-version opt-in active stream presence
  projection. Clients request presence with
  `includeAgentStreamPresence=true`; Core omits
  `activeAgentStreamPresences` when the caller does not opt in, so older strict
  clients keep their existing response shape.
- `packages/schemas/src/schemas/http/space-conversation-state.ts` owns the
  compatibility snapshot read model retained for older deployed clients.
- `packages/schemas/src/schemas/http/space-message-details.ts` owns the optional
  privacy-bounded working-details projection for a published reply. It exposes
  admitted semantic work, lifecycle states, technical compatibility names, and
  timestamps only, never call IDs, arguments, results, raw errors, commands,
  paths, or Agent text. Consumers display only the semantic work projection and
  hide legacy or wrapper records that do not contain it.
- `packages/schemas/src/agent-work-activity.ts` owns executable-aware command
  classification shared by Local Agent adapters and the Remote Agent. It
  classifies the executable and subcommand in each shell segment, not incidental
  words in arguments or output text. Mutating flags such as `sed -i` and
  `find -delete` classify as source updates, while unbounded execution flags
  remain invisible. Commands with comments, heredocs, command or process
  substitution, background or alternative branches, an unknown segment, or
  multiple different work meanings also remain invisible because the
  conservative classifier cannot describe the complete shell execution
  truthfully. Output redirection is checked before setup-only commands are
  skipped. Unknown package-manager commands, named project scripts, and direct
  script paths follow the same rule. Unknown commands never fall back to generic
  command copy.

These contracts carry a transient presentation projection, not execution or
message truth. Core must validate a hosted callback against the active
native-delivery record. For a workstation callback, Core must validate the
current RuntimeCoordinator execution token, execution identity, daemon session,
lease, target Agent Profile, Space, and source signal against authoritative
pending-dispatch state before Space accepts it. Space owns sequence,
deduplication, gap evidence, expiry, and terminal guards across text and tool
parts for both paths. Room entry recovers active stream presence and any active
text projection through the bootstrap snapshot. Reasoning is absent from durable
bootstrap, but a bounded live tail may replay from the active Space instance
after the existing audience and Local Agent owner-preference checks. Hosted
provider-emitted reasoning reuses the existing v2 thinking callback and does not
change execution, publication, or authorization ownership. The presence rollout is Core
receiver/producer first, then Gateway forwarding, then Web opt-in. An old
Gateway ignores the unknown browser query, and new Core omits the additive
response field for callers that did not opt in. A successful
final reply carries the complete optional durable projection in
`signal.text.data.meta.agentWorkSummary` and may separately expose its
timestamped bounded summary through Message details for 14 days. During a
successful hosted turn, the same final Signal may carry up to 8,192 characters
of explicit public updates in `meta.agentPublicProgress`. This additive field
contains neither provider reasoning nor tool input or output. Space stores its
draft only until a terminal outcome and omits it for failed or stopped turns.
During a
mixed-version rollout, Core may also emit `meta.agentActivity` containing only
steps accepted by the previously deployed strict schema. A cached older Web
client ignores the additive `agentWorkSummary` field and can therefore keep the
reply instead of rejecting the whole Signal. Current Web prefers
`agentWorkSummary` and reads `agentActivity` only as a compatibility fallback.
This projection is not the organization-wide Agent Activity product. Outer
orchestration tools such as Code Mode never enter the user projection; only
admitted inner work may enter it. Code Mode publishes an admitted inner work
part only after that inner tool has succeeded. Inner tool errors remain part of
the Agent's execution and final outcome, not Work summary rows, and a
best-effort Work summary publication failure must never change the inner tool
result. Subject labels are admitted only by explicit per-tool rules: repository
owner/name, website hostname, or a bounded human-authored product object name
or title. The shared schema enforces the allowed semantic-key and subject-kind
pair; a key without an explicit subject rule rejects every subject. The schema
also rejects control characters, requires repository labels to use the safe
`owner/name` form, and requires Web labels to be hostnames rather than paths or
URLs. URL rules parse the complete bounded URL before retaining only its
hostname, so a long path cannot remove a valid hostname. A current Connected
App producer builds its subject from the allowlisted App display name and, for
execution, a normalized safe catalog action id. The protocol temporarily
accepts the same work keys without a subject so a new Core can receive an older
Remote Agent payload, but Core and Web keep that compatibility form out of
every visible summary. Current Remote Agent requires the Core receiver that
accepts `connected_app` subjects. A rejected part stops that preview without
stripping its work metadata or resubmitting a degraded part. Missing, unsafe, or
compatibility-only values therefore never create generic Connected App copy.
The legacy final-reply field omits Connected App steps because its deployed
schema cannot represent their required concrete subject; the complete
`agentWorkSummary` and Message details retain them for current clients. The
live Web buffer applies the same presentability rule before its 50-step bound,
so compatibility-only parts cannot evict concrete live work.

For one `toolCallId`, Core locks the tool name on the first lifecycle frame,
allows semantic work to appear once when a producer could not provide it
earlier, and then keeps that work immutable. Lifecycle state can stay unchanged
or advance from input to exactly one terminal outcome; it cannot regress or
switch between success and failure. Tool calls without admitted semantic work
are retained in a separate bounded lifecycle index long enough to enforce those
stream invariants. They do not consume the 50-step visible summary budget,
cannot mark that summary as truncated, and are excluded from published Agent
Activity and Message details. When that internal index reaches its bound, Space
first evicts the oldest finalized record outside the visible window, then the
oldest non-visible record if every hidden call is still active. The latest 50
visible calls are never evicted by internal lifecycle pressure, so a long
execution continues following new user-meaningful work instead of freezing.

Older clients ignore the additive `agentWorkSummary` Signal metadata, and new
clients accept older replies that contain only `agentActivity` or neither
field. Older clients may continue using the compatibility conversation-state
read while that endpoint remains deployed.

A `final_message` terminal references the already-published durable Space
signal. Other terminal frames may close a temporary overlay, but they are not
durable history and cannot by themselves satisfy the visible-failure contract.
Clients must let the persisted Space reply or notice replace the temporary
stream, and must never derive native-delivery status, final outcome, readiness,
or reply placement from stream text.

### Conversation Compaction Contracts

`packages/schemas/src/schemas/protocol/conversation-compaction.ts` owns the
safe versioned conversation-compaction checkpoint. Version 1 contains only
`completedAtMs` and the positive bounded `count` of successful compactions
observed during one Remote Agent submission. It contains no prompt, summary,
message, transcript, model response, or token payload.

The optional checkpoint crosses two server-authored boundaries:

- the Remote Agent completed callback carries
  `conversationCompaction` after Flue successfully compacts and the worker has
  stored that fact in the submission callback context; and
- Core copies the checkpoint into the final Space
  `signal.text.data.meta.conversationCompaction`.

The field is absent for ordinary turns, failed compaction, and failed
execution. A completed callback for an external conversation may still carry
the safe worker checkpoint, but Core does not copy it into Slack or Message
Channel publication; only a Space final Signal has the marker contract.
Client-authored normal-message input omits the field from its accepted metadata,
so a browser cannot forge a compaction event. The final Signal remains the
durable user-facing truth; a stream frame, callback observation, local timer,
or browser heuristic must not produce the marker.

This additive rollout is consumer first:

1. deploy Web, which accepts older Signals without the optional field;
2. deploy Core, which accepts both old callbacks without the field and new
   callbacks with it; and
3. deploy Remote Agent last, when it may begin sending the callback field.

An older Web client safely ignores the additive Signal metadata and still
renders the reply. A newer Web client against an older Core renders the reply
without a marker. An older Core may reject the new strict callback shape, so
Remote Agent must not emit it before Core is current. Rollback removes the
Remote Agent producer before Core or Web consumers. Gateway, Auth, CLI,
OpenMeld Service, daemon, Prepare, managed skills, and local-component runtime
contracts are unchanged.

### Agent Task Coordination Contracts

`packages/schemas/src/schemas/runtime/agent-task-coordination.ts` owns the
shared language for exact Agent Task Handles, terminal outcomes, completion
conditions, frozen continuations, subscriptions, and delegation topology.
`packages/schemas/src/schemas/http/center-agent.ts` owns the Center Agent Wake
completion-mode request, the paired delegation/child-task response, and the
exact-task watch request and response. It also owns the bounded controller-task
discovery request and response used to obtain an exact handle before a watch.
Delegated Wake and watch requests can carry an optional canonical BCP 47
`replyLanguageTag`: the upstream Agent's semantic decision for this task,
including an explicit requester override. Core freezes it in the existing
continuation JSON and Wake publication command. It does not update Organization
preferences or alter the Wake's idempotency identity. Native continuation
instructions and their failure publishers read that same fact; failure readers
verify the subscription's Organization and exact continuation identity before
using it. Routine continuations use their existing subscription reference.
Initial Routine failures and workstation child-failure publishers do not yet
receive this fact. Deploy Core request/storage readers before Remote tool
producers. Old producers can omit the field. Before rolling Core back, remove
new producers and drain or retain current readers for persisted commands and
continuations containing the field; older strict readers can reject them.
`packages/schemas/src/schemas/http/runtime-reporting.ts` owns the strict,
bounded Agent Controller task lifecycle batch and per-event result. It carries
only exact task identity, controller identity, Organization identity, lifecycle
type, stable source, timestamp, and a bounded attention reason code. Prompt
text, notification text, transcript paths, and arbitrary provider payloads are
not part of this contract.
`packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts` owns the
Center Agent delegation and general-watch continuation triggers. It also owns
the optional Routine-trigger continuation evidence: the exact delegation
snapshot, watched Task Handle, terminal outcome, subscription id, and
delegation id on the unchanged Routine trigger. The dispatch Queue schema owns
the versioned continuation message that carries one exact subscription claim.

`packages/schemas/src/schemas/protocol/center-agent-interaction-source.ts` owns
the bounded Local Agent carrier attribution shared by Signal metadata, the
Space dispatch snapshot, and the Remote Agent turn envelope. The current
variant is `local_agent` with a client label and optional opaque session
locator. This contract is informational: consumers must never use it as member
identity, permission evidence, conversation authority, or an instruction to
load local context. The field stays optional across the rolling Signal,
dispatch-queue, and turn-envelope contracts so older messages and in-flight
deliveries remain valid.

An Agent Profile id is not a Task Handle. A Task Handle always names the owning
execution domain and its exact execution identity. Current handle variants
cover Space Wake tasks, hosted native deliveries, and registered
controller-native tasks. A controller-native handle combines the exact host,
Agent Controller ref, and provider task id; it exists only after an accepted
registration lifecycle event.

Controller-task discovery is requester- and Organization-scoped. Core returns
only registrations owned by the verified requester in the active
Organization, orders them by registration time, bounds the result, and may
filter by one Agent Controller ref. Each item includes the exact handle,
registration source, supported completion conditions, and any current terminal
projection. The Remote Agent may call discovery once to resolve a recent task;
it must not poll the list for completion or guess when multiple rows remain
plausible.

Cross-field schema invariants fail closed:

- an explicit resumed-completion response contains both a delegation id and
  child tasks or contains neither;
- returned child targets exactly match the canonical requested Wake targets;
- a fallback, when present, is a distinct Agent Profile behind exactly one
  primary and is never compatible with `on_each_terminal`;
- the continuation subscription carries the delegation id and frozen
  instruction, while the subscription's observer Task Handle resolves the
  original requester and destination from its authoritative Native Delivery;
  the exact terminal evidence and bounded child snapshot are carried on the
  new turn envelope, and the snapshot is emitted by every new Core continuation
  after the consumer rollout;
- a Routine continuation keeps `sender.kind = "routine"` and
  `trigger.source = "routine"`, preserves the original frozen destination, and
  requires its nested delegation and terminal evidence to satisfy the same
  exact-child invariants; it never becomes a live member turn;
- when that snapshot is present, its delegation id must equal the outer
  delegation id, its children must contain the exact watched Task Handle, and
  that child's terminal outcome must equal the outer continuation outcome;
- controller-native Task Handle fields and delegation child arrays are bounded,
  so a nominally bounded snapshot cannot grow through an unbounded custom
  controller ref;
- a task-watch request contains one exact Task Handle, explicit condition, and
  bounded continuation instruction; its response preserves that handle and
  returns the durable watch and subscription identities, current watch status,
  and any authoritative terminal outcome already observed;
- a task-watch continuation contains the exact watched handle, authoritative
  outcome, subscription id, and watch id, and never fabricates delegation
  topology;

New Core subscription writers omit the former Space-only `sourceSignalId`,
`spaceId`, and `threadContext` continuation fields. The shared reader accepts
historical rows only when all three legacy fields are present together. The
Core consumer derives the new delivery's conversation identity from the exact
observer Native Delivery, so this change requires no PostgreSQL migration and does not
change the Remote Agent turn-envelope schema.

This contract requires a consumer-first Core rollout controlled by
`OPENMELD_TASK_CONTINUATION_DESTINATION_NEUTRAL_ENABLED`. The checked-in
production value is `false`, so the first production deploy installs the new
reader while every producer continues to write the legacy destination snapshot
and ordinary non-Space parent continuations remain unavailable. Routine
continuations keep their existing destination behavior. Keep the flag `false`
until every serving Core version can read both shapes and execute every
supported destination. Then change it to `true` and deploy Core again to admit
ordinary Slack and Message Channel parent continuations and activate
destination-neutral writes. A missing or malformed flag fails closed to the
legacy shape and Space-only ordinary continuation admission.

The normal rollback target is the Phase-A Core build from the first production
deploy. It already reads both subscription shapes and executes every supported
destination, so setting the flag back to `false` before that rollback is
sufficient.

Rolling back farther to a pre-feature Core is a separate emergency procedure.
That consumer cannot execute an ordinary non-Space continuation even after its
JSON receives the legacy destination fields. First set the flag back to `false`
on the current Core and let the compatible Core drain all already-admitted
ordinary non-Space continuations. Then pause continuation registration and
continuation Queue consumption. This query must return zero; do not cancel
these subscriptions merely to satisfy the gate:

```sql
SELECT COUNT(*) AS active_non_space_continuation_count
FROM agent_task_completion_subscriptions AS subscription
JOIN openMeldRemoteAgent_native_delivery_ledger AS delivery
  ON delivery.delivery_id = json_extract(
    subscription.observer_task_handle_json,
    '$.deliveryId'
  )
  AND delivery.organization_id = subscription.organization_id
WHERE json_extract(subscription.continuation_json, '$.kind')
    IN ('resume_agent', 'resume_task_watch')
  AND subscription.state IN ('pending', 'ready', 'continuation_claimed')
  AND json_extract(subscription.observer_task_handle_json, '$.kind')
    = 'native_delivery'
  AND delivery.routine_run_id IS NULL
  AND delivery.conversation_kind <> 'space';
```

If compatible Core cannot drain that count to zero, rollback only to the
Phase-A build. After the behavioral gate is zero, a pre-feature rollback also
requires an explicit shape backfill. Fail closed if this preflight returns a
nonzero count, and do not deploy the pre-feature Core:

```sql
SELECT COUNT(*) AS missing_observer_delivery_count
FROM agent_task_completion_subscriptions AS subscription
LEFT JOIN openMeldRemoteAgent_native_delivery_ledger AS delivery
  ON delivery.delivery_id = json_extract(
    subscription.observer_task_handle_json,
    '$.deliveryId'
  )
  AND delivery.organization_id = subscription.organization_id
WHERE json_extract(subscription.continuation_json, '$.kind')
    IN ('resume_agent', 'resume_task_watch')
  AND json_type(subscription.continuation_json, '$.sourceSignalId') IS NULL
  AND json_extract(subscription.observer_task_handle_json, '$.kind')
    = 'native_delivery'
  AND delivery.delivery_id IS NULL;
```

When that count is zero, backfill the legacy destination snapshot from the
authoritative observer Native Delivery:

```sql
UPDATE agent_task_completion_subscriptions AS subscription
SET continuation_json = (
  SELECT json_set(
    subscription.continuation_json,
    '$.sourceSignalId',
    delivery.trigger_message_id,
    '$.spaceId',
    delivery.space_id,
    '$.threadContext',
    json(COALESCE(delivery.thread_context_json, 'null'))
  )
  FROM openMeldRemoteAgent_native_delivery_ledger AS delivery
  WHERE delivery.delivery_id = json_extract(
    subscription.observer_task_handle_json,
    '$.deliveryId'
  )
    AND delivery.organization_id = subscription.organization_id
)
WHERE json_extract(subscription.continuation_json, '$.kind')
    IN ('resume_agent', 'resume_task_watch')
  AND json_type(subscription.continuation_json, '$.sourceSignalId') IS NULL
  AND json_extract(subscription.observer_task_handle_json, '$.kind')
    = 'native_delivery';
```

The shape gate is this query returning zero. It covers every durable row, not
only currently active subscriptions, because a pre-feature Core may read a
settled row during idempotent replay:

```sql
SELECT COUNT(*) AS old_core_incompatible_continuation_count
FROM agent_task_completion_subscriptions
WHERE json_extract(continuation_json, '$.kind')
    IN ('resume_agent', 'resume_task_watch')
  AND (
    json_type(continuation_json, '$.sourceSignalId') IS NULL
    OR json_type(continuation_json, '$.spaceId') IS NULL
    OR json_type(continuation_json, '$.threadContext') IS NULL
  );
```

Only after both the behavioral gate and the shape gate are zero may the
pre-feature Core be deployed. Resume continuation producers and consumers
after the rollback completes. The backfilled fields are rollback compatibility
data only; compatible Core continues to use the observer Native Delivery as
its sole destination authority.

A successful watch result with status `watching`, `continuation_pending`, or
`continuation_created` is a turn-ending tool result. Remote Agent serializes
submission-scoped tool execution, persists the turn-end marker, and rejects
later tool work in that same submission. `condition_not_met` is not
turn-ending because the immutable terminal outcome already proves that the
declared continuation will not run.

The Center Agent Wake request names the user-facing modes
`child_reports_directly`, `resume_parent_when_all_terminal`,
`resume_parent_when_first_success`, `resume_parent_on_failure`, and
`resume_parent_on_each_terminal`. Core maps the resumed modes to the stable
barrier vocabulary `all_terminal`, `first_success`, `on_failure`, and
`on_each_terminal`. The optional response `fallbackTask` exposes its exact
planned Task Handle plus result and activation subscriptions; it is not part of
the initial `agentProfileIds` activation set.

Shared schemas provide vocabulary only. Core's coordination repository owns
subscription and delegation state. RuntimeCoordinator, native delivery, and
controller-native adapters remain the execution authorities that produce
terminal evidence.

For a controller-native watch, Core prevalidates Organization, requester
ownership, and registration-source capability, then repeats the exact task key,
Organization, owner, and registration source inside the same conditional PostgreSQL
INSERT that creates the subscription. If retention removed the task or the same
handle was re-registered with different authority evidence, the INSERT creates
nothing and the request fails as target-not-found. A prior read followed by an
unguarded subscription write is not valid.

The lifecycle event types are `registered`, `completed`, and
`needs_attention`. Completion and attention are deliberately different
observations: a completion may create a `succeeded` terminal outcome, while
attention remains nonterminal and can satisfy only a `needs_attention`
subscription. Core derives supported watch conditions from the exact
registration source. The current controller matrix exposes `terminal` and
`succeeded` for Claude Code `TaskCreated`, only `terminal` for Claude Code or
Codex subagents and Codex prompt turns, and no condition for Claude Code
sessions. It exposes neither `failed` nor `needs_attention` for
controller-native watches. Core rejects unsupported controller refs,
mismatched provider sources, missing registrations, cross-Runtime or
cross-Organization identity, unacceptable event times, and unavailable
conditions. Generic Agent availability, process presence, Agent Activity, and
free-form provider status cannot be converted into this contract.

### Agent Execution Readiness HTTP Contracts

`packages/schemas/src/schemas/http/agent-execution-readiness.ts` owns the
shared Agent execution readiness response contract.

Core may include a `primaryBinding` read projection on readiness responses so a
client can render Binding diagnostics without issuing a separate Binding read
per Agent Profile. That projection is copied from Binding-owned truth and is
read-only. It must not become a second Binding writer, reservation, claim
authority, or Wakeability owner.

Rules:

- Binding writes and command eligibility stay on the Agent Profile Binding
  contract.
- Wakeability still comes from the Core-owned projection. Its current
  compatibility implementation is `AgentExecutionReadiness`; Binding existence
  or route/service evidence alone does not provide the verdict.
- Clients may use `primaryBinding` for display and local cache hydration only.
  They must refresh the owning Binding or readiness read model after a mutation
  instead of treating a stale projection as authority.

### Message Channel Contracts

The optional Message Channel turn-trigger `resources` field contains Core-frozen
descriptors for the admitted message, never bytes or credentials. The shared
`centerAgentReadChannelFileBodySchema` and response schema own current-message
file RPC payloads. Core checks the durable request and current connection before
downloading; the model never supplies a new resource authorization. Remote Agent
must read the new optional field before Core produces it. Rollbacks must retain
read compatibility for durable resource-bearing requests.

The optional `trigger.filePublicationSupported` capability is issued only by
Core with the file-publication RPC. Remote Agent hides and rejects the send tool
without it, so a compatible reader can deploy before the producer. The shared
`centerAgentPostChannelFileBodySchema` contains bounded bytes, digest and verified
speaker; the conversation must match the active Core-frozen delivery. Publication
uses `center_agent_publication_operations` with `message_channel_file`, preserving
the existing claim, completed replay, and unknown-outcome contract. Apply the
additive destination-kind migration before enabling the Core producer. Audit
actions `read_channel_file` and `post_channel_file` require action set v22.

`packages/schemas/src/schemas/http/message-channels.ts` owns the canonical
Organization Channels projection.
`packages/schemas/src/schemas/runtime/message-channel.ts` owns provider
identity, transport, typed conversation locators, normalized ingress events,
and the generic Queue envelope. Types derive from these schemas; Web, Gateway,
Core, and Remote Agent must not maintain parallel provider or lifecycle unions.

The provider set is `slack | lark | feishu`. The transport set is
`webhook | websocket`. Lark and Feishu are separate provider values even though
one internal Lark-platform implementation serves both brands. `connector` is
not a Message Channel domain term.

Channel permission read-back requires the complete tenant Channel bundle and
rejects denied, duplicate, user-token, or unrelated business scopes. The one
explicitly granted tenant scope `application:application:patch` may additionally
be present for application configuration. It is setup authority only and never
becomes a Center Agent tool grant or an App connection. The default registration
bundle remains limited to Channel capabilities. New registration links request
this additional setup scope in the provider consent page, where the operator
must explicitly confirm it before it is granted. Older applications missing
the scope retain their credentials and require explicit additional consent.
The additive `reauthorize` begin mode returns a fresh official launcher URL
for the existing app (`clientID`, without `createOnly`). Only this explicit
request may return a URL while configuring with the missing-permission reason.
Normal poll/resume responses remain unchanged for older clients. The URL does
not mark consent complete: the existing Core configurator still verifies the
permission and Webhook delivery using the stored app credentials.

Provider configuration refusal `99991672` becomes the bounded reason
`<provider>.application_config_permission_required`, including when delivered
with HTTP 403. Web explains the explicit setup grant and links to the selected
provider's Developer Console; the existing Core-owned retry remains active.
This uses the existing string reason field without changing a shared payload,
CLI/Service protocol, database schema, or local-component artifact. Old Web
can still read the reason with generic retry copy; new Web accepts old Core.
Deploy Web before Core for actionable guidance throughout rollout. Old and new
CLI, Service, Skills, and Gateway remain compatible through setup, Wake, Space
actions, and diagnostics; no contract-version bump or local-component stamp is
required.

The additive setup-request HTTP contract accepts one provider and returns its
Organization, stable request id, recipient count, and `created` or
`already_requested` result. It never returns credentials or grants Channel
mutation authority. Gateway validates the shared schema, Core reauthorizes the
active ordinary member and current owner/admin recipients, and Web treats the
response as a durable Organization Inbox request rather than local UI state.

The public connection lifecycle has exactly these states:

```text
pending_registration
credentials_received
configuring
connected
repair_required
revoked
disconnected
```

This status is the only connection-state fact. Clients derive a connected
boolean from `status === "connected"` and never receive a second boolean that
can disagree. The projection contains bounded capability groups and failure
reason codes, never credentials, raw scopes, raw provider errors, or provider
payloads.

`MESSAGE_CHANNEL_ERROR_CODES` includes the stable
`message_channel.organization_required` refusal for every attempt to create,
install, resume, restart, repair, or poll a workspace-level Channel in a
Personal Workspace. This is an additive cloud error enum change. It does not
change a request or success-response shape, setup, Wake, Space Action, status,
trace, or diagnostic contract, and local components neither emit nor consume
the new code. Old and new CLI, OpenMeld Service, Skills, Core, Gateway, and Web
therefore remain interoperable across those paths. Because
`@openmeld/schemas` is bundled into packaged local components, release-ready
verification still rebuilds them and may report a changed Service bundle hash;
the normal main release must stamp the resulting local-component facts instead
of hand-editing the manifest on a feature branch.

The scheduled Lark/Feishu continuation path has no HTTP error envelope, but it
applies the same canonical classification before provider work. A Personal
attempt becomes `repair_required` with the bounded projection reason
`<provider>.organization_required`. An unavailable classification is
quarantined as consumed `repair_required` with
`organization.context_unavailable`, so it performs no provider operation and
cannot repeatedly occupy the bounded scheduler batch.

Deploy Web and Gateway before Core so the human-readable guide and bounded
Gateway code are present before Core can emit the refusal. New Gateway remains
compatible with old Core. New Core behind an old Gateway still fails closed but
degrades to the generic upstream error envelope, so that mixed-version window
must stay short.

Active Lark-platform registration is an additive, separate HTTP/RPC read
contract rather than an optional field on the strict connection-list response.
It contains at most one safe summary per enabled Lark-platform provider:
provider, attempt id, `pending_registration | credentials_received |
configuring`, due/expiry timestamps, a bounded reason code, and a
viewer-specific `canResume` capability. Core derives `canResume` from the
current Organization permission and the attempt's exact continuation authority;
it exposes neither the initiating profile nor another installer's private setup
data. It never carries the registration URL, device code, credentials, or
provider payload. This keeps older strict Web, Gateway, and Core consumers
compatible while allowing newer Web clients to show durable setup progress
before a connection row exists. Deploy Core first, then Gateway, then Web; roll
back in the reverse order.

Lark-platform registration begin has three explicit modes: `resume`,
`restart`, and `repair`. `resume` is the compatibility default and returns the
current active attempt. A legacy shared-issuer launcher does not restart an
attempt: Web selects the browser host while preserving its user code and all
other URL parameters. `restart` may replace only a `pending_registration`
attempt owned by the requesting Human Profile in the active Organization. It
never replaces an attempt after credential receipt or while connection
configuration is running. `repair` is accepted only for a `repair_required` or
`revoked` connection with its encrypted credentials still present. It creates
one new connection-bound configuration attempt for the same App, preserves the
failed attempt as history, resets connection-owned Webhook proof, and does not
start a new provider device flow. When a connection-bound configuration
attempt is already active, a repeated `repair` request returns that same
attempt without another write; it must not reinterpret a pending device flow
as repair. Pending attempts remain
installer-private; after credentials bind an attempt to an Organization
connection, authorized Organization Channel managers may resume or repair it
without receiving the now-hidden setup URL. A repair attempt records that
current manager as its initiator while connection installation ownership stays
unchanged. The Gateway validates the mode before Core, and Core remains the
only writer of attempt lifecycle state.

The selected provider fixes registration routing. The shared
`lark-platform-registration-domains.json` contract maps Feishu to
`accounts.feishu.cn` and `open.feishu.cn`, and Lark to
`accounts.larksuite.com` and `open.larksuite.com` for brand-specific polling and
launcher destinations. Both providers begin at the shared issuer
`accounts.feishu.cn`: direct Lark issuance still produces invalid launcher
links in the real browser gate. Core validates the shared issuer's Feishu URL
and user code, retaining the shared issuer URL in storage and HTTP responses.
Web sets only the browser launcher host to the selected provider after response
validation. This presentation does not change registration identity or authority.
Polling starts at the shared issuer and may move to the Lark account host only
after the returned brand matches an already selected Lark attempt. This is a
protocol transport transition; it never changes the selected provider.
Any reported conflicting brand is rejected before
credentials are persisted, including a brand reported while authorization is
still pending. Provider-side redirects remain an external behavior that requires
real browser verification; changing the initial host is not proof that a
provider's app-creation UI enforces the intended brand. The provider login UI
offers a cross-brand sign-in link, so OpenMeld cannot claim that the external
page prevents creation of a wrong-brand app. It must reject that app when the
registration protocol reports the mismatch.

Contract impact: payload fields and the emitted shared-issuer URL stay compatible
with old Gateway, Web, and API-client readers. New readers accept that URL plus
the selected provider's launcher, with the same HTTPS, path, user-code, and
credential/fragment restrictions. Core validates stored URLs before returning
them without host rewriting. New registrations store
the shared issuer URL so rolling Core back does not strand pending attempts.
Use the normal Web, Gateway, Core cloud order; either old/new reader/producer
combination remains readable. Old browser tabs retain their previous launcher
behavior until reloaded; new Web selects the correct launcher even with old Core.
The early brand-mismatch refusal requires new Core. Existing
connected-channel delivery, CLI setup, workstation Wake and Service contracts
are unchanged; no daemon epoch change is implied by this URL contract.

The runtime schema owns a discriminated locator for every provider. A new
generic Message Channel delivery freezes that locator in Core and uses
`conversationKind = "message_channel"`. Only the matching provider adapter may
interpret its branch. New Lark/Feishu deliveries write only this locator;
legacy Slack ledger rows remain readable through a bounded compatibility
adapter. A callback, provider payload, model value, or conversation-id prefix
cannot replace the frozen locator.

The generic Queue envelope carries only a normalized bounded event, provider,
connection id, provider event id, Gateway request id, and receipt time. Raw
Webhook bodies, credentials, tokens, message history, and profile records do
not cross the Queue boundary. Gateway acknowledges only after Queue acceptance,
and Core performs the durable idempotency claim before worker admission.

One-click Lark/Feishu registration returns App credentials and the operator
open id but not authoritative tenant identity. A verified URL challenge proves
Webhook reachability, not tenant membership. The first non-challenge provider
event that passes verification-token, App-id, encryption, and signature checks
must carry a non-empty tenant key; Core atomically binds that first value to the
connection before normalization. `null` never equals `null` for participant
admission, and a different later tenant key is rejected.

`RemoteAgentTurnEnvelope` adds a provider-neutral
`trigger.source = "message_channel"` branch plus
`message_channel_conversation` as a durable memory-source value. The legacy
`slack` trigger and `slack_conversation` memory source remain readable during
the Slack migration. Deploy the schema and Remote Agent consumers before Core
emits either new value; rollback stops Core production before removing those
consumers.

The Message Channel contract never carries OpenConnector credentials or a
Feishu/Lark member user grant. Business actions remain in the separately owned
App contract.

Lark-platform CardKit progress is a durable Native Delivery projection, not a
second execution ledger. Core stores the active card, first visible message,
provider sequence, source offset, rollover index, and one fenced pending
rollover. A response uses the existing 100,000-character product message limit
and at most six 30,000-character provider cards. Core closes and reopens
Markdown code fences at card boundaries without changing the source text.
Every rollover finalizes the current card, creates the next card with its exact
continued segment, and publishes the new reference with a deterministic
provider UUID before advancing the active-card projection. An ambiguous send
retries only the exact persisted card, destination, and UUID; an expired
ambiguity becomes `outcome_unknown`. Final callback publication cannot overtake
an unfinished rollover and never publishes a second standalone reply after a
working card may be visible.

Lark-platform standalone final reply calls use the same deterministic provider
UUID for every ambiguous retry. The reply/send provider contract deduplicates
an identical UUID for exactly 60 minutes. Core persists the exact final payload
and attempt before provider I/O. When the first result becomes ambiguous, Core
writes the next attempt and a deadline anchored to that first attempt's pre-I/O
time, never to a later replay or callback observation. Inside that window,
replay is retryable and nonterminal; at the exact deadline, Core must not call
the provider again and permanently records `outcome_unknown`. Neither callback
content nor a model result may replace the persisted payload, locator, or UUID.
CardKit mutations freeze their card, sequence, and UUID before provider I/O,
but remain fail-closed on ambiguity because no 60-minute CardKit deduplication
window is claimed here.

Remote Agent-generated callback attachments are not a first-release
Lark/Feishu output contract. When a completed Message Channel callback contains
one or more attachments, Core removes the unsupported attachment references
from provider publication and appends an explicit generated-image delivery
notice to the same frozen conversation result. If the notice would exceed the
100,000-character product ceiling, Core shortens only that provider
presentation with a second explicit notice and preserves a Unicode boundary.
It never retries forever, silently drops the attachment fact, redirects the
result, or publishes a second message.

Retryable Remote Agent stream and terminal-callback responses may carry
`retryAfterMs` from Core. For provider `429 Too Many Requests`, Core accepts
either delta-seconds or an HTTP date and caps the value at five minutes. For an
ambiguous Lark-platform standalone final reply or active publication fence,
Core returns the exact remaining delay to the durable next attempt or claim
expiry. Remote Agent treats the value as a minimum retry delay, preserving any
longer durable callback backoff. Because older Remote Agent response parsers
reject unknown fields, deploy the optional-field consumer before Core starts
emitting it. A newer Remote Agent remains compatible with an older Core that
omits the field; rollback stops Core production before removing the consumer.

The completed-callback text ceiling is a strict worker-to-Core change. Deploy
the Remote Agent producer that emits bounded callbacks before deploying the
Core reader that enforces the ceiling. An older Core accepts the bounded
callback. A newer Core can reject an oversized callback from an older Remote
Agent, so that reverse dependency window must remain short and Lark/Feishu
provider flags stay disabled until both are current. Rollback restores Core
first, then Remote Agent. No CLI, OpenMeld Service, daemon, or local-component
runtime contract changes. Because `packages/schemas` is packaged into the local
component artifact, its bundle hash may still change. The release worktree must
rebuild and stamp that artifact with an advisory `available` policy; the
feature branch must not pre-commit release state that has not been published.

### Slack OAuth Contracts

`packages/schemas/src/schemas/http/slack-oauth.ts` owns the payloads that cross
Gateway and Core for Slack OAuth state creation/consumption and workspace
installation. Types derive from these schemas. Gateway must not hand-build a
second state or installation contract, and Web result copy consumes the shared
closed error-code set.

When Core refuses Slack OAuth state creation or installation with
`message_channel.organization_required`, Gateway preserves that diagnostic as
the bounded Slack OAuth result `organization_required`. Web tells the user to
create or choose an Organization instead of presenting the generic state or
installation retry guidance.

A workspace-ownership conflict returns the existing organization identifier to
Gateway, never the organization name. Auth owns the membership-and-name lookup:
Gateway may disclose the existing organization name and offer a move only when
the installer is a member there. Non-members receive the closed generic conflict
without an organization identifier or name on the Web surface.

An informed move is an OAuth retry, not an independent migration endpoint. The
one-time Core-owned state binds the expected previous organization identifier;
the installation payload carries it back only after Slack returns a fresh
authorization code. Core still rechecks current owner/admin membership in the
destination organization before writing.

The installation payload contains a short-lived Slack bot token and is
sensitive even though it crosses an internal service binding. It must never be
logged, returned to Web, included in diagnostics, or persisted outside Core's
encrypted workspace credential record.

The installation payload keeps the two installer identities explicit:
`installedByUserId` is the OpenMeld user identifier used for destination
organization authorization, while `slackInstallerUserId` comes from Slack's
fresh `authed_user.id` and is used only for the welcome DM after a binding is
created or moved to a different Organization. An unchanged reauthorization
does not send another welcome. The Slack identifier remains optional at the
shared boundary so Core can be deployed before Gateway without breaking
installations during a rolling deployment; the current Gateway always supplies
it after a successful exchange.

`packages/schemas` also owns the closed Gateway-to-Core Slack welcome
interaction contract. Gateway verifies Slack's request signature, parses the
native button or modal submission, and forwards only the discriminated action,
workspace/user identity, trigger or interaction id, and bounded selected Slack
user ids. Core re-resolves the workspace Binding and exact linked OpenMeld
member, then consumes Auth's current Organization account-identity projection
and requires a non-null membership before opening a modal, reading an active Organization join link,
ensuring a missing link, or sending an invitation. Any verified member may
reuse the active Core-owned link; Auth remains the only authority that can
create a missing link on behalf of an owner or admin. A forbidden missing-link
result becomes a private actionable Slack outcome for the requester rather
than an unobserved `waitUntil()` rejection. Other Core-side interaction
failures also attempt one private retry/reconnect next step; Gateway observes
and logs a binding-level background rejection instead of dropping a bare
`waitUntil()` promise. Gateway never receives the bot token
or decides Organization authority. Joined-member onboarding is claimed once
per Organization, Slack workspace, and target Slack user. A competing delivered
invitation is moved to a terminal duplicate outcome before it can start a
second research task or welcome publication. Invited-member welcome delivery
uses a separate Core-owned claim ledger keyed by invitation, Slack recipient,
and nullable research task. A null research-task id means research could not
start and the same ledger owns the one failure-aware welcome; Core never
fabricates a task id merely to satisfy publication storage. `pending` fences
concurrent and crash retries, `delivered` stores the provider message id for
onboarding recovery, a confirmed
non-publication may retry from `failed`, and stale or ambiguous claims close as
`outcome_unknown` instead of republishing blindly.

Slack direct-message ingress uses the same event callback and durable queue
contract as `app_mention`, with the strict human `message.im` subtype. Bot
messages and messages with a Slack subtype fail parsing, preventing the Center
Agent from replying to itself or treating edits and other message variants as
new human turns. Core writes the Slack trigger's optional `replyPlacement` into
the strict Remote Agent turn envelope. Current ingress always writes `thread`:
a top-level App Home direct message starts one request thread, an existing
direct-message thread stays there, and a channel mention uses its originating
thread. Working status, final publication, visible failure, and recovery share
that locator. The stored worker request preserves the decision. Older stored
requests with `conversation` remain publishable for recovery; requests without
the optional field continue to use the legacy thread placement.

This additive field rolls out Remote Agent receiver first. The guarded
production planner recognizes the shared turn-envelope owner, Slack Core
producer, and Center Agent receiver together, then deploys Remote Agent before
Core. Old Core safely omits the optional field while the new receiver preserves
legacy thread placement; Core may emit `replyPlacement` only after that receiver
is visible. Rollback stops the Core producer before removing the receiver.

### Slack Event Ingress Contracts

`packages/schemas/src/schemas/runtime/remote-agent-slack.ts` owns the strict
Slack event queue message. Gateway verifies the Slack signature and timestamp,
normalizes the supported event, and must await `Queue.send()` before returning
2xx. It returns retryable non-2xx when the queue binding is unavailable or
enqueue fails; `waitUntil()` is not an accepted durability boundary.

The queue message is discriminated from other messages sharing the physical
queue and carries the Slack event id, durable conversation locator, normalized
event payload, Gateway request id, received timestamp, and Slack retry headers.
Core parses it through the shared schema before durable claim. Unknown queue
messages fail closed under their owning consumer contract; Gateway and Core
must not maintain parallel Slack event shapes.

An `app_mention` event may be content-empty because Slack's event envelope is a
sparse trigger, so the shared event schema preserves it for Core-owned provider
recovery. Human direct-message events remain content-strict. Before admission,
Core uses the Organization-bound Slack credential to read the exact current
message and hydrate its text and file metadata; the normalized queue envelope
does not become a second source of truth for Slack content.

This additive acceptance rolls out Core before Gateway: the new Core continues
to accept every old Gateway event, then the new Gateway may begin forwarding
content-empty `app_mention` triggers. Rollback stops that Gateway production
before removing the Core receiver. The outer Queue message and local component
contracts do not change.

### Slack Workspace Directory Contracts

`packages/schemas/src/schemas/http/slack-workspace-directory.ts` owns the
strict private Core RPC request and response for the Center Agent's read-only
Slack workspace directory tool. The request contains only a bounded page size
and opaque Slack cursor. The response contains one live page of normalized
active human Slack profiles, an opaque next cursor, and Core's current
OpenMeld-membership classification.

The response is a strict union between a successful page and an expected
unavailable result. An unavailable result carries a stable reason code, plain
message, and one lowest-cost next action. A missing Organization Slack
connection therefore remains an ordinary model-visible tool result instead of
becoming an uncaught Worker RPC exception. Remote Agent may explain that result
but must not reinterpret it as an empty Slack directory.

Core owns the comparison, not Slack or the Remote Agent. Core fetches
`users.list` with the Organization-bound Slack bot credential, filters deleted
users, bots, and app users, and consumes OpenMeld Organization membership
through the centralized Organization directory RPC. Core first resolves an
exact Slack identity link scoped to the current Organization and Slack
workspace. The linked OpenMeld user must still be a current Organization
member. If no valid link exists, an exact normalized email match may classify
that directory row for the current response only. The response reports whether
the classification came from `identity_link` or `email`; `email` never creates
a link, represents a Slack sender, or grants member-owned authority. Without
either match, an available nonmatching email means `not_member`; no Slack email
means `unknown`. Display names and profile fields are untrusted provider data
and cannot upgrade either result. The contract grants no roster persistence,
invitation, identity-link, or messaging authority.

This rollout is receiver-first because old Core rejects the new `actionSet=v6`
query and does not implement the directory RPC. Deploy Core's RPC receiver and
v6 audit reader first, then the Web/API-client v6 reader, then the Remote Agent
tool caller. During rollback, remove the Remote Agent caller and Web v6 reader
before Core. Once a directory-read audit row exists, Core must retain the v6
reader and older-action-set filters while that durable row remains.

### Slack Channel Read Contracts

`packages/schemas` owns the Center Agent Slack channel list, channel member,
channel history, and file-read request and response contracts. Requests are
bounded and cursor-paginated. Model-visible responses expose channel names and
provider metadata but not internal Slack channel ids. Member research opts into a
service-binding-only `channelId` field on the member read, stores it outside
model-visible output, and sends it back as `expectedChannelId` on the history
read. Core resolves the name again and fails closed unless it still identifies
that exact immutable channel before reading history.

The Slack workspace-directory request can opt into `memberUserId`; Core includes
it only when the Slack identity matches a current Organization member. Remote
Agent requests it only for member research, stores the exact task-subject Slack
id, and removes the OpenMeld member id before returning directory data to the
model. It must follow the returned directory cursors from the first page to the
end and proceeds only when the completed traversal yields exactly one subject
Slack id. The execution boundary bounds membership inspection to five distinct
immutable channels and allows one history page only for a channel containing
that exact Slack id. Research state expires after one hour and is deleted in a
bounded batch when a later submission is admitted.

These opt-in request fields preserve the receiver-first rollout. Deploy Core
first: callers that do not opt in receive the legacy strict response shapes.
Then deploy Remote Agent, which opts into the new internal fields and fails
closed if Core does not return them. Rollback removes Remote Agent before Core.

Current Remote Agent callers also set `includeFiles=true` on history reads.
Core then returns a bounded `files` array with file id, name, MIME type, size,
and permalink for every message, including one with null text. Callers that
omit the flag keep the legacy message shape without `files`, so Core remains
the receiver-first deploy. Remote Agent retains only a submission-scoped
mapping from the returned file id to the resolved channel name. A file attached
to the current Slack request instead uses the immutable channel id from the
Core-owned turn trigger. The model controls only `fileId`; it never supplies an
internal channel id or download URL.

`centerAgentReadSlackFile` accepts either the resolved history channel name or
that current trigger channel id. Core reauthorizes the designated Center Agent,
connected workspace, and exact conversation/file association through
`files.info` before downloading from an HTTPS Slack-owned private URL with the
Bot credential. The strict response carries at most 5 MiB as base64 plus the
normalized metadata. Remote Agent decodes it, removes base64 from model-visible
output, writes the exact bytes to the Center Agent Computer when available,
returns only a bounded UTF-8 preview for text, and sends images to the selected
auxiliary image-understanding model. Core must deploy before Remote Agent; old
Remote Agent never opts into file metadata or calls the additive file RPC.
Rollback removes the Remote Agent caller before Core.

Each response is a strict union between its successful payload and the same
expected-unavailable shape. Core uses that result for a missing Slack
connection, temporarily unavailable connection state, or a channel the App has
not joined. The result names the cheapest recovery action, such as connecting
Slack or inviting OpenMeld to the channel; these expected product states do not
cross Worker RPC as thrown errors and are never represented as successful empty
history.

Channel listing reports whether the App is already a member and has no mutation
side effect. Channel member and history reads require that membership evidence
and never auto-join. History is newest-first and capped at 15 messages per page.
Interactive and Routine turns expose all three tools through the same Core
authorization, App membership, pagination, and audit contracts; a Routine's
delegated member does not widen Channel visibility. Returned names, profiles,
and messages are untrusted transient evidence, not a durable memory or
Organization document source. Audit readers use `actionSet=v11`; older action
sets must continue excluding these durable action rows.

### Slack Channel Publication Contracts

`packages/schemas` owns the private Core RPC requests and shared response for
explicit Center Agent Slack publication. Top-level channel messages use
`centerAgentPostSlackChannelMessage`; exact existing threads use the additive
`centerAgentPostSlackThreadMessage` receiver. The model-visible tool accepts only
`current_turn` or `organization_document` with an exact document id. A top-level
publication uses an exact channel name. An explicitly requested interactive
thread publication instead uses one exact Slack message permalink from the
user's request or from Slack search evidence returned in that turn;
Organization document and Routine publications remain top-level. Remote Agent
retains only bounded parsed target selectors for the current submission and
converts `current_turn` to the system-owned submission id, or to the trusted Run
id from a Routine envelope. It never accepts a model-authored internal execution
id, Run id, arbitrary publication id, raw thread timestamp, or invented thread
target. A current-turn message supplies one bounded stable `operationId`;
Remote Agent carries it only under the system-owned execution source. Distinct
messages in one task use distinct IDs, while an exact retry reuses the same ID.
Routine Run and approved-document publications keep one source-owned operation
and do not use the model-authored ID to widen that source.

Core validates a Remote Agent execution against the current request context, a
Routine Run against its native-delivery row, and an Organization document
against current Organization access. For an exact thread, Core also requires
the current active native-delivery row to match the represented member and to
have no Routine Run; a caller-provided source kind is never sufficient proof.
Core resolves the supplied permalink through the connected Slack workspace,
rejects a workspace or channel mismatch, and freezes the provider-confirmed
channel id plus canonical root message timestamp before publication. It then
derives the document revision from the approved artifact. The ledger scope
binds that source and normalized operation key to the
Organization, designated Center Agent, and resolved Slack destination. A
top-level destination is the channel id; an exact thread destination is the
channel id plus root message timestamp. The request signature binds the
represented user and final text. An exact completed retry returns the stored
strict response. Changed input conflicts, an active claim stays in progress,
and `outcome_unknown` fails closed. Only a provider-confirmed non-publication
may retry the same source revision.

The top-level Core request keeps `publicationSource` rollout-optional only so an
already-running older Remote Agent can call a newly deployed Core. Omission
uses the legacy direct path and must not be emitted by the current tool. The
current execution source keeps `operationId` receiver-optional during rollout;
an older caller maps to the source-owned `source` key and preserves the former
one-message-per-source-and-destination behavior. Verify the native schema originating in historical D1 migration `0145_calm_tarot` first; it backfills that key and expands the unique
scope without changing existing rows' meaning. Then deploy Core before Remote
Agent. Old Remote
Agent may still call its legacy `channelName` plus `threadTs` request and
continues sending top-level publications to new Core; new Remote Agent sends
the permalink and operation-id request, which old Core rejects before any Slack
write. Rollback removes the Remote Agent caller before the Core receiver and
retains the additive migration. The legacy receiver
shape is rollout compatibility only and must not return to the model-visible
tool. Migration `0067_damp_mariko_yashida` still owns the original ledger;
`0145_calm_tarot` owns ordered per-operation publication identity. No
response-shape change is required.

### Slack File Publication Contracts

`packages/schemas` owns `centerAgentPostSlackFile`. The model supplies one
Computer-relative path and a current-thread, channel-name, or exact trusted
thread-permalink selector. Remote Agent reads one regular non-symlink Computer
file of at most 5 MiB, computes its SHA-256 digest, and supplies the verified
speaker, current execution source, bytes, digest, and basename outside any
provider credential. Core reauthorizes the current interactive native delivery
and represented member, verifies the digest, resolves the exact Slack
destination, and uses `files.getUploadURLExternal` followed by
`files.completeUploadExternal`. The upload URL must be HTTPS and Slack-owned;
the Bot token is sent only to Slack API methods and never to the byte-upload
URL.

The existing publication operation repository adds `slack_file` as a
destination kind. Its destination binds channel/thread plus content digest;
the request signature binds represented user, filename, title, comment, and
digest. A completed retry returns the stored strict response. A
provider-confirmed non-publication may retry, while an interrupted or
undecodable completion becomes `outcome_unknown` and never uploads again
automatically. Audit records the represented publication action without file
bytes or Bot credentials. Verify the native schema originating in historical D1 migration `0141_awesome_lady_bullseye` before Core;
the previous table constraint rejects `slack_file` claims and therefore cannot
fence file uploads safely. This is otherwise an additive receiver-first RPC:
deploy Core before Remote Agent and remove the caller before the receiver on
rollback. Existing Slack installations require reauthorization before
`files:write` is granted.

### Slack Search Authorization And Result Contracts

Slack `app_mention` and direct-message event variants may carry Slack's optional
`action_token`. Core creates an encrypted `searchAuthorization` only after the
Slack identity resolves to a verified Organization member. The ciphertext is
bound to the Organization, Slack workspace, Slack user, verified OpenMeld
member, OpenMeld user, source channel, and source thread. Core rejects mixed
requester or workspace identity. Neither the ciphertext nor plaintext token is
rendered into a model prompt or exposed as a model-controlled argument.

`remoteAgentTurnEnvelopeSchema` owns the optional encrypted authorization as a
trusted Slack-trigger field. Core admits that envelope, bounded Slack history,
and the current verified request into the ordinary durable Center Agent turn.
There is no stateless pre-answer RPC and no second model that may settle the
task before conversation admission.

`centerAgentSearchSlackMessagesBodySchema` owns one model-requested bounded
query and bot-inclusion choice. The encrypted authorization and verified
speaker are supplied outside model-controlled input. Core reauthorizes the
currently designated hosted Center Agent and represented active human,
decrypts the event grant, and revalidates the Organization, workspace, member,
and user before one `assistant.search.context` call.

`centerAgentSearchSlackMessagesResponseSchema` is a strict discriminated union.
A `found` result contains at most eight normalized public messages, at most two
normalized context messages per result, at most 2,000 characters per evidence
item, `moreResultsAvailable`, and the Organization id. Failures remain distinct
`authorization_expired`, `forbidden`, `rate_limited`, or `unavailable`
outcomes. Extra free-form text and malformed
provider fields fail schema validation; provider failure never becomes empty
success.

The ordinary Center Agent may refine search when the current evidence is
insufficient. Search stays inside the existing durable Agent loop and respects
Slack's provider rate-limit outcome instead of adding a second search-specific
counter or router. Each call still has strict input and result bounds.
Concurrent and malformed calls follow the same schema-validated tool path.
Returned messages are untrusted evidence in the same Agent loop. The Agent may
cite permalinks and continue with another tool, but the search tool cannot
answer, publish, save, or terminate the task. Normalized results remain in
current conversation history for durable reasoning and recovery; no automatic
Memory, Organization Document, Profile Report, or Computer-file write follows.

No plaintext action token, raw provider response, query text, or message
content enters audit rows or diagnostics. After a successful provider read,
the audit journal records only the search action, designated Center Agent,
represented requester, and Slack workspace identifier.

The final Slack publication carries deterministic metadata derived from the
event idempotency key. Core skips metadata history lookup on a first delivery.
Only a Queue or Slack retry reconciles the exact top-level or thread message;
if found, it returns `replied` without another model call or publication.

The evidence-shape rollout is complete. Current Remote Agent requires the
shared search result rather than accepting a presentation acknowledgement.
Core no longer calls or exposes the removed transient resolver. Keep Core's
current search and invitation receivers in place before deploying Remote Agent;
roll back Remote Agent before reverting those receiver contracts. This hosted
runtime contract does not change
CLI, OpenMeld Service, daemon, Prepare, RuntimeCoordinator, or local-component
versions.

`centerAgentInviteSlackTeammatesRpcResponseSchema` separately owns strict
per-target conversational invitation outcomes. Core sends target DMs and
returns `delivered`, `already_member`, `manual_invite_required`, `failed`,
`outcome_unknown`, `already_claimed`, or `not_found` to the same Center Agent
turn. It does not also publish a requester summary. The native modal contract
keeps its Core-authored summary because no Agent turn owns that interaction.
The same Remote-Agent-first rollout accepts and labels only the exact legacy
`{handled: true}` acknowledgement until Core emits structured outcomes; deploy
Core immediately afterward. Rollback restores Core first, then the old Remote
Agent consumer.

### Channel Context Contracts

`packages/schemas/src/schemas/runtime/channel-context.ts` owns the
provider-neutral `ChannelContext` projection that a channel adapter may attach
to one Remote Agent turn envelope. Slack, future chat providers, and future
threaded message surfaces adapt their provider payloads into this one contract;
they must not add provider-specific transcript fields to the turn envelope.

The projection identifies the provider, stable conversation, current trigger
message, snapshot-or-delta sync mode, retrieval status, and an ordered bounded
set of historical message records. It excludes the current trigger message
because the exact provider lookup hydrates that request through the existing
worker message field. Message identifiers are unique, timestamps are ordered,
and both per-message and total text limits are enforced at the shared schema
boundary. Slack message permalinks in the hydrated request may add at most
three exact same-channel source-message reads as separately labeled untrusted
quote context. Cross-channel references are not automatically fetched with the
Bot credential. Thread permalinks retain their root timestamp for the replies
API. Unsupported attachment structures and clipped quotes remain non-complete.
If current-message or quoted-message rich content cannot be read, Core keeps
the main request but downgrades a nominally complete projection to an explicit
non-complete status and adds a model-visible limitation note.

Slack native admission freezes the original event's `triggerText` before
showing working status. The model receives the separately hydrated `sourceText`;
hydration must not rewrite admission identity or weaken replay checks. Both
values are internal Core inputs; the persisted ledger and worker wire schemas
are unchanged.

Channel history is reference context, not authority. Human, agent, bot, system,
and unknown-author records are all untrusted provider content. The Remote Agent
renders them as delimited JSON Lines before a separately labeled current
verified request. Historical instructions cannot authorize actions or override
the current request, Routine or task instructions, system rules, or tool safety
rules. An unavailable, forbidden, or rate-limited projection carries no message
records and tells the worker not to claim that it read them.

This contract is intentionally separate from cross-conversation provider search
and Center Agent memory. Current-thread context may be attached automatically;
searching another conversation requires an explicit read tool; long-lived facts
belong to the separately governed memory contract. The initial rollout is
consumer-first: deploy the shared schema and Remote Agent renderer before any
Core channel adapter emits `channelContext`, and stop Core production before
rolling back that consumer. The additive optional field does not change CLI,
OpenMeld Service, daemon, Prepare, RuntimeCoordinator, or local-component
contract versions.

For the first Slack adapter, apply shared historical D1 migration `0044` before deploying
the Core producer. The Remote Agent consumer from the previous rollout must
already accept `channelContext`. Rollback stops the Core producer before
removing that consumer; the cursor table may remain as dormant synchronization
evidence and stores no Slack message content.

### Center Agent Interaction Environment Contract

`packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts` owns the
optional rollout field `interactionEnvironment = requester_private |
organization_shared | externally_shared`. Core is the only current producer.
`packages/agent-runtime/src/center-agent-context-policy.ts` is the shared policy
projection used by Core and Remote Agent; provider adapters and clients must not
maintain parallel disclosure matrices.

The field separates requester identity from result audience. Verified-member
authority and continuity remain stable across surfaces, while the environment
controls whether member memory, Organization context, or protected information
may be shared, used only privately, requested after exact authorization, or
never materialized. Authentication secrets are always unavailable. External
participants deterministically receive no member memory, Organization memory,
Organization Documents, or Organization Skills before model invocation.

Core writes the field from owning facts: Space type and Center Agent DM
projection, Slack `conversations.info` audience flags, Message Channel direct
versus group identity, or the continuation's frozen destination. Lookup failure
and ambiguous external-provider audience fail to `externally_shared`. Legacy
stored envelopes derive a safe environment from their frozen Space and trigger
only during the mixed-version window. Identity-link continuation preserves that
derived environment while replacing the sender with the newly verified member.

Rollout is receiver first. Remote Agent and shared readers accept the optional
field before Core producers emit it. Once every active producer writes it and
retained recovery records have aged through their supported window, a later
contract may make it required. Rollback stops new producers before removing the
receiver. This field does not create a new transcript, authorization owner, or
provider-specific conversation contract.

### Center Agent Memory Contracts

`packages/schemas/src/schemas/http/center-agent-memory.ts` owns member wipe,
organization policy, and explicit organization-memory payloads.
`packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts` owns the
bounded memory projection Core may attach to one Remote Agent turn. Types derive
from these schemas; Web, API clients, Core, and the worker must not maintain
parallel shapes.

Core owns authorization, policy, provider access, and projection. The provider
name in an HTTP response is descriptive metadata, not authority. The worker
consumes only the turn-envelope projection and must not query Zep or infer
member/organization scope from Flue session state.

Each projected memory item carries its episode source, and Message Channel
memory also carries its exact provider. Core includes the episode occurrence
time in the bounded model-facing `text` projection instead of adding another
turn-envelope field. This keeps new Core output compatible with existing strict
Remote Agent consumers. Source conversation IDs, source message IDs, and Zep
episode IDs are Core-private and are rejected by the strict turn-envelope item
schema.

The explicit-save tool is a capture method, not a conversation source. Core
resolves its source from the stored, Core-originated native-delivery request and
keeps the existing tool response's `explicit_tool` value only as the operation
description. Model-facing text marks an explicitly saved fact without replacing
its Space, Slack, Lark, or Feishu source. Core accepts the tool only for a
non-conflicting frozen `organization_shared` environment at the write boundary.
Requester-private and externally shared turns fail closed even if an old or
compromised worker attempts the RPC. Remote Agent must also omit the tool from
its model-facing catalog unless that same frozen environment is present,
non-conflicting, and `organization_shared`; this projection reduces impossible
calls but does not replace Core authorization.

A cross-boundary memory write must carry a verified speaker-member projection or
resolve it through an owning identity contract. Native-delivery callback code
must not reconstruct `memberId` or profile ownership by directly reading Better
Auth or Profile private tables.

Automatic completed-turn writes also consume the frozen Core-owned
`interactionEnvironment` from the stored native-delivery request. Before
writing, Core verifies that the stored Organization, conversation, and sender
still align with the delivery and the owning current-membership projection.
`requester_private` writes the verified member subject. Both
`organization_shared` and `externally_shared` write neither scope automatically;
shared turns never fall back to personal capture. Explicit authorized team saves
remain a separate path controlled by the existing Organization memory setting.
Source values such as
`slack_conversation` and `message_channel_conversation` remain provenance and
must not choose the memory subject. Missing or conflicting frozen scope fails
closed.

### Private Center Agent evidence-read contracts

The additive schemas `center-agent-evidence.ts`, `agent-activity-overview.ts`,
`center-agent-routine-evidence.ts`, and `center-agent-memory-search.ts` under
`packages/schemas/src/schemas/http/` own the private Audit Log adapter, Activity
overview, historical/exact Routine diagnostics, and explicit retained-memory
read. Their types are derived and used by Core receivers and Remote Agent
parsers. Core's private Center Agent entrypoint exposes these methods; Gateway
does not. The human journal, Web/CLI Activity snapshot, Routine HTTP history,
`lastRun`, interactive turn-diagnostic restrictions, and automatic memory turn
envelope remain unchanged.

The model supplies only read intent and bounded selectors, never principal,
member, Organization, graph/episode selector, or arbitrary submission authority.
Core reauthorizes the designated Agent and represented member, then resolves
source access and the current reply audience. The explicit memory response may
include authorized structured OpenMeld Space/signal references; this is a
separate contract from the automatic turn envelope, which still excludes them.
Every supporting source of a synthesized fact must pass before its text or any
reference becomes visible in the ordinary tool result. Runtime summaries include
only allowlisted timestamps/counts, not tool names or raw provider content.

Mixed versions fail explicitly: deploy these Core receivers before the Remote
Agent callers, and remove callers before rolling receivers back. New callers
must not fall back to the human Audit Log endpoint or the unbounded-for-tools
legacy snapshot. Existing callers continue using retained old receivers and
shapes. No Gateway/Web/CLI wire change, new database migration, local component
bundle update, or workstation hard cut is introduced by these private reads.
This ordering is a compatibility contract, not authorization to deploy.

### Information Protection Contracts

`packages/agent-runtime/src/information-protection-prompt.ts` is the single
shared source for built-in disclosure guidance and the optional
Organization-maintained classification-hint section. Remote Agent and the local
OpenMeld Service compose that renderer into their existing system/bootstrap
prompts. No client, tool registry, or provider adapter may maintain a parallel
copy of the categories.

`packages/schemas/src/schemas/http/organization-information-protection.ts`
owns the bounded owner/admin HTTP policy contract. The optional
`includeOrganizationProtectedInformation: true` request and optional response
field on the Organization Document prompt-context RPC preserve old Remote Agent
compatibility: an old caller omits the request flag and receives the old strict
response shape. Owner/admin-only management is not a secret-storage contract:
the active compatible runtime receives the classification hints transiently for
enforcement, and a member-controlled local runtime operator may inspect them.
The policy must therefore contain only category names or document types, never
credentials, secrets, or sensitive record contents.

Runtime Transport uses an additive capability fence. A new local OpenMeld
Service reports `informationProtectionPrompt: true`; only then may Core read
and attach `organizationProtectedInformation` to a dispatch. An old Service
does not report the capability, so new Core omits the new payload field and the
existing Wake continues with built-in guidance only. This does not change the
Runtime Transport epoch because unsupported peers lose only the optional
Organization hints, not Wake execution.

Remote Agent fetches the current policy for every model turn. Organization
Brief, title, and policy reads do not reuse cached content after a current read
fails. Unavailable context is omitted and reported honestly. Workstation policy
reads are also optional to delivery: a read failure
or missing Space Organization projection is observable and omits the custom
hints while preserving built-in guidance.

The rollout is ordered: verify the native schema originating in historical D1 migration `0061`; deploy Core so it
accepts both optional cloud and workstation fields; deploy Gateway and the
Remote Agent; deploy Web; then publish the CLI/Service producer. A new Remote
Agent must not send the strict request flag to old Core, and a new local Service
must not report the strict capability to old Core. Rollback removes producers
before consumers. No release may stamp the local components until this
cloud-first order is satisfied.

### Hosted Center Agent Space Guide Contract

`packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts` owns the
optional bounded `space.guide` projection on a Remote Agent turn envelope. Core
reads it from the owning Space Durable Object for each Space-context native
delivery and omits it when the guide is empty. The Remote Agent consumes only
that envelope field; it must not cache a prior guide or create another Space
guide read model.

Core attaches the field for ordinary Space Wakes, including ordinary Direct
Message Spaces, and Space-destination Routine Runs. Center Agent DM turns,
Slack turns, and Slack-destination Routine Runs do not carry it. The approved
Organization Brief stays in the system prompt and does not move into, or
duplicate, the per-turn Space guide frame.

This is an additive but strict Core-to-Remote-Agent cloud contract. Deploy the
Remote Agent consumer that accepts the optional field before Core starts
emitting it; roll back the Core producer before rolling back that consumer. It
does not change CLI, OpenMeld Service, daemon, Prepare, RuntimeCoordinator, or
local-component contract versions.

### Hosted Center Agent Navigation Contract

`packages/schemas/src/navigation-action.ts` owns the Organization route
constructors and the structured `NavigationAction` shape used by OpenMeld Web
and the Remote Agent. A Navigation Action contains one code-owned target, a
human label, and an absolute HTTP(S) URL. The shipped target set is deliberately
small: the GitHub App management surface, a Space, Projects home, one Project,
and computer setup. Computer setup has explicit `setup`, `reconnect`, and
`update_service` modes; reconnect and update require the exact Core-projected
`connectedComputerId`. Adding a target means adding its schema variant, route
construction, label, and behavior test in this single owner; it does not
require a new service, database table, or product plugin registry.

Core owns the optional `organization.webUrl` projection on the Remote Agent turn
envelope. It builds that canonical tenant root from the deployed `WEB_APP_URL`
and the current Organization's stored slug for Web, Slack, Routine, and member
research admission. The worker may combine that trusted root only with the
shared code-owned target builder. It must never infer an origin, tenant slug, or
route from model text, Slack identifiers, Flue state, or provider data.

A Navigation Action is presentation, not authority. It neither proves that the
viewer may use the destination nor bypasses the destination's ordinary auth,
membership, or role checks. App tools retain their connection ownership and
action policy; Space and Project tools retain their Core-owned authority.

For hosted Center Agent replies, the worker durably records only the most
recent top-level code-generated `navigationTarget`; it never accepts a
model-authored URL as callback authority. The optional completed-callback field
crosses the Remote-Agent-to-Core boundary. Core resolves the current
Organization slug and deployed `WEB_APP_URL` again, rebuilds the canonical
`NavigationAction`, and persists it as optional semantic content on the final
message envelope. OpenMeld Web renders that field as a button-styled link only
on a trusted final agent reply. Slack renders the same action as a native
button with a fallback link. Lark, Feishu, and generic Message Channels do not
yet consume the structured action, so their prompt contract requires one
ordinary Markdown link built from the exact returned label and URL. Ordinary
assistant Markdown remains an ordinary link and cannot impersonate the Web or
Slack action surface. The Space write boundary also rejects any
message-envelope action unless both `authoringPolicy = system_emitted` and
`finalOutcomeAuthority = remote_agent_native_delivery`; accepting the shared
schema shape alone never makes an action trusted. A successful Project removal
clears any earlier Project target recorded during the same turn and
intentionally does not return an action to the no-longer-active Project.
GitHub connection-unavailable failures use the same structured path: the worker
records the code-owned GitHub App target before reporting the failure, and the
final reply receives Core's canonical action instead of relying on a
model-authored Markdown URL.

`centerAgentListComputers` is the dedicated private Core RPC for the represented
member's computer setup context. Its strict request carries the Core-recorded
verified `speakerMember`, and its strict response is separate from
`centerAgentListLocalAgentConnectionCandidates`; computer setup fields must
never be appended to that existing strict response. Core resolves the active
human Organization member from that pair before reading Local Runtimes for the
represented member's user id. An unverified, inactive, mismatched, or
out-of-Organization speaker fails closed before the inventory read. Because
this is a read projection, it must not request legacy connection identity
adoption or otherwise write local-runtime identity state. Core projects
computer identity, status, reason codes, and recommended setup mode from that
current Local Runtimes response. Remote Agent exposes the projection through
`openmeld_list_computers` only in a requester-private conversation and fails
closed when the audience is shared, the verified member is absent, or the new
Core receiver is absent.
This read contract does not grant computer management authority or change
OpenMeld Service, daemon, Prepare Session, RuntimeCoordinator, or local
component contracts.

The optional `includeDiagnostics` request flag expands only this verified-owner
read. Its optional `diagnostics` response uses
`owner-computer-diagnostics.ts` to compose a model-safe projection of the
existing Local Runtimes response, current-local-runtime reply-readiness
response, and a File Access summary. The Local Runtime projection preserves
Computer state plus Local Agent status, installed version, update state,
capabilities, model display names, and check evidence. It excludes controller
accounts, executable paths, launch arguments, update commands, raw diagnostic
messages, private skills, and local policy. It creates no persisted fact and
does not replace Core-owned Agent execution readiness. The File Access summary
intentionally cannot represent folder paths.

This optional pair is the mixed-version fence: new Remote Agent requests
diagnostics explicitly; old Remote Agent omits the flag, so new Core omits the
extra strict response field. New Remote Agent accepts an old Core response with
no optional diagnostics. Deploy Core before Remote Agent. The separate
`centerAgentReadMemberComputers` RPC must follow the same Core-before-Remote
order; a new caller against an old Core fails closed as unavailable.

The Organization Web projection remains an additive strict
Core-to-Remote-Agent cloud contract: deploy the Remote Agent consumer that
accepts optional `organization.webUrl` before Core starts emitting it and roll
back Core first. The final-reply action adds the opposite strict direction:
deploy Web's optional message-envelope reader, then Core's optional callback
reader and canonical action producer, and deploy the Remote Agent callback
producer last. Rollback stops the Remote Agent producer before Core and Web.
Old Remote Agent remains compatible with new Core because it omits
`navigationTarget`; new Remote Agent must not send that field to old strict
Core. This change has no CLI, OpenMeld Service, daemon, Prepare,
RuntimeCoordinator, local-component, migration, or local persisted-state
impact.

The computer setup rollout preserves that order and adds one Core-to-Remote
Service Binding dependency: deploy Web's inline renderer first, then Core's
navigation target reader/producer and `centerAgentListComputers` receiver, and
deploy Remote Agent's new tool and target producer last. Before enabling the
Remote producer, let old Web tabs age out or require a refresh: an already-open
strict Web reader from before this contract can reject a message carrying the
new target instead of rendering only the action as unavailable. Rollback stops
Remote Agent first. Old Remote Agent never calls the new RPC, and the existing
strict local-agent candidate response remains byte-for-byte unchanged for
mixed-version compatibility.

### Agent Work confirmation outcomes

Agent Work may carry the optional `outcome: confirmation_required` projection.
It means the tool returned a confirmation proposal, not that its external action
executed. The tool result remains the execution owner's fact; this field grants
no permission and carries no confirmation token or raw result. Runtime preserves
the original tool-call identity and safe subject while attaching the terminal
outcome, including Code Mode inner calls. Web labels it as a confirmation request.

Deploy Core/Gateway/Web readers before Runtime emits the optional field because
older stream readers use strict schemas. Refresh existing Web tabs before the
producer rollout. Rollback removes the Runtime producer before old readers.

### Organization Document Contracts

`packages/schemas/src/schemas/http/organization-documents.ts` owns the strict
human HTTP/Core RPC CRUD and draft-review payloads, the Center Agent catalog,
read, draft, and management payloads, and the bounded prompt-context projection.
Gateway, Core, API client, Web, and Remote Agent must derive their types from
these schemas and must not maintain parallel document shapes.

The existing read RPC permits an omitted `speakerMember` for personal Remote
Agents only. Core verifies the receiving Agent against its active native
delivery and ordinary owned-Profile/member read contract, plus the stored task
audience. Center callers still require the verified speaker. This read-only
path returns approved content without draft, protected-prompt, or management
authority. Roll out Core before Remote callers that omit the speaker.

The Center Agent draft input is strict and contains `draftContent`, never
`content`. It targets either an existing document id or a new document identity
described by kind, optional member subject, and title; those target modes are
mutually exclusive. The prompt-context response carries approved Brief content
and titles for documents with non-empty approved content only. Draft bodies and
draft-only document titles are intentionally absent from prompt projections.

The Center Agent management input is a strict action-discriminated union for
folder creation, folder rename, document placement, and approved ordinary
knowledge saves. Every action carries a caller-stable operation id. Core scopes
that id to the organization, Center Agent profile, represented human, and action;
an exact completed retry returns the recorded response, an exact pending retry
reports in-progress without repeating the mutation, and a changed payload fails
as a conflict. The operation-ledger insert winner is the only request allowed to
mutate or complete the operation. Destructive delete is intentionally absent.
Direct approved saves are owner/admin-only, knowledge-only, and fail when the
target has a pending draft.
Core also requires the current accepted native-delivery identity. An interactive
turn uses its Core-recorded represented member; a Routine turn additionally
requires the current Run/native-delivery link and the stored
`organization_documents.save_approved_knowledge` action grant.

Human list/get/create/update/delete/approve/discard routes live under
`/v1/organizations/current/documents`. Every route has a same-batch Gateway and
Core RPC method using the same schema so a partial deployment fails as an
explicit contract error rather than an unowned 502.

Human content updates carry both `expectedDocumentUpdatedAt` and nullable
`expectedDraftCreatedAt`. Core includes both values in the same conditional PostgreSQL
update that writes the content. A zero-row update returns
`organization_document.working_copy_conflict` after confirming the Document
still exists, so a stale browser cannot erase a newer Center Agent draft or
human edit. Title-only and folder-only updates remain independent management
operations and do not require content versions.

Welcome preparation reads `COALESCE(draft_content, content)` from the report
bound to the completed research task. This preserves one visible-body rule when
a human saves the provisional report before Slack delivery. Profile Report
selection compares structured report date first and creation time second;
`updatedAt` is an edit version and never changes which same-day learning run is
the latest. Managed Profile Report folders are absent from every Web move-target
projection and remain rejected by Core's document and folder placement writes.
The member-research draft RPC returns the exact current content produced by its
Core write as the Computer-file body, so Documents and the Center Agent Computer
cannot diverge or create an empty file from a summary that omits content. A
preexisting ordinary root folder named `Profile Reports` remains ordinary and
unchanged; Core creates a collision-safe managed root instead of converting
user-owned hierarchy into managed storage.

`packages/schemas/src/schemas/http/center-agent-member-research.ts` owns the
single-member/all-members start request, batch/task progress projection, and
status response. The public HTTP route is
`/v1/organizations/current/member-research`; Gateway, Core, API client, and Web
must use the shared request and response schemas. The `member_research` Remote
Agent turn variant is owned by the shared turn-envelope schema and binds its
task id to worker dispatch, trigger, idempotency, and requesting-profile
identity. Remote Agent adds the internal task id to the draft RPC from the
trusted envelope rather than model input; Core binds that id and the worker
submission to the assigned `member_profile` target.

The same schema module owns the private
`centerAgentStartSelfMemberResearch` service-binding request used by the
model-visible `openmeld_learn_about_me` action. Its payload contains only the
trusted Center Agent context and the current verified speaker. Core derives the
single subject from that speaker and starts the existing research contract; the
model cannot name another subject. The same rollout adds the
`organization.member_research.start` Agent Work key so Web can describe the
background start without claiming that the Profile Report is already complete.

The member-research evidence extension adds `slack_channel_history` and
`connected_apps` coverage plus attributable `slack` and `connected_app`
evidence. Core accepts the complete legacy five-source coverage set and the
complete current seven-source set so an old Remote Agent remains compatible
during a Core-first rollout. The current Remote Agent tool input requires all
seven sources, and connected-App evidence execution is independently fenced to
actions whose provider declaration says `read`. Deploy Core before Remote
Agent; roll back Remote Agent before Core.

This contract has two strict directions and rolls out consumer-first:

1. Verify the native schema originating in historical D1 migration `0115_tense_cannonball`;
2. deploy Web so it accepts the new Agent Work key before any worker emits it;
3. deploy Remote Agent so it accepts the `member_research` turn variant and
   exposes the self-only tool;
4. deploy Core with the new tool RPC receiver and the producer that schedules
   `member_research` turns.

During the Remote-Agent-first window, the new tool fails explicitly against an
older Core RPC receiver and does not create a document through another path.
An older Remote Agent never calls the new Core method, but new Core must not
lead the Remote Agent rollout because the old worker does not accept the new
strict turn variant. Rollback therefore removes the Core producer first, then
Remote Agent, then Web; the additive PostgreSQL migration may remain.

Core persists that trusted task id with the Organization Document draft write so
completion can be verified even if a human immediately approves or discards the
pending draft; it is correlation metadata, not approval or execution authority.
The same task and submission are idempotent and resolve to the correlated
document instead of creating or restoring another pending draft.

### Center Agent Routine Contracts

`packages/schemas/src/schemas/http/center-agent-routines.ts` owns the strict
public HTTP, Core RPC, eligible-target, Routine, Run, and private Center Agent
tool payloads. Types derive from those schemas. Gateway, Core, API client, Web,
CLI, and the Remote Agent worker must not maintain parallel Routine shapes.

The canonical Routine projection includes the owning organization,
`scheduleKind = once | cron`, the matching one-time timestamp or recurring
cron/timezone fields, `destinationKind = space | slack_thread`, the matching
Space or durable Slack-thread locator, status, nullable `nextDueAt`, permission
projection, and a required `lastRun` field whose value is a strict summary or
`null`. The canonical eligible-target response is a
separate Core-owned projection of `{ kind, name, spaceId }`. Clients must not
expand a Routine with a locally reconstructed Space object or treat a cached
Space directory as target authority.

The Run status set is closed: `claimed`, `submitted`, `completed`, `failed`, or
`skipped`. Ordinary timestamps such as created, updated, next-due, started, and
finished times remain nonnegative. Run and `lastRun` `scheduledFor`, plus the
Runs HTTP/RPC `beforeScheduledFor` cursor, are signed safe integers. A negative
Run `scheduledFor` parses only when `status = skipped` and
`failureCode = routine.schedule_invalid`; every other negative combination
fails closed. Boundary code must not clamp, hide, or migrate valid quarantine
evidence.

One claimed Run's destination snapshot remains the routing authority across
worker submission and every publication path. A Routine destination update affects
later claims, not an existing claimed Run. This routing rule does not define
claim-time snapshot semantics for name, instructions, schedule, or timezone.
Schema fields and successful parsing do not by themselves prove that runtime
writers obey the frozen-target rule.

Routine HTTP requests and responses, Core RPC inputs and responses, and
`packages/api-client/src/routines` all parse through the shared strict schemas.
Unknown fields, missing required fields, and unknown status values are
mixed-version errors, not compatibility hints. CLI `show` may select one
Routine from the strict list response; it does not imply a separate HTTP
endpoint.

The public Routine routes preserve the frozen response shape shipped in CLI
`0.2.30` when the request omits `contract`. Core filters one-time and
Slack-thread Routines out of that legacy list because the v1 projection cannot
represent them, and rejects a legacy mutation or Run-history request that names
one with `routine.client_update_required` before mutation. Current consumers
explicitly send `contract=practical-v2`; only that opt-in response carries the
new schedule, destination, and `completed` fields. The frozen v1 schemas and
the practical schemas both live in the shared package. Gateway, Core, and
clients must not hand-build a third compatibility projection.

Routine create and update inputs may carry the bounded structured
`authorizedActions` set. The current set contains
`organization_documents.save_approved_knowledge` and
`slack.publish_channel_report`. Its omission means no new grant, create
defaults to no grants, and update omission preserves the stored value. The
canonical public Routine response does not expose this internal grant,
preserving the existing strict practical-v2 response shape. Core is the grant
writer and verifier; Remote Agent descriptions or Routine instruction text are
not permission evidence.

The list-only `management-v1` contract extends that public Routine projection
with a strict `capabilityState` read projection: approved-knowledge availability,
Slack channel-report availability, the stored external-action policy, and
whether the represented member can repair that combination. Core derives those
fields from the canonical stored Routine and the same grant policy used by
updates. It remains frozen. The list-only `management-v2` contract adds required
`creationAttribution` from the canonical Routine definition: the verified
represented-human display-name snapshot, which may be explicitly unknown for a
legacy row, and an optional bounded Local Agent client carrier. The strict
carrier contains no session or conversation locator. Core does not expose the
raw grant list or create another capability writer. Practical mutations and Run
history remain on `practical-v2`; management clients omit management-only fields
on ordinary updates and send capability fields only for explicit changes.

`management-v2` rolls out through an additive PostgreSQL migration first, then the Core
receiver and frozen `management-v1` compatibility reader, Gateway, and Web.
Existing Web builds can keep requesting `management-v1`, and CLI remains on
`practical-v2`, throughout the mixed-version window. New Web must not request
`management-v2` before both cloud receivers accept and return it. Rollback
removes callers in reverse order and retains the additive nullable column; an
older Core ignores that column, while current Core projects an explicit unknown
snapshot for rows created before the migration.

`packages/schemas/src/schemas/runtime/remote-agent-turn-envelope.ts` owns the
Routine turn variant. `sender.kind = "routine"` and
`trigger.source = "routine"` appear together, name the same Routine, and carry
the Run identity, scheduled timestamp, and required Core-authored `delegatedBy`
member snapshot. Current Core also includes the represented Human Profile id in
that snapshot. Remote Agent uses that Core-authored id for tool attribution; it
must never ask the model to select or repeat an `onBehalfOf` identity. The
profile id remains rollout-optional only so the new Remote Agent consumer can
deploy before the Core producer. The snapshot's `ownerUserId` must equal the
Routine sender's `createdByUserId`; a mismatch fails schema admission. The
Routine trigger also
carries the frozen Space or Slack-thread destination used by
`current_conversation`. The field is rollout-optional only so the new worker can
deploy before Core; current Core always emits it, and the worker fails visibly
rather than guessing when an old-Core turn omits it. Slack interactive triggers
also carry the durable team,
channel, thread, and conversation locators needed to create a current-thread
Routine. The strict worker submit envelope uses that projection; the worker
must not infer it from Flue session state or reinterpret a missing delegate as
shared-only authority.
For a Routine, the submit root uses the designated Center Agent as `author`,
requires `onBehalfOf = null`, and keeps historical delegation in
`turnEnvelope.sender.delegatedBy`. The worker submit response is a strict union:
either the durable submission ACK with a real `submissionId`, or a versioned
admission rejection with `idempotencyKey`, bounded `reasonCode`, and `message`.
The rejection variant must not invent a submission identity. Core's private PostgreSQL
recovery envelope is a storage concern, not a second cross-service contract:
its inner request is still validated by the shared worker-request schema before
write and after read.

The strict version-4 worker request separates the stable logical
`conversationId` from `runtimeConversation = { generation, id }`. The runtime
id is derived from the Organization, logical conversation, and non-negative
generation by the shared schema; either side rejects a mismatched route. Core
is the sole generation-pointer writer. Remote Agent owns each generation's
Flue stream and never chooses, advances, or aliases generations.

`remote_agent.conversation_history_limit_exceeded` is the deterministic
pre-replay rejection for a runtime generation whose serialized Flue stream
reached either the frozen controller model's adaptive rollover boundary or the
hard infrastructure safety boundary. This changes only when the existing
version-4 rollover response is emitted; it does not add a second request or
response shape. The Remote Agent first resolves the request's
durable idempotency receipt: finalized retries return their original ACK
without Flue replay, claimed retries retain their existing recovery path, and
only a request with no matching receipt is eligible for this rejection. For a
version-4 request, the soft boundary authorizes exactly one Core-owned atomic
generation advance and replacement submission for the same logical turn. The
replacement may carry only the shared bounded, source-attributed
`continuityContext`; Remote Agent consumes it only while the new generation is
empty. Legacy version-1 through version-3 requests still treat the rejection as
terminal.

Version 4 is an additive strict request-envelope change. Deploy the PostgreSQL
generation-pointer migration, then the Remote Agent request receiver, then the
Core producer. An old Core continues sending version 3 to the new receiver; an
old strict Remote Agent rejects version 4, so Core must never produce it first.
This request-receiver order takes precedence over the response-reader-first
order when one release changes both directions of the worker boundary.

The Routine trigger may carry `externalActionPolicy = standard | read_only`.
The field is rollout-optional so a new Remote Agent consumer can deploy before
Core emits it; omission means `standard`. Core persists the policy on the
Routine and copies it into the frozen worker request. `read_only` is consumed
only as the narrow external-action fence owned by
`developing/product/routines.md`; it does not authorize reads,
replace capability-owned checks, or become a second general permission model.
Deploy the Remote Agent consumer first, apply the Routine-column migration,
then deploy the Core producer.

The Routine trigger also carries its stored `authorizedActions` with an empty
default for older producers. Remote Agent may use an action-specific grant only
to pass the matching unattended fence. The receiving Core capability must still
rebuild authority from its own canonical records before the side effect. For
`slack.publish_channel_report`, Core resolves the Run back to its Organization
Routine and verifies the same stored grant; a forged worker envelope therefore
cannot publish.

For interactive Message Channel turns, `sender.kind = "member"` with
`verified = false`, no `ownerUserId`, and a Core-authored
`messageChannelIdentity` represents a connected Message Channel member in the
connected collaboration workspace. `messageChannelIdentity` contains only the
provider, connection id, and provider user id needed to resolve the exact
native delivery; it is provider-level admission and attribution, not an OpenMeld
member projection. The field is rollout-optional for stored or old-producer
envelopes. A missing field therefore preserves the legacy restricted surface
and never receives connected-member tools.

`centerAgentToolSpeakerSchema` is the shared speaker contract. Its existing
`{ memberId, userId }` variant remains the verified represented-member shape;
the additive `anonymous_member` wire variant carries the display name plus the
same Message Channel identity. `anonymous_member` is retained as a
mixed-version compatibility literal; the domain and product term is connected
Message Channel member, and the wire literal must never appear in user-facing
copy. Remote Agent and Core share one explicit connected-member capability
contract. Before an allowed tool executes, Core resolves
`agentControllerConversationId` to the durable native-delivery request and
matches the Organization, designated Center Agent, sender, and Message Channel
identity. The delivery must still be in `accepted` or `retry_observed`; a
terminal delivery cannot be replayed for later access. A mismatch or inactive
delivery fails closed. Successful audited reads store
`sourceNativeDeliveryId`, so attribution follows the frozen provider identity
without creating a second member record.

The connected-member contract includes public research and bounded
Organization reads plus Organization-shared Plugins. Dedicated GitHub reads accept
only `githubActor = organization` and resolve only the Organization's GitHub App
installation. Generic App catalog reads resolve only `scope = shared`; execution
must read the provider action metadata before deciding whether the action is an
ordinary read, an explicitly ordinary-member-authorized non-destructive write,
or an identity-gated action. A connected member can never select a requester or
member-owned connection. Unknown actions and mismatched scopes fail closed.
Capabilities outside this contract keep the verified represented-member
requirement and use the stable `center_agent.openmeld_identity_required` error.

The shared allowlist also includes the seven existing public research tools:
Web search, Web fetch, public-browser page read, link extraction, structured
extraction, selector scraping, and screenshot. They retain their existing
public-URL validation, bounded output, and Space-attachment limits. Their
inclusion grants no persistent browser or personal session authority.

Member-memory recall requires a verified member plus owner identity.
Organization-memory recall may also serve a connected Message Channel member
whose provider tenancy is proven, while never manufacturing an OpenMeld member
identity. External participants receive neither scope. Every new or continued
turn removes an inherited memory projection before running current authorized
recall, so a durable parent request cannot smuggle stale context into a changed
environment.
Provider adapters must not infer an OpenMeld user, member, profile, role, or
represented-member grant from a display name or provider user id. No component
may create a synthetic Better Auth member, Human Profile, or user id for a
connected Message Channel member. Shared App execution records the frozen
Message Channel identity and source native delivery instead of manufacturing a
OpenMeld human.

The three pre-existing general reads for Organization directory, coarse member
OpenMeld Service status, and Space directory accept the shared speaker only for
a connected-member turn. Verified-member calls preserve their old request shape.
This keeps a new Remote Agent compatible with an old Core during the required
consumer-first rollout.

Roll out the original connected-member read access in this order:

1. Verify the native schema originating in historical D1 migrations `0077` and `0078`, which add native-delivery speaker
   evidence and audit-source projection;
2. deploy Remote Agent, whose optional identity consumer keeps old Core turns
   on the legacy external-participant surface and preserves verified read
   payloads;
3. deploy Core, which may then freeze provider identity, expose the
   connected-member tool surface, and authorize each call against the active
   delivery.

The reverse Core-first window is unsafe because an older strict Remote Agent
does not accept the new sender identity. Rollback therefore stops or rolls back
the Core producer before the Remote Agent consumer; the additive PostgreSQL columns may
remain.

Expand connected-member Organization-shared App access in a separate
receiver-first rollout:

1. Verify the native schema originating in historical D1 migration `0096_lovely_roland_deschain`, which adds the canonical
   requester-attribution key and source native-delivery attribution to
   connector action operations;
2. deploy Core with the expanded shared tool-name contract, exact native
   delivery authorization, shared-only connection selection, and
   provider-delivery attribution;
3. deploy Remote Agent so connected-member turns begin exposing GitHub
   Organization reads and ordinary writes plus shared generic App capabilities;
4. for non-GitHub Plugins, treat the action owner's registered `write` effect as
   the ordinary-member policy already used for verified members. Unknown and
   destructive effects remain identity-gated. GitHub requires
   `githubActor = organization`; file deletion, pull-request merge, requester-
   owned actions, and other identity-sensitive capabilities remain gated.

An older Remote Agent never calls the new Core receivers. A newer Remote Agent
against older Core fails closed before provider I/O because the old strict
tool-name contract rejects the authorization request. Rollback therefore stops
Remote Agent first, then Core. This expansion changes no CLI, OpenMeld Service,
local Agent Controller, or workstation Wake contract.

`centerAgentReadTurnDiagnosticsRpcInputSchema` and
`centerAgentReadTurnDiagnosticsResponseSchema` own the private Center
Agent/Core self-diagnostics contract. The request carries only the trusted
OpenMeld request context and a bounded limit; Core derives all conversation and
requester scope from the current native delivery. The response keeps raw
lifecycle status, failure evidence, and final publication evidence separate,
and bounds sanitized failure detail. Each turn also carries an optional typed
`conversationSource` with `isCurrentConversation`; Core emits it for all new
responses, while optionality lets a new Remote Agent read an old Core response
during rollout. Deploy Remote Agent before Core for this response expansion so
the strict old reader never receives an unknown field. Rollback removes the
Core writer before the Remote Agent reader. Gateway, Auth, Web, CLI, OpenMeld Service, daemon, Prepare,
RuntimeCoordinator, and workstation Wake contracts do not change.

The provider-neutral Message Channel identity handoff is additive to
`openMeldNavigationTargetSchema`. The existing `slack_identity_link` wire target
remains a rollout-compatible Slack input, but it must not become the product or
model-facing capability boundary. The connected-member allowlist includes the
dedicated `openmeld_require_identity_for_action` boundary tool, but it does not
expose personal, role-restricted, destructive, or otherwise identity-gated
tools. After Core authorizes the exact native delivery, the boundary tool
records same-submission evidence in callback context; safe connected-member
tools never create that evidence. A `continue_request` navigation target
requires the evidence and a provider-supported identity-link authorization
capability before it records the non-secret target. An `optional_setup` target
is allowed only when the current participant explicitly asks to connect the
provider account. It never creates or satisfies an identity-required boundary
and is not an unsolicited conversion prompt.
Core reconstructs the exact connected Message Channel speaker from the native
delivery and confirms the task result before issuing a provider-bound token and
building a private Slack action or trusted Lark/Feishu card action visible only
to that provider user. Both `continue_request` and `optional_setup` guidance are
post-result. A known required-guidance failure remains retryable without
republishing the confirmed result; explicitly requested non-continuing guidance
is best effort and never changes a successful task into a failure. Lark and
Feishu retries reuse a
deterministic provider publication UUID. Slack uses the active source-bound
token as its at-most-once private-message publication fence: a known provider
rejection expires the token and may retry, while an ambiguous outcome remains fenced and logged
instead of risking a duplicate private action. Migration `0087` adds the nullable
`organization_id` rollout column to existing token rows, and migration `0088`
adds the nullable internal `consume_nonce` used to join one successful token
claim to its identity-link write. Migration `0089` adds the nullable consuming
OpenMeld user and source native-delivery id used for same-user replay and
deterministic continuation. Migration `0090` adds the nullable claim owner and
time, non-null continuation retry generation, and nullable private delivery
scope. New issuances always write the Organization, source delivery, and
`slack_direct_message` scope. The legacy `slack_ephemeral` scope remains readable
for unexpired private actions during rollout. Pre-migration tokens with no
Organization or private delivery scope fail closed, while private tokens without a source delivery may
link but cannot claim automatic continuation. Core atomically claims one
private token for the signed-in OpenMeld user before Auth may add Organization
membership. Core then rechecks the current workspace Binding and signed-in
Organization membership while consuming the claimed token and writing the link
in one PostgreSQL transaction. If that exact Slack account points to another member,
the same Slack-private proof atomically replaces the canonical mapping; it never
creates two mappings. A competing OpenMeld user fails before Auth enrollment.
The same user may retry a claim left unconsumed by a failed Auth enrollment.
Issuing a fresh private setup action atomically expires all earlier unconsumed
tokens for the same Slack identity before inserting the replacement, so an
abandoned claim cannot fence a later setup action until expiry.
A non-continuing action narrows that replacement to older non-continuing
actions and cannot invalidate a source-bound continuation for another request.

The strict preview response adds `alreadyMember` and
`replacesExistingLink`; the strict consume response adds
`joinedOrganization`, `continued`, `continuationRetryable`, and
`replacedExistingLink`. A consume caller may opt into
`includeReturnTarget = true`; Core then adds the optional nullable
`slackThreadPermalink`, resolved from the exact source native delivery through
Slack `chat.getPermalink`. The permalink is a convenience projection, not
identity, membership, continuation, or native-delivery authority. Lookup
failure is logged and returns `null` without rolling back any completed link or
continuation. Core omits this additive field unless the caller opts in, so an
older strict Web consumer keeps its frozen response shape while Core rolls out
first. A newer Web consumer accepts an omitted or nullable field while older
Core is still deployed. Their consumer schemas supply rollout defaults for an
older Core producer: an omitted `alreadyMember` means `true`, because the
previous flow admitted only current members, while the other omitted fields
mean `false`. Auth is the only
Organization membership writer: it may add a verified signed-in account as an
ordinary member of the non-personal Organization only after Core claims the
private token for that account and before Core consumes it. Core then reads the
source delivery's existing durable execution-recovery request, replaces the
connected-member sender with the verified member, and submits one new Slack
turn under a deterministic idempotency key.
The original terminal worker request remains cleared, and the token never
becomes native-delivery authority. If the attempt reaches a known terminal
failure, Core may atomically advance the token's retry generation to derive a
new deterministic submission key. Native delivery remains the execution truth.
If source-delivery recovery throws after membership and identity linking
succeed, Core logs the bounded failure and returns the completed link with
`continuationRetryable = true`; it does not report the setup itself as failed.

Migration `0096_lovely_roland_deschain` begins the same contract for Lark and
Feishu. It adds the source native-delivery id,
`continue_request | optional_setup` purpose, and continuation retry generation
to Message Channel identity-link tokens. Legacy
unexpired tokens are retained as `optional_setup` tokens with a non-authorizing
legacy source marker; they may connect an account but cannot continue an old
request. New blocking tokens are issued only after the exact frozen connected-
member delivery's result is confirmed and are sent through a deterministic
provider publication UUID to a private interactive card. Preview and consume
preserve the signed-in
account through login, Auth alone may enroll the verified account as an ordinary
member of the non-personal Organization, Core consumes the token and writes the
provider identity link, and one new verified-member Message Channel delivery
continues the original request in the same conversation. A known pre-execution
continuation failure advances the token generation before the same user may
retry. Consumed tokens remain readable only through the exact provider identity
link for that OpenMeld user until expiry; they never become native-delivery or
tool authority.

The Message Channel connection-list response may include the Core-owned
`identityLinks` projection. Each row exposes only an opaque link id, provider,
mapped OpenMeld user id, nullable exact provider-account email, provider-account
display name, and connection time; it never exposes the provider user id or
token. The email is optional display metadata resolved by Core from the exact
linked provider identity and never inferred from the display name or provider
identifier. The opaque id is stable for the provider, connection, and provider
user tuple and is the only Web deletion target. Deletion authorizes either the
mapped signed-in member or an
Organization role with Channel-disconnect permission, re-resolves the target
inside the active Organization, removes only the exact mapping, and returns the
refreshed strict connection-list response. It never disconnects the provider
Channel, assigns a replacement member, or mutates Auth membership.

This additive HTTP/RPC rollout is receiver-first: deploy the new Web schema and
UI, then Gateway, then Core. New consumers default omitted `identityLinks`,
`providerAccountEmail`, `replacesExistingLink`, and `replacedExistingLink` to
empty, null, or false, so they remain compatible with old Core. Old strict
consumers may reject those new fields, so Core must not emit them before Web and
Gateway are ready. Before the Core step, the new Web sees no mappings and
therefore exposes no deletion caller or provider-account email. No Auth, PostgreSQL
migration, CLI, OpenMeld Service, Runtime Transport,
Prepare, Wake, Space Action, status, trace, diagnostic, or self-rescue contract
changes; existing local components continue without an update. Rollback first
stops the new Core fields, then rolls Gateway and Web back so no old strict
consumer observes an unknown response field.

The agent-assisted account-connection increment stays inside the existing
provider-neutral handoff contract. `messageChannelParticipantIdentitySchema`
may carry the current provider account email when the provider returned it.
That email is untrusted comparison context, not identity authority.

The `message_channel_identity_link` navigation target may carry optional
`connectToUserId` and `requestedAction` details. Remote Agent can copy only an
exact `userId` from the current Organization directory response after its own
account comparison. It must not invent an id. `requestedAction` comes from the
same-submission personal boundary tool, is bounded to 160 characters, and lets
the provider-private guidance name the exact blocked action. Core authorizes the
exact current connected-member delivery, rechecks that `connectToUserId` is a
current member of the same Organization, and pre-claims the existing
provider-private token for that user with a frozen `current_member`
requirement. Older targets without either field keep the existing
`allow_enrollment` sign-in or sign-up flow and generic private guidance. A
claim made later by the person opening a generic token does not change that
requirement.

Auth owns current user and membership. Core owns delivery authorization,
provider connection validation, token claim, and orchestration. The current
Slack or Lark-platform identity-link repository owns the canonical exact
mapping. Remote Agent reasoning, a Channel reply, the private button click, and
provider profile fields cannot write a link.

The mutation remains idempotent for the same token and intended user. A
different signed-in user, conflict, expiry, changed connection, lost
membership, or dependency-unavailable read fails closed. A successful
confirmation creates one new verified-member continuation turn; it never
upgrades the source turn or another participant in the same thread.

Roll out both directions explicitly. Deploy the shared schemas plus Web and
Gateway error consumers first. Deploy Remote Agent next so it accepts the
optional provider email and probes Core with capability version `1` before it
ever sends a selected account. Against an older Core, the missing
`messageChannelAccountTargetSupported` flag makes Remote Agent discard both the
suggested `connectToUserId` and `requestedAction`, preserving the existing
generic connection action.
Deploy Core last so it may advertise target support, accept capability version
`2`, pre-claim tokens, and begin emitting the optional provider email. Rollback
stops the Core producer before removing the Remote Agent receiver. Slack and
Lark/Feishu presentation adopt the direct account-connection copy with the Web
consumer. Lark/Feishu code can be statically reviewed before this rollout, but
production enablement still requires a real provider smoke when quota becomes
available.

Migration `0096_lovely_roland_deschain` also adds the one-account claim fence
before Auth enrollment. Unconsumed legacy rows begin unclaimed; consumed rows
recover the exact linked OpenMeld user as their claim owner and consumption
time as their claim time. Rows without matching consumed-link evidence are not
migrated. A different signed-in account therefore fails before Auth can add
Organization membership.

Migration `0097_last_squirrel_girl` adds the frozen
`allow_enrollment | current_member` requirement to Slack and provider-neutral
tokens. Existing rows are `allow_enrollment` because account-target selection
did not exist when they were issued. New agent-selected targets are
`current_member`, so removal from the Organization after issuance fails closed
instead of silently reenrolling the account.

This extension is consumer-first because the service bindings and Web responses
use strict schemas. Deploy migrations through `0090`, then Web and Gateway
consumers, then Auth, then Core, with Remote Agent prompt behavior deployable
after Core.
Current Remote Agent authorizes identity links once using capability version 2,
including any selected account. It requires both provider-neutral identity-link
and account-target support before recording the target. It does not retry a
Slack-only request or discard an unverified selected account to produce a
generic action. The directory supports `matchedBy = "identity_link"`.
Rollback stops Core production before removing Gateway or Web consumers; the
additive PostgreSQL columns may remain.

For the provider-neutral completion, apply migrations
`0096_lovely_roland_deschain` and `0097_last_squirrel_girl`, deploy the shared
schemas and Web consumer, then Auth's generic Message Channel enrollment RPC,
then Core's token
issuer/consumer and private-card publication, and finally the Remote Agent
target producer. The authorization RPC negotiates the generic capability
explicitly: an older Remote Agent omits the capability version, so new Core
returns only the legacy Slack field that its strict schema accepts; a current
Remote Agent sends version `1` before Core returns the new provider-neutral
field. Rollback removes the Remote Agent producer before rolling back Core,
then removes Auth or Web consumers. Slack's legacy `slack_identity_link` input
remains accepted during the mixed-version window, but new model-facing behavior
uses `message_channel_identity_link` for every provider.

An all-terminal Routine resume adds optional `trigger.continuation` evidence to
that same strict Routine variant. It does not change sender authority,
destination, Routine id, or Run id. Core emits it only after the initial
delivery has registered the continuation and reached an intermediate terminal
callback. Current Core supports at most one such resumed Center Agent delivery
per Run. PostgreSQL atomically claims the exact continuation delegation id before child
work is created; replaying that id is idempotent and a different second id fails
closed. Other Routine resume modes fail closed.

The six private Center Agent Routine RPC inputs carry strict action fields plus
the Core-authored request context and verified `speakerMember`. They do not
accept a caller-selected role, organization, on-behalf-of identity, or
confirmation token. Core resolves and enforces represented-member authority.
Ordinary explicit create/update/pause/resume requests require no second
confirmation. Interactive Routine deletion uses a Remote Agent-owned one-time
token bound to the issuing submission, represented user, Organization, action,
exact input, and any selected external execution identity; the private Routine
RPC remains unchanged and receives a call only after that gate. Routine
deletion during a Routine Run is unsupported and returns
`routine_destructive_action_unsupported` before the directory read or delete
RPC. Free-text Routine instructions never become RPC authorization evidence.

Routine rollout has three independent Remote Agent strict windows:

- W2 deploys the Remote Agent Routine-envelope consumer that accepts
  `delegatedBy`, the rollout-optional frozen destination, and Slack locators
  before Core emits those Routine turns;
  rollback removes the Core producer first.
- W5 deploys Core's six private receiver methods before the Remote Agent exposes
  their interactive callers; rollback removes the callers first.
- W6 deploys Core's worker response-union reader before Remote Agent emits the
  structured admission-rejection variant; rollback removes the Remote Agent
  producer first. Thrown service-binding failures remain outcome-ambiguous and
  keep bounded idempotent recovery.

Complete native PostgreSQL migration acceptance before producers. The baseline
includes the original D1 Routine schema chain (`0025`, `0026`, `0035`, `0036`,
`0063`, `0064`), including action grants and the one-continuation claim. Do not
replay that D1 sequence. Deploy Core's optional create/update input consumer
before the Remote Agent starts sending `authorizedActions`; deploy the Remote
Agent consumer that accepts optional Routine continuation evidence; deploy Core so the Slack
queue consumer exists and no-contract
Routine RPC calls still return v1; deploy Gateway so Slack starts enqueueing and
the practical query is routed; then deploy Web and publish the CLI consumer.
Rollback reverses producer order: remove Web/CLI practical callers, then
Gateway's queue producer, then Core's new turn producer, and only then the
Remote Agent consumer. The short Remote-Agent-before-Core window may reject a
new practical Routine tool call visibly, but existing Slack turns and legacy
Routine clients continue to work. Missing receiver methods and strict shape
mismatches fail closed; do not add an unversioned fallback payload or alternate
authority path.

The completed W2 contract now requires `delegatedBy` on every Routine envelope.
Core already emits it only after reauthorizing the current member. When rolling
this stricter consumer into an environment that may still run a pre-W2 Core,
deploy the current Core producer before the Remote Agent worker. New Core
remains compatible with an older worker that accepted the field; an older Core
Routine submission to the new worker fails visibly at schema admission instead
of running with reduced connector authority.

### Connector Connection Contracts

`packages/schemas` owns the shared App service registry plus connection list,
authorization start, credential submission, disconnect, reconciliation, Center
Agent selection, connector-action audit payloads, and the recoverable connector
action operation read and write contracts. The request signature binds a stable
model-supplied operation ID to the selected connection, service, action, and
action input. The read contract lets an exact retry recover that frozen
connection before current availability checks. The read and write responses
carry an optional non-secret execution-connection snapshot with its frozen
connection name, service, scope, owner user id, and owner display name. It is
nullable only for operation rows created before this additive rollout. Remote
Agent then rebuilds the same signature, uses that snapshot for replay
attribution, and replays the existing `attempted` write so Core verifies the
exact request before provider replay. The write contract carries the provider
execution ID and explicit pending or final status. The executor
connection name is constrained to OpenConnector's 64-character
`[A-Za-z0-9_-]` alias contract. Core preserves the readable Organization and
owner prefix and uses a deterministic hash suffix when a long service name
would exceed that limit.

The completed `linear.create_linear_issue` write carries one validated,
provider-typed issue receipt. Core stores this bounded reference in the
connector operation, and the same requester-scoped read returns it for
association-only recovery without another provider create. Older operation
rows have no receipt and must never be replayed as a new Linear create after
completion. A pending or outcome-unknown operation may use the same provider
idempotency key only while OpenConnector's 24-hour replay retention is safely
current; older or undated operations require reconciliation. Apply the
additive receipt-column migration before the Core reader and writer, then
deploy Core before a Remote Agent caller sends the receipt. An old Core rejects
the new completion field, so this order is required before enabling Linear
issue creation through the new Remote Agent.

`packages/schemas/src/schemas/runtime/openconnector-runtime.ts` is OpenMeld's
pinned runtime validator for OpenConnector action metadata. It mirrors the
OpenConnector `/v1/actions?service=` serializer and the bounded
`/v1/actions/search` projection, including required schemas, provider
permissions, the executor-owned `execution` projection, and optional
`operationType = read | write | destructive` metadata. Remote Agent normalizes
this field to its internal `effect` policy field, accepts legacy `effect`, and
rejects entries where both fields disagree. Remote Agent must
fail closed on a malformed entry and may expose only
`execution.locallyExecutable = true` actions to the model. Catalog-only entries
are provider documentation, not executable Center Agent capability. The same
module validates OpenConnector action-operation metadata so Remote Agent does
not hand-interpret provider execution IDs, idempotency keys, or replay flags.
It also validates the successful action envelope's JSON data and execution
metadata and the optional execution-owned `outputSchema` returned by the pinned
OpenConnector serializer. Remote Agent retains that schema; only legacy
envelopes without it use the verified action catalog schema. Unknown fields and
invalid action or execution identities still fail closed. A replay can
recover the provider result without consulting a catalog that may have changed
or become unavailable, so its result may omit `outputSchema`.
Remote Agent recognizes destructive legacy action IDs or names as well as
`effect = destructive`; conflicting read/write metadata cannot downgrade a
legacy destructive action. This vocabulary classifies the action's effect only
and never parses user or Routine text as authority. Interactive destructive
actions use the shared one-time confirmation. A new Routine destructive action
returns `routine_destructive_action_unsupported` before a new operation claim or
provider execution. Recovery reads an exact existing operation before current
catalog and policy checks, and may replay only that same idempotent provider
operation; recovery never authorizes new destructive work.

The internal `pluginRuntime` list request accepts an optional `actionId`. Core
uses it for execution admission, and Remote Agent requests the same exact ID
when it verifies execution metadata again. OpenConnector's additive
`/v1/actions?service=...&actionId=...` filter preserves current policy checks.
Remote Agent still checks the ID, service, and executable metadata if an older
producer returns the complete catalog. No permission or connection result is
cached. Deploy the Remote Agent receiver before the Core caller that sends this
optional field. An older strict Remote Agent receiver rejects it. Rollback Core
first. This changes no CLI, Service, Skills, setup, Wake, or public response
contract and requires no local-component version bump.

#### Selected Git connection transport integration

`services/remote-agent/connectors/github-connection-transport.ts` owns the
Plugins host adapter for Git read requests. It is an integration entrypoint,
not an enabled native Computer command. The Computer owner must bind each
request to an active operation and its exact repository before calling
`forwardGitConnectionRequest`. Pass the connection snapshot selected by Core.
The required `authorize` callback must recheck execution access and resolve
that same connection through Core with `includeAccessPolicy: true` on every
advertisement and upload-pack exchange. It returns the existing
`centerAgentConnectorConnectionSelectionSchema` response. Never use an
automatic connection preference after the operation selected an identity.

The adapter verifies current read permission, Organization, member ownership,
scope, alias, active status, and `updatedAtMs` against that snapshot. A changed
or revoked connection fails the new request. OpenConnector derives the same
canonical alias from verified Organization/requester IDs and the selected
scope. Member connections use OAuth or API tokens. Shared GitHub connections
use the existing App installation token resolver. Credentials stay with
OpenConnector. The host replaces request credentials, cookies, and selector
headers rather than forwarding them from the Computer. Both request and
response remain byte streams. Abort signals propagate to the upstream fetch.

The adapter requires the distinct OpenConnector endpoints
`/v1/openmeld/git-connections/:owner/:repo/info/refs` and
`/v1/openmeld/git-connections/:owner/:repo/git-upload-pack`. An older producer
fails without substituting the legacy personal-only endpoint. The OpenMeld
deployment overlay allows GitHub only for these fixed read-protocol routes.
The upstream route still authenticates the configured runtime bearer and
checks current runtime policy. Ordinary proxy and MCP policy remain blocked.

Integration order: merge the OpenConnector endpoint, update the reviewed pin
in `config/openconnector/github-working-copy-policy.mjs`, deploy that producer
with the overlay, then enable the Computer consumer. The current pin does not
contain the selected-connection endpoint. Keep this consumer disabled until
that dependency is delivered. Computer owns native `git clone`/`git fetch`,
process start, progress, cancellation, exit, and cleanup. Its integration must
verify both member and shared connections, concurrent accounts, revocation,
and existing independently authenticated CLI use through real commands.

The Core connector-operation read must be deployed before the Remote Agent
consumer. For the execution-connection snapshot rollout, apply the additive
database columns first, then deploy the Remote Agent consumer that accepts the
optional field, deploy Auth with the shared owner-display projection, and
finally deploy the Core producer. A new Remote Agent remains compatible with an
older Core response and preserves legacy replay behavior without re-resolving a
connection. Deploying the Core producer before the new Remote Agent would make
the older strict response parser reject the additive field. Deploying Core
before Auth would make new shared-connection claims fail closed because Core
does not fall back to Auth-private tables. Rollback stops the Core producer
first, then may remove the Auth projection and Remote Agent consumer; the
additive database columns remain in place. The corresponding OpenConnector
runtime must support durable operation replay before current action,
connection, and executor availability checks.

Connection lists, Core records, selections, and audit payloads carry non-secret
ownership and attribution only. API keys and custom credentials cross the
authenticated Web-to-Gateway request boundary only long enough for Gateway to
configure OpenConnector; they never enter Core reconciliation, connection-list,
selection, or audit payloads. The connection payload carries `member` or
`shared` scope. Selection may return `requester` for the verified member's own
connection or `shared` for the Organization-controlled connection; it must
return no connection instead of lending another member's connection.

The shared preference vocabulary is `automatic | requester | shared`.
Ordinary non-GitHub Plugins may use `automatic` for requester-first,
shared-second selection. Every dedicated GitHub tool instead exposes required
`githubActor = requester | organization`; Remote Agent maps it to
`requester | shared`, and Core rejects `automatic` for GitHub. Missing exact
access returns no connection rather than falling back. Routine and
member-research schemas reject requester GitHub execution.

GitHub App installation setup uses the shared start, setup-query, verification,
and pending-installation schemas. The public state is an opaque `githubapp_`
value with 32 random bytes and a ten-minute lifetime. Core binds its digest to
Organization, user, Center Agent profile, and target connection. GitHub's public
setup callback accepts only the installation id, optional setup action, and that
state. After Core transitions the record to `verifying`, Gateway starts a
temporary OpenConnector user authorization and polls only the same authenticated
Organization and user. OpenConnector verifies that the user can see the
installation, configures the final installation credential, deletes the
temporary verifier credential, and only then may Core mark setup complete. No
shared payload carries the GitHub App private key, OAuth client secret, user
token, or installation token.

Web opts into the installation expiry only on the shared GitHub authorization
request with `includeAuthorizationExpiry=true`. Gateway returns Core's
`expiresAtMs` only for that explicit request. Calls without the opt-in retain
the legacy strict response shape, so an older Web client can run against the
new Gateway without rejecting an unexpected field. The new Web must be deployed
only after Gateway understands the opt-in. Roll back Web before Gateway.

Deploy the OpenConnector installation verifier and token minter first, then the
Core PostgreSQL migration and Core, then Gateway, Remote Agent, and Web. New Core remains
compatible with old callers that never start a GitHub App installation. A new
Gateway or Remote Agent against an old dependency fails closed; it must not
recreate the OAuth App connector path or reinterpret a member connection as an
Organization installation.

When the shared service enum expands, deploy Core before Gateway and Remote
Agent, then deploy Web. New Core remains compatible with GitHub-only clients.
A new Gateway or Remote Agent against an older Core fails closed when that Core
rejects the unfamiliar service; it must not bypass Core through OpenConnector
or treat an executor connection list as authority.

Every Web App connection list, authorization, credential, and disconnect request
carries the route-resolved `expectedOrganizationId`. Core compares it with the
authenticated active Organization before reconciling registry state or starting
an executor mutation. A mismatch fails closed with
`connector.organization_context_changed`; cached Web scope and an
OpenConnector connection list are never Organization authority.

### Wake Stop HTTP Contracts

The accepted-result publication phase uses the shared eligibility variant
`controlMode: openmeld_owned_publication_cancel` with
`reliability: openmeld_owned_publication`. Core obtains that policy projection
from RuntimeCoordinator's read-only
`/runtime-coordinator/wake-stop/publication-eligibility` endpoint, which reuses
the shared Wake Stop request scope and nullable eligibility schema. It does not
pretend a retired local execution has native Controller cancel capability.
Web consumes the server eligibility and must not infer it from progress text.

Rollout is consumer-first: deploy the Web/Gateway readers built with the
expanded eligibility union before Core emits it, and refresh already-open Web
clients. Older clients that explicitly request eligibility have a strict union
and cannot decode this new variant. Published CLI commands do not opt into
`includeWakeStopEligibility`; their response shape stays unchanged. Setup,
Service transport, Agent skills, and Stop mutation payloads are unchanged, so
no local-component contract floor is raised. A missing internal eligibility
receiver fails closed with null rather than granting a client-side fallback.

`packages/schemas/src/schemas/http/space-wake-stop.ts` owns the shared POST
contract for Wake Stop. Clients may submit only Space-visible selectors:
`sourceSignalId` or `clientMessageId + targetProfileId`. `dispatchId`, local
task ids, execution tokens, and adapter ids stay internal to Core,
RuntimeCoordinator, RuntimeTransportHub, and the local OpenMeld Service.

`packages/schemas/src/schemas/http/space-wake-progress.ts` owns the Wake
progress read model, including the optional `startedAtMs` timing projection and
the optional `wakeStopEligibility` projection. This existing nullable field is
a viewer-scoped projection of authorization and stopping capability. Null means
no Stop control is available to this viewer; omission means it was not projected
and must not grant authority. Core filters eligibility through the same policy
that protects `POST /v1/spaces/:spaceId/wake-stop`. Unauthorized Stop requests use
the existing HTTP 403 error envelope with `space.wake_stop.forbidden`. No new
runtime payload or local-component contract is introduced.

A caller may also opt into
`sourceContext`, which contains only the Space-owned requester Profile ID, kind,
display name, sanitized public source-message preview, and nullable thread ID.
Active reads may filter by one `sourceProfileId`. New dispatch-ledger and native
delivery rows retain that immutable source Profile ID only as a bounded query
selector; it is not identity authority or public source context. Legacy
dispatch rows may match through bounded active-outbox dispatch IDs. Every
lifecycle-owner filter runs before ordering and limiting, and Core must never
scan the requester's unbounded Space message history.
The response query must echo the accepted `sourceProfileId`. A new client that
requested this filter fails closed when the echo is absent or different, so an
older Gateway or Core cannot silently return an unfiltered result.
Callers may opt into bounded result metadata with `includePageInfo=true`.
When requested, Core returns `pageInfo.limit` and `pageInfo.hasMore`; a new
client fails closed if an older Gateway or Core omits that metadata. Core omits
`pageInfo` when it was not requested so older strict clients remain compatible.
This public context is a read-time join over existing Space truth. It is not
copied into an execution owner, cannot authorize or advance work, and never contains
provider prompts, transcripts, or other private runtime context.

The contract may also expose the bounded
optional `waitReasonCode=runtime.agent_controller_conversation.occupied` from
RuntimeCoordinator lifecycle evidence. Clients request that projection with
`includeWaitReason=true`; Core must omit the field entirely when the caller
does not opt in. That neutral projection never exposes
the controller conversation id, does not grant execution authority, and must be
cleared when the latest occupancy transition is `available`. The timing, wait
reason, and Stop projections are
mixed-version opt-in: clients request authoritative elapsed-time timing with
`includeTiming=true`, the occupancy wait reason with
`includeWaitReason=true`, and Stop eligibility with
`includeWakeStopEligibility=true` on Wake progress and active Wake progress
reads. Public source context is similarly requested with
`includeSourceContext=true`, and live reply preview text with
`includePreviewText=true`. Core must omit each field when the corresponding
request does not opt in, so new Core does not break older strict clients. `startedAtMs` is the
authoritative execution start anchor while `updatedAtMs` remains freshness and
ordering evidence. A new client must omit elapsed time when `startedAtMs` is
missing, and must treat a missing `wakeStopEligibility` field as not eligible
before exposing a clickable Stop control.

The timing rollout is Core receiver/producer first, then Gateway forwarding,
then Web opt-in. Old Gateway ignores the unknown browser query and old Core
never receives it; new Gateway must not forward `includeTiming` to an old Core
strict RPC input. Existing CLI versions do not send `includeTiming=true`, so
new Core preserves their previous strict response shape. These additive timing
and public source-context HTTP/RPC projections change no OpenMeld Service,
daemon, Prepare, Runtime Transport, RuntimeCoordinator authority, or
local-component contract version.

The occupancy wait-reason rollout is Web receiver first, then Core producer.
The field is optional so new Web remains compatible with old Core; an old
strict Web response parser must not receive the additive field before the new
Web is live.

Wake Stop eligibility is a read model, not execution authority. It may make a
Wake appear stoppable only when Core can project one of four control modes:

- OpenMeld-owned pre-agent Stop, for a target Wake that has not linked a
  RuntimeCoordinator execution and has not reached local agent delivery.
- Controller-backed running Stop, for a linked execution whose controller can
  accept native cancel or native interrupt.
- OpenMeld-owned publication Stop, after RuntimeCoordinator accepts the local
  result and before its final outcome settles, without current Controller control.
- Remote Agent native-delivery Stop, for one active hosted submission whose
  durable execution identity can be cancelled through the Remote Agent worker.

Transient thinking and preview signals update presentation only. They preserve
an already-read viewer-scoped Stop projection for the same active dispatch and
target; they never create eligibility or carry it to another execution. A full
Core snapshot still replaces the projection, including null or omitted
eligibility. The Stop mutation always rechecks current authorization and control.

Pre-agent and Remote Agent native-delivery Stop responses may succeed without a
`runtimeCoordinatorExecutionId`; the response must still carry an explicit
`stopMode`, and stopped progress must come from Core/RuntimeCoordinator or the
Remote Agent durable execution facts, not Web-local state.
`cancellation_requested`, frame delivery, socket write
success, route lookup success, and pre-agent guard writes are not enough by
themselves to claim a visible stopped outcome; Core must also publish or observe
the stopped Space notice. For linked running executions, once RuntimeCoordinator
has accepted a user Wake Stop intent before visible reply finalization, later
success replies must be recorded as suppressed stopped diagnostics and must not
replace the stopped outcome.

Web and CLI consume Wake progress and Stop through `packages/api-client`; a CLI
must not reproduce these HTTP paths or response unions locally. A CLI Stop
preflight may narrow the presented control surface by requiring an eligible
progress item, but it does not grant authority. `cancellation_requested` is a
pending server response, while only `cancelled` or `already_cancelled` confirms
cancellation to the caller. The public stopped Space outcome remains owned by
Core and RuntimeCoordinator.

### Space Access Context Propagation

`packages/space` owns `SpaceAccessContext`, the structured Space access contract
used by Core RPC, Space Durable Objects, dispatch continuation, and internal
Space request reuse.

`SpaceAccessContext` is not equivalent to `OpenMeldRequestContext + Space password`.
The request context and password are lossy projections for wire transport. They
do not preserve the access actor kind or actor-specific authority. In
particular, a `dispatch_continuation` access actor carries the dispatch id,
source signal id, target profile id, and attempt identity that make an internal
Wake continuation auditable and narrowly authorized. If that actor is flattened
to ordinary authenticated headers, the Space can no longer distinguish the
continuation from a generic authenticated request.

Rules:

- When an input type accepts `spaceAccess`, every Core RPC, Gateway bridge,
  Space DO direct-RPC method, helper, and adapter in the call path must pass that
  `SpaceAccessContext` through unchanged until the Space access owner authorizes
  it.
- Do not drop `spaceAccess` because `context` and `password` are also present.
  `context` and `password` are fallback wire facts, not a replacement for the
  structured access authority.
- Do not rebuild a `SpaceAccessContext` from headers, `context`, or password
  when the caller already provided one.
- Direct RPC inside Core/Space may reuse HTTP handlers for parsing, but it must
  preserve structured access out-of-band, such as by passing `spaceAccess`
  through handler options. Headers are only the external HTTP wire projection.
- Any `spaceAccess.spaceId` mismatch must fail closed before the Space method
  runs.
- Tests for Space RPC helpers that accept `spaceAccess` must assert that actor
  kind survives the full path, including `dispatch_continuation`, not just that
  `context` and password reached the next function.

Schema rules:

- Use `zod/v4`.
- Use `safeParse` on runtime and request paths.
- Avoid uncaught `parse` in production flow.
- Use `z.strictObject(...)` by default.
- Document any relaxed object boundary.
- Adding a field to a shared `strictObject` response breaks already-published
  clients that validate with the frozen schema. Evolve response schemas
  opt-in: add new response fields as `.optional()` without defaults, and
  deploy consumers before producers (Web, then Gateway, then Core) so no
  frozen client ever receives an unexpected field. Published CLI versions can
  never be forced to update first.
- The Center Agent Audit Log applies the same rule to its closed action enum.
  Requests without an action-set opt-in retain the legacy actions;
  `actionSet=v2` additionally includes Slack channel publication; and
  `actionSet=v3` additionally includes Organization-member additions; and
  `actionSet=v4` additionally includes Organization document reads and draft
  submissions; and `actionSet=v5` additionally includes connector write
  attempt, completion, failure, and outcome-unknown evidence; and
  `actionSet=v6` additionally includes Slack workspace-directory reads; and
  `actionSet=v7` additionally includes Slack public-message searches;
  `actionSet=v8` additionally includes Project actions; `actionSet=v9`
  additionally includes exact task-watch actions; `actionSet=v10`
  additionally includes controller-task discovery; `actionSet=v11` adds member
  Service-status reads; `actionSet=v12` adds Slack channel reads;
  `actionSet=v13` adds Center Agent operating-state actions;
  `actionSet=v14` adds Local Agent-carried requests; `actionSet=v15` adds
  Context Manifest reads; and `actionSet=v16` adds Context Load Receipts and
  opt-in manifest/load counts; and `actionSet=v17` adds Routine create, update,
  pause, resume, and delete rows; `actionSet=v18` adds Organization working
  language actions; `actionSet=v19` adds member Computer reads; and
  `actionSet=v20` opts in to the connector audit entry's nullable
  `sourceSpaceId` projection; and `actionSet=v21` adds Slack file reads and
  file publications. Interaction-source projections remain absent
  before v14, Routine actions remain absent before v17, Slack file actions
  remain absent before v21, and `sourceSpaceId` remains absent before v20. The
  projection is non-null only for a native delivery whose `conversationKind`
  is `space`; Slack and generic Message
  Channel locators never populate it. Each version filters later actions and
  fields in Core before response validation, so an already-published CLI never
  receives an enum value or optional projection its frozen schema cannot parse.
- Deploy a new Center Agent RPC receiver and its audit action-set reader in Core
  before deploying the Remote Agent caller or clients that request the new
  action set. During rollback, remove callers first. Once Core has written a new
  durable audit action, keep that Core reader and its older action-set filters
  deployed until those journal entries no longer exist; rolling Core back below
  the durable enum is not compatible.
- Do not use implicit coercion.
- If coercion is required, make it explicit and test it.
- Preserve existing external error-code semantics.
- Add parity tests before parser migrations or shared-contract extraction.
- Cover success, failure, and boundary cases.

Schemas are not business execution authority. They validate and normalize
contract boundaries so the owning domain can make the decision.

## Agent Controller Interface Evidence

Agent Controller Interface (ACI) evidence is a shared runtime contract because it
crosses local OpenMeld Service, CLI, Core, Web, Desktop, and future client boundaries.

`packages/schemas` owns the ACI snapshot shape. Local controller adapters may
probe Codex, Claude Code, OpenCode, Cursor, Grok Build, or future controllers, but once that
evidence crosses process or service boundaries it must use the shared ACI
schema. Do not create Web-only, Desktop-only, or CLI-only ACI payloads for the
same facts.

The current shared read path is:

```text
local OpenMeld Service -> Runtime Agent Controller Report -> Core PostgreSQL projection -> listLocalRuntimes -> Web/Desktop/UI consumers
```

Desktop may also consume the local CLI JSON projection for the same facts:

```text
openmeld agents show <agent-id> --json -> agentControllerInterface -> Desktop/UI consumers
```

ACI evidence belongs on the Agent Controller capability in the local runtimes
read model. It may describe install selection, version, controller version
advisory, controller sign-in, native control capabilities, models, skills, and
diagnostics. Its optional `usageLimits` list is the one provider-capacity
contract shared by Service reporting, owner reads, Organization Computers, Web,
Center Agent, and Local Agent JSON. Each item has one stable key and label,
`usedPercent` with 0–100 used semantics, nullable `resetsAt`, `observedAt`, and
one of `available`, `exhausted`, `stale`, `unavailable`, or `unsupported`.
An optional fixed `reason` distinguishes `not_authenticated`, `not_applicable`,
`not_reported`, and `refresh_failed`. It contains no free-text provider error,
account identity, subscription tier, or payment facts. An `unavailable` item may
retain a provider-reported reset time while its percentage remains null;
`unsupported` cannot carry a reset time. A missing percentage remains unknown
unless the verified upstream serialization contract explicitly defines its
default, as Grok's implicit proto3 zero does for an active unified billing period.
An item may include a strict `provider` descriptor containing only a stable id
and display name. This optional nesting keeps existing single-provider
controllers wire-compatible while allowing one controller such as OpenCode to
project several providers without flattening their independent capacity.
`Low` is derived by presentation code and is not stored. Missing provider facts
remain null; they must not become zero, 100, or unlimited capacity.

ACI may also carry one strict account-level `usageAdmission` object with
`blocksNewWork: boolean | null` and `observedAt`. It belongs to this same Usage
report, rather than individual windows or another readiness store. Matrix
version 6 uses that fact for Codex admission and recovery: 100% included usage
remains visible, while native account permission, credits, and spend control
determine whether new work is blocked. No credit amount, payment fact, or
account identifier crosses the Service boundary. A full unknown account read
records null; sparse native rolling updates do not clear or refresh an older
account verdict. Codex uses the same-session full native snapshot collector for
probes and rolling observations. Matching native quota account ids bracket its
account read, and an unchanged account-notification epoch fences collection and
consumption. Missing or mismatched identity discards capacity evidence. The
existing local ACI auth comparison may carry an opaque `accountKey`; cloud
allowlists and legacy `agents show` projections omit it. Legacy machine output
also omits `usageAdmission`, preserving older strict Desktop readers.
Core's non-opted-in Local Runtime responses omit admission together with windows,
including mutation responses that return the same legacy inventory.
Missing or older matrix versions cannot authorize recovery.
An older strict Core receiver may reject this optional field; the existing
report compatibility retry omits windows, admission, and matrix together.

Provider adapters may add evidence either from a dedicated native non-task
probe or from a provider-native event passively observed during an ordinary
already-running controller turn. Both sources must normalize into this same
Usage report before crossing the local Service boundary. A passive observation must
not start work, modify the turn, retain its raw event, or create a second usage
store. Claude Code's Agent SDK event is partial: a missing utilization value
creates no percentage evidence, while allowlisted 0–1 utilization is normalized
to 0–100 and all session, account, overage, credit, and payment fields are
discarded. The local Service separately confirms the current account through
the existing non-task ACI authentication probe before merging a passive event.
That owner-only comparison evidence never becomes part of the Usage Limit item
or crosses into Organization Computers; an unknown or different account fails
closed instead of reusing the observation.

Support matrix version 4 adds observational Cursor and OpenRouter collection
alongside Claude's experimental SDK control probe. Observational means display
evidence only: it cannot block new work or authorize exhausted-work recovery.
Claude account windows already use 0–100 percentages, unlike its 0–1 stream
events. The SDK probe sends no prompt and skips local behavior/transcript scans.
OpenRouter free-model request capacity is not capacity for every model hosted
by OpenCode. Native Codex rate-limit events use the existing account-bound
keeper and the same sanitized list. No new polling state or usage store exists.

Version advisory is read-only controller maintenance evidence:
current version, latest known version, advisory status, and an optional manual
update command for the install method OpenMeld detected. It must not become an
automatic Web/Desktop command runner, Agent Profile identity, Binding truth,
final Wake readiness, Space membership, or RuntimeCoordinator execution truth.
When ACI proves that a local built-in controller account is not authenticated,
the Runtime Agent Controller Report must also carry non-ready status/reason-code
evidence. Clients may render the snapshot, but Core readiness must not have to
rediscover that auth blocker during Wake execution.

The shared snapshot's optional `check` evidence distinguishes `succeeded`,
`failed`, and `not_run`, together with the last successful check timestamp when
known. The field is optional only for rolling compatibility with older
snapshots. A `failed` check is a current fail-closed Wake blocker with
`controller.interface.check_failed`; it is not proof that controller setup
needs repair. Clients must present it as a retryable check failure and may show
the last successful timestamp without treating historical evidence as current
readiness.

Core owns the recovery verdict in the current-local-runtime reply-readiness
response. Execution-target status, aggregate reason codes, and the recovery
verdict use enabled capabilities only. A disabled capability remains available
as row-scoped diagnostic evidence, but its status and reason codes never change
the Computer verdict. When every non-ready enabled capability is blocked only
by `controller.interface.check_failed`, Core must keep Wake fail closed with
`canReplyFromThisComputer: false` and `status: blocked`, while publishing
`nextAction: check_status` instead of `run_setup`. Clients present that verdict
as the same warning-level **Check delayed** outcome used by the affected local
agent row; they must not escalate it to repair guidance.

When the Computer reports capabilities but all of them are disabled, Core keeps
`canReplyFromThisComputer: false` and `status: blocked`, publishes
`nextAction: none`, and describes the intentional all-off state. Clients keep
that state neutral and create no Computer or navigation attention. They may
continue to show each disabled capability and its diagnostics in detail. Clients
must consume these owner verdicts for summary status and recovery actions; they
may expose raw reason codes as diagnostic or row-scoped evidence, but must not
reinterpret them into a second setup-or-retry decision.

The shared schema supports both the rich local snapshot and its cloud-bound
projection, but runtime reporting must construct the cloud projection through
one shared allowlist. The cloud projection clears local command paths and launch
arguments, controller-provided skill inventory, and
free-text local messages. It preserves the bounded controller-provided model IDs
and display names as installation compatibility evidence, plus controller
identity, coarse authentication status, the bounded authentication type needed
for Core's account-scoped model admission, optional provider email or bounded
account label, static capabilities, native interface, version/update evidence,
launch status/count, bounded check evidence, Usage Limits, and stable readiness
fields needed by Core and owner-facing clients. Provider account evidence is
allowed only because the
authenticated owner-only `listLocalRuntimes` surface needs to identify which
local account OpenMeld will use; it must not flow into Organization computer
directories or another member's read model. Authentication type is retained in
Core's report for admission and is omitted from Organization computer and owner
computer detail projections. Do not make every schema field
cloud-visible merely because a local adapter can populate it.

The optional Organization Computer model ID is additive. Deploy Web and Gateway
receivers before the Core producer, then publish the CLI and Service producer.
Older Services report an empty model list and new Web treats that as unknown, so
neither mixed-version direction disables a model without evidence. Rollback
removes the CLI and Service producer first, then the Core producer, Gateway, and
Web. Runtime Transport, Wake, Space action, diagnostics, and Binding contracts
do not change.

The Usage Limit allowlist never includes credentials, provider account identity,
subscription or payment state, balances, monetary values, history, or raw
provider responses. Core may compare already-existing owner-only ACI
authentication evidence solely to prevent last-known capacity from crossing a
provider account change; that evidence never enters the Usage Limit projection
or Organization Computers. Core derives staleness from the provider observation
time and the existing report expiry. Unsupported and never-observed unavailable
evidence remain distinct; only account-bound last-known percentage evidence
becomes stale. This projection does not change readiness, Wake, Binding,
routing, Agent Activity, or RuntimeCoordinator contracts.

Deploy the new Web/Gateway readers and Core report receiver before publishing
the local producer of optional usage reasons or partial reset evidence. Old
Services remain valid. If an older Core rejects the extended Usage shape, the
existing report compatibility retry omits Usage and its support-matrix version
while preserving the remaining controller report. It must not invent capacity
or suppress authentication/readiness evidence. Setup, Wake execution, Space
actions, and Service diagnostics retain their existing contracts.

Hard provider-account failure evidence is a separate optional task-result
contract, not a reinterpretation of Usage Limits. It uses the shared
provider-neutral provider enum and one of
`provider_account.organization_access_disabled`,
`provider_account.subscription_access_unavailable`, or
`provider_account.capacity_exhausted`. Only an accepted ordinary Wake failure
may produce it. Transient rate limits do not. Core stores it against the exact
Agent Profile, Binding, OpenMeld Service Runtime, Agent Controller, and provider,
orders writes and clears by Core's accepted-result time, and reads it through a
bounded freshness window. Therefore an older failure cannot replace newer
evidence, an older success cannot clear it, and a persisted success watermark
prevents a delayed older failure from reopening it even when no failure existed
at success time. An exact accepted-result timestamp tie fails closed in favor of
the hard failure. Deploy schema/Core consumers before publishing Local Service
and adapter producers that emit the added `capacity_exhausted` enum value.

A redacted field is not negative evidence. Clients must omit local-only command
paths that are null in the cloud projection instead of describing them as
missing or broken.

Deploy ACI check-evidence consumers in Core and Web before releasing the local
producer. Older local producers remain compatible because the field is
optional. During the reverse mixed-version window, the Runtime Agent Controller
Report retry path may omit an ACI snapshot rejected by an older strict consumer,
while its independent non-ready reason code keeps Wake eligibility fail closed.
Remove or roll back the local producer before rolling back the consumers.

For built-in Agent Controllers, `config/agents/registry.json` remains the
product catalog for detection, skills, runtime support, adapter matching, and
transport declarations. `clients/openmeld-cli/src/agents/builtin-agent-controller-definitions.ts`
owns the CLI-side static controller definition used by ACI and local launch
resolution: adapter id, launch resolver, native interface, static native
capabilities, and version-maintenance metadata. Tests must keep the supported
runtime registry entries, built-in controller definitions, and local adapter
installers aligned so adding Cursor, Grok Build, OpenCode, or another controller cannot
create parallel sources of truth.

Clients should render ACI details from these shared read models. They must not
separately probe local controllers or reconstruct ACI from private CLI
implementation details.

The shared daemon, Runtime Transport, Local Runtimes HTTP, and API-client
contracts also own current-Computer installation management. The optional
`localAgentControl.manageInstallations` capability preserves the original
owner-only list/select contract for one registered built-in agent. The additive
`localAgentControl.manageInstallationsSafely` capability states that the Service
also owns idle admission and serializes the registry write against matching
local work. Cloud callers require both capabilities before exposing or sending
a selection. The Service returns bounded installation ids, friendly
names/details, one selected id, and an additive selection status of `available`,
`blocked_by_work`, or `operation_in_progress`; only the immediate owner response
may contain path-derived details. Selection updates the local registry's launch
contract and then refreshes the canonical runtime report.

The new capability and daemon result field are optional on the mixed-version
wire, while the owner-only HTTP response requires the normalized selection
status. New cloud code stays dormant against an older Service because the safe
capability is absent. Publish Core, Gateway, API client, and Web consumers before
the new Service producer; rolling cloud consumers back after that publication is
not supported until the producer is retired. Existing setup, Wake, status,
Space Actions, and diagnostics remain compatible in both directions because
none of their established frames or projections change.

`packages/schemas/src/schemas/daemon/computer-file-access.ts` owns the strict
Computer file access mode, absolute-path, policy, current-device HTTP/RPC,
daemon frame, Runtime Transport, result, and error contracts.
`packages/api-client` owns the browser-facing client for the same current-device
surface. Runtime adapters consume the provider-neutral active boundary through
`@openmeld/adapter-core`; controller-specific compilation and capability proof
remain inside the selected adapter.

Every update request carries the policy revision returned by its preceding read
as `expectedRevision`. The local Service is the single writer: it serializes the
complete read-modify-write, increments revisions monotonically, and rejects a
stale revision with `computer.file_access.revision_mismatch`. Its persistent
idempotency history maps
each of the 64 most recent keys to the exact request fingerprint and original
result. Replaying the same request returns that result without another write;
reusing a key for different input is invalid; after history eviction, revision
CAS prevents an old state-changing request from silently restoring policy.

The current control path is:

```text
authenticated Computer owner in Web
-> Gateway current-device route
-> Core owner/current-target authorization
-> RuntimeTransportHub exact owner + device + lane + capability
-> current local OpenMeld Service policy single writer
```

`computerFileAccess` is an optional rolling capability. The Service advertises
support with the versioned `x-openmeld-runtime-capabilities:
computer-file-access-v1` WebSocket handshake header while registration and
heartbeat retain the frozen base capabilities shape. Gateway forwards only the
exact shared versioned capability value and drops unrecognized values before
the Core boundary. Core validates that handshake fact and merges it into the
existing RuntimeTransportHub session capabilities; the session remains the
single live capability authority. An older Core ignores the header and
continues accepting the unchanged strict registration and heartbeat payloads,
so a newer Service never takes existing Wakes offline during cloud rollback. A
newer Core connected to an older Service receives no header, keeps
`computerFileAccess` absent, and leaves the control dormant.

An older Service that omits the handshake capability is unsupported for policy
reads and writes; Gateway or Core must not report a successful cloud-side
setting. The Core-owned Local Runtime read model projects an optional
`computerFileAccess` control only when the current live Service advertises both
policy reads and writes. Web hides the control when that projection is absent,
so a new cloud release remains quiet and compatible with an older Service.
Policy responses may carry absolute paths only back to the authenticated owner
who made the immediate request.
Those paths are local configuration, not a cloud projection, and no PostgreSQL schema,
browser persistence allowlist, Organization record, or Agent Activity contract
may store them.

Rolling delivery remains receiver-first for feature availability: Web, Gateway,
Core, and RuntimeTransportHub accept the optional projection, routes, frames,
and negotiated capability before a Service that advertises it is released.
Until that Service is present, the new cloud path remains dormant and existing
Wakes are unchanged. The frozen base payload also makes transport rollback
safe: rolling Core back first causes the header to be ignored and removes only
the cloud management surface, without rejecting registration, heartbeat, or
existing Wakes. A Service with a non-default local policy must not be
downgraded to a version that ignores the policy; restore the default through
the capable Service first, or keep a Service version that preserves local
enforcement.

`packages/schemas/src/schemas/daemon/local-folder-picker.ts` owns Local Folder
Picker purpose, request, result, error, Runtime Transport, and daemon frame
contracts. `localFolderPicker: { selectFolders: true }` is an optional sibling
runtime capability. It is negotiated through its own versioned handshake header
instead of extending the existing Computer file access header: a new Service
therefore cannot accidentally remove `computerFileAccess` when connected to an
older strict Core that understands only `computer-file-access-v1`.

The strict result union distinguishes `selected`, `cancelled`, and
`unavailable`. Selected paths use the shared local absolute-folder schema and
preserve legal trailing spaces. `unavailable` carries a stable
`local.folder_picker.*` code and a path-free message. Product-specific state is
not part of this contract; the `purpose` field supplies bounded presentation
context but never mutation authority.

The same package owns the strict Service-to-helper subprocess result protocol.
The helper may return only selected paths, cancellation, or a stable path-free
error code. The Service validates every selected path as an existing directory
and maps helper codes to its own fixed public messages; helper stderr and
arbitrary local messages remain on the local diagnostic side of the boundary.

Rolling delivery is receiver-first: schemas, Core/RuntimeTransportHub, Gateway,
API client, and Web consumers deploy before the Service advertises the new
header. New cloud with an old Service omits the picker and preserves existing
discovery and manual-path flows. Old cloud ignores the new independent header;
the Service must not emit picker request/result frames until the negotiated
session capability is present. Rollback removes Web callers before cloud
receivers and removes the local producer last.

`packages/schemas/src/schemas/daemon/runtime-reporting-health.ts` owns the
local diagnostic state shared by OpenMeld Service reporting writers and CLI
diagnostic readers. It keeps Runtime Agent Controller reporting and provider
conversation proof reporting as distinct channels with bounded success and
failure evidence. The shape is not a Core projection and must not become
service liveness, Agent Profile readiness, or RuntimeCoordinator execution
truth.

`packages/schemas/src/schemas/prepare/session.ts` owns the shared Prepare
Session snapshot contract. Its `setupBootstrap` result is the cross-boundary
record that lets CLI, Core, and Web agree on setup bootstrap completion. Current
runs do not create a managed welcoming assistant, Welcoming Space, membership,
Binding, or welcome message; the retired fields are `null`. The schema still
accepts legacy completed results so older Prepare Session snapshots can be read
without data loss. Consumers must not assemble identity or routing from legacy
display names or incidental nested details. It must not become a new owner for
Agent Profile identity, Space truth, Binding truth, model selection, Agent
Controller selection, Agent Profile health, or Wake readiness.

An explicit Computer reconnect may carry an optional `connectedComputerId` in
the create request and snapshot. Core must verify that the authenticated owner
already owns that Computer before minting the handoff. The value identifies the
stable Computer being reconnected; `deviceId` may legitimately change when the
local service identity is reinstalled or repaired. Web therefore matches that
reconnect session by `connectedComputerId`, while CLI may forward the value only
from the trusted Prepare Session. Generic setup sessions omit the field for
compatibility with older consumers. This contract may reattach a reported
device identity to the selected Computer, but it must not create or move Agent
Profile Binding truth.

## Local Components Manifest

`packages/schemas/src/schemas/local-components.ts` owns the shared contract for
local CLI, OpenMeld Service, and OpenMeld skills component status.

The manifest is a read projection for setup and diagnostics. It must not become
Agent Profile readiness truth, Space truth, or RuntimeCoordinator execution
truth.

Clients should use the shared setup action labels instead of inventing local
copy for the same local alignment state:

- `Connect Computer`
- `Reconnect Computer`
- `Update OpenMeld on Computer`
- `Connect local agent`
- `Update OpenMeld skills`
- `Everything is up to date`

Local component update policy is the result of the Contract Impact Audit in
`developing/engineering/development-workflow.md`, not a direct inference from
whether a version string changed. In the current hard-cut phase, Service or
Skills drift may become a required local alignment action when the release
policy says old local components cannot safely continue the affected capability.
Artifact-only changes may remain advisory. CLI package updates may be advisory
unless the command contract version is incompatible or the audit finds that old
CLI behavior cannot safely continue.

The published release manifest (`cli/local-components.json` in R2, built from
the `release/local-components-policy.json` decisions) is the single source of
the current release's advisory-or-required rollout intent. Each component's
release policy is projected into exactly one channel that reaches its audience,
never authored twice. A separate compatibility floor may make Core's effective
Service projection `required` even when the latest artifact is advisory:

- Service policy is build-imported into Core, which serves the runtime Wake gate
  (`wakeBlocked`) — a post-auth, post-enrollment signal. Core also owns one
  monotonic minimum supported OpenMeld Service version. A version below that
  floor is known unable to carry current Wake work safely and must project
  `update_required` and `wakeBlocked=true`. Its user-visible `requiredVersion`
  is the newer of the compatibility floor and the current installable Service
  release, so recovery never directs a user to an older or unavailable target.
  Raising the compatibility floor requires concrete compatibility evidence plus
  Core behavior tests; an ordinary advisory release cannot lower or bypass it.
  The initial floor was `0.3.15`: Service `0.3.14` can report an online
  heartbeat without registering execution routes. The current floor is
  `0.3.217`: earlier Services do not refresh admission after update or draining
  and do not carry the required Codex MCP startup behavior. The floor blocks
  only new unsafe admission; RuntimeCoordinator keeps
  accepted work authoritative, and Service update and reconnect controls remain
  available so the Computer can recover.
  A supported version below the latest release remains advisory when
  `components.service.updatePolicy=available`.
- CLI policy is projected at release time into the published npm package as
  `openmeld.minRequiredCliVersion` (the forced-update floor), because npm is the only
  channel a CLI can read before sign-in or device enrollment. The release tool
  copies that exact tracked package field into the R2 stable manifest, so npm
  and the binary channel cannot publish different floors. A `required` release
  pins the field to at least its own version; a separately proven compatibility
  break may raise it to the first safe CLI without making every supported CLI
  below the latest release mandatory. The floor is monotonic inside a
  release line against the last-published baseline (the `v*` release tag
  created by the guarded CLI release), and `verify` hard-rejects any regression
  below the baseline — dropping the floor silently un-gates old CLIs, which is
  exactly how the 0.7.95 floor regression shipped. The current floor is
  `0.3.126`: earlier CLIs belong to the same pre-recovery generation as the
  unsupported Service and cannot be trusted to provide the startup recovery,
  managed-update, and active Permission/Wake behavior that the current
  workstation flow requires. This is a compatibility floor, not a latest-
  version requirement; supported CLIs at or above `0.3.126` remain advisory
  when `components.cli.updatePolicy=available`.
  The one explicit exception is the initial `openmeld-greenfield-2026-07`
  reset: OpenMeld's greenfield product line starts at `openmeld@0.1.0` before
  public npm publish, so the inherited ATS `0.7.x` floor does not carry into
  the new line. After that marker lands on `main`, future release-line changes
  do not bypass floor monotonicity.

The local update-operation schema keeps `targetVersion` as the required legacy
aggregate target and adds optional `targetCliVersion` and
`targetServiceVersion`. New producers set both split targets. Mixed-version
readers fall back independently to `targetVersion` when either optional field
is absent, so old operations remain readable while new CLI-only releases can
name an older selected Service without manufacturing version equality. These
fields describe one operation's expected observations; they do not create a
second release-policy, Service-health, or Wakeability owner.

- Skills policy is build-imported into Core and compared with the OpenMeld
  Service's reported `localComponents.skills.installedBundleHash`. That reported
  hash is the installed OpenMeld-managed skills artifact hash, not the per-target
  user store result from `openmeld skills check`. A self-contained OpenMeld
  Service bundle may not contain `skills/`; in that case local component
  reporting must resolve the active bundle source package's `skills/` directory
  before falling back to the installed local-components snapshot. Otherwise Core
  receives a missing installed hash and Web shows a false skills update even when
  the user's `~/.openmeld/skills` targets are current.

  Operational note (first `required` release): `openmeld.minRequiredCliVersion` is a
  custom npm field; the gate only works if npm preserves and serves it on the
  `latest` packument. This holds today via the existing `openMeldReleaseDate` custom
  field, but it is an external assumption — on the first release that flips
  `cli.updatePolicy` to `required`, verify the field is actually live on npm
  after publish (the release tool prints the exact check). If npm ever strips
  it, the gate silently never fires; fall back to a dist-tag floor.

The CLI required-update floor is the CLI-side equivalent of the Service Wake
gate. It must fail open (any failure to resolve the floor lets the command run)
and remains strictly a setup/lifecycle gate — it must not become Agent Profile
readiness, Space, or RuntimeCoordinator execution truth. In particular it must
never take down the local OpenMeld Service's own lifecycle/liveness surface:
`service run` (the daemon's runtime entry — blocking it crash-loops the service
under launchd/systemd) and the `service status` / `service snapshot` liveness
probes are exempt, as are `openmeld doctor`, `openmeld --version`, and the self-rescue
commands (`upgrade`, `auth.*`, `reset`, `uninstall`, `repair.local-state`).
Commands running inside a dispatch-owned runtime (the headless agent the daemon
spawns for a Wake turn, which acts only through nested `openmeld space ...` calls) are
exempt for the same reason `service run` is: a breached floor would block the
agent's every action mid-turn — woken but unable to reply — and a headless agent
has no tty to upgrade. This exemption is keyed on the runtime mode, not the
command name. Service version compatibility is enforced by Core's monotonic
Service floor and the Service Wake gate, not by failing these commands.

Core's local-component projection and the production CLI download channel are
two projections of one release, not two policy owners. The published release
manifest owns the declared component versions and update policy; Core exposes the server-required projection, while the R2/Web manifest
and binary URLs prove that the declared CLI is actually installable. CLI status
may reconcile those views for diagnostics, but it must not invent a third
requirement or choose whichever view is more convenient. The publisher writes
the release manifest only after the channel it declares is downloadable; a newer compatible channel may precede Core during an intentional
rollout.

`packages/schemas` also owns the public CLI binary manifest and exact-base delta
payload. Raw executable metadata remains mandatory for compatibility. Gzip
transport, Apple signing identity, and delta records are additive, but each
optional field group is all-or-none. A delta names one exact base version,
size, and sha256; it is never a fuzzy compatibility claim. Consumers must
verify the compressed patch, validate the shared payload, reconstruct a
temporary candidate, verify the final executable metadata, and fall back to
the complete gzip artifact on any delta failure.

## CLI `--json` Output Contract

`packages/schemas/src/schemas/cli/json-output.ts` owns the contract for the CLI
`--json` machine-readable stdout envelope (`cliJsonOutputEnvelopeSchema`): the
schema version, the closed `type` discriminant set, the failure-envelope shape,
and the entry-check blocked-code enum.

This is the CLI JSON boundary a non-interactive driver (Desktop GUI, scripts, CI)
parses. The CLI derives its envelope type from the schema via `z.infer` and emits
through a single chokepoint (`emitCliJsonEnvelope`); it must not hand-write a
parallel envelope shape or emit a raw envelope literal that can drift.

The envelope is the FRAME owner. It validates the version, the `type`
discriminant, and the per-type literal fields it pins; the rest of the flattened
command result is a documented relaxed boundary, because its deep shape stays
owned by the daemon and agents runtime contracts. Do not re-derive those payloads
here — that would create a second source of truth for a payload another owner
already owns.

This is distinct from the `--view agent` presenter protocol (the flat
`{ type: "error" | "hints" | "result", ... }` lines emitted without
`schemaVersion`), which is a separate machine-readable surface this contract does
not own.

Routine success output is stricter than the documented relaxed deep-payload
default. The eight `routines.*` success envelopes reuse the corresponding
strict shared HTTP response shape, including required nullable fields and the
closed Run status set. The API client parses that strict response before a
Routine command presents or emits it; missing or unknown fields fail closed as
an invalid upstream response. The existing strict v1 CLI error envelope remains
unchanged. Its entry-check code enum distinguishes a temporarily unavailable
saved-sign-in read as `auth.session_token_unavailable`; the existing `message`
field may carry the sanitized local cause without adding a new envelope field.

`space.members` success output follows the same strict rule. Its versioned CLI
envelope flattens the shared `spaceMemberDirectorySchema` response without
redefining member fields in the CLI. The API client parses the directory before
the CLI renders Human View, emits Agent View frames, or writes the `--json`
envelope.

`space.members.brief` is a separate strict CLI-owned projection for one or more
resolved directory members. It reuses the shared member kind, addressing
relations, and a schema-picked subset of Core-owned Agent Wake Availability:
status, phase, action, reason code, and summary. Its `canWakeNow` convenience
boolean is true only for `available_for_wake`; it does not create a second
readiness owner. The command must fetch the existing Space directory and member
snapshot contracts rather than introduce another Space or Wake API.

`space.list.organization` success output is also strict. Its versioned CLI
envelope reuses the Organization Space member-count directory fields and item
schema, while `scope`, `total`, and `returned` remain CLI-owned presentation
facts. Explicit JSON output must not fall back to the unversioned Agent View
presenter protocol.

`organization.directory` and the three `organization.invite_link.*` success
outputs also follow the strict rule. The Directory envelope flattens
`organizationDirectoryResponseSchema`; invite-link get/create flatten
`getOrganizationJoinLinkResponseSchema`, and revoke flattens
`revokeOrganizationJoinLinkResponseSchema`. The CLI must not unwrap, rename, or
augment Auth's invite-link result before emitting the versioned envelope.

Human View, Agent View, and explicit `--json` stay separate. Human View renders
terminal output. Agent View renders flat presenter frames. Explicit `--json`
writes a versioned command envelope through `emitCliJsonEnvelope`, with no
presenter frames mixed into stdout. The emitter's local schema check is a debug
diagnostic and does not replace strict shared schemas, typed call sites, or
upstream response parsing.

Agent Activity uses the same rule. `packages/schemas` owns Project mutations,
provider-specific safe event metadata, per-event ingestion outcomes, the
Organization snapshot, digest summarization RPC, Center Agent read RPC, and
every `activity.*` / `projects.*` CLI JSON envelope. Gateway, Core, API client,
Web, CLI, and Remote Agent must parse those contracts rather than hand-building
parallel payloads. The local hook protocol adapts an already-validated cached
snapshot into each provider's official startup-context shape; it never widens
the cloud disclosure contract. The versioned local Agent Activity route
registry is also a shared cross-process schema because production, development,
and canary CLI processes may read the same machine-global dispatcher state.

Agent Activity snapshot filters are semantic. Project filtering may retain
Project digests. Member, provider, or status filtering returns an empty digest
list because the stored Project summary is not filtered to those dimensions.
Clients must not pair an unfiltered digest with filtered events or sessions.
The public session projection may add the reviewed provider-specific metadata
object as an optional response field only when a reader sends
`includeProviderMetadata=true`. Core validates stored provider metadata,
removes private parent-session ids, and returns only the closed shared shape.
Readers that omit the flag receive the frozen legacy session shape, so a new
Core remains compatible with published strict clients. Consumers that opt in
must still treat an omitted field as unavailable rather than inventing
defaults.

Cursor follows the same metadata-only contract through its official Hooks.
The shared Cursor metadata shape admits only hook or ACP provenance, the
official `composer_mode` wire value (`agent`, `chat`, `plan`, or `debug`), the
background-agent flag, and an optional version. Cursor's `chat` value is the
wire name for Ask mode.
It never admits prompts, responses, transcripts, file content, or tool
arguments. A Cursor hook event uses `clientKind = unknown` unless trusted
provenance explicitly identifies Cursor CLI or Cursor IDE; the workspace root
alone is not client identity.

## Agent View Setup Plan Contract

`packages/schemas/src/schemas/agent-view/setup-plan.ts` owns the shared
`setup.plan` Agent View event contract.

The payload intentionally reuses the onboarding facts and plan schemas from
`packages/schemas/src/schemas/start`. Onboarding action ids, decision ordering,
blocking semantics, reason codes, `run`, and `afterRun` stay owned by the
onboarding planner contract. The Agent View event only frames that plan as
machine-readable setup or doctor output with `schemaVersion` and `readOnly`.

CLI presenters must validate emitted `setup.plan` payloads through this schema.
They must not hand-write a parallel setup-plan shape, mint client-only action
ids, or reinterpret `readOnly` as permission to mutate local state.

## Space Message Reaction Contracts

The Space owns persisted message reactions. `GET` and `PUT` on
`/v1/spaces/:spaceId/message-reactions` use the shared reaction schemas. Writes
take `signalId`, a supported Unicode `emoji`, and the desired `active` boolean;
the authenticated request context supplies the actor. A write requires an active
Human member with writable Space access and a persisted non-system text message.
Reads preserve the existing Space access boundary.

The unique identity is `(signalId, emoji, profileId)`. Retrying the same desired
state is idempotent. Mutation and per-message revision increment are atomic.
Supported aliases resolve to one canonical Unicode sequence; skin tones and
joined emoji remain distinct. At most 30 distinct emoji groups may be active on
one message.

Text-envelope `reactions` is additive and optional for existing clients. Its
`version` and `groups` describe current state. Each group includes the emoji,
label, count, `reactedByMe`, an actor preview, and `actorsHasMore`. Actor records
include profile identity, display name, and kind. The focused GET accepts `emoji`
and `afterProfileId` to read actors in pages of 50, returning `nextCursor`.
An actor preview must never be represented as the complete list when truncated.

Only a changed mutation emits `space.reactions.changed` with affected
`signalIds`. Clients invalidate reaction reads without creating a timeline
signal or refreshing Wake status; reconnect also refreshes mounted reaction
reads. Revision checks prevent older responses replacing newer state.

A changed addition stores its Inbox projection intent in the same SQLite
transaction as the reaction and revision. The existing Space Inbox outbox owns
retries and current-recipient access checks. The source remains `space_signal`
with `reaction:<signalId>:<version>` as its event key and the actual message as
its navigation target. Reaction time, rather than the original message time,
governs unread activity. This uses existing public Inbox and reaction payloads;
older clients can read and acknowledge the ordinary update without an upgrade.

Shared message projections, CLI history, Center context manifests, and Remote
Agent continuity preserve reaction metadata. Materialized-context hashes include
the reaction state. Personal Remote Agent reads use the existing execution and
Space-scoped tool authorization, without granting Center administration access.
New-message delta cursors remain message cursors, not reaction-change cursors.

## Space Member Contracts

Auth's internal `resolveProfilesByIds` RPC reads at most 64 requested Profile
IDs per call. It returns the same minimal identity facts as
`resolveProfileById`, with an explicit null for each absent ID. A database
failure returns a failed envelope, never a partial successful set. Consumers
reject missing keys, unrequested keys and Profile IDs that do not match their
keys. This is an identity read, not authorization or a readiness projection.
Core keeps ownership, Organization, Binding and execution policy checks.
Deploy Auth before Core consumers; the scalar RPC remains available to old
cloud callers. Roll back Core before removing the new Auth receiver. No public
CLI, Service, Gateway, Web, setup or Wake payload shape changes, and no local
compatibility floor changes are required.

Auth owns current Profile names. Space member names are persisted display
snapshots, not a second identity authority. Historical Signals and existing
sessions must never rename an existing member, even when their names are
nonempty. They can initialize a missing member's historical snapshot only.
Agent publication, including WebSocket writes, resolves the matching Profile
through Auth's `resolveProfileById` contract and rejects caller-reported names.
New Signals freeze the name resolved at publication; existing Signals are never
rewritten by a Profile rename. Authorized member-directory and active-Wake reads
refresh active-member names through the Space-owned writer and existing Space
Index projection outbox. Account working summaries resolve each distinct active
Agent through Auth, without making the cross-Space index a membership writer.
Space-wide name refresh uses bounded Auth fact batches instead of one RPC per
member. It stops launching batches after the existing display-read deadline.
Status and member snapshots reuse a successful refresh's validated Auth facts
for Core readiness within that same request. Explicitly absent Profiles remain
null entries. A failed or timed-out batch is unavailable identity evidence, not
permission to launch one scalar Auth query per Agent. An absent batch capability
means no batch was attempted and preserves scalar receiver compatibility. Both
facts and failures expire with the request; a later request can read again
without marking members deleted or changing their stored identity. Wake
admission still reads its own current facts. Reuse does not skip Core's identity,
ownership, Organization, Binding or execution checks.
Refresh preserves membership, ownership, removal and aliases. It re-reads the
member after the Auth call so a concurrent removal or changed name wins. Failed
or mismatched identity reads do not write names: the last known snapshot remains
available so a display-name lookup outage does not block reply publication.
Active work prefers the refreshed name over the dispatch's historical label.
Name enrichment has a 500 ms wait budget per publication or read refresh, shared
across all batches in a member or account summary read. Timeout preserves the
last known name and emits diagnostics; it does not cancel or fail Agent
execution. An RPC may still finish remotely, but its late result cannot write
a snapshot after the caller has timed out. Name-only index delivery runs in the
background using the existing durable dirty mark and projection outbox, rather
than delaying the reply or status response.
Web treats old ID-valued progress labels as unnamed Agents during rollout.
The batch RPC is additive; public message and local-component contracts stay
unchanged. Request-scoped reuse between name enrichment and Core readiness is
separate from this batch transport and must not reuse stale cross-request facts.

`getSpaceStatusResponseSchema` may expose the Organization's current
`centerAgentProfileId` as an optional presentation identity. This lets public
Space readers render the Center Agent consistently without inferring identity
from a Profile name or Agent Controller. The field is not membership,
readiness, or execution authority; clients must still use the owning snapshots
and projections for those facts. It remains optional so older Core producers
and already-deployed strict consumers remain compatible during rollout.

`packages/schemas/src/schemas/http/space-members.ts` owns the shared HTTP
contracts for Space member snapshots, public Wakeability fields, owner
diagnostics, and Space member directory entries.

Core's Organization-directory member-addition boundary expands every selected
ordinary Agent Profile to include its authoritative owner member's active
default Human Profile before it calls the Space membership writer. The
expansion uses current Agent Profile identity and Organization membership,
excludes managed Agents, and fails the complete request when the owner Human
cannot be resolved. The Space Durable Object receives one resolved member batch
and remains the only membership writer; Gateway and Web must not issue a second
owner-add request or infer the owner from display text.

An unconverted one-Human/one-Agent Direct Message does not persist that owner as
a third member. Space read authorization derives the ordinary Agent's owner
observer from the active Agent member's frozen `ownerUserId`, while write
authorization rejects that observer with `space.access.read_only`. The existing
Direct Message conversion method is the only promotion path: it accepts the
observer only when the one selected member is the observer's own Human Profile,
then atomically converts the DM and writes membership. Existing ordinary Spaces
use a one-time Space-SQL reconciliation marker; reconciliation reads canonical
identity and calls the same Space member service without touching Signal,
cursor, Inbox, or unread history.

These changes add no external request or response field. Rollout is Core first,
then Web. New Core with old Web fails observer writes safely but may show the
existing generic error; new Web must not be deployed against old Core because
the browser-only read-only presentation is not an authorization boundary.
Rollback removes Web before Core.

Current Space Message Addressing has exactly three shared-schema relations:
Wake (`activationTargets`) and Reference (`referenceTargets`) target Agent
Profiles; Human Mention (`mentionTargets`) targets Human Profiles. Wake is the only
relation that may create executable work. Reference and Human Mention must
not enter dispatch, claim, RuntimeCoordinator, Delegation, or continuation
coordination.

The Space Durable Object is the write-time authority for Message Addressing
target membership. Before persisting a new text signal, it validates every
`activationTargets`, `referenceTargets`, and `mentionTargets` entry against its own active Space
member records. Center Agent, HTTP, thread, WebSocket, and idempotent publication
paths cannot replace this check with Organization Profile data or a client
member-directory snapshot. Idempotent retries validate the submitted target set
only when the attempt would create a new publication. An already accepted
publication remains the successful idempotent result after later membership
changes. Historical signal reads do not run this authoring check; their
compatibility projection remains readable after membership changes.

Current Center Agent Space-authoring RPC requests use `mentionProfileIds` for
Human Profiles and `referenceProfileIds` for Agent Profiles. Core validates and
normalizes both sets, then writes them as `mentionTargets` and
`referenceTargets` in the current Message Envelope. A delegated Wake
publication command persists both sets and the current addressing version so
event-driven retry cannot lose structured addressing or its validation mode.
Older persisted commands normalize missing lists to empty current-domain lists
and keep the legacy unversioned mode. No caller may infer either relation from
message text. The deterministic Center Agent `clientMessageId` includes the
current addressing version for a current caller plus each non-empty normalized
set; legacy callers omit the version and preserve their older idempotency keys.

Before either Center Agent Space-authoring RPC can publish, the current Remote
Agent calls Core's `centerAgentReadSpaceAuthoringContract` RPC with
`requestedAddressingModel = wake_reference_mention` and validates the matching
response plus `structuredMentionTargets = true` and
`structuredReferenceTargets = true`. An older Remote Agent omits the request
field and receives the legacy `wake_reference` response. This negotiation is a
capability fence, not a second addressing fact: Core remains the sole owner of
the response, and a current Remote Agent uses it only to reject an incompatible
old Core before any Space write.

Current Remote Agent Space-context reads use the same explicit model request:
`centerAgentReadSpaceContext.requestedAddressingModel = wake_reference_mention`.
Core returns `mentionTargets` unchanged only for that current request. An older
Remote Agent omits the field and receives the legacy Reference/cc response
projection, so mixed-version reads never expose Human Mention as an Agent
Reference to a current model and never expose an unknown relation to an old
model.

For Core-first rollout compatibility, an older Remote Agent may still send a
Human Profile in `referenceProfileIds`. The current Core lets the Space
authoring boundary translate that active Human into persisted Human Mention
truth, then projects only the RPC response back to the requested legacy
Reference set so the old caller's postcondition does not falsely report failure
after a successful publication. A current caller receives no such projection:
its accepted response must preserve every requested Human Mention and Agent
Reference. If that postcondition fails, Remote Agent locks every later
Space-authoring call in the same submission to the same non-retryable contract
error, so a model retry cannot repeat a non-idempotent publication.

The `packages/schemas` package is the single shared-schema compatibility
boundary for retired CC wire data. Its removal points are explicit:

- `schemas/protocol/message-envelope.ts` normalizes historical `ccTargets` into
  `referenceTargets` before returning a current-domain object.
- `schemas/http/space-members.ts` accepts the retired
  `allowedRelations.cc` field only while parsing old member-directory
  projections and returns the current three-relation capability object.
- `compatibility/legacy-space-addressing-wire.ts` is the outbound compatibility
  boundary for supported old-client transports. The request helper preserves a
  non-empty `mentionTargets` list and otherwise may add only an empty
  `ccTargets` field. The response encoder folds Human Mention targets and
  capabilities into the retired client's Reference projection, while adding
  only the empty `ccTargets` field and `allowedRelations.cc = false` flag.

Current HTTP clients declare
`x-openmeld-space-addressing-version: 1`. Gateway obtains the current projection
from Core and returns it only to that negotiated consumer; a request without the
header receives the strict legacy projection. Current Space WebSocket clients
declare `capabilities.spaceMessageAddressing = true` in `hello`, and Core stores
that capability with the session before selecting the live wire projection.
Core's typed Space RPC adapter always requests the current in-process projection;
the service-binding RPC method version argument then selects current output for
current Gateway while preserving legacy output for an already-deployed Gateway.
Compatibility selection is transport metadata, never Space business state.

An old authoring client that omits this version or WebSocket capability may
still encode a Human target in `referenceTargets`. Before current target-kind
validation and persistence, Core translates only active Human member targets
from that legacy request into `mentionTargets`; Agent References remain
References, and inactive targets still fail. A negotiated current caller does
not receive this translation, so Human Reference remains invalid on every
current user-authored path. Core applies the same translation to
`system_emitted` Agent replies because already-published OpenMeld Services
encoded Human attention as Reference and do not carry the HTTP or WebSocket
negotiation marker. Current Agent reply producers cannot validly author a Human
Reference. This compatibility step never infers addressing from text and never
rewrites an already persisted signal.

These three owner points are one package-owned compatibility boundary, not
three business facts. Neither retired field is a current fact, writer input,
prompt concept, or UI state. No consumer may branch business behavior on them.

The Contract Impact Audit for this retirement is:

| Direction                                                  | Compatibility rule                                                                                                                                                                                                   |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old CLI or OpenMeld Service -> new Core                    | New shared request schemas accept the retired empty or populated field only at preprocessing, merge historical targets into Reference, and return a current addressing object. This includes daemon result frames. |
| New CLI or OpenMeld Service -> old Core                    | Not supported once `mentionTargets` is authored. The guarded rollout deploys current readers before current Human Mention writers.                                                                                |
| Old Web or API client -> new Gateway/Core                  | New request schemas normalize the retired field at the boundary. Gateway preserves the caller's missing version, and Core translates active Human References into Human Mentions before current validation. Old response readers receive Human Mentions through their legacy Reference projection. |
| New Web or API client -> old Gateway/Core                  | Requests without Human Mention retain the empty compatibility field. A request with non-empty `mentionTargets` requires current readers; the guarded rollout deploys those readers first. Current response readers normalize old persisted values into Reference.              |
| Old Gateway or Remote Agent -> new Core                    | New Core request schemas normalize retired wire fields. For Center Agent authoring, an old Remote Agent receives the legacy contract and response projection while persisted Human targets become Mentions.                                                                         |
| New Core -> old Gateway, Remote Agent, or OpenMeld Service | Consumers that omit the HTTP/RPC response version or WebSocket capability receive their supported legacy projection after current-domain validation. Negotiated current consumers receive `mentionTargets` and `allowedRelations.mention` unchanged.                               |
| New Gateway or Remote Agent -> old Core                    | Not a supported authoring direction. Current Web/API writers roll out after Core/Gateway, and current Remote Agent detects the old authoring contract and fails before a Space write.                                                                                                 |
| Historical persisted Signal -> current read projection     | Shared preprocessing merges historical CC targets into Reference before timeline, details, prompt, or dispatch code can observe the message. It never creates work.                                                  |

The Center Agent Human Mention extension follows the same rollout boundary.
The request fields remain optional at the Core compatibility boundary, so old
Remote Agent producers continue to work with new Core. A current Remote Agent
refuses to publish through an old Core because that Core cannot satisfy its
requested `centerAgentReadSpaceAuthoringContract`; it does not rely on an
unknown authoring field being rejected or on a post-publication comparison.
Guarded production rollout must therefore deploy Core before Remote Agent, and
rollback must remove the current Remote Agent before rolling back Core. Old
persisted delegated publication commands remain readable because Core
normalizes missing `mentionTargets` and `referenceTargets` to empty
current-domain lists and treats a missing addressing version as legacy.

Remove all three compatibility owner points together after the minimum
supported Web, CLI, OpenMeld Service, Gateway, Core, and Remote Agent versions
use the three-relation model and one production Space-history retention window
has elapsed. Until then, production rollout is Core first, then Gateway and
Remote Agent, then Web, and finally the published CLI, OpenMeld Service, and
managed skill bundle. Rollback reverses that order. The release fence is
required because a new Gateway or Remote Agent must not call an old strict
Core; it is not permission to add a second current relation or a behavioral
fallback.

The same shared schema boundary must own the dedicated mutation that adds an
Organization's designated Center Agent to an ordinary Space. Its request carries
the Center Agent Profile id shown to the user as an expected designation
identity; Core compares it with the current designation and rejects a mismatch
instead of silently substituting another profile. Gateway, API client, Web, and
Core RPC surfaces must not hand-build parallel request shapes. The canonical
mutation response, not the cached Organization directory candidate, drives the
Space member snapshot update.

The Center Agent member-addition request carries Organization member user ids,
not model-supplied Human Profile snapshots. Core resolves each id against the
current Organization membership and active default Human Profile, rejects each
unresolved target explicitly, and sends only canonical resolved profiles through
the ordinary Space member mutation. The Space member service remains the sole
membership writer and records these additions with the existing
`added_by_member` source.

`packages/schemas/src/schemas/http/space-access-mode.ts` owns the shared Space
access mode and link-join policy contract. `space_meta.accessMode` is the
source-of-truth projection
for whether a Space is public, public to view but password-gated to join, or
member-only for creator/current-member/same-account access. The Space password remains a single
Space credential; access mode changes may set, reuse, or clear that one password
proof, but must not introduce a second join-only or view-only password.

`space_meta.linkJoinPolicy` is a narrow restriction on the link-derived join
grant: `access_mode` retains the access-mode behavior and `invite_only` denies
link self-joining without changing reading, Organization-open joining, direct
addition, accepted invitations, or existing membership. Core owns its write and
enforcement. A missing persisted value resolves to legacy `access_mode`
behavior; omission from an access-mode write preserves the existing resolved
value.

`packages/schemas/src/schemas/http/space-meta.ts` also owns the pure initial
access policy used only while creating a Space. Core and creation clients must
call `resolveInitialSpaceAccessMode`; they must not independently recreate the
`private -> members_only` and `public -> public` mapping. Once the Space exists,
its stored visibility and access mode remain independent facts and readers must
not apply the creation policy to reconstruct either one.

`GetSpaceStatusResponse` projects all access facts from the same Space meta
record: optional `organizationVisibility` describes Organization discovery and
self-service joining, required `accessMode` describes link reading/password
behavior, and optional `linkJoinPolicy` restricts link-derived joining.
Space-access contract version 2 carries the new policy; version 1 strips only
that field, while the legacy projection also strips ownership and Guest fields.
Clients must label the facts separately and must not derive one from another.

`packages/schemas/src/schemas/http/space-status.ts` owns the bounded
`latestVisibleUpdate.previewText` projection. Core applies the shared UTF-16
boundary before publishing the response, and the response schema applies the
same idempotent normalization while parsing. That parser normalization lets a
new CLI consume an older Core response without repeating the full message in
status output; it does not cache, omit authorization, or change Space history.
The field name and wire shape remain unchanged, so old readers continue to
accept a new Core response and no ordered rollout is required.

The authorized latest-update summary selects only message ID, type, time,
actor ID/name and bounded preview text from Space storage. It never returns
Agent local directories or native conversation IDs, so it does not load Auth
Profile ancestry to redact those absent fields. Detailed member and history
reads retain their local-origin privacy checks. The summary is a synchronous
Space SQL read; it needs no separate asynchronous bootstrap branch or Auth wait.

`packages/space` owns reusable pure policy for turning Space identity and
membership facts into mention labels, addressing support, and member directory
send targets. Clients, Core, and dispatch prompts may adapt source facts before
calling this layer, but they must not rebuild separate member-directory,
mention-label, or send-target rules locally.

Shared Wake progress matching also belongs to `packages/space`. Two known,
different dispatch IDs cannot match through a common source or client-message
ID. Matching local pending identity may gain a dispatch ID, and accepted final
signals clear only that execution. This is projection policy, including Core's
recent-signal cleanup; it adds no execution writer, wire field, persisted state,
or new Stop eligibility rule. Web's scoped outcome cache remembers accepted
evidence for presentation only.

The member directory is a Space read projection and authoring aid. It must not
become Space membership truth, Agent Profile readiness truth, Binding truth, or
RuntimeCoordinator execution authority.

## Account Display Name Contract

`packages/schemas/src/schemas/http/account.ts` owns the Account Display Name
limit and the shared `PATCH /v1/account/display-name` request and response.
Account Display Name is the canonical name value for the account's one default
Human Profile. The Auth-owned account display-name command is the only writer:
one native PostgreSQL transaction updates Better Auth `users.name` and the
active default Human Profile's `profileName` and collision-safe derived
`profileHandle`. The repository uses Drizzle `db.transaction()`; every mutation
uses the transaction client and a failure rolls back both writes. Do not split
the paired mutation across separate transactions or clients.

The default Human Profile is a one-to-one read projection of Account Display
Name, not an independently writable identity. `PATCH /v1/profiles/:profileId`
must delegate a default Human Profile rename to the same command. Non-default
Human Profiles and all Agent Profiles retain independent names. Clients must not
issue two writes, repair drift after the fact, or use a database trigger or
post-transaction hook as a second synchronization authority.

Better Auth's generic `/update-user` writer is disabled. Auth retains an exact,
strict `{ name }` compatibility adapter at `/api/auth/update-user` for deployed
Web clients; it delegates to the same paired command and rejects every other
user field. A successful paired mutation refreshes the Better Auth session-data
cookie so session reads cannot continue presenting the old account name.

This additive HTTP rollout is Auth first, then Web: new Auth continues serving
the old Web request through the compatibility adapter, then new Web adopts the
canonical endpoint. Rollback reverses that order (Web first, then Auth). No CLI,
OpenMeld Service, daemon, setup, Wake, Space action, or diagnostic contract is
changed.

## Agent Profile Creation Request Contract

The [teammate request launch hold](../product/agent-profiles.md#teammate-request-launch-hold)
temporarily disables cross-user request behavior, not the shared self-creation
protocol. Existing payloads, status enums, and identity checkpoints remain
unchanged. Core enforces the hold for every caller and background execution;
clients do not authorize the feature by rendering its retained UI.

`packages/schemas/src/schemas/http/agent-profile-creation-request.ts` owns the
strict cross-client request, list, decision, mutation, and approval-preference
payloads. Web, CLI, the Local Agent Skill, API client, Gateway, Core, and Remote
Agent consume those schemas instead of maintaining client-specific status or
approval enums.

The public request freezes requester user, acting Profile, target owner,
initiation source, name, Session strategy, optional exact provider-native
Session ID, optional intended Space, status, reason, timestamps, and the created
Agent Profile ID after completion. `new` forbids a Session ID; `resume` and
`fork` require one. The shared contract never introduces an OpenMeld Session ID
or treats a provider-native ID as authority by itself.

Core owns authorization and transitions for the Organization routes under
`/v1/organizations/:organizationId/agent-profile-creation-requests` and the
member's singular `agent-profile-creation-approval-preference` route. Gateway
is transport only. Auth performs the final idempotent Agent Profile identity
write after Core approval; it records the target user as owner and the request's
actor/source as immutable creation provenance.

The requester's stable idempotency key is unique within that requester and
Organization. Exact replays return the same request; a changed actor, target,
name, strategy, native Session ID, intended Space, or source conflicts. Pending
requests project one structured Inbox target of kind
`agent_profile_creation_request`; that locator carries only the canonical
request ID and grants no approval or Profile access.

The Auth identity write is the request's irreversible commit point. If a later
setup step fails, the shared response carries the backward-compatible
combination `status: failed`, `statusReason: profile_created`, and the non-null
`createdAgentProfileId`. A retry may temporarily carry `status: approved` with
that same Profile ID while Core finishes setup. Core checkpoints the ID on that
fenced request before the first post-Auth setup write, bypasses the Auth create
RPC on retry, and reruns only idempotent Space, Binding, managed working-folder,
and Default Project follow-ups. A private custom-folder path remains a Web-local
per-tab settings draft keyed to the request, is bound to the committed Profile
ID when one exists, and resumes through the existing current-device workspace
writer after Core completes. Web may retain a browser-local incomplete marker
with no path: before identity commit it records only that custom setup is due,
and after commit it may carry the Profile ID. Neither value is added to this
cloud contract.
`profile_creation_failed` is reserved for failures that have no committed
`createdAgentProfileId`; no new strict response enum is required for older CLI
and cloud readers to understand the payload.

The public failure message for a committed Profile explicitly reports incomplete
setup and possible usability. Current readiness remains a separate read, not an
inference from the setup request's failure. Working-folder eligibility errors
use their exact shared recovery mapping and never imply a provider outage or
expired login. Historical saved failures use the same safe read projection.

These corrections retain all request, candidate, Service and Wake wire shapes.
Old CLI, Service, Skills, Gateway and Web readers can consume the corrected Core
projections. No contract-version bump, local-component stamp, restart or forced
upgrade is needed. The Center Agent guidance change is advisory and does not
require coordinated deployment with Core. Setup, Wake, dispatch-owned Space
actions and diagnostics keep their existing owners and mixed-version behavior.

The failed-request retry body optionally carries `expectedUpdatedAt` and one
paired `modelSelection` (`modelId`, nullable `reasoningLevel`). Both fields are
required for a correction. Core validates the canonical selection, ownership,
failed state, exact version, and any retained Binding before atomically saving
the correction with the new attempt. Ordinary retries retain their empty body.
Center reads can select the exact `requestId`; local candidates opt into the
existing catalog's `modelOptions` with `includeModelOptions`.

Local workspace request validators share `profileWorkspaceWriteSchema`.
Creation's `onlyIfUnconfigured` flag requires the Service's
`initializeProfileWorkspace` capability. Runtime Transport must reject an old
Service rather than strip the flag or fall back to an ordinary write. Binding
`initialize` reuses an identical target while preserving current settings.
Auth's required `initializeAgentProfileDefaultProjectInOrganization` RPC owns
the field-specific compare-and-set. Core must not fall back to the ordinary
Auth setter when that receiver is missing. The nullable database revision has
no zero default; only the supporting Auth creation writer records zero.

Center runtime-settings responses project local workspace writes to Profile ID
and status. The owner-self workspace response retains its private fields.
Operation steps distinguish a saved folder from a failed Default Project clear
and use path-free failure copy with a reason code when known.

Working-folder mutations require the named Core receiver
`centerAgentUpdateAgentProfileRuntimeSettingsWithSafeWorkspace`. The legacy
runtime-settings receiver rejects any request containing `workspaceMode` before
calling the operation, including requests that also change model, permission,
or collaboration. It cannot change other settings and then reject the folder.
Model- and permission-only requests retain the legacy receiver. Both receivers
use the same authorization and operation owner.

Deploy Core before Remote. Old Remote with new Core receives a 409 before any
settings write for a folder change. New Remote with old Core receives
`core.rpc.unavailable` before any settings write; it never retries through the
legacy receiver. Matched new components return the safe workspace receipt and
all completed or failed steps, including a partial Default Project clear.
Rollback Remote before removing the named receiver. During that transition,
legacy folder changes remain unavailable rather than returning an incompatible
receipt after a write. No Service, CLI, Skills, setup, Wake, diagnostic, or local
component compatibility floor changes are needed for this cloud RPC correction.

The Center Agent RPC wrapper does not create a second state machine. It verifies
the current designation, resolves the represented member, preserves the Center
Agent Profile as actor, and delegates to the same Core request operations.
Routine turns cannot decide another member's pending request or change the
represented member's approval preferences.

This is an additive rollout. Apply the PostgreSQL migration first, then deploy Auth so
Core can send creation provenance, Gateway so it can read the new Inbox source
target, Core, Web, and Remote Agent. Publish the CLI and managed Skill only
after the cloud endpoints exist. New cloud leaves old CLI, Skills, setup, Wake,
status, trace, and recovery behavior unchanged. A new CLI or Skill against old
cloud receives an explicit unsupported-route failure; it must not retry through
direct creation. Rollback removes Web and Remote Agent callers first and keeps
the additive nullable Profile columns and request tables.

## Additional Human Profile Creation Capability Contract

Auth owns both the capability projection and the mutation policy for manual
creation of non-default Human Profiles. The deployment variable
`OPENMELD_ADDITIONAL_HUMAN_PROFILE_CREATION_ENABLED` enables the capability only
when its exact value is `"true"`; missing, false, or malformed values fail
closed. Default Human Profile bootstrap never depends on this capability.

Authenticated clients read the strict shared response from
`GET /v1/profiles/capabilities`:

```json
{
  "ok": true,
  "additionalHumanProfileCreationEnabled": false
}
```

Clients use that projection to hide Human Profile creation choices, but the
Auth Profile Service remains the mandatory enforcement boundary. A rejected
`POST /v1/profiles/humans` returns HTTP `409` with code
`profile.additional_human_profile_creation_disabled`. The corresponding Auth
RPC result carries `status: 409` with the same code and message. Both boundaries
derive their error envelopes from the strict shared Profile error schemas and
the same Auth error mapper. Existing non-default Human Profiles retain their
read, use, update, membership, and delete behavior. The capability does not
restrict Agent Profile creation.

This is a separate endpoint instead of an added field on the strict
`GET /v1/profiles` response, so deployed clients remain compatible. Deploy Auth
before capability-aware Web or CLI clients. Older clients remain safe because
Auth rejects their Human creation requests; newer clients fail closed if they
cannot read the capability. Re-enabling creation is a configuration change plus
an Auth deployment, not a data migration.

## Profile Details Contract

`packages/schemas/src/schemas/profile-details.ts` owns the shared
`ProfileDetailsSnapshot` payload shape for cross-client Profile Details
surfaces.

`packages/agent-profile` owns the reusable pure builders that compose Profile
Details snapshots from source-owned read models. Web, Desktop GUI, and other
clients should consume the shared snapshot or section model instead of rebuilding
Profile Details sections locally.

The Profile Details snapshot is a permission-scoped display contract, not a new
fact authority. It may compose:

- Agent or Human Profile identity from profile-owned read models.
- Space membership context from Space-owned membership projections.
- Wakeability from the Core-owned projection.
- local connection and Binding diagnostics from Binding, Runtime, and local OpenMeld
  Service evidence.

Each Profile Details field must carry explicit source provenance and explicit
viewer visibility. Source provenance says which read model supplied the value.
Viewer visibility says whether the field is visible to every viewer or only to
the owner-self view. Do not infer permission from provenance.

The builder must preserve viewer authority. Owner-self views may include local
connection details such as controller conversation ID, OpenMeld Service runtime ID,
computer, model, Binding state, and workspace directory. Observer views must not
receive those owner-local details. Clients should not fetch all local details and
hide them in the UI after the fact.

Controller conversation ID is a core Agent Profile connection field. Owner-self
Profile Details surfaces should show it in the Connection section instead of
hiding it behind advanced diagnostics.

Do not make Profile Details, Space member directory, or a client-specific dialog
the source of truth for identity, membership, readiness, Binding, local runtime,
or execution authority.

## Public Failure Recovery Copy

`packages/schemas/src/public-agent-failure-reason.ts` owns shared public
failure reason and recovery mapping for Wake failure reason codes that appear
across Space, Web, CLI, Core, and package projections.

Use this shared mapping when translating known execution or readiness failure
codes into user-facing recovery kind, primary action label, and public body
copy. Do not remap the same reason-code families separately in each client.

Shared mapping may classify whitelisted details from diagnostic error messages
when old runtimes only send a generic reason code, but Space-visible copy must
still be the mapped public text. Raw provider messages remain diagnostic
evidence and must not be used as primary public copy.

Clients may adapt presentation from client-local context, such as whether the
current user can manage the failed local service target, but they must not
change the shared meaning of the reason code or turn internal reason codes into
primary user copy.

`agentFailureFactsSchema` is the shared owner-supplied failure read projection:
stage, execution confirmation (`not_executed`, `executed`, `unknown`), result
availability, retry state, recovery state and available actions, plus
bounded diagnostic references. A verified retained or published result requires
a result reference; a recovered result must match that same reference. Missing
admission confirmation means an unknown outcome, never proof of no execution.
The projection does not schedule work, authorize recovery or supersede the
execution owner. The public formatter uses these facts for neutral retry/recovery,
warnings requiring review, and final failures. Native continuation exhaustion
feeds Space and Inbox from the same projection; Routine execution callbacks use
the same formatter and preserve their Run link.
Known stop causes and outcome certainty are independent. The callback reason
mapping keeps cause-only English/Chinese copy alongside legacy recovery copy;
an unknown outcome must retain an allowlisted stop cause without restoring an
unconditional retry instruction or publishing raw failure details.

An optional `languageTag` is the owner's resolved display language. Native
continuation notices and Routine continuation failures first read the trusted
per-task semantic decision from the Task Coordination owner. When that decision
is absent, they explicitly use the current Organization preference as a fallback,
then English. Initial Routine failures still use that fallback.
This fallback does not establish the conversation's actual language and never
uses a text-classifier guess. English and Chinese rendering are supported.
Propagation into initial Routine execution and workstation child-failure
publishers remains incomplete. The shared failure projection is not added to
other strict HTTP/RPC/stream envelopes; adding it requires a receiver-first audit.

Exhausted continuation copy distinguishes confirmed execution, confirmed no
execution and uncertainty. It directs users to summarize existing results rather
than resend the original request, and warns about repetition only when execution
is possible. The notice does not invent retained child-result locations; exact
authorized retained-result references remain an incomplete recovery integration.

`connectorActionOutcomeUnknownSchema` is a model-visible receipt for an attempted
connector operation. A validated provider completion followed by failed Core
finalization carries `executed`; an unverified response carries `unknown`.
Neither authorizes another write. Direct tools and Code Mode retain the caller's
exact `operationId` and explain that a write may have succeeded, a new operation
ID must not be used, and recovery must use the same action and input. The durable
Core operation and provider idempotency key remain the existing owners.
The optional `replay` projection makes recovery permission explicit: `allowed`
with one attempt and a positive remaining window, or a denial reason for an
unverified/expired window or a replay already attempted. Older receipts without
this field grant no replay permission. Core claims the single replay through a
unique entry in the existing operation audit journal. Both Local and Remote
ordinary Plugin writes require this durable permit. The original connection
version is frozen in the operation ledger; replacing a same-name connection
refuses replay. Migration `0192_lush_rick_jones.sql` adds that nullable
version before new Core code is deployed. Legacy rows remain readable but do
not receive a replay permit without a frozen account version. Old consumers
keep their prior response shape unless they opt into recovery receipts.
The common App/GitHub guidance and Code Mode consume the same rule;
`not_found`, a timeout, or one page without a matching target proves no outcome.
GitHub retains its own authorization and operation owner.

Ordinary Plugin target reads may carry `verificationOf: { operationId,
actionId }`. Core accepts the association only for a declared read through the
original operation's still-current account and returns that operation's stored
request signature, identity, and outcome. This is read evidence, not automatic
confirmation of the original effect. The caller compares authoritative target
data with the exact original input and reports the matching target. Empty pages,
`not_found`, timeouts, and insufficient evidence leave the original outcome
unchanged. Local CLI exposes `--verify-operation` and `--verify-action`; Remote
direct tools and Code Mode use the same input. New Core must precede these
consumers; a missing association receipt refuses the verification read.

Native `readAdmission` is an additive Core-to-Remote RPC. It reuses the exact
persisted submit-request schema so the receipt owner can verify the original
digest. Its shared response is `found` with the original replay ACK, `unconfirmed`
for a claimed receipt, or `not_found`; the last two contain no submission ID and
prove no execution outcome. The replay ACK has `accepted: false` and a required
matching idempotency key. Core adopts only a validated ACK and reuses the existing
accepted-execution reconciliation path. An old receiver or failed read preserves
the existing exact-idempotency admission policy; it does not manufacture a fresh
execution. Deploy the Remote RPC receiver before relying on receipt recovery.
After a validated receipt is found, persistence or probe-scheduling failure
belongs to existing delivery retry/accepted-probe repair, not admission timeout.
No new persisted state or recovery state machine is introduced.

The native admission Stop intent is an identity fence owned by existing
native cancellation, validated by `remoteAgentWorkerAdmissionStopIntentSchema`.
Its Organization/Space/idempotency identity and first Stop time remain immutable.
It carries a reason and optional structured recovery provenance, with no
execution phase, submission ACK, or new recovery state machine. Ordinary Stop
can only remove that provenance, never remove the fence. Execution initialization
and guards enforce it. Cancellation keeps its existing envelope with the optional
recovery extension below; `not_found` cannot certify receiver capability to Core.
The native producer and guard ship together; rolling back that guard while
stopped admissions can arrive is unsafe. The intent is retained like existing
execution tombstones and cannot expire to reopen the original request.

The optional native `readAdmissionStop` RPC reads that same fact using the exact
persisted submit request and original conversation route. Its shared response
is `found` with an identity-bound Stop intent or `not_found`. Core validates the
Organization/Space/idempotency identity before using a positive fence receipt.
An old receiver, missing receipt or lookup failure never proves non-execution
or supplies restart authority. This read adds no state, lease or admission.
Pending Space Stop reconciliation forwards native cancellation before consuming
an already-visible stopped Space outcome. A current receiver returning
`not_found` for cancellation must supply a positive original-identity fence
receipt before Core retires that pending delivery; an absent fence or a lookup
failure keeps reconciliation pending. This does not create a submission ACK.
Older receivers retain the pre-existing Space terminal projection policy, but
their unsupported lookup remains distinct from a current owner's missing fence
and cannot enable restart. When cancellation returns an existing execution,
the normal execution/cleanup reconciliation remains authoritative.
Deploy the native receiver before enabling a recovery caller that requires this
proof; a positive receipt does not replace execution reconciliation, current
permission checks or the existing atomic task-continuation owner. Existing
ACK payloads and workstation CLI/Service/Skills contracts are unchanged. Recovery
extensions to cancellation and fence receipts require the compatible readers below.

Manual summary recovery adds optional `summaryOnly: true` to the native
`task_continuation` trigger. Only the task owner derives it from the persisted
`summaryRecovery` subscription; no model tool input sets it. A read-only
`readAdmissionStop` probe opts in with this marker using the original identity.
A supporting receiver includes optional `summaryOnlySupported: true` in its
found/not-found receipt. The marker certifies the restricted runtime tool
catalog, not execution, admission or a Stop fence. Ordinary receipt reads keep
their original strict response shape, including calls from an old Core.

Deploy the Core reader/probe first, then Remote's receiver and restricted
runtime together. Core must not submit a summary-only producer request until
the opt-in probe succeeds. Missing support, old strict receivers and transport
errors make summary recovery unavailable; they never authorize unrestricted
execution. Rollback removes summary producers before the receiver/guard and
retains a compatible Core reader for persisted submit envelopes containing the
marker. This does not change CLI, Service, Skills, setup or workstation Wake
wire contracts and requires no local contract floor bump. Old local clients
still receive ordinary text Signals and Diagnostics.

The task owner persists `summaryRecoveryIntent` on the original subscription
before cancelling the old identity. Cancellation and the native Stop receipt
carry its exact `summaryRecoveryId`; free-text reasons are never identity proof.
The opt-in probe also requires `summaryRecoveryFenceSupported`. A recovery can
resume after a failed receipt read only when the persisted intent matches that
fence. Any ordinary Stop atomically removes recovery provenance and it cannot
be restored; the identity fence itself never expires or reopens. Parent Stop
continues to block the task owner's atomic summary registration.

These fields require Core readers before Remote and explicit receiver support
before recovery writes. Older receivers remain unavailable. Once an intent is
persisted, retain a compatible reader and forward-fix; do not remove the intent
or provenance to force a retry. Baseline strict Core subscription readers reject
the affected row and therefore its queried list batch, even if the new summary
subscription was not created yet.

Core negotiates optional top-level `taskId` through the Remote service binding's
strict `readSubmitTurnCapabilities` request (`{ v: 1 }`) and response
(`{ v: 1, taskId: true }`) before
freezing a new Space admission. A positively missing method means the published
legacy request shape: omit the field. Transport failures and malformed responses
are not legacy capability evidence. Existing frozen requests retain their
persisted payload unchanged, even if the receiver upgrades between attempts;
do not enrich them with a newly available task ID. A missing usage attribution
stays missing rather than being inferred from another task. This probe does not
grant summary recovery support; its existing Stop-fence probes still own that
capability. Once a frozen request contains `taskId`, retain a supporting Remote
receiver until that request can no longer be replayed.

The ordinary-object Remote Worker entrypoint requires exactly one RPC argument.
The capability request is versioned and strict even though it carries no task
data. `pnpm --filter @openmeld/remote-agent test:rpc` runs the actual Core
resolver against the built Remote Worker over a workerd service binding;
ordinary JavaScript mocks cannot establish this calling convention.

This negotiated request permits the supported Core-first rolling window:
new Core continues to accept the old Remote's in-flight completion callbacks,
and omits unsupported attribution on new requests. Deploy and verify Core's
`recordRemoteAiUsage` receiver before deploying Remote. New Remote never starts
a provider call when that receiver is absent; `core.rpc.unavailable` remains a
visible failure with the missing method name. This also applies to new owners
and a receiver disappearing after allowance enforcement. Existing settlement
outbox retries and historical admission audits are retained; neither authorizes
new inference. The data owner defines their retention and deduplication.

Before a continuation is submitted or replayed, Core compares its frozen
pending and recovery envelopes with the task owner's `summaryRecovery` intent.
An unmarked legacy summary fails with
`remote_agent.task_continuation.summary_policy_mismatch` before Worker admission
or receipt recovery. The same validation applies to watchdog recovery and every
native resubmission through the shared admission boundary. A summary marker
without a matching owner also fails closed. Ordinary continuations remain
ordinary. Never overwrite the frozen request, strip owner intent, or allocate a
new operation identity to bypass this rejection.

Before rollout, inventory existing summary subscriptions with retained unmarked
`task_continuation` envelopes, including those with no child result locator.
Keep them blocked and visible for operator diagnosis; use the existing task Stop
path to cancel an affected request if it must be retired. Do not rewrite its
envelope or replay it under the old unrestricted producer. For rollback, first
disable producers and retain this compatible reader/admission guard together
with Remote's restricted runtime. An older Core lacking the guard is not a safe
rollback target for these records; forward-fix instead.

`agentFailureFactsSchema.completedResults` optionally contains up to ten
owner-verified child result references and navigation URLs, distinct from the
failed turn's own `result`. This is a formatter read projection, not a new
callback/Inbox wire envelope or persisted execution state. Native failure copy
can retain same-Space child links while independently omitting an unavailable
recovery action. A failed evidence read never fabricates a result or drops the
visible failure; bounded diagnostic correlation records the missing evidence.

Agent Work's optional `outcome_unknown` presentation is neutral and must not be
shown as failed or business-completed. The current reader maps unfamiliar future
outcome vocabulary to uncertainty. This is an actual stream-enum change: Web and
Core readers must precede the Remote Agent producer. Web opts into rich outcomes
with the existing hello-capability mechanism (`agentWorkOutcomes`). Legacy live
readers receive an ordinary progress delta with the same sequence; HTTP/history
readers receive the existing `agentPublicProgress` field rather than unfamiliar
work metadata. The projection never changes stored receipts or activity.
HTTP history currently uses this generic presentation even for new readers.
No CLI or Service execution, cancellation, admission, or retry authority changes.

`signal.system_notice.data.reasonCode` (schema in
`packages/schemas/src/schemas/space-mesh/signal-system-notice.ts`) carries a
code from this same shared public failure mapping family when a publisher has
one on hand, so clients can group notices and look up recovery copy without
parsing `text` or the legacy `reason` field. See the `signal.system_notice
Field Contract` in `developing/architecture/agent-transport-contract.md` for
the full per-field breakdown, including `failureStage`.

## Readiness Impact Taxonomy

`packages/schemas/src/agent-execution-readiness-impact-taxonomy.ts` owns the
shared readiness-impact taxonomy for Wake failure reason codes that may affect
current Agent execution readiness.

A readiness impact is not the Wake's Final Visible Outcome. It is a Core-readable
input into the current `AgentExecutionReadiness` projection. The current
taxonomy records only Wake failures whose effect is a current readiness blocker
for the exact Agent Profile, Binding, OpenMeld Service Runtime, and Agent Controller
scope.

The lifecycle is explicit: the impact is fresh for the shared TTL. A later
token-validated `running` lifecycle for the exact same Agent Profile, Binding,
OpenMeld Service Runtime, and Agent Controller scope clears it because that
execution has disproved the stale pre-execution blocker. The running lifecycle
may clear only an impact observed no later than that execution's token
authorization, or an impact written by that same dispatch. A delayed running
lifecycle from an older execution must not clear a newer impact written by a
different dispatch. A successful matching execution also clears it.
`runtime_coordinator.delivery_expired` is an explicit readiness impact because a
Wake that expires before local delivery is current local-execution evidence for
the same Agent Profile, Binding, OpenMeld Service Runtime, and Agent Controller
scope. Local setup blockers such as
`controller.launch.choice_required`, `controller.launch.needs_repair`,
`workspace.missing`, and `workspace.invalid` also belong here because the next
Wake for the same execution target is likely to fail until the user repairs the
local setup.

Readiness impact must stay narrower than Wake failure. Long-running execution,
stale progress-evidence diagnostics, malformed agent replies, invalid Space
actions, and Space publication failures remain per-Wake outcome or diagnostic
facts. They do not prove that the Agent Profile cannot currently be woken from
this computer.

Provider-account evidence follows the same exact-identity and monotonic-time
rules but remains its own typed readiness input because its recovery action is
provider account access, not local setup. It must never be synthesized from
passive Usage Limits or an unclassified provider error.

Evidence freshness is not a readiness blocker class. Stale agent controller
reports and aged local evidence mirrors explain diagnostics; they must not
enter the public readiness blocker taxonomy. Current account, Binding, route,
service, and provider-account facts decide availability.

## Shared Database Contracts

Shared contract truth lives in `packages/schemas`.

Shared database truth lives in `packages/db`.

Consumers building predicates for those shared tables import the required
operators and inferred-record types from `@openmeld/db/query`. That entrypoint
re-exports Drizzle directly from the same package that owns the tables and PostgreSQL
factory; it is not another ORM, query implementation, or database authority.
Its ESM and declaration outputs keep Drizzle external, and it must not import
Node-only SQLite tooling into Worker consumers.

Do not combine a shared table with query helpers or inferred-record types from
a consumer-local Drizzle installation. pnpm may resolve the same Drizzle version
with different optional SQLite peers, creating incompatible private/protected
type identities. Auth retains its declared Drizzle dependency for Better Auth's
peer contract, but its own repositories use `@openmeld/db/query`. Fix this
boundary without coercing types, editing dependency links, or undoing the
separately validated SQLite 13 runtime/install fixes.

The durable mental model is:

```text
packages/schemas defines cross-boundary contracts
packages/db defines shared PostgreSQL schema truth
services/auth and services/core expose domain-owned behavior
services/gateway aggregates read-only diagnostics
```

A shared physical database does not imply shared ownership. Auth and Core may
share a physical PostgreSQL database while each domain still owns its own tables and
writers.

Database ownership, projections, Dispatch Ledger, Diagnostic Reports, and
rebuild rules belong in `developing/architecture/data-and-observability.md`.
This document only owns the shared package and contract boundary.

## `packages/agent-runtime`

`packages/agent-runtime` owns shared pure policy for runtime and claim-adjacent
decisions that must stay consistent across CLI, Web, Core, daemon, and adapters.

It is the shared source for:

- Agent Controller refs
- Agent Controller semantic version comparison and capability-range admission
- OpenMeld Service Runtime identity and registry contract helpers
- Prepare readiness summaries
- Agent Profile Binding projections and command eligibility
- Core claim eligibility policy projections
- stable working-language judgment instructions and per-turn advisory rendering

Agent Controller refs must use the shared helpers. Do not hand-build or
hand-parse refs such as `builtin:<id>` or `custom:<id>` in clients or services.

Local Agent adapters, model compatibility, and controller update advice use
`compareAgentControllerVersions` and `supportsAgentControllerVersion` for
SemVer evidence. They retain prerelease ordering and ignore build metadata for
precedence; malformed or missing versions are unknown/unsupported. Each adapter
owns its verified capability range and any upper bound. A newer prerelease may
exceed an older stable floor, but a prerelease of the floor itself does not.
Non-SemVer provider formats such as Cursor's dated builds retain an explicit
provider-specific interpretation rather than being coerced into SemVer.

Version admission never replaces native capability, effective configuration,
managed-policy, or permission evidence. A version rejection, unavailable native
capability, and an incompatible tool policy must remain distinguishable. This
local admission correction changes no setup, Wake, Space action, diagnostic
payload, cloud execution epoch, or minimum CLI/Service contract. Old/new cloud
and local components still interoperate; publication metadata remains deferred
to the authorized local-component release.

OpenMeld Service Runtime IDs used for Binding or claim eligibility must be opaque
authoritative Runtime Registry IDs. Do not derive claimable runtime identity
from owner, device, or lane lookup strings.

Runtime execution identity is a boundary envelope. The server-side execution
authority creates it from Runtime Registry, Binding, and route evidence. Daemon
runtime evidence and task results must echo the delivery identity received in
dispatch context instead of replacing it with Prepare evidence, service-contract
evidence, or claim-lease projections.

Task-result telemetry may add privacy-safe controller context observations:
non-negative last-turn and cumulative token counters, the controller-reported
model context window, and whether context compaction was observed. These fields
are optional for rolling compatibility. They must use the shared task-result
schema, contain no prompt or response content, and remain diagnostic evidence
only. A missing field means the controller did not provide proven evidence; it
must not be reconstructed from local prompt length or model-catalog limits.

## Execution Tokens And Finalization Contracts

RuntimeCoordinator execution token handling is execution authority, but the
shared contract shape must stay centralized.

Core issues and stores the execution token before daemon delivery. The daemon
echoes the received token from dispatch context. Core validates the echo before
advancing lifecycle or accepting result frames.

Runtime Transport capability `agentReplyContextReview: true` means the Service
understands the additive `review_required` result-settlement response and can
resume the exact controller conversation with a bounded Space cursor delta.
Core emits that response only to a session advertising the capability. An old
Service omits it and therefore never receives the new status. Because the base
capability envelope is strict, the cloud receiver must deploy before a Service
that advertises this field; an old Core does not silently ignore unknown base
capabilities. `review_required` is non-terminal: it does not accept the dispatch
result, retire execution authority, or create another Wake.

Finalization commands and outcomes must use the shared RuntimeCoordinator
finalization command schema. Do not hand-build finalization envelopes in Core,
daemon, adapters, or clients.

The Space-owned publication-exhaustion RPC accepts that same finalization
command and returns the shared final-claim outcome. Its additive
`publication_failed_visible` outcome carries the claimed failure-notice signal
id. Callers must parse the shared schema, treat invalid payloads as observable
contract failures, and keep retry state when an older deployed Space object
does not yet support the RPC.

Token secrets must not be exposed in diagnostics.

Shared schemas and helpers define the envelope. RuntimeCoordinator and Core
execution paths enforce the authority.

## Policy Projections Are Not Authority

Agent Profile Binding command eligibility and Core claim eligibility are policy
projections only.

They may answer whether a command or claim appears eligible from known facts.
They must not:

- grant claim success
- reserve leases
- create attempts
- accept results
- start runtime execution
- consume queues
- publish Space replies
- decide final Wake outcomes

Only the owning execution path may perform those actions.

Legacy or compatibility paths must stay diagnostic unless explicitly migrated
into the RuntimeCoordinator authority path. Caller authority, owner evidence,
Binding evidence, and claim truth must come from verified Gateway/Core context,
not request bodies.

## Execution Context Contract

`packages/schemas` owns `ExecutionContextSelection`, the Core-created request and
assignment, the Service task projection, and the returned completion. Clients
submit only a selection. Core constructs requester/discussion scope and assigns
the context once. Native conversation IDs and local workspace fingerprints are
resolved from retained Core context records. Results echo the context ID; native
history checkpoints are stored per accepted Wake and survive Head retirement.
A code-work selection may carry `projectWork` with one Project ID and canonical
repository fingerprint. RuntimeCoordinator freezes that pair in the assigned
Context; a retained Context cannot change it by editing Project defaults. Core
verifies the current Project association before delivery. The Service resolves
only an owner-local matching connection and never receives a cloud-selected
absolute path. An invalid or removed association fails visibly without
selecting another repository.
A fork source's completed-history boundary is optional in the assignment: when
no checkpoint was frozen, Core names the source identity and the harness
confirms the boundary from that source's own retained history.

An explicit new Codex or Claude Code Context with no access restriction inherits
the Agent's settings when that controller supports permission inheritance.
A retained Context keeps its existing access contract; explicitly selected
Space-only work remains code-free. An independent project task selects
`workspace: isolated`. `workspace: isolated`
with local access now means a committed project worktree with private Git data.
The local preparation journal binds the shared assignment to its source and
starting commit. Its paths remain local; it neither replaces the Core context
association nor introduces a second Project connection. Source policy is checked
before materialization, and native project access is probed before execution.
Codex retains native platform temporary-directory access; that contract does
not promise complete temporary-directory isolation. Claude Code project access
requires a running Docker or Podman Linux-container engine on macOS, Linux, or
Windows. The Service verifies one task-only mount before execution. Its
dispatch-scoped `project_shell` MCP tool checks the current attempt's workspace
lease on each call, then runs Bash with no container network, host credentials,
or host socket. Claude's host file tools use restricted working-directory
access; host Bash is unavailable. Container commands must stop before the
Service releases or reconciles the task workspace.

Core sets `contextRequest.required` only for an explicit client selection. An
ordinary thread Wake carries its discussion scope with `required: false`; the
Context authority creates implicit thread contexts only for supported harnesses.
Other harnesses retain their existing serial Binding path and do not select
retained Context history from a previously configured harness. Explicit
new/resume/fork/auto selections never fall back to that path. This changes Core's
request-selection policy while retaining existing Binding, lifecycle, and
readiness checks. Claude project contexts additionally require Service adapter
`executionContextVersion: 3`; older Services receive a visible update-required
outcome. Version 2 remains sufficient for the legacy association and Codex
contexts. The shared assignment wire shape remains v1.
An assignment with `projectWork` requires Service adapter
`executionContextVersion: 4` for Codex or Claude Code. Older Services receive
`service.update_required` at admission before an execution token or local
workspace is used. The optional field leaves legacy assignments readable and
keeps the assignment wire version at v1.

An optional `projectWork.commit` freezes a complete 40- or 64-character Git
commit ID. Such assignments require adapter capability 5 at admission and
delivery, including reconnect. An older Service must receive update guidance
before execution, never a selection with the commit removed. The local journal
retains the requested commit and the existing workspace lifecycle owns retry,
continuation, and retention. Starting a current-folder Context verifies HEAD and
rejects preexisting local changes; resuming its established native Context keeps
subsequent work. Isolated preparation leaves the connected checkout unchanged.
For continuation and fork selections, an omitted commit with the same Project
and repository inherits the retained pin. An explicitly different commit is
rejected. Fork assignment always retains the complete source Project work.

`SpaceWorkHandoff` version 2 adds the exact source message revision, execution
choices, and a complete work brief. Its strict variants separate materials:
without `code`, execution must be `space_context` and `isolated`, and a Project
selection is rejected; with `code`, an exact Project/repository and full commit
are required with the existing repository permission choices. Both allow an
empty shared-file selection. Version 1 retains its selected-file contract.
The Core-created accepted dispatch snapshot freezes optional `workHandoffVersion`
from the authored manifest so admission and reconnect check capability 5 for all
v2 workstation handoffs, including brief-only work. Delivery rechecks the active
adapter version. Only nonempty selected-file sets also require `spaceWorkHandoff`.
Normal-message HTTP callers send the matching `workHandoffVersion`; thread
callers carry the same versioned manifest. Space validates the current source,
original placement, one target, and matching Context selection. Its existing
client-message idempotency also fences changed Context selections. Public history
omits the v2 manifest so older readers retain the readable message and files;
the authored manifest stays in persistence and dispatch snapshots.

Contract impact: deploy compatible Core and Remote Agent schema readers and
materialization before Gateway and new callers. Then publish the CLI/Service
with capability 5 before enabling the Web entry point/new CLI manifests.
The Remote Agent native path accepts brief/shared-file v2 work and rejects
repository work before provider submission. An empty shared-file set reuses its
existing working directory without creating an unmaterialized copy receipt.
Capability 5 and v2 are unreleased additions in this PR; earlier draft artifacts
must be replaced together. Older Services continue ordinary and v1 work but
reject v2 work; older clients can read its message. No database migration,
new cloud resource, or new handoff lifecycle is introduced. Roll back callers
first. Once v2 messages are persisted, retain compatible Core readers for their
entire retention lifetime, including completed handoffs. Computers that ran
v2 tasks must also retain a compatible Service reader for their retained
Context/workspace records. The
CLI/Service bundle and registry require normal local-component release validation;
this feature does not authorize production deployment or release stamping.

The public signal read encoder omits `contextSelection` so older strict history
readers remain usable. This encoder must never be used for persistence, dispatch
snapshots, or authoring. The existing singular workload reference remains a
compatibility projection of the first reserved task; waiting counts exclude all
reserved contexts. Per-Wake progress continues to show every actual execution.

The Profile admission ceiling is five reservations plus 50 waiting Wakes,
owned by `packages/agent-runtime`. Readers accept five reservations and 55 total
work items, including records retained across a temporary reduction in capacity.
Serial policy reduces future reservations to one while retaining Context
identity and already reserved work. Setup, dispatch-owned actions, status,
trace, and self-rescue retain their contracts.

Restoring parallel capacity from three to five changes the shared admission and
local slot policy, not the wire shape or capability version. Existing readers
already accept five reservations and 55 total items. A Service built with the
three-task policy remains locally limited to three until updated; compatible
Core and Service builds must both use the five-task policy to reach that ceiling.
The existing serial switch continues to admit one task. This policy change does
not add host-resource admission or certify five-way native execution.

The local Space Action receipt is deliberately limited to
`proposal_saved_locally`, `rejected_closed`, or `outcome_unknown`. Its
`coordinatorAcceptance` and `publication` fields remain `unconfirmed`; it does
not implement remote `accepted_for_finalization` or `published` receipts. Core
execution and Space publication must be read from their existing authorities.
The separate Late reply presentation remains outside this implementation.

Contract impact: HTTP signal/thread sends gain optional selection fields;
accepted snapshots and RuntimeTransport gain version-1 context assignments;
current task results gain context identity/completion fields; the local ledger
and fork journal migrate to v2. Dispatch Space Action authority is unchanged;
the per-Wake tool catalog adds `project_shell` only for a verified Claude
project context, without granting a second final action path.
Setup, Service installation, CLI self-rescue, and managed Skill contracts are
unchanged. Legacy unscoped execution keeps its existing payload and epoch.

The owner-shard work-coordinator record advances to v3 for the durable migration
marker and serial/parallel policy. Its reader accepts v1/v2 and the original
legacy execution-admission record; it preserves previously accepted five-slot
data. An earlier v2 binary is not a supported rollback reader for v3 policy.

`GET` and `PATCH /v1/agent-profiles/:id/execution-mode` use the shared execution
mode schemas. PATCH accepts only `serial` or `parallel`; the response reports
Profile id, mode, migration phase, and revision. Core rechecks current
Organization and Profile ownership, then mutates the existing owner-shard
record under the same transaction/index-generation fences as admission. Clients
cannot use this endpoint to supply native IDs, migration boundaries, or higher
numeric capacity. An additive reader-first release is required before exposing
the new CLI caller.

Scoped delivery carrying the Core-owned legacy association requires a fresh
Service adapter declaration of `executionContextVersion: 2`, as well as
runtime-specific file-access verification. The reader still accepts version-1
capability declarations and existing task envelopes without the additive legacy
association. An older Service receives a visible update-required outcome when
it cannot read the selected task contract, never a delivery that silently reuses
the Binding conversation. Assignment/history version remains 1; the capability
increment identifies the new Service-side migration guard. Older Core strictly
rejects unknown capability declarations, so deploy Core/Gateway support for
version 3 before distributing this Service and Web/CLI feature. This ordered
rollout is required; publishing the local component first is unsupported. Local-component
release metadata is deferred in the feature PR and must be produced by the
guarded release workflow before production rollout.

The legacy association is server-owned metadata from a current primary Binding
read under the owner-shard mutation lease. The local Service compares only the
selected pre-isolation Profile/controller/transport/workspace ledger lookup;
two known, unequal native IDs reject before execution. Missing evidence does
not choose or rewrite an identity, and unrelated historical roots are not
treated as conflicts. The association is omitted from local workspace identity
and never grants the requesting member access to the legacy transcript.

## Agent Profile Binding Contract

Profile settings and Space working-folder recovery carry the shared
`expectedBindingTarget` tuple:
Binding ID, Service Runtime ID, controller ref, and nullable conversation ID.
It is a read/write precondition, not another Binding store or execution authority.
The private saved-configuration GET verifies it before and after its Service
read. Its configured/missing/invalid result is defined in `packages/schemas`;
the configuration version is the local envelope format, not a Binding revision.
GET responses use no-store and do not populate a second configuration cache.
Core checks the tuple inside the existing execution-target admission before
Service writes, and inside the existing future-work admission before Auth's
Default Project write. These remain two ordered writes with explicit partial
success; they are not an atomic cross-service transaction.

Gateway requires the named Core receivers
`setBoundPeopleComputerAgentProfileWorkspace` and
`updateBoundAgentProfileDefaultProject` when that tuple is present. An old Core
receiver must fail without fallback to the unguarded methods; an old Gateway's
strict HTTP body rejects the new tuple before writing. Deploy Core, then
Gateway, then Web. Ordinary explicit Computer configuration without the tuple
retains its existing contract. The write precondition changes no Auth or Service
write payload. The private saved-configuration read adds a separate Service
capability and correlated frame; its strict registration receivers must deploy
before the new Service. An old readiness projection without a canonical Binding ID
cannot acquire a recovery draft. Local CLI/Service, Skills, setup, Wake and
diagnostic compatibility floors remain unchanged by this correction.

The shared Agent Profile Binding contract must stay synchronized across schemas,
API client, Core command/lookup services, and Gateway route behavior.

Binding connects:

```text
Agent Profile -> openMeldServiceRuntimeId + agentControllerRef + controller-native settings
```

`agentControllerPermissionMode` is shared Binding metadata. It stores the user's
per-profile controller-native permission mode and must move through the same
cross-boundary contract family as the Binding itself: shared schema, API
client, Gateway/Core write path, route catalog projection, daemon cache, and
local adapter invocation. The dispatch queue must not duplicate the setting; it
freezes only the owning `bindingId` and monotonic `configurationRevision`.

An active-session permission update is a process-internal `RuntimeAdapter`
capability, not a second permission source or a new cloud-to-Service command.
The Service reacts to the existing canonical route-catalog change, compares
that projected mode with its in-flight task record, and asks the matching
adapter to update the active controller session. Only an explicit `applied`
acknowledgement advances the task record, and its stable meaning is
`subsequent_tool_requests`. `not_applied` must distinguish an inactive task,
controller-incompatible value, and unsupported live update. The adapter
capability must never approve or deny an already-pending Agent Interaction,
change repair-only constraints, or imply that the accepted Binding revision was
rewritten.

The shared runtime resolver owns the native catalog values. Claude Code values
mirror `claude --permission-mode`: `claude-code:default`,
`claude-code:acceptEdits`, `claude-code:plan`, `claude-code:auto`,
`claude-code:dontAsk`, and `claude-code:bypassPermissions`. Codex values mirror
its product permission modes and CLI/config mapping: `codex:askForApproval`,
`codex:approveForMe`, `codex:fullAccess`, and `codex:customConfig`. Cursor
values mirror its ACP mode and launch controls: `cursor:default`,
`cursor:plan`, `cursor:ask`, `cursor:autoReview`, and `cursor:force`.
Grok Build values mirror its native permission mode: `grok-build:default`,
`grok-build:acceptEdits`, `grok-build:plan`, `grok-build:auto`,
`grok-build:dontAsk`, and `grok-build:bypassPermissions`.
Codex transport adapters preserve the product intent through their native
interfaces instead of sharing one literal approval-policy value:
`codex:askForApproval` uses CLI `untrusted` for CLI execution and App Server
`on-request` for interactive sandbox escalation. The App Server mapping is
required so an explicit escalation produces a native approval request rather
than an immediate `UnlessTrusted` rejection. `codex:approveForMe` also uses
App Server `on-request`, with `approvalsReviewer=auto_review` routing eligible
requests to Codex Auto-review instead of the user.
Structured Space Action repair is an execution constraint, not a Profile
permission choice. Repair must not replace the canonical Agent Controller
conversation or persist a temporary permission choice. Codex transports use an
isolated fork with read-only sandboxing and the native `untrusted` approval
policy. Claude Code uses an isolated Agent SDK or CLI fork for temporary Plan
mode. OpenCode uses an official Server session fork while preserving the exact
Binding-owned `OPENCODE_PERMISSION` JSON. Cursor and Grok Build have no proven
native fork, so their repair turns keep the exact Binding-selected permission
mode and must not apply a temporary repair-only mode. The shared adapter
dispatch shell requires canonical conversation continuity for Codex, Claude
Code, Cursor, Grok Build, and OpenCode. A refreshed or different conversation
fails repair explicitly; the shell must not relabel it as the canonical
conversation. OpenClaw remains provider-managed and outside this contract until
its repair semantics receive a separate audit.

Agent Controller conversation occupancy is a separate versioned adapter and
daemon-lifecycle contract. Version 1 carries only the exact controller
conversation id and `occupied` or `available`; provider adapters may produce
`occupied` only from an official atomic admission result. Core records that
evidence against the current Profile FIFO head, while the local Service retains
and retries the same Wake. The original provider error remains adapter
diagnostics and does not itself drive state. Unknown providers, generic
transport failures, Agent Activity, and process presence cannot populate this
contract. After a transition, the first running keepalive, the first keepalive
on a new connection generation, and a low-frequency recovery keepalive repeat
the current occupancy value so Core can recover a missed frame without a second
provider query. Intermediate keepalives omit the additive field for older-Core
compatibility.

The Agent Profile work-recovery contract exposes only idempotent owner actions
that change current coordinator state. Every public recovery action carries the
`expectedInterruptedTargetWakeLifecycleId` from the owner's displayed recovery
projection. Approval compares this identity and the approval phase in the same
owner-shard transaction that advances the queue; continuation and Skip retain
their exact-source transactional fences. Queue growth, cancellation, and other
admission revisions do not invalidate a choice about the same interrupted work.
Missing identities are rejected, never filled from a fresh server read. A
confirmation for one task closes when its action or task identity changes.
Repeated queue approval cannot advance another recovery; no historical approval
receipt is implied by a no-longer-pending response. Continue can retry a saved
Fork choice for the same task, but cannot make the first Fork choice implicitly.

The public request and internal queue-approval RPC remain strict. During rollout,
new Web requests may be rejected by old Gateway/Core or old owner shards, and
old requests without an identity are rejected by new receivers. Recovery writes
must wait for compatible receivers; ordinary Wake traffic and automatic Usage
continuation keep their existing contracts. Update Web, Gateway, and Core in the
normal coordinated cloud order and verify the exact-source request through the
owner shard before declaring recovery available. Do not fall back to the old
unfenced body on a mixed-version error. This cloud-only request change does not
require a CLI or Service contract epoch increase or restart. Existing optional
projection identity fields stay optional for old readers; new Web refuses an
action when an older projection cannot supply its identity.

`skip_interrupted_work` resolves an exact
`continuation_needs_attention` gate and promotes the oldest queued Wake; it does
not replay the interrupted request. Its strict request carries the current
interrupted target-Wake lifecycle id, and the owner shard compares that identity
before mutation so a stale Web action cannot clear a later gate. Usage-based
automatic continuation requires the exact current
`usageLimitsSupportMatrixVersion`, the same Profile, controller, Binding, and
configuration, the same nullable Default Project, complete replayable source
context, and no prior automatic continuation attempt. The continuation
authorization request also carries the current canonical Binding tuple, the
Auth-owned nullable Default Project, and an explicit accepted-revision
verification marker; the owner shard compares them with the interrupted run
command snapshot in the same transaction. The new Default Project field is
additive on the wire, but a new owner shard treats an omitted field as unsafe so
an older caller cannot continue without this fence. Missing or mismatched
accepted evidence is unsafe. An unsafe request or failed automatic continuation
stays behind one current Needs-attention projection instead of entering another
retry loop.
The resulting Space handoff is a separate owner-only Usage-continuation
command. It carries the frozen interrupted source identity plus deterministic
operation and client-message identities, the exact canonical Space File
revision references, and the structured Agent Reference targets. Repeated
commands converge through Space's ordinary exactly-once client-message writer,
including its current file and addressing validation, and cannot create a
second handoff. The command never depends on the public Execution Recovery
`retry_as_new_execution` capability. That legacy schema member remains accepted
for mixed-version parsing while public inspection and execution keep it
disabled.

RuntimeCoordinator head admission keeps its existing version 1 wire shape so a
new Core caller cannot stall ordinary Wake traffic on an older strict owner
shard. The initial continuation authorization compares the current canonical
`bindingId`, `agentControllerRef`, `configurationRevision`, and Auth-owned
nullable `defaultProjectId` with the interrupted run command in the owner-shard
transaction. Future-work settings use a dedicated owner-shard mutation RPC
instead of adding a field to the existing strict execution-target mutation
request. That transaction moves a
pending or authorized continuation to the single Needs-attention gate and
writes its Inbox intent before the cloud Binding write may begin. If the
continuation head wins the owner-shard order first, it becomes running and the
setting may save for later work without changing the current execution. An
older shard that lacks the dedicated future-settings RPC rejects the setting
write before PostgreSQL mutation; ordinary Wakes continue on the unchanged hot path.

The RuntimeCoordinator head no-execution contract is also the durable boundary
for a canonical readiness block found after a Wake already owns the Profile
head. One shared mapping converts every canonical blocking reason into its
exact reason code plus a bounded publication category and recovery action;
this includes disabled Local Agent, reliable Usage `Checking` or exhausted
outcomes, and the wider Profile, Binding, workspace, controller, route,
Service, and provider-access blocker families. A fresh Wake with one of those
facts is rejected before head admission; an existing matching head is settled
through the no-execution request without a second accept call. The exact reason
code selects shared public copy, while the bounded recovery action gives the
user one next step. Raw provider text remains only in Message Details and never
selects admission behavior.

The owner-only Organization directory projection may add the interrupted
target-Wake lifecycle id beside a paused recovery action. Web accepts the field
additively, requires it before sending `skip_interrupted_work`, and asks the user
to refresh when an older projection omitted it. Non-owner projections omit both
the action and this identity. The directory request advertises Agent Profile
work-recovery contract version 2 before Core may emit `skip_interrupted_work`;
requests without that capability continue receiving only the older recovery
actions, so an already-loaded strict Web build cannot reject the whole
directory. The strict Core Skip request still fails closed for unfenced callers.

`agentControllerCollaborationMode` is independent shared Binding metadata.
The initial values are `codex:default` and `codex:plan`; non-Codex Bindings
must reject them. The field moves through the shared Binding schema, API
client, Gateway/Core write path, PostgreSQL Binding record, owner read projection, and
local route catalog. The local Codex adapter translates it into
`conversationPolicy.collaborationMode` and verifies the native App Server Plan
preset before starting the turn. The App Server preset mask supplies mode,
model, and reasoning effort; `turn/start` sends
`developer_instructions=null`, which the native protocol defines as using the
built-in instructions for that mode. Plan requires either the selected model or
the model resolved by the thread response; Default does not require a thread
response model. It must not be derived from or merged into
`agentControllerPermissionMode`.

Legacy Binding rows with no stored collaboration mode retain Codex Default
execution semantics, but read projections must omit the optional field rather
than manufacturing `codex:default`. Owner-initiated primary-Binding reads and
writes return an explicitly stored value. The unversioned execution-readiness
projection omits it so old strict Web and Gateway consumers remain compatible;
Web reads the editable value from the owner Binding endpoint. Reconnecting the
same controller to a different local runtime preserves every stored Binding
setting, including the conversation id, collaboration mode, permission mode,
model, reasoning level, and OpenCode permission. Reconnect is a
runtime-assignment command, not a settings mutation: a reconnect request omits
editable setting fields, and Core preserves their latest committed values when
it writes the new runtime assignment. A cached client snapshot must never be
replayed as an explicit settings patch. Only an explicit settings command may
carry editable settings and use `configurationRevision` for compare-and-set
protection. Switching controllers does not inherit settings from the previous
controller.

The existing strict expected-routes response remains the v1 mixed-version
shape and never emits `agentControllerCollaborationMode`. `contractVersion=v2`
adds collaboration mode. `contractVersion=v3` additionally carries the
Binding's `configurationRevision`. `contractVersion=v4` additionally carries
the current Auth-owned `defaultProjectId` as a nullable Project identity. A new
local component negotiates newest first and falls back from `v4` through `v3`
and `v2` to the legacy query only when the server
returns `invalid_payload`, whether surfaced as the direct Gateway error code or
its legacy upstream-code alias. It must not retry network or server failures as
compatibility fallbacks.

A Service that successfully negotiated v4 uses the strict v4
`LocalWakeRouteReport` branch with `expectedRoutesContractVersion: "v4"` and a
required `workingFolderObservations` array. A legacy report has neither field;
there is no v3 report marker. Each observation is path-free and echoes the
Profile, Binding, Binding configuration revision, nullable Default Project,
observation time, resolution source, status, and nullable local Project
`bindingGeneration` (named `localProjectBindingGeneration` across this mixed
identity boundary). The seven legal fact shapes are Default Project ready,
missing connection, missing folder, or invalid connection; and Profile
workspace ready, missing, or invalid. Non-ready observations use only
`project.local_connection.missing`,
`project.local_connection.folder_missing`, `project.local_connection.invalid`,
`profile.workspace.missing`, or `profile.workspace.invalid`. The Core trust
matcher accepts a set only when its echoed current identities match and the
report provides exactly one observation for every current expected Profile.
Duplicate, missing, extra, stale, or mismatched facts make the observation set
unknown. `localProjectBindingGeneration` remains an opaque Service-owned local
connection identity: Core does not compare it with a cloud value, and a later
accepted report replaces the earlier generation. Core Wakeability and dispatch
admission consume this matcher as the single current working-folder gate. Once
that gate is enabled, an online Service that can only send the legacy report is
shown as requiring an OpenMeld update; it is not misreported as Offline or as a
damaged Agent setup. Rollout therefore publishes the new Service package first,
then enables the Core gate. A new Service falls back to the legacy query only
after an explicit v4 negotiation failure, so it remains compatible with an old
Core during that rollout window.

`openMeldDaemonDispatchControllerSnapshotSchema` carries optional `bindingId`
and `configurationRevision` as frozen execution-consistency identity. The
Runtime Transport capability `profileConfigurationRevision: true` means the
Service can report the applied identity in `LocalWakeRouteReport`. Core must
require an exact match before delivery to a capable Service and return
`daemon.profile.configuration_not_synced` on drift. For an older Service, Core
omits the new fields before sending the strict frame. These fields do not carry
the editable settings, grant a lease, or replace RuntimeCoordinator authority.

Cursor and Grok Build runtime transports are ACP-only. The shared runtime
transport and native interface schemas use `acp`; each adapter exchanges
newline-delimited JSON-RPC through the shared adapter-core ACP session/process
mechanics. Cursor launches `cursor-agent acp`; Grok Build launches the verified
`grok` contract with `--no-auto-update --permission-mode <native-mode> agent
--no-leader stdio`. Provider-specific launch, authentication, model, mode,
extension-request, update, and error behavior stays inside the selected
adapter.

Cursor session identity comes from `session/new` or `session/load`. Grok Build
session identity comes from `session/new` or `session/resume`; `session/load`
is not used to pretend replay is resume. Both bridge through the existing
`agentControllerConversationId` contract. Neither is an IDE chat ID, Space
thread ID, Binding identity, or execution authority.

`packages/schemas` owns the cross-controller Agent Interaction contract.
`agentInteractionRequestSchema` carries one bounded `permission`, `question`, or
`plan_review` request with a unique interaction id, request and expiry
timestamps, native choices, and only the details needed for the owner to decide.
`agentInteractionResponseSchema` carries the matching permission option,
complete structured answers, plan decision and optional feedback, or cancel.
`agentInteractionResolutionSchema` validates request/response compatibility.
`agentInteractionPendingSummarySchema` is the privacy projection used by Wake
progress: the Binding owner receives the request and `canRespond=true`; other
authenticated Space members receive a content-free summary and cannot respond.

The Runtime Transport frame family carries interaction request, response, and
delivered acknowledgement envelopes. These frames reuse the exact dispatch
execution authority and token echo; interaction ids are correlation, never
execution authority. Wake progress exposes `pendingInteraction` as an optional
additive field. Space's response HTTP/RPC contract carries only the public Wake
selector, interaction id, and shared response; Core resolves private execution
authority and must not accept it from the browser.

RuntimeCoordinator serves `interactionUpdatedAtMs` only from the revision read
(`/runtime-coordinator/interaction/read-revision`); the original interaction
read keeps its frozen `{ pendingInteraction }` body. Space and the Runtime
Transport Hub are separate Durable Objects that can briefly run different
Core builds, so a reader whose revision read is answered with anything else
(an earlier Hub returns `not_found`) falls back to the original read, keeps the
request visible, and leaves the lifecycle revision unchanged. The value is the
Core time of the execution's latest interaction change (the request reaching
Core, its answer, or its expiry), or null before any interaction.
Space folds it into every Wake progress item's `updatedAtMs` for that
execution. A request or answer therefore advances the item revision even when
the lifecycle record is unchanged, so a client holding an older copy of the
same lifecycle revision, such as a per-message poll taken before the request,
cannot outrank the newer interaction state. The Service's `requestedAtMs`
stays display data and never orders progress.

Provider adapters map native protocols into this contract without creating
provider-specific approval truth:

- Codex App Server maps current and legacy command/file approvals,
  `requestUserInput`, additional permissions, and MCP form or URL elicitation;
- Claude Agent SDK maps `canUseTool`, `AskUserQuestion`, `ExitPlanMode`, and MCP
  elicitation;
- Cursor ACP maps `session/request_permission`, `cursor/ask_question`, and
  `cursor/create_plan`;
- Grok Build ACP maps `session/request_permission`, the observed and pinned
  `_x.ai/ask_user_question` / `x.ai/ask_user_question` methods, and
  `_x.ai/exit_plan_mode` / `x.ai/exit_plan_mode`; and
- OpenCode maps its permission and question event/reply APIs.

Native permission modes still decide whether a provider asks and which choices
it offers. Adapters must not invent approval options, widen a decision, persist
an `allow_always` choice the provider did not offer, or turn a force/bypass mode
into a redundant prompt. Provider cancellation uses its native turn/session
interrupt path.

The rollout is consumer and receiver first: deploy Web, then Gateway, then Core
and Runtime Transport support, and only then publish the CLI/Service producer.
New Web and Gateway accept old Core responses because `pendingInteraction` is
optional. New Core remains compatible with an old Service, which emits no new
interaction frames and retains its previous explicit fail-closed behavior. A
new Service must not run against old Core: the old strict frame receiver cannot
route the interaction and may leave the provider waiting. No PostgreSQL migration is
required because pending interaction state belongs only to RuntimeCoordinator.
The existing schema version and runtime contract epoch remain valid because no
existing frame changed and the new producer is released only after its strict
receiver. Stamp the touched CLI and Service components as advisory `available`
because existing Wake work remains safe on an old Service. Product surfaces
still advertise the newer Service through the existing local-component update
projection without blocking unrelated Wake work.

`session/cancel` remains the structured ACP runtime cancellation for Cursor and
Grok Build. Grok Build Stop additionally requires `session/close` plus
supervised process-tree cleanup before the execution is reported stopped.

Clients may render controller-native labels, but they must not duplicate the
permission matrix or invent a separate local enum. Unsupported controllers must
not show a selector. Read projections fail closed through the shared resolver;
explicit user writes for unsupported values should fail with a clear error
instead of silently storing an intent the controller cannot honor.

Model and reasoning intent are also shared Binding metadata, but their allowed
values come from the deployed vendor-model catalog rather than a static schema
enum. Shared request schemas therefore keep bounded strings. Core is the
authoritative write validator: an explicit model must be available for the
Binding's `agentControllerRef`, and an explicit reasoning level must be listed
for that model. Core rejects the whole write with stable 400 error semantics and
the supported values when either check fails. Omitted model intent keeps the
default-model path unchanged. Daemon-side effective-model fallback remains a
last defense for catalog-version drift or previously stored selections; it must
not turn an invalid new write into a silent downgrade.

Cursor ACP model IDs are account-scoped exact values returned in the session
descriptor. The repo catalog is a reviewed snapshot for selection and offline
fallback, while the adapter validates the chosen ID against the current
session's offered values before calling `session/set_model`. Cursor ACP does not
expose reasoning strength as a separate session option; reasoning-bearing
parameters remain part of the exact model ID and Cursor catalog entries expose
no independent reasoning levels.

Grok Build model and reasoning choices are also account-scoped live ACP facts.
The repo catalog defines selectable intent, but the adapter requires a complete,
consistent initialize/session inventory for the authenticated account and
rejects a requested catalog model or effort that is missing there before
`session/prompt`. It must not rely on Grok's permissive input handling as
validation, select another live model silently, or replay through Headless JSON.

OpenCode permissions are a separate OpenCode-only Binding field, not an
`agentControllerPermissionMode` value. The shared schema stores the official
OpenCode permission JSON object. Core may project it on Binding reads and
expected routes only when `agentControllerRef` is `builtin:opencode`; other
controllers must reject explicit writes or omit the field. The local route
catalog, daemon cache, runtime task route, and OpenCode adapter must carry this
field unchanged until the adapter serializes it into `OPENCODE_PERMISSION`.
OpenMeld must not invent a controller-agnostic permission policy layer for this
field.

Binding existence does not make Wakeability `Available`.

Binding command eligibility does not grant claim success.

Unavailable Core primary Binding reads are not the same as missing or unbound
profiles. Route catalog loading and recovery surfaces must fail closed and avoid
turning unavailable evidence into destructive state changes.

## `packages/agent-profile`

`packages/agent-profile` owns shared Agent Profile product semantics only where
reusing the rule prevents cross-client drift.

Its current scope is Agent Profile Reply Recovery:

- consume Core-owned `AgentExecutionReadiness`
- consume Core-provided action intent or primary action evidence
- consume adapter-provided current-local-Runtime evidence
- translate those facts into one user-visible next action and copy

It does not own Wakeability truth.

It also does not own Start or Prepare orchestration, OpenMeld Service lifecycle,
Space rendering, RuntimeCoordinator execution truth, dispatch, claim, final Wake
outcomes, or reply placement.

Adapters must flatten source-specific evidence before calling this package. Do
not import Start-owned setup, device projection, or profile Wakeability types
into `packages/agent-profile`.

## Cross-Client Reuse Policy

### Profile and Organization business HTTP adapters

`organization-actions.ts` defines strict safe Organization management inputs,
invitation display results and error code/message envelopes. Existing Profile,
join-link, public join-request, Space-invitation and account-context schemas stay
their respective owners. Fixed Web handlers call existing Auth HTTP endpoints;
Auth/Core remain the only authorization and mutation owners. Never expose the
internal invitation RPC union through these adapters.

Contract impact: these are additive Web HTTP routes and an additive Auth Agent-only
DELETE route. The Agent precondition is internal to the deletion service, not a
caller-selectable field. No CLI/Service/Skills runtime contract, Wake envelope,
setup command, trace response, database schema or execution epoch changes.
Old and new local components retain their existing cloud setup/Wake/Space-action
and diagnostic contracts. No local component stamp is needed.

Rollout: deploy Auth before the new Web handlers, then release Desktop with its
separately accepted native API/trust contract. Cookie Profile creation now requires
the existing trusted-origin check: old generated Web create helpers did not
forward Origin, so minimize the Auth-to-Web deployment window (those old helpers
fail closed until Web is updated). Verified bearer callers without cookies retain
their behavior. Roll back new Web/Desktop callers before Auth; do not remove
cookie-origin enforcement to restore an older unsafe helper. Browser security
and account session endpoints remain outside this change.

OpenMeld has both Web and CLI clients. New feature work must classify touched logic
before implementation.

Classify each concern as one of:

- shared domain or application logic
- client adapter or shell logic
- client-exclusive UX or platform integration

Shared domain or application logic belongs in `packages/*` when it is
transport-agnostic and should stay consistent across clients.

Bias toward extraction when duplicated implementations would create semantic
drift in:

- workflow planning or next-action decisions
- state composition and read models
- validation, normalization, parsing, or write preparation
- identity resolution and target catalogs
- mention handling and shared display metadata
- API composition and shared error semantics

Keep logic inside `clients/*` when it is genuinely client-specific:

- routing
- rendering
- layout
- interaction state
- presentation-only copy
- terminal prompts
- ANSI rendering
- local process control
- filesystem or browser APIs
- browser clipboard, cookies, URL state, and storage

Do not extract code only because two clients use the same noun. Extract only
when the shared rule improves correctness, consistency, reuse, or long-term
maintainability without weakening UX.

## Dispatch Trace Response Contract

`packages/schemas/src/schemas/http/space-dispatch-trace.ts` owns both the
legacy and current strict trace response schemas. A caller requests the current
contract by sending
`x-openmeld-space-dispatch-trace-response-version: 7`. Core also accepts
versions `2` through `6`; without the header, Core projects the legacy version `1`
subset. Version `2` omits every version-3-only head no-execution detail,
including disabled-Local-Agent, reliable Usage, and newer canonical blocker
families, while retaining the surrounding generic dispatch and attempt
evidence. These projections validate each detail against the frozen version-2
schema and omit newer values instead of substituting a misleading historical
Binding reason or sending a payload an already-published strict CLI cannot
parse.

Version 7 adds optional `executionContext` diagnostics to the Head trace,
including a `missing` Head whose exact Wake-to-Context association remains.
The owner reads that association and validates its Space and target. The
projection contains only Context id, assigned access, permission source and
workspace; it contains no native history or new execution authority. A legacy
assignment without `permissionSource` is reported as `context_restriction`,
without asserting that a human explicitly chose that restriction. Responses
negotiated as v1–6 omit this field. The v6 native-delivery projection and v5
waiting evidence retain their existing version gates.

The existing internal Head trace route accepts the opt-in
`?executionContext=1` query. Its request body is unchanged. Old callers
receive their original strict shape; an older shard that ignores the query
reports no Context diagnostics, which the new reader presents as unavailable.
The query does not change the Head trace's five-second read deadline or
transport error classification. An unavailable owner or failed read remains an
explicit unavailable task-context projection in v7; it does not remove the
section from Message details. Versions 1–6 retain their original shapes.
This adds no storage writer, migration, or dependency on retaining transient
Heads.

Message details opts in separately with `executionContextVersion=1`. New
Gateway/Core readers forward it; old readers ignore it and keep their original
response. Only opted-in responses add each target's task-context projection
and an eligible readable `newTaskSource` for an authenticated viewer Profile.
The viewer need not be the source author. Source content is redacted for the
viewer before projection; a missing viewer Profile receives no recovery copy.
Existing local-origin redaction
also removes Context identifiers for non-owners. The source copy preserves
Space-owned text/file revision facts and grants no permission; its new Wake
uses the existing message-authoring contract under the current acting Profile,
with that sender's permissions and no inherited approvals from the source.
Its stable client message id
reuses the existing Space authoring receipt for the same reviewed request,
requester, target and placement, including retries after accepted publication.
Every Space and Thread publication receipt is checked against the authorized
sender before replay. Reusing another sender's message identity returns an
explicit conflict rather than a successful recovery. The client-generated id
grants no authority and does not prevent another sender from attempting to use
it; a conflict requires a new message from the composer.

Contract impact: deploy Core and Gateway trace-v7 receivers before publishing
a CLI that requests v7; old Gateways reject unknown trace versions. Existing
CLIs continue requesting v2–6, and old/new Services retain setup, Wake, Space
Action, status and recovery compatibility. Web's Message details opt-in
degrades to the old details when older readers ignore it. No execution epoch,
required Service/Skills update, or new Cloudflare resource is needed. The
updated local prompt guidance is an advisory available component change.
Rollback the new CLI caller before removing v7 receivers; Web can roll back
independently. Clients must not rebuild missing Context or waiting truth from
current Profile preferences or historical dispatch attempts.

## OpenMeld Request Context Header Text Encoding

`packages/gateway-contract/src/headers.ts` owns the wire encoding of every
`x-openmeld-*` request-context header value.

Fetch header values are ByteStrings: undici (CLI, Web server) and workerd
(Gateway, Core) throw on any code point above 0xff. User-authored text —
profile names, owner names, Space passwords — is therefore never written into
a header raw. `buildOpenMeldRequestContextHeaders` carries values that are not
printable ASCII RFC 8187-style as `utf-8''<percent-encoded UTF-8>`;
printable-ASCII values stay byte-identical on the wire, so machine identifiers
keep their historical format.

Every reader of these headers must decode through `decodeOpenMeldHeaderText`
(`readOpenMeldRequestContext` does this internally; Gateway ingress forwarding,
Gateway Space password parsing, and Core Space password parsing call it
explicitly). Do not read an `x-openmeld-*` context header with `headers.get`
alone, and do not write one with `headers.set` outside
`buildOpenMeldRequestContextHeaders` / `applyOpenMeldRequestContextHeaders`.

Length caps apply to decoded text, not encoded wire text: a 64-character CJK
profile label percent-encodes to ~580 chars and must survive the read-side
cap.

Length caps are sized per field, not one-size-fits-all. The
`x-openmeld-visited-profile-ids` list header is bounded by the schema limits
(`MAX_VISITED_PROFILE_IDS` × `MAX_PROFILE_ID_LENGTH` plus comma separators),
not by the generic single-value cap: every schema-valid visited list must
round-trip gateway → Core intact, because a truncated entry fails the whole
actor-context parse and surfaces as an authentication failure. Lists that
exceed the schema maximum keep failing closed (null context) rather than
being silently truncated — the visited list is the chain's loop telemetry
(dispatch trace today, loop-awareness prompt injection next), so dropping
entries is never a valid degradation.

## Space Entry Resolution Contract

Public HTML advertises `GET /v1/spaces/:spaceId/context` as an alternate JSON
representation. `spaceReadContextSchema` is a discovery directory, not a second
content store: it links existing authorized Space reads and explains bounded
pagination and Thread/file relationships. Message pages expose `Link: rel=next`.
All anonymous-readable resources return `private, no-store` and `noindex,
nofollow`; these headers are not a guarantee against copying or model training.
An authorized reply-only entry target resolves its canonical Thread root in the
Space owner before clients perform navigation.

`packages/schemas/src/schemas/http/space-entry.ts` owns the shared Space entry
target and resolution read model. The target preserves the Space plus optional
message and Thread-root focus so a client can continue to the original
destination after a recoverable entry gate is cleared.

Core is the only owner of the resolution. It combines canonical Space access,
Space membership, Organization membership, and the bounded Space Index
projection into separate `view` and `participation` outcomes. This separation
is required because `public_view_join_password` permits reading while still
requiring a password to join. Web, CLI, and Agent View consume the result; they
must not rebuild the access table from HTTP status codes or client caches.

Entry resolution reads the existing authorized Space metadata RPC for the name
and access mode, then the existing viewer membership projection. It must not
read full status, Agent readiness, runtime routes, or Service health to decide
entry. Metadata and status enforce the same canonical Space access policy;
missing access-mode evidence fails closed. The response contract is unchanged.
Status member summaries also omit optional readiness counts and do not enrich
runtime readiness. Operational members remain the readiness owner, and absence
of those optional counts is not an offline verdict. Existing schema consumers
accept these omissions; no CLI, Service, Wake, setup, publication, or diagnostic
contract/version changes or coordinated rollout are required.

The resolver is a read projection, not an authorization token. Every content
or mutation endpoint still performs its own Core-owned authorization. Same-
Organization nonmembers may receive the bounded Space name and creator contact
needed for a useful blocked state. Anonymous visitors and authenticated
outsiders receive no private Space or Organization context. A missing or
inconsistent owner fact is omitted instead of being guessed.

`packages/space` owns the pure public path and URL builder for a validated
`SpaceEntryTarget`. The builder emits the tenant-neutral `/spaces/<space-id>`
route with optional `signalId` and `threadRootSignalId`; it does not add a
Profile, Organization slug, password, token, or access outcome. Web share
surfaces and CLI Agent/Human View reuse this builder so a copied destination has
one cross-client form while authorization remains owned by the resolver and
the eventual read endpoint.

For a verified Organization member outside an active listed Space, `allowed`
view with the `public` experience accompanies `self_join_available` participation.
This permits a read-only preview. Preview does not create membership and cannot
open a writable WebSocket, post messages, Wake Agents, or mutate content.
Deleted Spaces retain their original-member read gate. Space membership POST verifies the actual Organization
membership and rechecks canonical Space visibility after that lookup, admitting
only the caller's own Human Profile. Directory projections and URL targets do
not grant authority. Private Spaces, outsiders, Agent actors, and member batches
do not receive the self-join grant. Existing password/access grants retain their own rules.

Web resolves tenant-neutral links before mounting a public viewer. When the
resolution supplies the caller's Organization slug, it opens the App Space
route with message/Thread focus preserved. App links stay within the App shell
for reading, joining, and blocked states; they do not round-trip through the
public viewer.

## Protected Space Access Contract

`packages/schemas/src/schemas/http/space-password.ts` owns canonical Space
password text.

Use shared password normalization across CLI prompts and commands, Web
protected-access cookies and live streams, API client, Gateway contract, Gateway
header parsing, Core RPC/HTTP, and Space logic.

Do not compare, store, or forward raw password strings with leading or trailing
whitespace.

Empty-after-normalization Space passwords count as absent. Omit the Space
password header instead of forwarding a blank header.

This is a shared contract because inconsistent password handling breaks
protected Space access across clients and services.

Core owns protected Space access authorization.

Space password is a first-entry gate for a protected Space. It is not a
per-command credential that already-authorized users or their local agents must
carry forever.

For a protected Space, Core authorizes access when any one of these proofs is
true:

- the request includes the correct Space password
- the acting profile is an active Space member
- the acting OpenMeld account already has any active profile in that Space

Creator attribution is historical, not an access grant. Disabled external guest
access overrides a guest's recorded membership until guest access is enabled again.

Anonymous viewers and authenticated accounts with no member or same
account membership proof must still provide the Space password.

Same-account access is not automatic Space membership. It allows the account to
open and operate against the protected Space without re-entering the password,
but a profile still must be explicitly added or joined before product flows that
require that exact profile to be a Space participant can rely on membership.

Clients must not duplicate this authorization rule. Web may store a short-lived
encrypted password cookie for anonymous or not-yet-member access. CLI may accept
`--password` for first join or one-off access. Both clients should rely on Core
to decide when password is still required.

## Unified Space Access and Ownership

### Deleted Space history

The Space owner persists `deletedAt` in its canonical metadata. Deletion retains
signals and original membership grants, disables all publication actions, and
restricts reads to those grants. Removing a deleted Space leaves only this
account's memberships. Account deletion remains a separate physical purge.
The account index derives the deleted state from that metadata; subsequent
member or signal projections cannot restore an active Space.

Contract Impact Audit: metadata and status add optional `deletedAt`. Account
list callers opt into retained entries with `includeDeletedSpaces`; older CLI
callers retain their existing list shape. Status actions may be empty for a
deleted Space. Core must precede new Gateway and Web readers. Old clients can
read retained history but Core rejects their writes. No Service, Wake execution,
live invalidation, or local component protocol changes. Rollback the new Web
first; an older Core does not enforce the retained read-only state.

### Account Space preferences

`packages/schemas` owns `SpacePreferences` and its authenticated RPC input.
`GET/PATCH /v1/account/space-preferences` addresses the verified Human's existing
account owner shard. That shard is the sole durable writer; an absent record
means automatic Wake is enabled, preserving existing behavior. Core reads the
author's preference at automatic dispatch admission. Space status and bootstrap
project `automaticWakeEnabled` for the viewer without granting work authority.

The status field is additive and optional. Existing clients keep their previous
guidance and can still send messages; Core applies the saved preference. New
clients require the preference receiver for Settings, and show a load error when
it is unavailable. No CLI, Service, Gateway live-frame, or Wake execution protocol
changes. Older status readers accept the added field. Rollback preserves the
stored preference, but an older Core does not enforce it.

`packages/space` owns the pure Space access and ownership policy over verified
facts. Core obtains current identity and membership facts and enforces the policy
for HTTP, RPC, live connections, and Agent callers. UI capability projections do
not grant authority. Organization-open discovery grants current Organization
members read-only preview and explicit joining. It does not grant Organization
membership or publication before joining.

The Space Durable Object is the sole writer of `ownerUserIds` and `allowGuests`.
Creator attribution remains immutable. Owners are current Organization members
with an active Human Profile in the Space; multiple Owners are supported and the
last Owner cannot be removed. Ownership changes are serialized and audited.
`space_owner_member_references` is a restrictive PostgreSQL deletion guard, not a second
authorization source: add the reference before granting ownership, remove it after
demotion, and reconcile stale references against the owning Space before departure.
Organization membership removal, leaving, and account deletion require handoff.
Deleting an Organization requires deleting its owned Spaces first.
An old Space member record does not preserve a departed colleague's access.
Authenticated membership grants recheck current Organization membership, an
explicit enabled guest admission, or the Organization-managed Agent identity.
The same authorization runs for reads, joins, incoming WebSocket messages, and
live delivery; connection establishment is not a permanent access grant.
Live delivery checks each session independently. One check covers every message
already queued for that session before the check started, so no message is
delivered under a check older than the message. A denied check closes only that
session with `1008 space_access_changed`. A check that cannot verify access,
such as a PostgreSQL connect timeout, is not a revocation: Space withholds the
session's messages, retries once immediately, and then closes only that
session with `1013 space_access_unverified` before yielding. Closing an
accepted session this way publishes its `presence.quit` to the sessions that
stay open, as an ordinary disconnect does. The retry is not
delayed by a timer, because a timer does not keep a hibernating Space awake and
a discarded retry would leave the socket open with its messages lost. On that close Web re-reads Space access at once, because a real revocation
in the meantime rejects the reconnect before any close code reaches the
browser. The client reconnects through the full join
check. After an accepted reconnect, Web re-reads every snapshot those
invalidations refresh (Space metadata and access, members, Tasks, files, chat
titles, Agent progress, and shared Agent readiness) in addition to its history
catch-up. Because the missed readiness frames' Agent Profiles are unknown, the
tab also publishes a scoped refresh-all message on the readiness bus so other
tabs in the same account and Organization refresh their readiness projections;
it bypasses the per-Space version check. Recovery restarts snapshot and readiness
reads already in flight, including a first load with no data, because such a
read may predate the missed change. The active Wake progress summary and
message details instead read once more after an in-flight read settles. A tab
loaded before that
Web change keeps the earlier reconnect behavior until it reloads; that gap
predates this rule, because a failed check used to close every session. A failure for
one session never closes or delays another session.

Guest invitations are email-bound and require an authenticated recipient. Their
acceptance records Space membership and a guest receipt without creating an Auth
Organization membership. Only a current Space Owner may enable guest invitations.
Disabling guest access closes live connections and rejects subsequent guest reads
and mutations. Re-enabling restores admitted guests; removing a guest is permanent
until a new invitation is accepted. Internal discovery never includes unrelated
private Spaces; a pending invitation exposes only its recipient's invitation card.

New clients send `x-openmeld-space-access-version: 2` on Space metadata, status,
and bootstrap requests. Gateway projects the legacy response without the new
ownership and guest fields for unversioned strict-schema clients, and projects
version 1 without `linkJoinPolicy`. Web forwards the header. Additive metadata
fields alone are not sufficient compatibility when old clients reject unknown
properties.

Space dispatch snapshots carry server-derived `callerContext` (relationship,
Space role, and result audience), preserved through hosted and workstation delivery.
These facts are supplied separately from user text on every local Agent turn.
External callers cannot acquire Organization context through later identity
verification. Existing tool authorization remains authoritative; instructions are
not a substitute for access enforcement. Anonymous execution is not enabled.

### Contract impact and rollout

This changes Space HTTP/RPC contracts, Auth invitation storage, Space SQLite, PostgreSQL
ownership guards, hosted Agent envelopes, and workstation dispatch snapshots.
Apply additive PostgreSQL migrations before Auth. Deploy Auth before Core. The hosted Remote Agent receiver must accept
optional caller context before Core emits it; this receiver-first dependency is an
explicit exception to the usual Core-before-Remote-Agent order. No new hosted RPC
caller is introduced by that receiver change.

Deploy Gateway and Web after the CLI-owned Core deployment. Existing clients
remain supported by the versioned legacy response projection; new guest UI
must not call old Core receivers.

Old cloud payloads remain valid for the new Service because caller context is
optional. Old strict Service receivers cannot accept the new snapshot field or
provide its per-turn caller facts, so the owning Service contract is bumped and
the local component release must mark Service `required`. Publish that component
and its required floor before enabling Core dispatch producers. Setup, existing
CLI response readers, and diagnostic entry points retain their contracts; CLI
artifacts are updated to carry the new Service and shared diagnostic types.
No local skill or runtime execution epoch change is required.

Rollback removes new Web callers before rolling Auth/Core back, retains additive
migrations and the new Service, and does not rewrite guest or ownership state into
legacy creator-based permissions. An old Core cannot safely administer spaces
with transferred ownership; rollback must preserve the ownership enforcement
receiver or disable affected management until it is restored.

## Owner Boundaries

### Selected Space work compatibility

`spaceWorkHandoffSchema` is the shared optional selected-work payload in Message
metadata, Thread posts, dispatch source snapshots, and hosted admission. The
origin remains the real containing Message/Thread. The public normal-message
request adds `workHandoffVersion: 1` so an older strict Gateway rejects new
handoff callers rather than silently dropping their metadata.

Roll out Core receivers, the hosted receiver, Gateway, then Web/new CLI callers.
Core and Remote Agent must both understand the optional payload before enabling
hosted handoffs. New Service handshakes negotiate `spaceWorkHandoff` through the
Gateway header and Core socket attachment. New Core never sends this work to an
old Service lacking that capability. Old Core/new Service and ordinary
new-Core/old-Service setup, Wake, status, trace, and self-rescue keep their
existing contracts. No global execution epoch or managed Skill version bump is
needed: the new operation is capability-gated and existing operations are not
reinterpreted. The next CLI/Service artifacts must carry the implementation;
feature branches defer release stamping through the release-ready command.

Exact Skill reads use the optional selected-release response described above;
an absent exact release fails rather than selecting latest. Agent reads check
active account membership and the owned active Agent Profile and never grant
Skill editing permissions. Desktop uses the same Web/CLI/Service boundaries;
there is no new Desktop execution or file authority, and no native Desktop
working-copy manager is claimed. Rollback removes new callers before receivers;
retain pending local copies and immutable shared revisions. No DB migration or
resource binding is introduced.

The review fixes keep the same capability-gated rollout. The Service-to-adapter
boundary adds optional `workingCopyId` only after successful preparation; it
does not extend public execution-context access modes. The CLI/MCP adds explicit
refresh/resolve actions and conflict/incoming projections. These ship together
in the local component artifact; they do not require new cloud operations or
reinterpret ordinary setup, Wake, Space actions, status, or trace. Unreleased
first-version handoff artifacts must be replaced before enabling this capability.
No managed Skill or execution epoch changes are needed. The next local artifact
remains deferred on this draft branch; release verification must use the base.

This document owns shared contracts and reusable policy boundaries.

Use scoped owner documents for related rules:

- `developing/product/product-model.md`: product promise and user-facing model.
- `developing/product/agent-profiles.md`: Agent Profile product semantics.
- `developing/product/routines.md`: Routine and Run product
  semantics, authority, scheduling, and result surfaces.
- `developing/architecture/agent-transport-contract.md`: execution authority,
  readiness, Wake execution, and final outcome contract.
- `developing/architecture/data-and-observability.md`: data ownership,
  projections, trace, diagnostics, and sensitive-data boundaries.
- `developing/clients/web.md` and `developing/clients/cli.md`: client-specific
  presentation and platform behavior.

## Architecture Invariants

- Cross-boundary payloads need shared schemas before integration.
- Entry Brief, Space Board, and reply staleness consumers must reuse their
  shared render/schema owners instead of rebuilding parallel meanings.
- Shared types derive from schemas.
- Runtime/request paths use safe parsing.
- Shared external error semantics must not drift by client or service.
- Routine HTTP/RPC, eligible-target, Run, turn-envelope, private tool, and CLI
  JSON boundaries use the shared strict schemas and fail closed on unsafe mixed
  versions.
- Shared policy helpers are not execution authority.
- `packages/agent-runtime` owns reusable runtime and eligibility policy.
- Agent Controller refs must be built and parsed through shared helpers.
- Runtime execution identity must be echoed from dispatch context, not locally
  recomputed.
- RuntimeCoordinator finalization envelopes must use the shared schema.
- Binding command eligibility and claim eligibility are policy projections only.
- `packages/agent-profile` reply recovery copy does not own readiness truth.
- Cross-client business rules should be extracted before Web and CLI diverge.
- Client-specific presentation and platform behavior should stay in clients.
- Space password normalization must be shared across clients and services.

## Local component installation source and binary availability

Core owns update eligibility and target projection. The published
release manifest remains compatibility/admission authority. Core reads the
binary availability catalogue at runtime from the official stable and
Windows-preview channel manifests in R2. It selects exact channel/platform
pairs; it never infers a Windows preview from OS, or stable provenance from the JSON member
`channels.stable`. Missing installation source, platform, catalogue, or release
policy leaves binary latest versions null and availability unknown. Unsafe
Service versions remain blocked independently of artifact availability.
Required CLI package versions and command contracts also remain independent of
availability: an older channel target cannot satisfy either requirement.
When the installed CLI is below the required package version or has an
incompatible command contract, Core preserves `update_required` and its
diagnostic reason even without a compatible installable target.

`LocalComponentsStatus.installationSource` is optional strict metadata containing
only distribution, channel and product platform. The managed CLI installation
owns binary provenance, including a retained Service carrier; executable paths,
arbitrary update URLs and credentials are not report fields. Npm continues using
the global npm policy. Public binary manifests may carry `componentPolicy` whose
CLI and Service versions must each match their selected immutable artifact.
Separate Service versions are supported. Legacy stable metadata may reuse the
global policy only when both versions match; legacy preview never borrows it.

Contract Impact Audit: producer is CLI/Service local component reporting;
strict receivers include Gateway runtime transport parsers, Core and Web shared
schemas. Deploy compatible receivers before publishing a reporter with the
additive field. Old reports remain accepted but source availability is unknown;
missing availability must not weaken compatibility floors. Consumers include
computer status, setup completion, dispatch readiness and automatic maintenance.
Automatic updates require installable CLI and Service targets and use the
projected source-specific CLI target. Skills-only drift cannot bootstrap an
unavailable binary upgrade. Validate schema/report acceptance, source provenance,
channel/platform/retained-Service matrices, safety floors and automatic dispatch.
## Pending Space Input Receiver

`spaceInputQueueMutationSchema` and `spaceInputQueueResponseSchema` define the
additive Core-to-Space `spaceInputQueue` / `rpcInputQueue` contract. The receiver
uses the existing Center input target and client message ID schemas. The caller
never supplies an author or a native submission identity: authenticated context
and the Space's admitted delivery supply them. The receiver requires an active
Human membership owned by the authenticated caller, and the original verified
Human sender of a private Center DM or a supported Local Codex Wake. Read and
mutation results expose only that author's inputs. Steer also compares the
requested dispatch and Profile with the stored target. It never retargets an
existing row to a newer execution.

`GET/PATCH /v1/spaces/:spaceId/input-queue` and the shared API client expose this
receiver to the Human composer for Center and Local Codex targets. Gateway derives the actor from
authenticated context and rejects injected author fields. Existing Space access
and active Human ownership checks still apply. The Web default for supported
plain text during a confirmed response is Queue; only the explicit Steer action
calls native execution input. Queue mutations use the existing
`space.meta.changed` invalidation envelope, without message text or author data.
The client rereads its authorized queue, including after reconnect.

Queue intake freezes the original Human request's retained conversation placement
in the existing outbox request. The Space resolves it from the exact dispatch
source; callers cannot supply or replace it. A missing or mismatched source
rejects intake without consuming the draft. Ordinary handoff and applied Steer
publish into that original conversation. Thread context is private Core storage
metadata and is removed before strict Remote Agent execution-input requests.

Readers can opt into `includeConversationContext` (`conversation=1` over HTTP).
Only opted-in responses include `conversationContextIncluded: true` and each
item's nullable `threadId`. Legacy readers retain their existing response shape;
legacy stored requests without context retain main-conversation placement.
Web shares one authorized queue cache and shows only the current conversation's
rows. The existing composer work bookmarks also read that cache to locate the
author's queued input in closed or other Threads. They merge a Thread's queue
count with its matching original Wake when present, or show a Queue-only entry;
queued input never implies a running execution. The open Thread's tray stays its
only Queue entry. Reordering a Thread replaces only its visible slots in the
author's full queue. A server without the scoped projection cannot accept Web Thread Queue
intake; Web keeps the draft rather than assuming main-conversation placement.

The Web Queue is one compact, inset tray behind the Composer, shared with the
existing pending-action tray geometry. Rows expose Steer, delete, and an accessible
Fluid menu for Edit, Move up and Move down, plus pointer/keyboard reordering.
Edit confirms the existing delete mutation before restoring the full text to the
Composer, preserving any newer draft. A lost response retains a retryable edit;
delete is idempotent for that same author's deleted row. A claimed or consumed row
cannot be taken back for editing. Removing input never stops its original Wake.

Local rows use the same outbox and freeze the original requester account,
author, Profile, dispatch, Coordinator execution, attempt and run. PostgreSQL locates
the Coordinator; it cannot authorize or select an active run. The Coordinator
resolves the admitted source and current attempt/run, then checks the exact
Service session, generation, Profile lease and supported controller. Space
rechecks current Auth ownership, writable membership and target membership
before enqueue, Steer, receipt reads and ordinary queue handoff. Queue-only
deletion/reorder still checks the original requester's authority, but does not
require a live target: an author can discard pending work after its Agent leaves.
Reordering changes only the caller's pending slots, preserving other authors'
positions. Ordinary consumption retains the existing atomic message/outbox
handoff and never replays an uncertain Steer as a new Wake.

Execution routing uses the persisted native delivery or the exact Coordinator
admission, not a lazily refreshed member Controller snapshot. An absent snapshot
does not reject a supported freshly created chat. Local enqueue does not require
a dispatch-conveyor row that may already have been retired; the Coordinator still
checks the original author, execution, attempt, run, session and lease.

`agentWorkloadSnapshotSchema` is an additive read projection on the existing
Organization Agent runtime overview. `workloadProfileId` requests one eligible
Profile after current Organization membership admission. The Space index supplies
candidate conversations within that Organization, including departed Agent
memberships with pending input. Core reads existing Space-owned progress and input
through `rpcAgentWorkload` with bounded concurrency. Space rechecks its Organization
scope and ordinary source access. Only accessible sources serialize locations,
message previews or identifiers; inaccessible sources contribute counts alone.
There is no new durable workload store, migration, writer, admission or scheduling
path. Partial owner reads or failed sources produce `unavailable`. Profile Details
uses its existing refresh lifecycle; directory list reads do not fan out to Spaces.

The workload contract is optional and additive: old Web ignores it, and new Web
retains its existing activity presentation when old Core omits it. Deploy the
Core read receiver before Gateway/Web callers. It changes no Service, CLI, Skills,
Remote execution or Wake protocol. Queue edit reuses the existing delete contract;
its lost-response retry guarantee requires the updated Core tombstone handling.

`local-execution-input.ts` owns the shared private apply/read wire. The optional
`x-openmeld-local-execution-input: 1` WebSocket handshake header follows the
existing negotiated capability path through Gateway and Core. It is not added
to the Service's strict registration JSON. Core sends
`daemon.execution_input.request` only to a negotiated session and accepts its
matching `daemon.execution_input.result` on that same socket. The connector
calls the existing private Host receiver; reads cannot resend. Applied receipts
publish and retire in one Space transaction. Only an explicit non-application
reply to the original apply may leave a blocked pending row; missing, mismatched,
lost or replaced-Host receipts remain held. One subsequent read can reconcile an
unknown application; another unknown stops scheduling without releasing it.

The Remote Center tool `openmeld_space_input_queue` calls
`centerAgentSpaceInputQueue` for the same owner. Core resolves the current
verified interactive requester from its native delivery on every call, checks
Organization scope, and audits the actual Center actor and represented Human.
Space then checks the represented Human's ordinary write and original-author
permissions. Source metadata, an Agent owner, Organization role, Routine or
unverified speaker cannot grant this effect. General Local Agent tools,
attachments/context and non-Codex Local executors remain separate incomplete
scope; this tool is not a general delegation grant.

Contract Impact Audit: the public HTTP contract, optional Service handshake and
private Runtime Transport/IPC schemas, Space stored request union, Center RPC
and audit action change. Deploy Core receivers/migration and audit readers
before Gateway/Web and the Remote tool caller; Core precedes Remote. Publish a
new CLI/Service bundle only after receivers are available. Roll back callers
before receivers and Remote before Core. An old Gateway/Core ignores or drops
the new header, retaining ordinary registration, setup, Wake, Space actions and
diagnostics. A new Core never sends input to an old Service without the header;
unsupported Local intake leaves the draft intact, and an existing uncertain
row remains held. Neither direction silently substitutes a new Wake for Steer.
The optional negotiated feature does not require an execution/Service/CLI/Skills
epoch bump: old components can safely continue their existing work. No CLI
command, Prepare payload or managed Skill changed. Shared schema, adapter and
carrier sources change packaged artifacts; deferred feature checks do not
authorize publishing an old bundle. A future release must rebuild, stamp
available local components and verify the actual release base. Retain additive
SQL migration 49 on rollback; reverting Core while Local rows remain requires
draining/retaining the candidate Space reader, because old request parsers cannot
read Local rows. Do not erase held rows to make rollback appear safe.
## Session history contract

`packages/schemas` owns the Session history policy, operations, requester,
metadata audit, bounded result, RPC, and transport frames. Core supplies the
requester from authenticated human or admitted execution evidence. Public
requests cannot supply their own requester or audience. Local Agent calls need
the current execution token and exact dispatch/binding scope. Hosted calls need
the active native delivery and its frozen, verified human root. Only verified
one-hop delegation is supported; missing provenance fails closed.

The additive `x-openmeld-session-history: session-history-v3` handshake is
independent of File access. An old Service returns unsupported and receives no
new frame. Requests use `daemon.session_history.request`; replies use
`daemon.session_history.request_result`. Pending operations and response bodies
stay in memory; HTTP results use `Cache-Control: no-store`.

Version 2 removes the per-Agent allowlist. The single enabled flag applies to
human reads and every verified owner-delegated reader within selected Project
connections. Old settings are projected as disabled and written in the v2 local
store format on the next mutation; old binaries fail closed on that format.
Old v1 Services are not admitted to the v2 history channel. Deploy Core/Gateway
before the updated Service and Web. Rolling back requires matching clients and
receivers; never reinterpret an existing v2 grant as a legacy allowlist.

Version 3 adds the provider discriminator to reads, results, and access audit.
Codex, Claude Code, OpenCode, and Grok Build share the same authorization path.
An omitted provider means Codex only, preserving prior callers and local audit
records; it never guesses a provider from a native ID. v1/v2 Services are not
admitted to the v3 history channel. The local policy store remains v2 because
its grant semantics are unchanged. New clients must wait for receiver rollout;
rollback receivers and callers together. No transcript is added to storage.

Contract impact: deploy receiving Core/Gateway and hosted tools before exposing
new clients. Existing CLI/Service/Skills continue their previous setup, Wake,
Space actions, and diagnostics. New history reads need the advertised Service
capability; no fallback or mandatory compatibility-epoch bump is needed. Local
CLI and Service updates are available, not required for existing workflows.
