# Shared Contracts

## Agent Context

- Purpose: Define cross-client and cross-service shared contract ownership for
  schemas, runtime policy, API clients, Gateway contracts, shared database
  contracts, Space Board and reply context, Space reply streaming, Center Agent
  Opportunities, Tasks, Routines and memory, weekly evaluation reports,
  reusable Space policy, and reusable Agent Profile semantics.
- Read this when: You are changing cross-boundary payloads, shared schemas,
  `packages/agent-runtime`, `packages/agent-profile`, `packages/space`, API
  client contracts, Gateway contracts, Space Board or reply metadata, Space
  streaming, Opportunity RPC contracts, Routine HTTP/RPC/turn envelopes,
  Organization Skill registry and exact-release delivery, Center Agent Task HTTP/RPC/turn envelopes and live
  invalidation, Center Agent memory, evaluation report payloads, Space password
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

## Boundary

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
truth. The additive rollout deploys the D1 migration and cloud receivers before
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

## Contract Rule

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
this field from the canonical D1 user row after Better Auth resolves the
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
or consume an explicit owner-approved projection; sharing one D1 binding does
not authorize it to query Auth-private `users` or `members` tables.

Web, future Desktop, and future Mobile clients consume the same list, direct
item, count, preference, and mutation contracts. The source target is a
discriminated, structured locator rather than an arbitrary or Web-only URL.
Each client maps only supported targets to its canonical navigation surface.
Unknown target kinds fail closed and remain visible without creating an
arbitrary URL. A Slack `message_channel` target is the bounded exception for an
external canonical source: it carries exact provider ids and a permalink that
the shared schema restricts to HTTPS `slack.com` hosts. Core resolves that link
through Slack `chat.getPermalink`; clients never construct or accept a
recipient-authored external URL.
An Agent Interaction target carries the stable source Space signal when known
and an exact nullable Space thread root for every new RuntimeCoordinator
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
separate mixed-version reader: source-target version `4` receives the complete
current target, version `3` receives Agent Interaction targets without the
thread locator, and missing or older versions retain the legacy projection.
That legacy projection maps unsupported `message_channel` and Agent Profile
creation targets to `{ kind: "center_agent" }`. Gateway applies the projection
after validating Core's current response for list, direct-item, and read-mutation
operations. The projection never rewrites the durable row or weakens the
canonical schema.

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

`message_channel` rows remain in D1 after the producer stops. A normal rollback
therefore stops emission with a forward Core change that retains the new reader,
then keeps the new Core, Gateway, and Web readers deployed. It must not restore
an old Core, Gateway, or Web reader while any new row can remain. A complete
reader rollback is allowed only after an explicit, verified compatibility
migration or retention process proves that no persisted row uses the new
discriminator. Manual D1 rewrites or deletion are not a normal rollback path.

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

The combined rollout order is shared database migrations 0102 through 0106,
Core receiver, Gateway route, then Web caller. The migrations add the
Task-owned authorization projection and the native-delivery execution-evidence
timestamp plus its monotonic stream-sequence fence, fair Task terminal
projection-attempt ordering, and the nullable Task origin-attribution envelope.
Existing Tasks retain a null attribution envelope and remain readable. Core
reads those columns unconditionally, so deploying Core before the database
would make valid reads fail at SQL preparation.

Center Agent Task reads and mutations use an explicit response contract
version. A missing
`x-openmeld-center-agent-task-response-version` header selects the frozen v1
shape so an old Web build, old Gateway, or both can continue parsing running
Tasks. Version `2` is the frozen honest execution-evidence shape. Current API
clients send version `3`; current Gateway accepts `2` or `3`, forwards the same
optional version through the shared RPC input, and validates the matching Core
response schema. V3 adds the frozen requester display snapshot and bounded
Local Agent client attribution to Task origin. It never carries a Local Agent
session id. V1 keeps the historical `running -> working` presentation only as
a bounded compatibility response; v2 and v3 require fresh owner execution
evidence for `Working`. Core performs the only v3-to-v2 and v2-to-v1
projections at its response boundary.

After the database is current, deploy the v3 receivers in Core and Gateway
before the API client and Web producer. Core defaults omitted Task response
versions to v1 and continues accepting explicit v2. Old Web builds continue to
call the existing Center Agent endpoints; new Web requests Task response v3.
Rollback removes the Web caller and Gateway route before rolling back Core;
additive database columns remain in place.

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
The Center Agent Tasks rollout is that future contract only after its Task and
Inbox producer, typed signal, transport, Web consumer, reconnect behavior, and
snapshot refetch all land together. Until then, existing Inbox polling remains
the honest behavior and no Task surface may claim realtime updates.

The Auth urgent-email RPC accepts a user id, stable delivery id, bounded
subject, text body, HTML body, and canonical OpenMeld link. Auth resolves the
current account email privately and returns a schema-validated sent or failed
result containing no address. Core never copies Auth's user table or logs email
content. The receiver must be deployed before Core begins calling the additive
method; during rollback, stop the Core caller before removing the Auth method.

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

### Delivery Evidence And Production Lease Contracts

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

