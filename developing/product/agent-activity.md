# Agent Activity

## Agent Context

- Purpose: Own the Agent Activity product contract for organization-wide coding-agent awareness, privacy, presence, retention, and read surfaces.
- Read this when: Changing coding-session observation, Agent Activity reporting or snapshots, Center Agent activity awareness, local hook or watcher behavior, or the Agent Activity Web/CLI experience.
- Update this when: Agent Activity disclosure, authority, storage, ingestion, retention, naming, client support, or rollout boundaries change.
- Do not use this for: Wake execution ownership, Space delivery, RuntimeCoordinator state, Center Agent audit records, or raw provider session formats.
- Source of truth: Product meaning and non-negotiable boundaries for OpenMeld Agent Activity.

## Product Promise

Agent Activity gives every member of one OpenMeld Organization a fast,
privacy-safe answer to two related questions:

> Which coding agents are active, on which Project, through which client, and
> when were they last active?

> Which retained Local Agent Sessions exist under our connected Projects, and
> which native Session can a person or agent unambiguously reference?

`Agent Activity` is the canonical product and code term. Its canonical Web
route is `/o/{orgSlug}/agent-activity`, and the primary rail label is
**Agent Activity**. The page, navigation, API, schema, and code term use that
full name so it cannot be confused with human activity or the Center Agent
Audit Log. `Session Sync`,
`Shared Context`, and `Pillar 3` must not be introduced as current names in
code, schemas, API fields, docs, or product copy.

Agent Activity is awareness evidence. It is not a work lock, task claim,
execution authority, transcript product, or replacement for direct teammate
confirmation.

## Canonical Project Consumption

Agent Activity consumes the canonical Organization-scoped Project identity
owned by `developing/product/projects.md`. It may reference Project IDs, filter
or group Activity by Project, and retain historical Project references while
the evidence remains under retention. It does not own Project creation,
editing, removal, local connection management, or Default Project behavior.

Local observation remains explicit opt-in. Watchers may observe only sessions
whose working directory resolves inside a user-confirmed Local Project
Connection. A discovered candidate is not a connection and cannot report
Activity. One Project may have multiple connected clones or worktrees; every
matching connection attributes Activity to the same canonical Project ID.

Absolute paths remain local owner-self facts. Agent Activity events, sessions,
digests, snapshots, and Center Agent context never receive them. Removing a
connection stops new collection for that folder immediately and clears its
unsent local Activity without rewriting accepted cloud history.

## Disclosure Contract

Agent Activity is metadata-only. Allowed facts are explicitly enumerated and
provider-specific. There is no generic metadata bag.

Allowed categories include:

- provider and client kind;
- the provider-supplied user-visible session title, including a provider's
  generated thread name;
- model and bounded provider configuration enums;
- active, idle, ended, error, or unknown status;
- Git branch, commit, and one-way repository fingerprint;
- session start, observation, expiry, and last-active timestamps;
- safe bounded provider counters that have been individually reviewed.

Never collect, store, transmit, summarize, inject, or display:

- full prompts or any additional prompt-derived summary beyond the
  provider-supplied session title;
- assistant replies, reasoning, transcripts, or tool input/output;
- file contents, diffs, patch text, commands, or terminal output;
- absolute paths, environment variables, credentials, or raw repository URLs;
- arbitrary provider fields or an unreviewed serialized session object.

The provider-native Session id is the public Session identifier in the current
Session Inventory. OpenMeld does not create a second public Session id. Its
product identity is the tuple `(owner, agentControllerRef, nativeSessionId)`.
Project and Computer describe the Session's current authorized work
environment; they are not additional identity namespaces. A native Session id
is an identifier, never operation authority. Resume, Fork, Profile creation,
and Space membership must re-authorize the Organization, owner, Project,
Computer, controller, and current provider capability at execution time.

Historical Activity event and legacy snapshot contracts keep their opaque
projection ids for compatibility. Those ids are not Session Inventory identity
and must not be accepted by new Session selection or Agent Profile creation
flows.

Organization snapshots return the reviewed provider-specific metadata for each
session only when the reader sends `includeProviderMetadata=true`. The field is
additive and optional during mixed-version rollout; a reader that does not opt
in receives the frozen legacy session shape. It remains a strict
provider-specific object rather than a generic metadata bag. Web opts in and
presents every returned reviewed field, while Core removes private
parent-session ids before the public response.

The Session Inventory uses only the current provider-native title. It does not
copy, rename, summarize, or preserve a previous title after the provider store
has changed or removed it. A provider prompt preview, first prompt, transcript
summary, OpenMeld label, or Agent Profile name is not a substitute. When the
provider exposes no safe native title, the value is `null` and the UI says that
no native title is available.

