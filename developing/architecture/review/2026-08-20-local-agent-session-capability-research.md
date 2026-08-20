# Local Agent Session Capability Research

## Agent Context

- Purpose: record first-party evidence for complete local Session discovery,
  native identity, title, status, Resume, and Fork capabilities across the five
  Local Agent providers required by Agent Activity.
- Read this when: defining or reviewing the shared Session inventory contract,
  provider observers, reconciliation, provider capability probes, or
  Session-to-Agent-Profile actions.
- Update this when: a supported provider changes its persisted Session format,
  documented Session API, CLI flags, hooks, lifecycle events, retention policy,
  or the OpenMeld adapter used to resume or fork a Session.
- Do not use this for: treating private provider storage as a permanent public
  API, inferring operation authorization from Session visibility, uploading
  transcript content, or claiming a provider capability without a runtime
  version probe.
- Source of truth: provider documentation, provider source and installed CLI
  help own native behavior; OpenMeld owner documents and shared schemas own the
  product contract and privacy boundary.

Date: 2026-08-20

Status: REVIEW EVIDENCE — Remove after provider-native capability conformance
runs in CI against pinned official provider releases. Stable findings are
distilled into `developing/product/agent-activity.md` and provider contract
tests; this dated review records the inspected versions and evidence basis,
while owner docs and shared schemas remain the live product contract.

## Research Scope And Evidence Standard

This review answers six questions for Codex, Claude Code, Cursor, OpenCode, and
Grok Build:

1. What first-party source can enumerate every locally retained Session, and
   what is outside that source's boundary?
2. Which provider-native field is the stable Session identity?
3. Can the provider-native title be observed and reconciled without reading or
   uploading prompt content?
4. Which evidence can honestly map to `working`, `idle`, `ended`, `error`, or
   `unknown`?
5. Does the installed provider natively resume the same Session?
6. Does the installed provider natively fork into a new Session?

Only official documentation, official source, installed first-party CLI help,
sanitized local provider metadata, and current OpenMeld source were accepted.
No prompt, response, transcript body, tool payload, file content, credential,
absolute working path, or concrete local Session ID was recorded.

The inspected installed versions were:

| Provider | Inspected first-party version |
| --- | --- |
| Codex | `codex-cli 0.148.0` |
| Claude Code | `2.1.237` |
| Cursor CLI | `2026.08.11-e8db854` |
| OpenCode | `1.18.18` |
| Grok Build | `1.0.3 (1a29d5bc12d4)` |

These are evidence for the inspected versions, not an unconditional minimum
version promise. At the beginning of this review, the repository defined Resume
declarations but no complete Session Inventory contract or provider Fork
command path. This PR adds the discovery contract while deliberately retaining
that Fork limitation. The implementation must probe the installed provider
before advertising discovery, Resume, Fork, or optional metadata fields.

## Executive Capability Matrix

`Complete` below means a full, repeatable enumeration of all Sessions still
retained by that provider on this computer. It never includes Sessions the
provider deleted, expired under its retention policy, created with persistence
disabled, stored only on another computer, or never persisted.

| Provider | Complete retained discovery | Native title | Trustworthy status source | Native Resume | Native Fork |
| --- | --- | --- | --- | --- | --- |
| Codex | Yes: app-server `thread/list`, all source kinds, both archived states, cursor to exhaustion | Optional `Thread.name`; latest title index entry | Live app-server or hooks; archived storage; otherwise `unknown` | Yes for retained, non-archived threads | Yes for retained, non-archived threads |
| Claude Code | Yes only as a composite of retained top-level JSONL, live/job registry, and hooks | Explicit `--name`, `/rename`, or `custom-title`; otherwise null | `claude agents --json --all` plus hooks; otherwise `unknown` | Yes for retained Sessions | Yes for retained Sessions |
| Cursor | **No complete documented machine-readable source**; hooks are forward-only and private ACP metadata covers only an ACP subset | Hook payload has no title; private ACP metadata has a title only for the ACP subset | Hooks for observed lifecycle; otherwise `unknown` | Yes for CLI chat IDs and ACP Session IDs, not proven interchangeable with IDE chats | No inspected native Fork surface |
| OpenCode | Yes: full local `session` table reconciliation, or provider API with pagination where supported | Persisted `session.title` | Live `/session/status`, lifecycle events, and `time_archived`; otherwise `unknown` | Yes for retained, usable Sessions | Yes for retained, usable Sessions |
| Grok Build | Yes: full retained `summary.json` index scan | `generated_title` / renamed title in summary metadata | Complete hook sequence keyed by prompt, plus SessionEnd; otherwise `unknown` | Yes for retained Sessions | Yes; Fork creates a new native Session ID |

