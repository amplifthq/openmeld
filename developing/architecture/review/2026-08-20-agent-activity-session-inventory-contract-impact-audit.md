# Agent Activity Session Inventory Contract Impact Audit

## Agent Context

- Purpose: Record the contract, compatibility, privacy, provider, and release
  evidence reviewed for the Organization Local Agent Session Inventory rollout.
- Read this when: Reviewing or releasing the Session Inventory introduced by
  the same pull request.
- Update this when: The pull request changes a wire contract, receiver order,
  provider capability, privacy boundary, or release gate described here.
- Do not use this for: The live product contract, deployment authorization, or
  provider claims beyond the inspected versions and sanitized acceptance run.
- Source of truth: Owner documents and shared schemas remain authoritative;
  this dated file is review evidence for one rollout.

Status: IN REVIEW — Remove after this pull request is merged and its contract
compatibility and acceptance evidence is preserved in the merge record.

Date: 2026-08-20

## Outcome And Authority Boundaries

This rollout adds one Core-owned, Organization-scoped Session Inventory. Local
OpenMeld Service observes complete provider metadata for explicitly connected
Projects and reconciles it into Core. Core owns current visibility, stable
pagination, public Computer projection, source health, and the live Binding
join. Web, CLI, Local Agents, and Center Agent consume the same shared schema.

The stable product Session identity is:

```text
owner.userId + localAgent.agentControllerRef + nativeSessionId
```

Project and Computer describe the current environment. Agent Activity creates
no second public Session id, never writes Binding or Agent Profile state, and
never turns visibility into Resume, Fork, Binding, Space, or execution
authority. Every later mutation must reauthorize its actor and revalidate the
Organization, Owner, Project, Computer, provider, Session, and capability.

## Changed Contracts And Owners

| Contract | Change | Owner and receiver |
| --- | --- | --- |
| Agent Activity Session HTTP/RPC schemas | New strict list query, keyset cursor, reconciliation pages, coverage, Session, Owner, Project, Computer, Local Agent, origin, capability, and Binding projections | Shared schemas; Core is the read/projection owner; Gateway, Web, CLI, and Remote Agent are receivers |
| Agent Profile Binding ensure body | Additive optional `sessionInventorySelection` for authoritative Resume revalidation; the Binding writer atomically conditionally claims the controller conversation | Shared schemas and API client; Gateway forwards; Core validates before the Binding writer, which remains Binding authority |
| CLI JSON envelope | Additive `activity.sessions` result using the shared response unchanged | Shared schemas; CLI Human, Agent, and JSON views |
| Local reconciliation | New provider observations and page/result submissions | Local OpenMeld Service is observer/carrier; Core remains inventory owner |
| Local Service control plane | Additive `request_agent_activity_sync` command for immediate post-disconnect reconciliation | CLI requests; the current local Service schedules the canonical sync loop |
| Center Agent RPC/tool | Additive read-only paginated Session Inventory | Core authorization and projection; Remote Agent tool receiver |
| Core D1 | Migration 0130 adds canonical inventory, private candidate, and source-health tables | Core only |

No existing Activity snapshot field changes meaning. Historical Activity
evidence and retention remain separate from the current selectable inventory.

## Mixed-Version Compatibility

| Combination | Result |
| --- | --- |
| Old CLI/Service with new Gateway/Core | Existing Activity and runtime reports continue; no Session pages are produced |
| New CLI/Service with old Gateway | Session reconciliation receives an unavailable route and retries; existing Activity and Wake behavior continue |
| New CLI/Service with old Core | New Session RPCs are unavailable; therefore Core receivers must precede local components |
| New Gateway/Remote Agent with old Core | New reads fail closed as unavailable; no alternate inventory is derived |
| New Web with old Gateway/Core | Session read is visibly unavailable; Web does not fall back to the bounded snapshot as a complete inventory |
| New Resume Web caller with old Gateway/Core | The strict Binding receiver rejects `sessionInventorySelection`; deploy Core and Gateway before the Web caller, and never retry without the selection pointer |
| Old Web/API caller with new Gateway/Core | Existing non-Session Binding writes remain unchanged because `sessionInventorySelection` is optional |
| Old OpenMeld Skill with new CLI | Existing commands continue; the old Skill does not discover the new Session command |
| New OpenMeld Skill with old CLI | `activity sessions` is unavailable; release stamping keeps Skill and CLI delivery aligned |
| New CLI with old local Service | The additive immediate-sync control request is rejected as a contract mismatch; unbind remains local and the persisted source set reconciles after the Service is upgraded or on its next compatible run |
| New Core with a pre-0130 database | Forbidden rollout order: Session queries and atomic Forget Computer cleanup require the additive inventory tables; apply migration 0130 before deploying Core |

## Required Rollout And Rollback Order

Rollout order:

1. Apply Core D1 migration 0130. This feature PR does not deploy or mutate
   production data and does not migrate or repair Binding rows.
2. Deploy shared-schema receivers and Core RPC/repository support without
   enabling new callers prematurely.
3. Deploy Gateway and Web readers and the Remote Agent read tool.
4. After this feature PR merges, use the dedicated clean release worktree to
   stamp and publish aligned CLI, OpenMeld Service, and OpenMeld-managed Skills.
5. Verify one real installed-client reconciliation, Web/CLI reads, Center Agent
   read, Project disconnect removal, and content non-disclosure before calling
   the product delivered.

Rollback reverses caller order: roll back local components and Skills first,
then Web/Remote Agent/Gateway callers, then Core code. Migration 0130 can remain
as additive inventory storage. Rollback must not delete
historical Activity evidence or rewrite Binding/Profile data.

## Provider Capability Verdict