The historical Activity session projection may still preserve sparse event
fields for evidence continuity. That compatibility behavior does not apply to
the current Session Inventory.

`boundAgentProfileId` is resolved at read time from the authoritative enabled
primary Agent Profile Binding whose owner, `agentControllerRef`, and native
conversation id match the Session. Agent Activity never writes a second bound
flag or copied Profile id. Zero matches means unbound, one verified active
Profile means bound, and multiple or inconsistent matches fail closed as a
binding conflict.

## Presence And Evidence

Level-zero events are immutable, idempotent evidence. The current-session
table is a projection derived from accepted events.

- Every event expiry is no more than five minutes after its observation.
  Active presence requires a future expiry; idle, ended, error, and unknown
  evidence may expire at the observation time.
- Stale or missing evidence is shown as stale or unknown, never inferred as
  active.
- The same event id and canonical payload hash is `reused`.
- The same event id with another payload is permanently rejected as
  `event_id_conflict`.
- Event acceptance and current-session projection update are one atomic D1
  operation.
- Event reporting derives member, device, and runtime authority from the
  authenticated request and registered OpenMeld Service runtime.
- A normal observed event cannot self-report a RuntimeCoordinator execution
  id. Execution links use a separate authority-owned write path.

Agent Activity presence is separate from Wake availability, Wake execution,
Runtime Transport leases, and RuntimeCoordinator. It must never make an Agent
Profile look Wake-ready or change Wake routing.

## Ingestion And Local Observation

OpenMeld Service owns local observation and durable delivery. Supported Session
Inventory providers are Codex App/CLI, Claude Code CLI, Cursor, OpenCode, and
Grok Build.

- Codex App and CLI share rollout storage; client kind is derived only from
  trusted provenance such as `originator`.
- Claude Code may use managed hooks plus local session observation.
- Cursor uses its official user-level Hooks surface. OpenMeld observes
  `sessionStart`, `beforeSubmitPrompt`, `stop`, and `sessionEnd`, but maps only
  the session id, one unambiguous workspace root, Cursor version, background
  flag, and reviewed `composer_mode` values `agent`, `chat` (Ask), `plan`, or
  `debug`. Prompt, response, attachment, user, model, title, Git branch, and
  transcript fields are discarded. Hook evidence reports an unknown client
  kind unless Cursor supplies trusted IDE/CLI provenance outside the hook
  payload; OpenMeld ACP lifecycle evidence may report `cursor-cli`.
- OpenCode uses its official plugin event surface. When trusted provenance
  cannot distinguish CLI, TUI, Desktop, and Web, the product displays
  `OpenCode` with `clientKind = unknown`.
- Grok Build participates through its provider-native retained Session
  inventory and ACP lifecycle evidence. Provider versions that cannot discover
  retained Sessions report `unsupported`; OpenMeld does not infer a successful
  empty result. Runtime lifecycle and tool events remain execution telemetry
  and are not transcript-derived Activity.
- Managed hook and plugin installation uses compare-and-swap ownership,
  coexists with user configuration, and is reversible without deleting user
  entries.
- Provider hook configuration is machine-global, while Local Project
  Connections remain lane-local. One OpenMeld-owned dispatcher resolves each
  hook `cwd` through a
  mode-0600 global route registry and then reads only the selected lane root.
  Zero matches are unbound; more than one matching lane fails closed. The
  registry never uploads local roots or creates a second Project-binding truth.
- The dispatcher must be owned by a durable installed `openmeld`,
  `openmeld-dev`, or `openmeld-canary` command. Ephemeral `npx` and custom
  presentation commands cannot silently install a production-lane observer.
  When observer setup cannot complete, Activity reports `needs_attention`
  without invalidating the canonical Local Project Connection.
- Watchers read only sessions whose current working directory resolves inside
  an explicitly connected local folder. Non-matching sessions are discarded
  without a local copy.
- A fresh provider profile may create its session directory after OpenMeld
  Service starts. Missing watcher roots are retried dynamically; users must not
  need to restart the Service to begin near-real-time observation.
- The published CLI supports Node 20 and Node 22 through 25. OpenCode's retained
  Session reconciliation opens its SQLite store read-only only when the store
  exists: the npm CLI uses `better-sqlite3` only on the Node releases that its
  native package supports, while the standalone Bun binary uses built-in
  `bun:sqlite`. Both runtimes execute the same ordered query and row-mapping
  contract; the managed OpenCode plugin remains the primary lifecycle-event
  path. Node 21 and Node 26 or newer are not declared compatible until the
  native SQLite reader supports them.