The largest product blocker is Cursor. OpenMeld can truthfully provide complete
inventory for the retained local stores of Codex, Claude Code, OpenCode, and
Grok Build after implementing the provider-specific reconciliation described
below. For Cursor, the currently documented public surfaces do not prove a
complete historical, structured, paginated inventory across IDE, CLI print
mode, and ACP. The product must report this provider as partial or unsupported
for complete inventory instead of presenting hook history as complete.

### Usage Limit Projection

The inspected Codex app-server exposes the structured
`account/rateLimits/read` method. Its primary and secondary windows provide
`usedPercent`, `windowDurationMins`, and nullable Unix-second `resetsAt` under a
provider limit id/name. OpenMeld may project bounded labels and ISO timestamps
from that response. A sanitized live probe returned three valid windows.

No equivalently complete, stable, structured account Usage Limit read was
verified for Claude Code, Cursor, OpenCode, or Grok Build in this review. Those
providers must omit `usageLimits`; provider error text, plan names, local file
times, and past failures are not usage evidence.

## Cross-Provider Contract Findings

### Identity

The public Session identity must remain:

```text
owner + agentControllerRef + nativeSessionId
```

Project and Computer describe the currently authorized work environment. They
must not be folded into Session identity because providers can move or resume a
Session under another working directory or process. A provider-native fork has
a new `nativeSessionId`, even when the provider also retains a shared root or
parent identifier.

### Title

Only an explicit provider-native title is a title. If the provider exposes no
title, `title` must be null. Codex `preview`, Claude `firstPrompt`, and any
locally parsed first user message are content, not metadata-safe fallback
titles. They must not be uploaded or presented as Native Session Title.

A title reconciliation pass must read the latest provider title rather than
copying a second editable title into Agent Activity. A title change alone must
be able to update the projection even when the main Session transcript or
record did not otherwise change.

### Status

Persisted existence and recent file modification are not reliable status. The
shared mapping must use explicit lifecycle evidence:

| Shared status | Required evidence |
| --- | --- |
| `working` | Fresh provider evidence that a turn or job is actively in flight |
| `idle` | Explicit provider idle/stop evidence, or a provider-owned live registry that says the Session is waiting |
| `ended` | Explicit archive, SessionEnd, deletion, close, or completed lifecycle evidence |
| `error` | Explicit terminal provider failure for the latest lifecycle attempt |
| `unknown` | Missing, stale, conflicting, version-unsupported, or insufficient evidence |

A later valid turn start supersedes a prior idle, ended-when-resumable, or error
observation according to the provider's lifecycle. Age alone must never turn a
Session into `ended`, and a file written within two minutes must never by itself
turn a Session into `working`. The current observer does exactly that heuristic
mapping in `clients/openmeld-cli/src/agent-activity/observer-adapters.ts:362-370`,
so it is not a sufficient inventory status source.

### Capability versus authorization

`canResume` and `canFork` answer whether the installed provider and this exact
persisted Session support the native operation. They do not authorize an
operation. The command path must still revalidate current Organization,
membership, owner, Project connection, Computer, Binding, provider version,
and local Session existence immediately before execution.

The provider may support an operation while OpenMeld has not wired the
operation yet. Until both the provider probe and the OpenMeld command path are
available, the product-facing capability must remain false. There must be no
simulated fork implemented by copying transcripts or manufacturing another
public Session ID.

### Origin

Provider source fields can describe provider client provenance, but they do not
prove that OpenMeld created a Session. `origin = openmeld` needs an OpenMeld-owned
creation or Binding provenance fact. A provider source such as Codex
`appServer` is insufficient because another client may use the same protocol.
When neither provider metadata nor OpenMeld authority proves origin, the honest
value is `unknown`, not `local` by assumption.