`packages/schemas/src/schemas/release/production-scope-lease.ts` owns the
strict metadata stored in the cross-machine Git scope lease. The schema defines
scope, owner, exact source SHA, start, expiry, lease identity, and the durable
record for an explicit expired-lease recovery. It does not authorize a release:
the guarded release entrypoint still owns source validation, scope planning,
credentials, deployment, health, and recovery. The end-to-end lifecycle and
reuse rules remain solely in
`developing/engineering/agent-native-delivery.md`.

These two delivery-control schemas are engineering contracts consumed directly
by repository tooling. They are not exported from the package-wide runtime
schema index and are not packaged into the CLI or OpenMeld Service. Changes
under `schemas/ci` or `schemas/release` therefore require their behavior and
workflow contract tests, but do not by themselves create a local-component
release. Product-facing and runtime schemas elsewhere in `packages/schemas`
remain release-sensitive.

### Prepare Diagnostics Lifecycle Journal Contract

`prepareStepDiagnosticsLifecycleEventTypeSchema` is the strict shared allowlist
for daemon lifecycle journal entries that the CLI may attach to a failed
Prepare step. The CLI writes this diagnostic bundle and Core validates it only
for bounded logging; rejection must not change Prepare completion, setup truth,
Wake availability, or execution state.

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
detail. It does not carry Service readiness, Wake availability, execution
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
Project mutation. Interactive removal still requires a later turn. Trusted
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

This additive rollout is migration and receiver first: apply the D1 migration,
deploy the Core RPC receivers, then deploy Remote Agent callers. Old Remote
Agents call nothing new; a new Remote Agent against old Core fails closed.
Rollback removes Remote Agent callers before Core receivers or the table.
Gateway, Auth, Web HTTP APIs, CLI, OpenMeld Service, daemon, local components,
Changelog contracts, and RuntimeCoordinator contracts are unchanged.

### Organization Directory Contracts

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
Current Web People and Agents use two narrower Core-owned read projections so
identity is never blocked by runtime fan-out. `OrganizationProfileDirectoryResponse`
contains Auth-owned member and Agent Profile identity, Center Agent designation,
the optional member-activity overlay, and only the current viewer's
permission-scoped primary Agent Controller summary. It does not read Runtime
Transport or RuntimeCoordinator. `OrganizationAgentRuntimeOverviewResponse`
contains readiness and Agent Profile Operational Context keyed by Profile id.
Core resolves its inputs in bounded owner batches: one route batch, one owner
Service read, and one local-runtime display inventory per owner, with bounded
per-Profile readiness work. Splitting transport does not split authority: Auth,
Core readiness, Binding, and RuntimeCoordinator remain the same owners, and the
browser never derives or writes either projection.

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
phase, request source, target version, urgency, and timestamps. Core passes
the maintenance and operation projections through unchanged; it does not create
another update state.

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
existing Center Agent and Remote Agent consumers remain compatible. Deploy Core
first, then Gateway, then Web; roll back Web before Gateway or Core. These cloud
additions do not change CLI, OpenMeld Service, daemon, Prepare, Wake dispatch,
Space action, or diagnostic semantics.

### Direct Message Conversion Contract

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
are additive. The D1 column lands before Core projects it; then deploy Core,
Gateway, and Web. Old Web ignores the field and never calls the new route; new
Web against an old cloud stack receives an explicit failed conversion rather
than a partial member write. Rollback removes Web and Gateway callers before
Core. CLI, OpenMeld Service, daemon, Prepare, RuntimeCoordinator, Wake dispatch,
Space actions, diagnostics, and local-component contract versions are
unchanged.

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
the returned canonical revision reference in the message. In-progress staging
blocks Send. A failed stage or publication is omitted while text and other
successfully published files continue; an empty message is never posted when
all publications fail. A message-send failure after publication may leave the
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

The current single-request compatibility path accepts individual files up to
10 MiB. That transport ceiling is not the intended user-facing file policy and
must not be raised by buffering a larger request in Gateway. Removing it
requires one shared resumable multipart contract: Core-authorized upload
sessions, streamed R2 parts, exact size and part-integrity verification, atomic
Space File commit, abandoned-session cleanup, and the same idempotent canonical
response for Web, CLI, and Agents. Browser text editing remains limited to UTF-8
text files no larger than 1 MiB; that editor working-set boundary does not limit
upload or download. Until the multipart contract ships, large-file support
remains incomplete. There is no public object URL, per-file ACL, Resources
projection, automatic Computer materialization, CRDT, or live character stream
in this contract.

The resumable contract uses one server-owned lifecycle for creates and new
revisions:

1. `start` carries the exact target, requested name and folder when creating,
   MIME type, expected byte size, base revision, and client mutation id. The
   owning Space reauthorizes the actor, freezes that metadata, and returns an
   opaque upload-session id plus the R2-compatible part policy.
2. Gateway creates or resumes the R2 multipart upload under the exact private
   revision object key. The R2 upload id and object key remain server-only and
   never become client authorization.
3. Each numbered part is reauthorized through the upload session and streamed
   from the request body to R2 without whole-file buffering. Gateway returns the
   canonical part number and ETag. Web persists the opaque session and completed
   part list with its draft; CLI streams from disk. Both retry only missing or
   failed parts and can report byte-accurate progress.