- A local event is at most 16 KiB; one report contains at most 64 events; the
  outbox is bounded and reports pressure explicitly instead of deleting the
  oldest unsent fact to claim health.

### Complete Session reconciliation

Session Inventory discovery is a durable full reconciliation, not an event
window. Every connected local Project folder and supported Local Agent is one
reconciliation source. OpenMeld Service enumerates every provider-retained
Session available through that provider's documented local surface, maps it to
exactly one authorized connection, and uploads bounded pages containing only
the shared metadata contract.

- There is no ten-minute startup window, fixed file-count cap, or fixed cloud
  snapshot cap.
- Reconciliation pages are staged privately. Core publishes the new set only
  after the terminal page is accepted, so readers never mistake a partial scan
  for the complete inventory.
- Page order and retry are stable and idempotent. Core fences current-inventory
  and source-state terminal publication mutations on the source's active
  syncing reconciliation. Two overlapping copies of the same terminal page
  therefore publish the same complete set once; a late duplicate cannot delete
  current rows already published by the winner, and candidate cleanup remains
  scoped to the exact reconciliation. An interrupted scan can be restarted
  without erasing the last complete projection.
- The local source ledger namespaces every observed connection by the
  authenticated owner. After an account switch, a retained Project connection
  with source evidence for another owner is not adopted or submitted as the
  newly signed-in owner; other current-owner connections continue reconciling.
  Foreign-owner source evidence remains local until that owner can reconcile
  it, and an ownerless legacy source record grants no ownership.
- A complete reconciliation hides prior current rows from the same source that
  are absent from the new candidate set. Removing a Local Project Connection
  reports `disconnected` and removes that source from the selectable current
  Inventory while retained Activity evidence remains unchanged. CLI unbind and
  current-device Web removal both request this reconciliation immediately; the
  periodic loop is only a backstop.
- A `disconnected` report may revoke the exact previously authorized source
  after the Project repository fingerprint changes. Other reconciliation
  outcomes still require the current Project fingerprint, so this revocation
  exception cannot publish or resume Sessions for the old repository.
- When a local Project Connection is rebound, the Service publishes the old
  source's `disconnected` fact before publishing its replacement. A failed
  replacement therefore cannot keep an obsolete authorized source selectable
  or deadlock reconciliation on the Session identity uniqueness constraint.
  Once the replacement publishes current or unsupported coverage, Core retires
  the obsolete disconnected source generation from current coverage.
- `unsupported` is a provider capability fact. `error` preserves the last
  complete projection as stale. Neither is converted into an empty successful
  result.
- A provider that is not installed reports `unsupported`. A provider that is
  installed but temporarily cannot launch or read its retained store reports
  `error`, so a transient local failure cannot erase the last complete set.
- A retained provider record or Session file that is syntactically readable but
  lacks its required native id, Project path, or last-active timestamp is an
  incomplete scan and reports `error`; it is never silently omitted from a
  supposedly complete inventory.
- Provider-retained history is the hard completeness boundary. Sessions the
  provider deleted, expired, or created in a no-persistence mode cannot be
  reconstructed by OpenMeld.

Working, Idle, Ended, Error, and Unknown require provider evidence. File
modification time alone is not proof that a Session is Working or Ended. When a
provider exposes retained metadata but no reliable lifecycle fact, status is
Unknown. Ended is not synonymous with cannot Resume.

For Claude Code, only explicit top-level Session lifecycle hooks may refine the
retained status. `Notification`, subagent lifecycle, and other ambiguous hook
events remain Unknown unless the structured live-agent registry supplies a
current status for the exact native Session id.

The complete Claude union also includes an attributable registry Session before
its top-level JSONL appears. The registry must supply native Session id, current
Project path, provider job start time, and a recognized state. That job start is
the latest safe activity event for a registry-only row; the top-level Session
start remains null. Registry agent/job names are not native Session titles. A
registry Session missing any required field makes the provider scan incomplete
and preserves the prior Core inventory as stale.

`canResume` and `canFork` are explicit provider-and-session capability facts.
They are true only when the installed provider exposes that native operation
for the concrete retained Session and the OpenMeld adapter supports invoking
it. OpenMeld does not simulate Fork by copying metadata or starting an unrelated
Session.

The current provider contract is intentionally asymmetric where the provider
surface is asymmetric:

| Provider | Complete retained discovery | Native title | Status without fresh lifecycle | Resume | Fork |
| --- | --- | --- | --- | --- | --- |
| Codex | app-server `thread/list`, every source kind, archived and non-archived pages to cursor exhaustion | current `Thread.name`, else null | archived is Ended; otherwise Unknown | retained non-archived threads | false until OpenMeld wires and verifies provider-native Fork |
| Claude Code | top-level retained JSONL plus the complete live/job registry and hooks | explicit native custom title, else null | Unknown | retained Sessions | false until OpenMeld wires and verifies provider-native Fork |
| Cursor | no complete documented machine-readable inventory; report unsupported coverage | unavailable for the complete inventory | Unknown | unsupported from the complete inventory | unsupported |
| OpenCode | complete local Session table or official API pagination | current persisted `session.title` | archived is Ended; otherwise Unknown | retained usable Sessions | false until OpenMeld wires and verifies provider-native Fork |
| Grok Build | complete retained `summary.json` index | current generated or renamed native title | Unknown | retained Sessions | false until OpenMeld wires and verifies provider-native Fork |

Archived or otherwise unusable Sessions return false for an operation unless
the installed provider version and adapter have proved that exact operation.
Provider command output, protocol version, and retained-store shape must be
probed; this table is not permission to guess across provider versions.

Origin is `openmeld`, `local`, or `unknown`. `openmeld` requires explicit local
execution evidence that OpenMeld created that native Session. `local` requires
provider evidence of creation outside OpenMeld. Ambiguous history is `unknown`;
it is never guessed from the current folder or current owner.

Context injection is optional and fail-open for agent startup. It uses a
provider-independent 300-byte UTF-8 ceiling, which is also a hard upper bound
of 300 tokens for byte-fallback tokenizers. It may contain only cached, fresh,
privacy-safe Organization activity and
must label it as awareness only. Missing, stale, or failed cache reads inject
nothing. Harness documentation is not acceptance evidence; every supported
provider requires a real local injection test.

## Organization Visibility

Every active member can read current Agent Activity and Session Inventory in
the current Organization. Inventory rows are eligible only while their Project
is active and their local connection remains authorized to that Organization.
The authenticated reporting runtime determines the owner and Computer; a local
payload cannot choose another member or Computer. Personal workspaces are valid
one-member Organizations and use the same contract. Organization switching
must isolate query caches and preserve the Agent Activity page when the target
is personal.

Future per-Project or per-member permissions may narrow reads. MVP code must
not invent hidden ACL state before that shared permission system exists.

## Retention And Digests

- Level-zero events are retained for 14 days.
- Expired current sessions and execution links are cleaned with the same
  retention discipline.
- Daily aggregate evidence is retained after raw events expire. It records
  session/event counts and active agent duration. Active duration connects
  heartbeat, session-active, and session-started observations from the same
  provider session when consecutive evidence is no more than two minutes
  apart; longer gaps start a new active interval.
- A Project becomes digest-eligible after 10 new events or 30 minutes with new
  evidence.
- Digest generation uses a fenced internal summarization RPC and a configured
  low-cost model. It is not a Flue conversation and has no tools.
- Digests are strict structured output and cite event ids plus timestamps. The
  model receives the full event count and at most 100 explicitly safe evidence
  rows; a summary must not present a bounded evidence sample as a full
  transcript.
- Digest failure preserves the previous digest with an explicit failure
  reason; it never creates a template summary and calls it current.
- A pending digest claim older than ten minutes becomes the explicit
  `summarization_interrupted` failure. A crashed producer must not block that
  Project's future windows indefinitely.
- Core does not produce digests unless
  `OPENMELD_AGENT_ACTIVITY_DIGEST_ENABLED=true`. The Remote Agent digest model
  id must be configured before that producer fence is enabled.

## Read Surfaces

The current Session Inventory is one shared schema and Core-owned projection.
Web, CLI Human View, CLI JSON/Agent View, Local Agents, and the Center Agent read
that same paginated contract. No consumer may reconstruct Sessions from recent
events, re-map status, copy Binding state, or maintain a provider capability
table.

Inventory pages use a Core-issued opaque keyset cursor ordered by last active
time, owner, `agentControllerRef`, and native Session id. Filters include
Project, owner, provider, status, origin, exact native id, and bounded title/id
search. The response also returns coverage facts for waiting, syncing, current,
stale, unsupported, error, and disconnected sources. Public Computer identity
is `connectedComputerId` plus the current user-visible name; internal device id,
Service runtime id, local connection hash, and absolute path never leave Core.

