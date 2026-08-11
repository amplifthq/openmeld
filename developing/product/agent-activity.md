# Agent Activity

## Agent Context

- Purpose: Own the Agent Activity product contract for organization-wide coding-agent awareness, privacy, presence, retention, and read surfaces.
- Read this when: Changing coding-session observation, Agent Activity reporting or snapshots, Center Agent activity awareness, local hook or watcher behavior, or the Agent Activity Web/CLI experience.
- Update this when: Agent Activity disclosure, authority, storage, ingestion, retention, naming, client support, or rollout boundaries change.
- Do not use this for: Wake execution ownership, Space delivery, RuntimeCoordinator state, Center Agent audit records, or raw provider session formats.
- Source of truth: Product meaning and non-negotiable boundaries for OpenMeld Agent Activity.

## Product Promise

Agent Activity gives every member of one OpenMeld Organization a fast,
privacy-safe answer to:

> Which coding agents are active, on which Project, through which client, and
> when were they last active?

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

Raw provider session ids are private ingestion keys. Public Web, CLI, Center
Agent, and snapshot responses never return them.

Organization snapshots return the reviewed provider-specific metadata for each
session only when the reader sends `includeProviderMetadata=true`. The field is
additive and optional during mixed-version rollout; a reader that does not opt
in receives the frozen legacy session shape. It remains a strict
provider-specific object rather than a generic metadata bag. Web opts in and
presents every returned reviewed field, while Core removes private
parent-session ids before the public response.

Session projection updates preserve the last verified non-null title, client
kind, model, Git identity, and reviewed provider fields when a later real-time
hook does not know those facts. A later event with an explicit value updates the
fact; a sparse event must not erase richer evidence already observed from the
provider's session store.

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

OpenMeld Service owns local observation and durable delivery. Supported MVP
providers are Codex App/CLI, Claude Code CLI, Cursor, and OpenCode clients.

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
- The published CLI retains its Node 20 startup contract. OpenCode's optional
  SQLite reconciliation is capability-detected and fail-open when `node:sqlite`
  is unavailable; the managed OpenCode plugin remains the primary event path.
- A local event is at most 16 KiB; one report contains at most 64 events; the
  outbox is bounded and reports pressure explicitly instead of deleting the
  oldest unsent fact to claim health.

Context injection is optional and fail-open for agent startup. It uses a
provider-independent 300-byte UTF-8 ceiling, which is also a hard upper bound
of 300 tokens for byte-fallback tokenizers. It may contain only cached, fresh,
privacy-safe Organization activity and
must label it as awareness only. Missing, stale, or failed cache reads inject
nothing. Harness documentation is not acceptance evidence; every supported
provider requires a real local injection test.

## Organization Visibility

MVP visibility is simple: every active member can read all Agent Activity in
the current Organization. Personal workspaces are valid one-member
Organizations and use the same Activity contract. Organization
switching must isolate query caches and preserve the Agent Activity page when
the target is personal.

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

Web, CLI, and the Center Agent consume one Core-owned snapshot contract.
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

Projects use migration 0029. Activity events, sessions, digests, daily
aggregates, and execution links use migration 0030. Retention sweep indexes use
migration 0031. Active duration in daily aggregates uses migration 0032. All
four migrations are forward-only.

Reporting uses the existing CLI/OpenMeld Service coordinated release path.
Old servers that return 404 keep the local outbox and back off without
breaking Wake. Per-event outcomes are `accepted`, `reused`,
`retryable_rejected`, or `permanent_rejected`; only accepted, reused, and
permanent outcomes leave the outbox. Permanent rejection diagnostics contain
no raw payload, prompt, transcript, or path.

Digest RPC and Center Agent read-tool rollout are separate producer/consumer
windows with separate feature fences. The Remote Agent exposes
`openmeld_read_agent_activity` only when
`OPENMELD_AGENT_ACTIVITY_READ_TOOL_ENABLED=true`; the default is false and
Routine turns still cannot receive or execute it. Neither window changes
RuntimeCoordinator or workstation execution authority.

Provider-detail expansion uses a separate mixed-version window. Deploy Core
first so its strict RPC reader accepts `includeProviderMetadata`, then Gateway,
then the API client and Web producer that sends the flag. Until Web sends the
flag, new Core returns the frozen legacy response shape. Published CLI versions
never send the flag and therefore never receive an unknown response field.
Rollback removes the Web request first, then Gateway, then Core. Session-title
reporting itself reuses the existing optional `title` event field, so old cloud
code and old local observers remain interoperable.

The safe order is migrations 0029, 0030, 0031, then 0032; strict readers and the
Remote Agent digest consumer; Core before Gateway and API consumers; Web and
CLI consumers; the local observer release; and only then the digest producer
flag. The one-time active-duration backfill runs after migration 0032 and Core
are deployed. Rollback disables the digest producer and local reporting before
removing readers; retained D1 evidence is never rewritten to simulate rollback.