4. `complete` carries the ordered canonical part list. Gateway completes the R2
   object and verifies the resulting object size against the frozen session.
   The owning Space then atomically commits the immutable revision through the
   existing base-revision and mutation fence. A create collision receives the
   server-assigned numbered name in this final canonical response.
5. A stale base revision, changed frozen metadata, invalid part list, size
   mismatch, or reused mutation with different upload evidence fails explicitly.
   It never creates a visible partial revision.
6. Explicit cancel aborts the multipart upload. Expired sessions are aborted by
   the owning cleanup lifecycle, and a completed R2 object whose metadata commit
   fails is deleted best-effort with observable cleanup evidence.
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
contract fixtures in one receiver-first rollout.

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
constants are not evidence of compatibility. No D1 migration or new public R2
bucket is introduced: each Space Durable Object lazily owns its SQLite tables,
and immutable bytes use the existing private Space object-store binding.

#### Historical attachment rollout

The first rollout is an explicit exception to the default cloud deploy order:
apply D1 migration 0020, deploy Core's new attachment RPC methods, deploy
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
  unchanged. No D1 migration is required because the existing hosted Binding
  model field and configuration revision remain the single preference store.
  The shared-schema source mechanically changes the packaged Service bundle
  hash, so this feature branch defers the manifest update; the next clean release
  worktree may restamp it as advisory `available` without forcing an update.

### Space Live Invalidation Frames

`packages/schemas/src/schemas/protocol/envelope.ts` owns Space live WebSocket
frames that cross Core/Space and browser clients. Live invalidation frames such
as `space.members.changed`, `space.meta.changed`, and
`agent.readiness.invalidated` are transport signals, not durable state.

Rules:

- Core/Space may emit an invalidation frame after a membership, metadata, or
  readiness owner changes facts.
- Clients may use the frame to trigger a targeted read-model refresh.
- The authoritative facts remain the Space members snapshot, Space status
  snapshot, Core Wake/readiness projections, and their shared schemas.
- Clients must not derive final membership, Wake availability, Agent Profile
  Binding, local service liveness, or execution outcome directly from an
  invalidation frame.
- The frame version must be monotonic for a Space across Durable Object
  hibernation, restart, and deploy. A restarted Space object must not emit a
  lower version than a still-open browser tab has already observed.
- A missed invalidation frame must be recoverable by the next snapshot read.
- `space.meta.changed` triggers a Space status and Space Index refresh. It does
  not carry metadata state and does not imply that membership changed.

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

Shared schema surfaces define the hosted Center Agent and workstation Local
Agent Space-stream paths:

- `packages/schemas/src/schemas/runtime/remote-agent-worker.ts` owns the
  worker-to-Core sequenced text/thinking snapshot and tool-part callbacks plus
  their shared response. Core accepts the legacy text-only callback while the
  current producer emits the typed callback. Thinking is transient and must not
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
  consumes this additive event before the Remote Agent emits it; older final
  callback bodies remain valid throughout rollout.
- `packages/schemas/src/schemas/daemon/runtime-transport.ts` owns the Local
  OpenMeld Service-to-Core privacy-bounded tool-activity frame. The frame
  carries RuntimeCoordinator execution identity, current execution-token echo,
  daemon session and lease evidence, source message identity, sequence, and one
  safe tool part. A current producer attaches the shared semantic `work` object
  only after mapping the provider event to one admitted work key and, when
  useful, one explicitly safe bounded subject label. It never carries tool
  arguments, results, raw errors, command text, paths, or private Agent text.
- `packages/schemas/src/schemas/protocol/agent-stream.ts` owns Space live text,
  thinking, tool-part, and terminal frames plus the active stream presence,
  active text snapshot, and durable privacy-bounded Agent reply work
  projection. Text frames preserve the legacy wire shape. The active presence
  contains only stream identity, sequence, gap, and timing evidence; it carries
  no reply text or private thinking. Thinking frames are active-stream-only
  refresh data: Space may advance the shared sequence cursor and expose its
  privacy-safe presence, but must not store thinking in SQL, bootstrap,
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
text projection through the bootstrap snapshot; private thinking and the
compact live Work summary are not replayed. The presence rollout is Core
receiver/producer first, then Gateway forwarding, then Web opt-in. An old
Gateway ignores the unknown browser query, and new Core omits the additive
response field for callers that did not opt in. A successful
final reply carries the complete optional durable projection in
`signal.text.data.meta.agentWorkSummary` and may separately expose its
timestamped bounded summary through Message details for 14 days. During a
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
every visible summary. When a current Remote Agent reaches an older Core that
rejects the new `connected_app` subject kind, it retries the same sequence once
without the entire presentation-only `work` object. Missing, unsafe, or
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

### Center Agent Task Contracts

`packages/schemas` owns the strict shared boundaries for Phase 1 canonical Center
Agent Task records, Task events, list/detail projections, requester access,
execution-attempt links, Task runtime-conversation admission, mutations, Stop,
Retry, and Inbox targets. Recovery, shared access scopes, paginated detail, and
live invalidation require additive owner contracts before a producer or UI may
claim them. Product meaning is owned by
`developing/product/center-agent-tasks.md`.