The detailed inspected-version evidence lives in
`2026-08-20-local-agent-session-capability-research.md`. The public capability
contract is deliberately stricter than provider marketing:

| Provider | Complete discovery | Native title/id | Public Resume | Public Fork |
| --- | --- | --- | --- | --- |
| Codex | Complete app-server `thread/list` across explicit source kinds, archived states, and every cursor | `Thread.id` and native name | Yes for non-archived Sessions | No; provider-native Fork exists but OpenMeld has no verified invocation path |
| Claude Code | Complete retained top-level JSONL union plus attributable registry-only Sessions and structured hook evidence | Stable Session id and explicit custom title | Yes | No; provider-native Fork exists but OpenMeld has no verified invocation path |
| Cursor | Unsupported: no complete structured inventory across IDE, print, and ACP Sessions | No cross-surface identity claim | No from this inventory | No |
| OpenCode | Complete SQLite Session-table scan | Stable native id and title | Yes for verified retained Sessions | No; provider-native Fork exists but OpenMeld has no verified invocation path |
| Grok Build | Complete recursive `summary.json` retained index | UUID and native title | Yes | No; provider-native Fork exists but OpenMeld has no verified invocation path |

No provider receives Working or Idle from file modification time. Missing
fresh lifecycle evidence maps to Unknown. `origin = openmeld` requires an
OpenMeld-owned creation provenance record; provider client/source labels never
grant that origin.

The local source ledger also scopes retained Project connections to the
authenticated owner after the first accepted source observation. Account
switches do not restamp another owner's retained connection, and ambiguous
Claude `Notification` or subagent hooks cannot refine top-level Session status.

## Sanitized Live Acceptance

The acceptance runner used the installed official provider CLIs and the real
local provider stores, matched only against the connected OpenMeld repository
and this isolated worktree. It used a temporary `OPENMELD_HOME` and temporary
OpenMeld origin store. Output excluded titles, ids, paths, accounts, content,
and local private metadata.

```text
Codex: sessions=185, titled=185, resume=180, ended=5, unknown=180, fork=0
Claude Code: discovery succeeded, sessions=0 for the accepted Project
Cursor: unsupported, cursor_complete_inventory_unavailable
OpenCode: discovery succeeded, sessions=0 for the accepted Project
Grok Build: sessions=5, titled=5, resume=5, unknown=5, fork=0
OpenCode SQLite runtime: Node v20.20.2 fresh-install better-sqlite3 12.6.2
read/prepare/close smoke passed
Packaged CLI engine: Node 20 and Node 22-25, matching better-sqlite3 12.6.2;
Node 21 and Node 26+ are rejected by the published package contract
OpenCode standalone runtime: Bun v1.3.14 compiled executable opened the real
SQLite fixture read-only through bun:sqlite and returned the expected Session
```

Zero rows are evidence only for the exact accepted Project, not a claim that
the provider has no retained Sessions elsewhere. The live run proves installed
adapter execution and metadata mapping; deterministic contract tests prove
pagination, reconciliation, disconnect, authorization, Binding derivation,
Resume-time Binding revalidation, and content exclusion without reading user
content into test output. Binding repository tests also prove that two
concurrent new Agent Profiles cannot both claim one controller conversation,
while historical duplicate Bindings remain readable and are not rewritten by
Agent Activity.

## Privacy And Negative Acceptance

The shared schemas reject and the projections omit:

- prompts, responses, reasoning, transcripts, tool input/output, terminal
  content, file content, diffs, commands, branches, and models;
- local absolute paths, executable paths, credentials, provider accounts,
  internal Service runtime ids, internal device ids, and private diagnostics;
- duplicated Session titles, duplicated Binding state, synthetic provider
  capabilities, and synthetic OpenMeld Session ids.

Current inventory rows disappear from selectable reads when their Project is
disconnected. CLI unbind/archive requests the local Service reconciliation
immediately; when the Service is offline, the persisted source set carries the
disconnected fact on its next successful run without blocking the local
operation. Historical Activity evidence retains its existing policy.
Forgetting a Computer atomically deletes its private reconciliation candidates,
current Inventory rows, and source coverage with the owned-device record, so
orphaned metadata cannot keep claiming native Session identities. Hook status
projection is monotonic by provider observation time; older evidence is ignored
and conflicting equal-time evidence becomes Unknown.
Reconciliation error, including an installed provider's transient launch
failure, preserves prior rows as visibly stale; an explicit disconnected or
genuinely not-installed provider result removes selectable rows.
Core fences terminal publication on the exact active syncing reconciliation,
so concurrent delivery of the same terminal page is idempotent and cannot turn
a previously published source into an empty healthy projection. Provider scans
also fail closed when a syntactically readable retained record lacks required
identity, Project path, or timestamp metadata; such a record cannot be skipped
while coverage claims current.

## Architecture Invariant Assessment

This change does not violate the scoped architecture owner documents:

- RuntimeCoordinator remains the only in-flight workstation Wake truth.
- Local OpenMeld Service remains an observer and carrier, not Profile, Binding,
  Space, Session visibility, or execution authority.
- Core owns one canonical projection and derives Binding from the authoritative
  Binding store at read time.
- Clients do not infer status, capability, Binding, or provider origin.
- All cross-process payloads use strict shared schemas and fail closed.
- Session visibility cannot block Wake or create routing authority.

## Release Gates

Before push, this ordinary feature branch must complete the repository
Changelog check, docs validation, changed-package typechecks/tests, affected
checks, Contract Impact Audit review, deferred `verify:release-ready` against
the exact PR base, broad PR verification, and React Doctor for the Web change.
It must keep the CLI version and `release/local-components.json` identical to
the base. The later dedicated release branch owns the source-derived stamp. A
merge or green CI run is not deployment or real-user production smoke, and
this pull request does not authorize either.