Web keeps **Agent Activity → Sessions** as the sole Session inventory product.
It may offer Create Agent Profile, Resume as Agent Profile, Fork as Agent
Profile, Open Agent Profile, and Add to Space according to the returned facts.
Those actions belong to their authoritative Profile, Binding, and Space
systems. Agent Activity supplies only the selected Session fact. Resuming a
Working Session shows a lightweight suggestion to Fork when available; it does
not reject, score, or automatically route the request.

Resume as Agent Profile carries a strict `sessionInventorySelection` pointer
into the Agent Profile Binding command. Before writing Binding truth, Core
revalidates the authenticated owner and active Organization, active Project,
public Computer plus internal runtime device, controller/provider/native id,
fresh current source, `canResume`, and any existing active Binding. A cached Web
row can express selection intent but cannot authorize a Resume operation. The
Binding writer then conditionally claims the controller conversation in the
same atomic write boundary, so concurrent Resume requests cannot both create a
new enabled Binding for one native Session.

The legacy Overview and Changes surfaces continue to consume the bounded
Activity snapshot contract.

Web, CLI, and the Center Agent consume one Core-owned snapshot contract for
that historical presence view.
Snapshots are Organization-scoped and may filter by Project, member, provider,
and status. They return an explicit `asOfMs`, staleness, active sessions,
recent evidence, Projects, and digests.

The Organization stats read is a separate read-only aggregate contract for
dashboard and trend surfaces. Every active Organization member may read the
all-time active duration, all-time session count, earliest aggregate day, and
up to the latest 400 daily totals. Daily rows are returned oldest-first, and
the response states explicitly when older daily rows were truncated. The
all-time totals still include every retained aggregate row when that daily
series is truncated. An optional Project id narrows totals and daily rows to
that Project while retaining the current Organization as the authorization and
data-isolation boundary.

Project-only filtering may return Project digests. Member, provider, and status
filters return no digest rather than showing an unfiltered summary beside
filtered evidence.

The Center Agent tool is read-only and always uses the speaker's Core-verified
current Organization. A connected Message Channel member receives the same
ordinary-member public snapshot without first linking an OpenMeld account. The
snapshot already excludes paths, prompts, transcripts, and private provider
metadata. The tool cannot mutate Projects, stop sessions, claim work, Wake an
agent, or write Space content.

The Center Agent's existing operational record is named **Audit Log**. Do not
reuse `Activity` for audit journal entries.

## Rollout And Compatibility

Projects use migration 0029. Activity events, legacy sessions, digests, daily
aggregates, and execution links use migration 0030. Retention sweep indexes use
migration 0031. Active duration in daily aggregates uses migration 0032. The
complete Session Inventory, private reconciliation candidates, and source
coverage use migration 0130. All migrations are forward-only.

Reporting uses the existing CLI/OpenMeld Service coordinated release path.
Old servers that return 404 keep the local outbox and back off without
breaking Wake. Per-event outcomes are `accepted`, `reused`,
`retryable_rejected`, or `permanent_rejected`; only accepted, reused, and
permanent outcomes leave the outbox. Permanent rejection diagnostics contain
no raw payload, prompt, transcript, or path.

Digest RPC and Center Agent read-tool rollout are separate producer/consumer
windows with separate feature fences. The Remote Agent exposes both
`openmeld_read_agent_activity` and
`openmeld_list_agent_activity_sessions` only when
`OPENMELD_AGENT_ACTIVITY_READ_TOOL_ENABLED=true`; the default is false.
Interactive member turns and reauthorized Routine turns may receive these
read-only tools. Neither window changes RuntimeCoordinator or workstation
execution authority.

Provider-detail expansion uses a separate mixed-version window. Deploy Core
first so its strict RPC reader accepts `includeProviderMetadata`, then Gateway,
then the API client and Web producer that sends the flag. Until Web sends the
flag, new Core returns the frozen legacy response shape. Published CLI versions
never send the flag and therefore never receive an unknown response field.
Rollback removes the Web request first, then Gateway, then Core. Session-title
reporting itself reuses the existing optional `title` event field, so old cloud
code and old local observers remain interoperable.

The safe Session Inventory order is migration 0130, shared schema consumers,
Core, Gateway and API clients, Web/CLI/agent readers, then the local observer
producer. Agent Activity does not add or migrate Binding constraints; the
Binding owner continues to adjudicate historical duplicate conversations. An
old producer continues to report only historical Activity; a new producer
treats a missing reconciliation route as retryable and never erases the last
complete Core projection. Rollback stops the new local producer before removing
readers; retained D1 evidence is never rewritten to simulate rollback.
The legacy digest rollout still uses migrations 0029, 0030, 0031, then 0032;
the one-time active-duration backfill runs only after migration 0032 and its
Core reader are deployed.