Task identity is distinct from `AgentTaskHandle`. A strict Task contract must
not accept a Space Wake, native-delivery, controller task, dispatch, or
RuntimeCoordinator execution id where a canonical Task id is required.
Execution links use discriminated shared schemas and preserve their owning
domain.

Create and append operations carry one stable client/provider operation id.
Phase 1 canonical mutations carry `expectedVersion`; Task-turn admission freezes
the stable runtime `conversationId` derived from the Task id. No independent
`contextRevision` contract ships in Phase 1. Core returns the updated canonical
snapshot or a typed conflict. Clients and adapters do not invent merge,
ordering, status, or deduplication rules.

The shared Task parser validates one lower-level lifecycle `status` plus the
optional Core-owned `executionEvidence` projection and derives the canonical
client `state`, `phase`, and `outcome`. `running` without exact evidence from
the active native-delivery attempt remains `active` with no `working` phase;
only fresh owner evidence may produce `working`. Supplied projection fields
must agree with that reducer. Clients group and label Tasks from the derived
projection rather than duplicating lifecycle switches. A Message Channel
origin contains the full frozen
`messageChannelConversationLocatorSchema`; a provider label without its exact
destination is invalid.

Task list and compact projections are bounded and contain no transcript. Task
detail events remain typed, authorized, and privacy-bounded. Phase 1 returns the
full product event history; it does not claim paginated detail. Raw reasoning,
private runtime transcript, tool inputs/outputs, commands, paths, errors, and
provider payloads are forbidden.

The Inbox Task target contains only the canonical Task id, not a Web URL,
requester, access grant, or execution selector. Inbox reads join the Task-owned
`center_agent_task_authorized_readers` projection and separately require current
Organization membership, so delayed source JSON cannot preserve revoked
access. Web maps the Task id to the canonical Organization Task route. Unknown
target kinds fail closed and stay visible. Producer rollout is consumer first:
shared schema and Web target support, then Core Task source-event emission.

Phase 1 has no Task live-invalidation contract. Web uses bounded foreground
polling and refetch-on-focus. A future typed Organization/Task refresh signal
must carry no lifecycle truth, content, requester authority, or access grant;
producer, transport, consumer, and snapshot refetch must ship together. A schema
alone must not imply realtime behavior.

Task conversation support changes the strict Remote Agent turn envelope and
conversation identity union. Roll out receiver support before Core emits Task
turns. Mixed versions fail explicitly rather than falling back to Center Agent
Chat, Space, or a provider conversation. A provider publication keeps one frozen
typed locator and operation identity; Web projection of the same canonical Task
event never causes another model execution or provider write.

Version 3 Remote Agent turn requests carry
`conversationIdentity: { kind: "center_agent_task", taskId }` alongside the
shared Task conversation id. Remote Agent validates that the typed identity and
conversation route agree before Durable Object admission, and Core validates
the same Task id against the Task-owned delivery handle before terminal
projection. Version 1 and 2 prefix-only Task records remain readable solely for
mixed-version and retained-record compatibility; current Core Task producers
emit version 3. Deploy Remote Agent receiver support before the Core producer.

### Agent Task Coordination Contracts

`packages/schemas/src/schemas/runtime/agent-task-coordination.ts` owns the
shared language for exact Agent Task Handles, terminal outcomes, completion
conditions, frozen continuations, subscriptions, and delegation topology.
`packages/schemas/src/schemas/http/center-agent.ts` owns the Center Agent Wake
completion-mode request, the paired delegation/child-task response, and the
exact-task watch request and response. It also owns the bounded controller-task
discovery request and response used to obtain an exact handle before a watch.
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
observer Native Delivery, so this change requires no D1 migration and does not
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
Organization, owner, and registration source inside the same conditional D1
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
authority, or Wake availability owner.

Rules:

- Binding writes and command eligibility stay on the Agent Profile Binding
  contract.
- Wake availability still comes from Core-owned `AgentExecutionReadiness`, not
  from Binding existence or route/service evidence alone.
- Clients may use `primaryBinding` for display and local cache hydration only.
  They must refresh the owning Binding or readiness read model after a mutation
  instead of treating a stale projection as authority.

### Message Channel Contracts

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
current active attempt. `restart` may replace only a `pending_registration`
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
one-message-per-source-and-destination behavior. Apply D1 migration
`0145_calm_tarot` first; it backfills that key and expands the unique
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
bytes or Bot credentials. Apply D1 migration
`0141_awesome_lady_bullseye` before Core;
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

Roll out the Remote Agent consumer before Core returns the new evidence shape,
then deploy Core ingress with the trusted event grant. During that short window
the new consumer accepts only the exact old `{organizationId, status:
"presented"}` acknowledgement and labels it `legacy_core_presented`; arbitrary
extra text or fields still fail closed. Core no longer calls or exposes the
removed transient resolver. Rollback stops the Core producer first, then rolls
back the Remote Agent consumer. This hosted runtime contract does not change
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
because the verified request already carries that text through the existing
worker message field. Message identifiers are unique, timestamps are ordered,
and both per-message and total text limits are enforced at the shared schema
boundary.

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