## Codex

### Verified discovery boundary

Codex app-server `thread/list` is the strongest first-party discovery surface.
It supports stable cursor pagination and archived filtering. Complete retained
enumeration requires:

1. passing every supported `sourceKinds` value rather than omitting the field;
   omitted or empty source filters cover only the interactive CLI/VS Code
   default;
2. listing `archived = false` and `archived = true` separately; and
3. following `nextCursor` until it is null for both listings.

Official evidence: the Codex app-server overview and method list documents
`thread/list`, `thread/resume`, and `thread/fork`, while the detailed thread
list section documents cursor pagination and filters
([official app-server README, lines 161-176](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/app-server/README.md#L161-L176),
[lines 421-468](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/app-server/README.md#L421-L468)).
The official protocol schema enumerates `cli`, `vscode`, `exec`, `appServer`,
all sub-agent variants, and `unknown` in
[`ThreadListParams.json`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/app-server-protocol/schema/json/v2/ThreadListParams.json).

The boundary is complete retained Codex threads, not every transient in-memory
thread. Ephemeral or non-persisted threads cannot be reconstructed after their
process exits. Archived threads are inventory records but are not directly
resumable or forkable without an explicit unarchive operation.

### Native identity and title

The stable `nativeSessionId` is `Thread.id`, the Codex-generated UUIDv7 stored
as rollout `session_meta.payload.id`. It is not `Thread.sessionId` or rollout
`payload.session_id`. Codex uses the latter as a shared Session-tree root, so a
fork can have a new `Thread.id` while retaining the original tree root. Resume
and Fork APIs also take `threadId`. The official response schema describes
both fields in
[`ThreadListResponse.json`](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/app-server-protocol/schema/json/v2/ThreadListResponse.json).

`Thread.name` is the optional native title. `thread/name/set` persists it and
emits `thread/name/updated`
([official app-server README, lines 198-203](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/app-server/README.md#L198-L203)).
OpenMeld already reads the append-only `~/.codex/session_index.jsonl` as
latest-entry-wins for `id` and `thread_name`
(`clients/openmeld-cli/src/agent-activity/provider-session-titles.ts:6-45`).
However, the current file watcher is driven by rollout changes, so a title-only
index update requires independent periodic reconciliation. `Thread.preview`,
which is usually the first user message, is prohibited as a metadata-only
title fallback.

### Status, Resume, and Fork

Codex app-server exposes `notLoaded`, `idle`, `systemError`, and `active`
([official app-server README, lines 521-547](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/app-server/README.md#L521-L547)).
This state is process-local: retained threads discovered by a fresh app-server
normally start `notLoaded`. Therefore:

- fresh `active` or hook turn-start evidence maps to `working`;
- explicit Stop maps to `idle`;
- `systemError` or an explicit terminal error maps to `error`;
- archived maps to `ended`; and
- a retained rollout with no fresh lifecycle evidence maps to `unknown`.

Installed `codex resume --help`, `codex exec resume --help`, and
`codex fork --help` confirm native Resume and Fork by thread ID. The official
app-server source rejects direct Resume and Fork of archived rollouts and tells
the caller to unarchive first
([resume reader, lines 4250-4313](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/app-server/src/request_processors/thread_processor.rs#L4250-L4313),
[fork path, lines 4496-4538](https://github.com/openai/codex/blob/312b62ac95335e1762b70ceb8910374965bd2785/codex-rs/app-server/src/request_processors/thread_processor.rs#L4496-L4538)).
Thus, after a successful installed-version probe, retained non-archived threads
may report both capabilities true; archived threads must report both false.

Current OpenMeld Resume wiring exists in
`runtime/adapters/codex/src/transport/codex-app-server-transport.ts:418-464`
and `runtime/adapters/codex/src/transport/codex-cli-transport.ts:274-283`.
OpenMeld has no equivalent Fork command path yet, so product `canFork` must
remain false until that path and its authorization checks ship.

## Claude Code

### Verified discovery boundary

Claude Code has no single documented all-history structured API. Complete
retained local discovery must reconcile a composite of:

1. every retained **top-level** JSONL Session under
   `${CLAUDE_CONFIG_DIR:-~/.claude}/projects`;
2. `claude agents --json --all` for active, background, stopped, completed, and
   failed job state available in the installed version; and
3. `SessionStart`, `UserPromptSubmit`, `Stop`, `StopFailure`, and `SessionEnd`
   hooks for live lifecycle transitions.

Official storage and retention boundaries are documented in
[Claude Code directory and storage](https://code.claude.com/docs/en/claude-directory),
and official lifecycle payloads are documented in
[Claude Code hooks](https://code.claude.com/docs/en/hooks).
Claude retention is configurable and is not infinite. Deleted, cleaned,
expired, or `--no-session-persistence` Sessions cannot be inventoried after the
provider removes them. This is complete retained Claude Code CLI inventory,
not Claude Desktop, Web, or every VS Code surface.

Files below a `subagents/` directory must not become independent inventory
Sessions. They are sidechains whose records may reuse the parent `sessionId`.
If the same native ID is found in conflicting retained top-level locations,
the observer must fail closed and report a provider diagnostic rather than
silently merge unrelated metadata. The latest explicit provider cwd is the
current environment; the first transcript cwd is not an immutable identity.

The current observer violates several of these requirements: it hard-codes
`~/.claude/projects`, recursively collects every JSONL including subagent
files, caps discovery at 2,000 files, and skips previously unseen files older
than ten minutes
(`clients/openmeld-cli/src/agent-activity/local-observer.ts:31-34`,
`:154-159`, `:735-813`). It also uses the first row containing cwd as identity
and derives status from modification time
(`clients/openmeld-cli/src/agent-activity/observer-adapters.ts:137-224`).

### Native identity and title

Claude Code's stable identity is its native UUID Session ID. Resume appends to
the same ID. Fork creates a new ID and leaves the original unchanged. The
official behavior is described in
[Claude Code sessions](https://code.claude.com/docs/en/sessions) and
[How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works).

An explicit name supplied with `--name`, changed with `/rename`, or persisted
as `custom-title` is a provider-native title. When none exists, title is null.
The official commands are documented in
[Claude Code interactive commands](https://code.claude.com/docs/en/commands).
The provider's first prompt is not a title and remains prohibited content.

### Status, Resume, and Fork

Status should be composed as follows:

- an in-flight live registry or `UserPromptSubmit` transition is `working`;
- explicit Stop while the Session remains live is `idle`;
- SessionEnd or a completed/stopped job is `ended`;
- StopFailure or a failed job is `error`; and
- a retained transcript without fresh lifecycle evidence is `unknown`.

The current managed integration omits both `StopFailure` and `SessionEnd`
(`clients/openmeld-cli/src/agent-activity/managed-integrations.ts:16-25`), and
the generic hook mapper treats every `Notification` as idle
(`clients/openmeld-cli/src/agent-activity/hook-ingest.ts:319-351`). Those gaps
must be fixed before Claude status can be called complete.

Installed `claude --help` exposes `--resume`, `--session-id`, `--name`,
`--no-session-persistence`, and `--fork-session`. Native Resume is documented
in [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference),
and native SDK session resume/fork behavior is documented in
[Claude Agent SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions).
Current OpenMeld Resume wiring exists in
`runtime/adapters/claude/src/transport/claude-agent-sdk-transport.ts:554-557`
and `runtime/adapters/claude/src/transport/claude-cli-transport.ts:281-309`.
Fork is not wired into the current OpenMeld capability or command path, so
product `canFork` remains false until that work ships even though the inspected
provider version supports it.

## Cursor

### Verified discovery boundary

Cursor does not currently provide a documented complete machine-readable,
paginated inventory spanning IDE conversations, CLI print-mode chats, and ACP
Sessions. The official CLI can list and resume CLI chats (`cursor-agent ls`,
`cursor-agent --resume [chatId]`), but its documented list surface has no JSON
or cursor pagination contract
([Cursor CLI overview](https://docs.cursor.com/en/cli/overview),
[using the CLI](https://docs.cursor.com/en/cli/using),
[CLI parameters](https://docs.cursor.com/en/cli/reference/parameters)).

Official Cursor hooks provide forward-only lifecycle observation. Their
`conversation_id` is stable across turns, and `sessionStart.session_id` equals
the conversation ID, but hooks do not replay Sessions that predate
installation. They therefore cannot establish a complete retained inventory
([Cursor hooks](https://cursor.com/docs/hooks)).

Sanitized inspection of the installed first-party Cursor ACP store found one
directory per UUID with metadata keys `schemaVersion`, `cwd`, and `title`.
That private format can reconcile the ACP subset only. It is undocumented and
must be guarded by a provider-version/schema probe. Repository-authenticated
inspection already established that the ACP store is distinct from print-mode
CLI and IDE chat stores
(`developing/architecture/review/2026-07-cursor-acp-phase-1.md:61-70`).

Consequently, Cursor must report an explicit partial/unsupported discovery
diagnostic unless a future first-party complete inventory contract is verified.
OpenMeld must not scrape prompt-bearing IDE databases or claim that the ACP
subset represents all Cursor Sessions.

### Native identity and title

For a Cursor CLI execution, official structured output includes `session_id`
and keeps it consistent throughout the execution
([Cursor CLI output format](https://docs.cursor.com/en/cli/reference/output-format)).
For an OpenMeld ACP conversation, the native ACP Session ID is stable and
`session/load` resumes that exact ID. Current source and tests prove the same
ID is loaded rather than creating a new Session
(`runtime/adapters/cursor/src/transport/cursor-acp-transport.ts:482-525`,
`runtime/adapters/cursor/test/acp-transport.test.js:535-569`).

These identifiers are surface-specific. An IDE hook conversation ID, CLI chat
ID, and ACP Session ID must not be assumed interchangeable. The current Cursor
hook payload has no native title field, so OpenMeld deliberately returns null
(`clients/openmeld-cli/src/agent-activity/hook-ingest.ts:129-150`). The private
ACP metadata title is observable only for the ACP subset and does not solve
title discovery for all Cursor Sessions.

### Status, Resume, and Fork

For Sessions observed after hook installation:

- `beforeSubmitPrompt` maps to `working`;
- `stop` maps to `idle` or `error` according to its explicit reason;
- `sessionEnd` maps to `ended`; and
- absent, stale, or unobserved lifecycle evidence maps to `unknown`.

OpenMeld installs these official hook events today
(`clients/openmeld-cli/src/agent-activity/managed-integrations.ts:26-31`,
`:547-580`). Native Resume exists for CLI chat IDs and for ACP Session IDs via
`session/load`, but an IDE hook ID must not report resumable through the
OpenMeld ACP adapter unless equivalence is proven.

No Fork command, flag, or ACP method was present in the inspected official
Cursor documentation, installed CLI help, or current adapter. `canFork` is
therefore false for the inspected version. This is unsupported, not a request
to simulate Fork.

## OpenCode

### Verified discovery boundary

OpenCode's local SQLite `session` table is a complete retained local metadata
index for the inspected version. Sanitized schema inspection confirmed an
`id` primary key, `parent_id`, `directory`, `title`, `time_created`,
`time_updated`, and `time_archived`. A read-only, version-gated scan can use
stable keyset pagination over this table without reading message content.

The official HTTP API also exposes `GET /session`, `GET /session/status`,
`GET /session/:id`, and `POST /session/:id/fork`
([OpenCode server Sessions API](https://dev.opencode.ai/docs/server/#sessions)).
The official CLI exposes `session list`, `--session`, `--continue`, and
`--fork`
([OpenCode CLI documentation](https://dev.opencode.ai/docs/cli/)). A bounded
CLI `session list --max-count` invocation is not by itself complete; the
implementation must exhaust a provider pagination contract or reconcile the
full local table. It should not start a local server solely to inventory if no
provider server is already running.

The boundary excludes deleted rows and remote stores not present on this
computer. A schema mismatch must produce a visible provider diagnostic, not an
empty successful inventory.

### Native identity and title

`session.id` is the stable native ID and SQLite primary key. The persisted
`session.title` is the native title and can be updated through the official
Session API. Current OpenMeld parsing already reads ID, directory, archived
time, and normalized title
(`clients/openmeld-cli/src/agent-activity/observer-adapters.ts:227-273`).

### Status, Resume, and Fork

OpenCode's official live status schema defines `idle`, `busy`, and `retry`
([official `session-status-event.ts`](https://github.com/anomalyco/opencode/blob/dev/packages/schema/src/session-status-event.ts)).
The honest shared mapping is:

- `busy` and an active `retry` lifecycle map to `working`;
- explicit `idle` maps to `idle`;
- `time_archived` or explicit deletion maps to `ended`;
- `session.error` maps to `error`; and
- an unarchived retained row with no current live status maps to `unknown`.

The current observer applies the correct explicit archive mapping but otherwise
falls back to the two-minute modification heuristic
(`clients/openmeld-cli/src/agent-activity/observer-adapters.ts:238-272`). Its
incremental query is capped at 1,000 rows and does not loop to exhaustion in a
single reconciliation pass
(`clients/openmeld-cli/src/agent-activity/local-observer.ts:368-423`).

Native Resume is supported by the official `--session` path and is already
used by the CLI and server adapters
(`runtime/adapters/opencode/src/transport/opencode-cli-transport.ts:258-274`,
`runtime/adapters/opencode/src/transport/opencode-server-transport.ts:538-569`).
Native Fork is exposed by both installed CLI help and the official server API.
OpenMeld does not currently wire Fork. Archived Resume/Fork behavior was not
verified end to end, so archived rows must report both capabilities false until
an installed-version contract test proves otherwise.

## Grok Build

### Verified discovery boundary

Grok Build persists one Session directory and a metadata-only `summary.json`
index per retained Session. Official source documents a unique Session ID,
title, creation/update/last-active timestamps, parent Session ID, Resume, Fork,
headless operation, ACP Session operations, and bounded `sessions list`
([official Sessions guide, lines 18-43](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md#L18-L43),
[lines 79-123](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md#L79-L123),
[lines 199-245](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md#L199-L245)).

Sanitized inspection of the installed first-party store confirmed `info.id`,
`info.cwd`, `generated_title`, `created_at`, `updated_at`, and
`last_active_at` without exposing values or content. The adapter also accepts
the reviewed top-level `id`/`cwd` compatibility shape as one complete pair.
Complete
retained enumeration should scan every summary index with stable local
pagination/reconciliation. The default bounded `sessions list` output is not a
complete discovery algorithm.

The upgraded Agent Activity owner contract includes Grok Build in Session
Inventory (`developing/product/agent-activity.md:142-166`). The baseline
implementation still needs a managed, reversible hook integration and the same
Project authorization and metadata privacy filters as other providers.

### Native identity and title

The summary's unique provider Session ID is the stable `nativeSessionId`.
`generated_title` or a provider-renamed title is the native title. A fork has a
new Session ID and records its parent; parent ID is lineage, not identity.

### Status, Resume, and Fork

Grok Build's official hook guide documents `SessionStart`,
`UserPromptSubmit`, `Stop`, `StopFailure`, `StopCancelled`, `Notification`, and
`SessionEnd`
([official hooks guide, lines 84-106](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md#L84-L106)).
Common hook payloads include Session ID, workspace, timestamp, and prompt ID
([lines 231-248](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md#L231-L248)).
The same guide warns that Stop gates and idle notifications can otherwise
produce false idle or incomplete state
([lines 285-303](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/10-hooks.md#L285-L303)).

The observer must key the latest lifecycle by prompt ID because hooks can be
delivered out of order:

- `UserPromptSubmit` maps to `working`;
- `Stop`, `StopCancelled`, or the documented idle notification maps to `idle`;
- `StopFailure` maps to `error`;
- `SessionEnd` maps to `ended`; and
- missing, stale, or conflicting evidence maps to `unknown`.

Installed `grok --help` exposes `--resume`, `--fork-session`, and
`--session-id`; installed `grok sessions` help exposes list and search. Native
Resume is also implemented by the current ACP adapter, which requires the
provider to advertise Resume and calls `session/resume`
(`runtime/adapters/grok-build/src/transport/grok-build-acp-transport.ts:273-306`,
`:334-384`; verified by
`runtime/adapters/grok-build/test/acp-transport.test.js:374-400`). Native Fork
is supported by the provider but is not wired into OpenMeld, so product
`canFork` remains false until that command path ships.

## Current OpenMeld Gaps That Contract Tests Must Catch

1. **Arbitrary discovery bounds.** Codex and Claude discovery uses a ten-minute
   first-observation window and a 2,000-file cap
   (`clients/openmeld-cli/src/agent-activity/local-observer.ts:31-34`,
   `:154-159`, `:735-793`). OpenCode reads at most 1,000 rows per pass
   (`clients/openmeld-cli/src/agent-activity/local-observer.ts:400-415`). A
   complete reconciliation must page until exhaustion and preserve a stable
   continuation cursor.
2. **mtime status inference.** Codex, Claude, and unarchived OpenCode rows use a
   two-minute age rule
   (`clients/openmeld-cli/src/agent-activity/observer-adapters.ts:75-79`,
   `:176-180`, `:238-246`, `:362-370`). This creates false working and false
   idle facts.
3. **Incomplete baseline provider coverage.** Transcript discovery covers only
   Codex and Claude, OpenCode observation is database-specific, Cursor is
   hook-only, and the pre-upgrade implementation has no Grok Build inventory
   observer (`clients/openmeld-cli/src/agent-activity/local-observer.ts:735-793`,
   `clients/openmeld-cli/src/agent-activity/managed-integrations.ts:16-39`).
4. **Claude sidechain and config-root errors.** Recursive JSONL discovery can
   treat `subagents/*.jsonl` as Sessions and ignores `CLAUDE_CONFIG_DIR`
   (`clients/openmeld-cli/src/agent-activity/local-observer.ts:740-813`).
5. **Title reconciliation gaps.** Codex title index changes are not an
   independent inventory trigger, and Cursor hook titles are necessarily null
   (`clients/openmeld-cli/src/agent-activity/provider-session-titles.ts:6-45`,
   `clients/openmeld-cli/src/agent-activity/hook-ingest.ts:129-150`).
6. **Lifecycle gaps.** Claude managed hooks omit StopFailure and SessionEnd;
   generic Notification mapping is too broad; Grok hooks are not installed
   (`clients/openmeld-cli/src/agent-activity/managed-integrations.ts:16-39`,
   `clients/openmeld-cli/src/agent-activity/hook-ingest.ts:319-351`).
7. **No shared Fork capability.** The current conversation capability contract
   has no Fork field and declares discovery unsupported for every built-in
   provider
   (`packages/schemas/src/schemas/daemon/agent-controller-conversation-capability.ts:3-26`,
   `:32-64`).
8. **Origin is under-specified.** Provider client source cannot substitute for
   OpenMeld-owned Creation/Binding provenance. Contract tests must verify that
   insufficient evidence returns `unknown`.

## Required Provider Contract Tests

Each adapter should be validated with first-party-version fixtures or captured
metadata-only shapes, plus a real installed-provider smoke where safe:

| Test | Required assertion |
| --- | --- |
| Exhaustive discovery | More rows than one page/cap are all returned exactly once; reconciliation reaches a stable end cursor |
| Stable identity | Resume preserves ID; Fork creates a new ID and retains only explicit parent/root lineage |
| Title reconciliation | Rename without transcript activity updates the same Session; absent title remains null |
| Status honesty | Old retained data with no lifecycle evidence is `unknown`, never fabricated `idle` or `working` |
| Lifecycle ordering | A later turn start clears prior terminal/idle evidence; out-of-order provider hooks do not regress the latest prompt |
| Archived/ended capability | Provider-specific Resume/Fork flags are false unless direct operation is verified for that state |
| Version mismatch | Unsupported method, schema, or storage version returns a provider diagnostic and does not silently return an empty complete inventory |
| Cursor partial boundary | ACP metadata and hook history are never labeled as complete Cursor inventory |
| Project disconnect | Sessions outside current authorized Local Project Connections disappear from the selectable inventory |
| Privacy | Inventory upload contains no transcript, prompt, response, reasoning, tool I/O, diff, command, terminal content, local absolute path, credential, internal runtime ID, or device ID |

This review verified native surfaces and local metadata shapes without creating,
resuming, or forking a real user Session. Release acceptance still requires
real provider end-to-end evidence for discover, title rename, status lifecycle,
Resume, and Fork on the exact supported provider versions. A passing unit test
or installed `--help` entry is not that final product acceptance evidence.