For the first Slack adapter, apply shared D1 migration `0044` before deploying
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
`requester_private` writes the verified member subject,
`organization_shared` may write the enabled Organization subject, and
`externally_shared` writes neither automatically. Source values such as
`slack_conversation` and `message_channel_conversation` remain provenance and
must not choose the memory subject. Missing or conflicting frozen scope fails
closed.

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
Brief and title projections may use their existing bounded cache as an
availability fallback, but a failed current read must never reuse a cached
policy. Workstation policy reads are also optional to delivery: a read failure
or missing Space Organization projection is observable and omits the custom
hints while preserving built-in guidance.

The production rollout is ordered: apply D1 migration `0061`; deploy Core so it
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

### Organization Document Contracts

`packages/schemas/src/schemas/http/organization-documents.ts` owns the strict
human HTTP/Core RPC CRUD and draft-review payloads, the Center Agent catalog,
read, draft, and management payloads, and the bounded prompt-context projection.
Gateway, Core, API client, Web, and Remote Agent must derive their types from
these schemas and must not maintain parallel document shapes.

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
`expectedDraftCreatedAt`. Core includes both values in the same conditional D1
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

1. apply D1 migration `0115_tense_cannonball`;
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
Remote Agent, then Web; the additive D1 migration may remain.

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

`management-v2` rolls out through an additive D1 migration first, then the Core
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
The rejection variant must not invent a submission identity. Core's private D1
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

Version 4 is an additive strict request-envelope change. Deploy the D1
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
`developing/product/center-agent-routines.md`; it does not authorize reads,
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
Organization reads plus Organization-shared Apps. Dedicated GitHub reads accept
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

1. apply D1 migrations `0077` and `0078`, which add native-delivery speaker
   evidence and audit-source projection;
2. deploy Remote Agent, whose optional identity consumer keeps old Core turns
   on the legacy external-participant surface and preserves verified read
   payloads;
3. deploy Core, which may then freeze provider identity, expose the
   connected-member tool surface, and authorize each call against the active
   delivery.

The reverse Core-first window is unsafe because an older strict Remote Agent
does not accept the new sender identity. Rollback therefore stops or rolls back
the Core producer before the Remote Agent consumer; the additive D1 columns may
remain.

Expand connected-member Organization-shared App access in a separate
receiver-first rollout:

1. apply D1 migration `0096_lovely_roland_deschain`, which adds the canonical
   requester-attribution key and source native-delivery attribution to
   connector action operations;
2. deploy Core with the expanded shared tool-name contract, exact native
   delivery authorization, shared-only connection selection, and
   provider-delivery attribution;
3. deploy Remote Agent so connected-member turns begin exposing GitHub
   Organization reads and ordinary writes plus shared generic App capabilities;
4. for non-GitHub Apps, treat the action owner's registered `write` effect as
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
in one atomic D1 batch. If that exact Slack account points to another member,
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
therefore exposes no deletion caller or provider-account email. No Auth, D1
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
The new Remote Agent accepts an old Core authorization response that omits
`slackIdentityLinkSupported` and refuses to record the target until Core
advertises support. It also accepts the directory's additive
`matchedBy = "identity_link"` value before Core may emit it. After Remote Agent
is current, Core may emit both additions and accept the callback target.
Rollback stops Core production before removing Gateway or Web consumers; the
additive D1 columns may remain.

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
per Run. D1 atomically claims the exact continuation delegation id before child
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

Apply D1 migration `0025` before `0026`, Slack ingress migration `0035` before
queued Slack production, Routine migration `0036` before new Routine fields,
and migration `0063` before Core may create a second native-delivery row for a
Routine Run. Migration `0064` adds the stored Routine action grants and the
one-continuation Run claim and must precede Core writers. For this rollout:
apply `0063` and `0064`; deploy Core's optional create/update input consumer
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

`packages/schemas/src/schemas/runtime/openconnector-runtime.ts` is OpenMeld's
pinned runtime validator for OpenConnector action metadata. It mirrors the
OpenConnector `/v1/actions?service=` serializer and the bounded
`/v1/actions/search` projection, including required schemas, provider
permissions, the executor-owned `execution` projection, and optional
first-class `effect = read | write | destructive` metadata. Remote Agent must
fail closed on a malformed entry and may expose only
`execution.locallyExecutable = true` actions to the model. Catalog-only entries
are provider documentation, not executable Center Agent capability. The same
module validates OpenConnector action-operation metadata so Remote Agent does
not hand-interpret provider execution IDs, idempotency keys, or replay flags.
It also validates the successful action envelope and requires the exact
execution-owned output schema beside the returned data. Missing or malformed
execution schemas fail closed instead of falling back to a possibly newer
catalog contract.
Remote Agent recognizes destructive legacy action IDs or names as well as
`effect = destructive`; conflicting read/write metadata cannot downgrade a
legacy destructive action. This vocabulary classifies the action's effect only
and never parses user or Routine text as authority. Interactive destructive
actions use the shared one-time confirmation. A new Routine destructive action
returns `routine_destructive_action_unsupported` before a new operation claim or
provider execution. Recovery reads an exact existing operation before current
catalog and policy checks, and may replay only that same idempotent provider
operation; recovery never authorizes new destructive work.

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
Ordinary non-GitHub Apps may use `automatic` for requester-first,
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
Core D1 migration and Core, then Gateway, Remote Agent, and Web. New Core remains
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

`packages/schemas/src/schemas/http/space-wake-stop.ts` owns the shared POST
contract for Wake Stop. Clients may submit only Space-visible selectors:
`sourceSignalId` or `clientMessageId + targetProfileId`. `dispatchId`, local
task ids, execution tokens, and adapter ids stay internal to Core,
RuntimeCoordinator, RuntimeTransportHub, and the local OpenMeld Service.

`packages/schemas/src/schemas/http/space-wake-progress.ts` owns the Wake
progress read model, including the optional `startedAtMs` timing projection and
the optional `wakeStopEligibility` projection. It may also expose the bounded
optional `waitReasonCode=runtime.agent_controller_conversation.occupied` from
RuntimeCoordinator lifecycle evidence. That neutral projection never exposes
the controller conversation id, does not grant execution authority, and must be
cleared when the latest occupancy transition is `available`. The timing and
Stop projections are
mixed-version opt-in: clients request authoritative elapsed-time timing with
`includeTiming=true` and Stop eligibility with
`includeWakeStopEligibility=true` on Wake progress and active Wake progress
reads. Core must omit each field when the corresponding request does not opt
in, so new Core does not break older strict clients. `startedAtMs` is the
authoritative execution start anchor while `updatedAtMs` remains freshness and
ordering evidence. A new client must omit elapsed time when `startedAtMs` is
missing, and must treat a missing `wakeStopEligibility` field as not eligible
before exposing a clickable Stop control.

The timing rollout is Core receiver/producer first, then Gateway forwarding,
then Web opt-in. Old Gateway ignores the unknown browser query and old Core
never receives it; new Gateway must not forward `includeTiming` to an old Core
strict RPC input. Existing CLI versions do not send `includeTiming=true`, so
new Core preserves their previous strict response shape. This additive HTTP/RPC
projection changes no OpenMeld Service, daemon, Prepare, Runtime Transport,
RuntimeCoordinator authority, or local-component contract version.

The occupancy wait-reason rollout is Web receiver first, then Core producer.
The field is optional so new Web remains compatible with old Core; an old
strict Web response parser must not receive the additive field before the new
Web is live.

Wake Stop eligibility is a read model, not execution authority. It may make a
Wake appear stoppable only when Core can project one of three control modes:

- OpenMeld-owned pre-agent Stop, for a target Wake that has not linked a
  RuntimeCoordinator execution and has not reached local agent delivery.
- Controller-backed running Stop, for a linked execution whose controller can
  accept native cancel or native interrupt.
- Remote Agent native-delivery Stop, for one active hosted submission whose
  durable execution identity can be cancelled through the Remote Agent worker.

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
local OpenMeld Service -> Runtime Agent Controller Report -> Core D1 projection -> listLocalRuntimes -> Web/Desktop/UI consumers
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
`Low` is derived by presentation code and is not stored. Missing provider facts
remain null; they must not become zero, 100, or unlimited capacity.

Provider adapters may add evidence either from a dedicated native non-task
probe or from a provider-native event passively observed during an ordinary
already-running controller turn. Both sources must normalize into this same
list before crossing the local Service boundary. A passive observation must
not start work, modify the turn, retain its raw event, or create a second usage
store. Claude Code's Agent SDK event is partial: a missing utilization value
creates no percentage evidence, while allowlisted 0–1 utilization is normalized
to 0–100 and all session, account, overage, credit, and payment fields are
discarded. The local Service separately confirms the current account through
the existing non-task ACI authentication probe before merging a passive event.
That owner-only comparison evidence never becomes part of the Usage Limit item
or crosses into Organization Computers; an unknown or different account fails
closed instead of reusing the observation.

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
as the same warning-level **Couldn't check** outcome used by the affected local
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
arguments, authentication type, controller-provided skill inventory, and
free-text local messages. It preserves the bounded controller-provided model IDs
and display names as installation compatibility evidence, plus controller
identity, coarse authentication status, optional provider email or bounded
account label, static capabilities, native interface, version/update evidence,
launch status/count, bounded check evidence, Usage Limits, and stable readiness
fields needed by Core and owner-facing clients. Provider account evidence is
allowed only because the
authenticated owner-only `listLocalRuntimes` surface needs to identify which
local account OpenMeld will use; it must not flow into Organization computer
directories or another member's read model. Do not make every schema field
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
`localAgentControl.manageInstallations` capability gates an owner-only
list/select request for one registered built-in agent. The Service returns
bounded installation ids, friendly names/details, and one selected id; only the
immediate owner response may contain path-derived details. Selection updates
the local registry's launch contract and then refreshes the canonical runtime
report. Older Services omit the capability, so new Web stays dormant; publish a
new Service only after Core, Gateway, API client, and Web accept the additive
frames and responses.

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
Those paths are local configuration, not a cloud projection, and no D1 schema,
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

- `Connect OpenMeld Service`
- `Reconnect OpenMeld Service`
- `Update OpenMeld Service`
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

`release/local-components.json` `components.*.updatePolicy` is the single source
of the current release's advisory-or-required rollout intent. Each component's
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
  `0.3.126`: earlier Services lack the complete startup recovery,
  managed-update, and active Permission/Wake behavior required by the current
  workstation runtime, and `0.3.125` can strand a newly delivered Wake during
  a controlled Service replacement. A supported version below the latest
  release remains advisory when
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

Core's compiled local-component projection and the production CLI download
channel are two projections of one release, not two policy owners.
`release/local-components.json` owns the declared component versions and update
policy; Core exposes the server-required projection, while the R2/Web manifest
and binary URLs prove that the declared CLI is actually installable. CLI status
may reconcile those views for diagnostics, but it must not invent a third
requirement or choose whichever view is more convenient. A production channel
behind Core's declared version is a release fault and must fail closed before
Core deploys; a newer compatible channel may precede Core during an intentional
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

## Space Member Contracts

`getSpaceStatusResponseSchema` may expose the Organization's current
`centerAgentProfileId` as an optional presentation identity. This lets public
Space readers render the Center Agent consistently without inferring identity
from a Profile name or Agent Controller. The field is not membership,
readiness, or execution authority; clients must still use the owning snapshots
and projections for those facts. It remains optional so older Core producers
and already-deployed strict consumers remain compatible during rollout.

`packages/schemas/src/schemas/http/space-members.ts` owns the shared HTTP
contracts for Space member snapshots, public Wake availability fields, owner
diagnostics, and Space member directory entries.

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
access mode contract. `space_meta.accessMode` is the source-of-truth projection
for whether a Space is public, public to view but password-gated to join, or
member-only for creator/current-member/same-account access. The Space password remains a single
Space credential; access mode changes may set, reuse, or clear that one password
proof, but must not introduce a second join-only or view-only password.

`packages/schemas/src/schemas/http/space-meta.ts` also owns the pure initial
access policy used only while creating a Space. Core and creation clients must
call `resolveInitialSpaceAccessMode`; they must not independently recreate the
`private -> members_only` and `public -> public` mapping. Once the Space exists,
its stored visibility and access mode remain independent facts and readers must
not apply the creation policy to reconstruct either one.

`GetSpaceStatusResponse` projects both access facts from the same Space meta
record: optional `organizationVisibility` describes Organization discovery and
self-service joining, while required `accessMode` describes what a person with
the link can do. The optional field permits a staged Core, Gateway, and CLI
rollout: new readers accept an older response without it, and older readers
strip the additive field. Clients must label the facts separately and must not
derive one from the other.

`packages/schemas/src/schemas/http/space-status.ts` owns the bounded
`latestVisibleUpdate.previewText` projection. Core applies the shared UTF-16
boundary before publishing the response, and the response schema applies the
same idempotent normalization while parsing. That parser normalization lets a
new CLI consume an older Core response without repeating the full message in
status output; it does not cache, omit authorization, or change Space history.
The field name and wire shape remain unchanged, so old readers continue to
accept a new Core response and no ordered rollout is required.

`packages/space` owns reusable pure policy for turning Space identity and
membership facts into mention labels, addressing support, and member directory
send targets. Clients, Core, and dispatch prompts may adapt source facts before
calling this layer, but they must not rebuild separate member-directory,
mention-label, or send-target rules locally.

The member directory is a Space read projection and authoring aid. It must not
become Space membership truth, Agent Profile readiness truth, Binding truth, or
RuntimeCoordinator execution authority.

## Account Display Name Contract

`packages/schemas/src/schemas/http/account.ts` owns the Account Display Name
limit and the shared `PATCH /v1/account/display-name` request and response.
Account Display Name is the canonical name value for the account's one default
Human Profile. The Auth-owned account display-name command is the only writer:
one D1 atomic `batch()` transaction updates Better Auth `users.name` and the
active default Human Profile's `profileName` and collision-safe derived
`profileHandle`. Auth must not implement this pair with explicit transaction
statements or Drizzle `db.transaction()`, because D1's Worker API owns the
transaction boundary through `batch()`.

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

The Center Agent RPC wrapper does not create a second state machine. It verifies
the current designation, resolves the represented member, preserves the Center
Agent Profile as actor, and delegates to the same Core request operations.
Routine turns cannot decide another member's pending request or change the
represented member's approval preferences.

This is an additive rollout. Apply the D1 migration first, then deploy Auth so
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
- Wake availability from Core-owned readiness projections.
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

The durable mental model is:

```text
packages/schemas defines cross-boundary contracts
packages/db defines shared D1 schema truth
services/auth and services/core expose domain-owned behavior
services/gateway aggregates read-only diagnostics
```

A shared physical database does not imply shared ownership. Auth and Core may
share a physical D1 binding while each domain still owns its own tables and
writers.

Database ownership, projections, Dispatch Ledger, Diagnostic Reports, and
rebuild rules belong in `developing/architecture/data-and-observability.md`.
This document only owns the shared package and contract boundary.

## `packages/agent-runtime`

`packages/agent-runtime` owns shared pure policy for runtime and claim-adjacent
decisions that must stay consistent across CLI, Web, Core, daemon, and adapters.

It is the shared source for:

- Agent Controller refs
- OpenMeld Service Runtime identity and registry contract helpers
- Prepare readiness summaries
- Agent Profile Binding projections and command eligibility
- Core claim eligibility policy projections
- stable working-language judgment instructions and per-turn advisory rendering

Agent Controller refs must use the shared helpers. Do not hand-build or
hand-parse refs such as `builtin:<id>` or `custom:<id>` in clients or services.

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

## Agent Profile Binding Contract

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
that change current coordinator state. `skip_interrupted_work` resolves an exact
`continuation_needs_attention` gate and promotes the oldest queued Wake; it does
not replay the interrupted request. Its strict request carries the current
interrupted target-Wake lifecycle id, and the owner shard compares that identity
before mutation so a stale Web action cannot clear a later gate. Usage-based
automatic continuation requires the exact current
`usageLimitsSupportMatrixVersion`, the same Profile, controller, Binding, and
configuration, complete replayable source context, and no prior automatic
continuation attempt. The continuation authorization request also carries the
current canonical Binding tuple and an explicit accepted-revision verification
marker; the owner shard compares it with the interrupted run command snapshot
in the same transaction. Missing or mismatched accepted revision evidence is
unsafe. An unsafe request or failed automatic continuation stays behind one
current Needs-attention projection instead of entering another retry loop.

RuntimeCoordinator head admission keeps its existing version 1 wire shape so a
new Core caller cannot stall ordinary Wake traffic on an older strict owner
shard. The initial continuation authorization compares the current canonical
`bindingId`, `agentControllerRef`, and `configurationRevision` with the
interrupted run command in the owner-shard transaction. Future-work settings
use a dedicated owner-shard mutation RPC instead of adding a field to the
existing strict execution-target mutation request. That transaction moves a
pending or authorized continuation to the single Needs-attention gate and
writes its Inbox intent before the cloud Binding write may begin. If the
continuation head wins the owner-shard order first, it becomes running and the
setting may save for later work without changing the current execution. An
older shard that lacks the dedicated future-settings RPC rejects the setting
write before D1 mutation; ordinary Wakes continue on the unchanged hot path.

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
client, Gateway/Core write path, D1 Binding record, owner read projection, and
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
Binding's `configurationRevision`. A new local component negotiates newest
first and falls back from `v3` to `v2` to the legacy query only when the server
returns `invalid_payload`, whether surfaced as the direct Gateway error code or
its legacy upstream-code alias. It must not retry network or server failures as
compatibility fallbacks.

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
route the interaction and may leave the provider waiting. No D1 migration is
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

Binding existence does not equal `Available for Wake`.

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

It does not own readiness truth.

It also does not own Start or Prepare orchestration, OpenMeld Service lifecycle,
Space rendering, RuntimeCoordinator execution truth, dispatch, claim, final Wake
outcomes, or reply placement.

Adapters must flatten source-specific evidence before calling this package. Do
not import Start-owned setup, device projection, or profile readiness types into
`packages/agent-profile`.

## Cross-Client Reuse Policy

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
`x-openmeld-space-dispatch-trace-response-version: 3`. Core also accepts the
frozen version `2`; without the header, Core projects the legacy version `1`
subset. Version `2` omits every version-3-only head no-execution detail,
including disabled-Local-Agent, reliable Usage, and newer canonical blocker
families, while retaining the surrounding generic dispatch and attempt
evidence. These projections validate each detail against the frozen version-2
schema and omit newer values instead of substituting a misleading historical
Binding reason or sending a payload an already-published strict CLI cannot
parse.

The current schema accepts the legacy subset, so a new CLI remains compatible
with an older Core that ignores the header. A new Core remains compatible with
an older CLI because an explicit version `2` request receives the frozen
projection and a missing header selects version `1`. Deploy Core and Gateway
receivers before a new CLI starts requesting version `3`; rollback to a
version-2 CLI remains safe while those cloud receivers continue accepting both
versions. Clients must not rebuild current waiting truth from historical
dispatch attempts when the current head projection is absent.

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
- the acting profile is the Space creator
- the acting profile is an active Space member
- the acting OpenMeld account already has any active profile in that Space
- the acting OpenMeld account is the creator owner recorded on the Space

Anonymous viewers and authenticated accounts with no creator, member, or same
account membership proof must still provide the Space password.

Same-account access is not automatic Space membership. It allows the account to
open and operate against the protected Space without re-entering the password,
but a profile still must be explicitly added or joined before product flows that
require that exact profile to be a Space participant can rely on membership.

Clients must not duplicate this authorization rule. Web may store a short-lived
encrypted password cookie for anonymous or not-yet-member access. CLI may accept
`--password` for first join or one-off access. Both clients should rely on Core
to decide when password is still required.

## Owner Boundaries

This document owns shared contracts and reusable policy boundaries.

Use scoped owner documents for related rules:

- `developing/product/product-model.md`: product promise and user-facing model.
- `developing/product/agent-profiles.md`: Agent Profile product semantics.
- `developing/product/center-agent-routines.md`: Routine and Run product
  semantics, authority, scheduling, and result surfaces.
- `developing/product/center-agent-tasks.md`: canonical Task and Task Context,
  event, access, concurrency, Stop/Retry/Recovery, and cross-channel semantics.
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
