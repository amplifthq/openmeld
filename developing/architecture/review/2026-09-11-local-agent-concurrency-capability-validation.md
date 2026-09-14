# Local Agent Concurrency: Capability And Implementation Evidence

## Agent Context

- Purpose: Separate current source behavior, historical native probes, and remaining acceptance work for PR #956.
- Read this when: Reviewing Execution Context implementation or evaluating a concurrency, receipt, migration, or workspace-lifecycle claim.
- Update this when: Implementation or validation evidence changes.
- Do not use this for: Release authorization, production proof, or current product rules.
- Source of truth: Evidence record for [PR #956](https://github.com/amplifthq/openmeld/pull/956); scoped owner documents define the contract.

Status: Local P1 and review-comment validation completed on September 15, 2026
(Asia/Shanghai). The PR remains draft; this is not hosted certification or release
evidence.

Remove when the feature ships and its evidence has been incorporated into the
scoped owner documents. The original PR #948 and `593cdb2a` receipt-only snapshot
are historical slices, not descriptions of the current implementation.

## Current Implementation

| Area | Source-confirmed behavior | Limit |
| --- | --- | --- |
| Profile capacity | One Work Coordinator, three new reservations, 50 waiting Wakes, one writer per Context, and legacy exclusivity. Readers retain the preceding candidate's five reservations and 55 total items. | Three is a policy ceiling; it is not a measured host-resource budget. |
| Execution Context | Core assigns Context identity and exact requester/Organization/Space/discussion scope in the owner-shard admission transaction. New, resume, fork, and supported implicit discussion scopes are wired through execution and result routing. | Unsupported harnesses retain legacy serial behavior before Context activation; explicit unsupported selection fails closed. |
| Native identity | A reverse index rejects a native conversation assigned to a different Context in the same Runtime/Controller namespace. Exact-Wake checkpoints survive Head retirement. | Activity observations and Binding pointers cannot substitute for retained Context evidence. |
| Project workspaces | Explicit Codex tasks use private Git metadata and worktrees from the confirmed source root's frozen commit. Native project permissions, outside-access probes, and effective MCP inventory are checked before execution. | System temporary directories retain native access rules. This is project-file/Git isolation, not a container boundary. |
| Continuation and fork | Continuation retains its workspace and native identity; fork uses the selected completed history prefix and its own authority/workspace. | Recent-work brief injection and the general work-history product remain deferred. |
| Local Space Action receipt | `proposal_saved_locally`, `rejected_closed`, or `outcome_unknown`; exact replay retains original evidence. | `coordinatorAcceptance` and `publication` remain `unconfirmed`. No remote receipt or Late reply UI is implemented here. |

The authoritative implementation lives in:

- `packages/agent-runtime/src/work-policy.ts`
- `services/core/src/runtime-transport/application/agent-profile-work-coordinator.ts`
- `services/core/src/runtime-transport/application/execution-context-authority.ts`
- `clients/openmeld-cli/src/local-service/dispatch/execution-context-workspace.ts`
- `runtime/local-execution/src/ledger-store.ts`
- `packages/schemas/src/schemas/space-mesh/dispatch-space-action-receipt.ts`

## Historical Native Evidence

These observations were recorded before the P1 migration/lifecycle revision.
They must not be relabeled as a five-way product run or as current-candidate
migration acceptance.

| Observation | Evidence level and scope |
| --- | --- |
| Claude Code local CLI ran three independent requests in separate temporary directories, returned the requested outputs and distinct native session IDs; a same-directory continuation retained its session. | Native CLI capability only. This did not prove the complete OpenMeld Wake/Service path, long-running cleanup, or a fourth waiter. |
| One local macOS Codex Profile received four independent project requests; three native turns overlapped and the fourth started after a native process exited. Each produced its own result file and correctly linked Space reply. | Reported real local product-path smoke from PR #956 implementation. |
| A Codex continuation retained edits. A completed-prefix fork used separate files/Git metadata and a different native conversation; native-history readback excluded the parent's later continuation. The source checkout stayed clean. | Reported real local product-path continuation/fork smoke. |
| Desktop and narrow Task-menu checks passed. | Browser evidence for the earlier implementation, not a new migration or rollback run. |

The five-reservation candidate added deterministic five/sixth and full-queue
tests, but no five-way native product run. Its five-task policy was therefore
returned to the demonstrated three-task ceiling during P1 remediation.

## P1 Validation

- **Workspace recovery and retention:** focused tests cover interrupted preparation,
  exact-base restore, live-owner exclusion, proven process-tree quiescence,
  clean-copy reclamation, and retention of edits/ignored or untracked files,
  new commits, and unknown ownership. A retained workspace is not a completed
  cleanup. Native transcripts and user-created results must not be deleted.
- **Mode transition and rollback:** focused tests cover a durable finite legacy boundary,
  current Binding reread under the owner mutation lease, unclassified legacy
  association, atomic activation, restart, waiting/recovery preservation, and
  serial rollback with grandfathered five-reservation records.
- **Ledger backup:** a separate verified prior-version backup is required before
  replacing a valid v1 state. Tests cover copy/flush/verification failure and retry,
  direct writes, native identity preservation, and genuinely unknown versions.
  Windows directory-entry durability across power loss is not claimed; native
  Windows execution has not been tested.
- **Closeout:** report the exact candidate and its focused, contract, packaging,
  hosted, and native evidence separately. A green import check does not certify
  the remaining runtime acceptance work.

The assembled P1 revision passed 123 focused CLI tests, 17 API client tests,
CLI/Core/Gateway/Web typechecks, repository contracts, and deferred packaging
verification. The subsequent checkpoint correction passed the complete 310-test
Runtime Transport contract file and 22 focused CLI settlement tests, with renewed
CLI/Core typechecks. These are separate runs, not one aggregate suite.

A real macOS native probe on Codex `0.154.0-alpha.6.2` observed the durable
supervision marker, a successful native turn, and proven process-tree quiescence.
The unchanged checkout and private repository were reclaimed and restored at the
same path and frozen commit. This is adapter/lifecycle evidence, not a complete
Wake-to-Space smoke. Unit regressions additionally cover interrupted retirement
and preservation of changed or ambiguously owned copies.

## September 15 Comment Fixes

The [review comment](https://github.com/amplifthq/openmeld/pull/956#issuecomment-5666223602)
identified two defects:

- Space-only scratch access was incorrectly subjected to a user-project
  allowlist. It now retains a scratch-only native boundary without requiring
  permission for the Service directory. Real native execution also exposed
  parent-repository instruction discovery; setting the scratch project root
  fixes startup without widening file access. Seven session-boundary tests and
  12 Codex argument/MCP tests pass.
- Reply repair and reconsideration could retain an earlier turn's checkpoint.
  All native invocations now share completion observation, reset stale turn
  evidence, and recapture completion per proposal. Core reserves native identity
  during receipt checks, but freezes history with the accepted finalization
  command. Rejected review proposals cannot freeze history, and replay cannot
  rewrite an accepted checkpoint. Real smoke additionally exposed a read-only
  repair profile checked as if it allowed writes, and an implicit temporary
  repair fork. Scoped repair now verifies its effective read-only permissions
  and resumes the same native conversation; legacy repair remains unchanged.

Local product smoke uses an isolated localhost Worker lane, a temporary
`OPENMELD_HOME` outside system temporary-directory grants, one owned Git fixture,
and public `openmeld-dev` commands. Computer policy fixture setup uses its public
API and is not claimed as browser UI acceptance. Production state is untouched.

The current local build ran three new Space-context Wakes on the same Codex
Profile after its owner switched the Profile from serial to parallel through
the public CLI. Three distinct native conversations had overlapping turns;
all three published their exact requested marker to their own source message.
The project-only Computer allowlist remained in force. The source Git fixture
remained clean. This confirms three-way local product concurrency, not five-way
capacity or a measured resource budget.

The budget-correction product smoke started a project task at 1,000 credits,
posted the owner's 2,000-credit correction after native turn admission, observed
Core's `review_required` response, and ran a second turn on the same native
conversation. The final Space reply used 2,000 credits and the requested revision
marker; the public trace reported `visible_reply`. The unchanged project copy
was reclaimed only after native execution settled. The first attempt exposed
the repair-permission defect described above and remains recorded as a failure;
the successful attempt used a new Wake rather than replaying it.

A public CLI fork from that completed Wake created a different native
conversation. Native `thread/read` diagnostics showed the parent's initial turn
and its final correction turn as the child's inherited prefix, followed by the
child's own new turn. This directly verifies the selected checkpoint includes
the revised answer rather than relying on a child answer that could have read
the same correction from Space history.
The fork also published the revised budget and marker to its own source message;
its public trace reported `visible_reply`.

After the native repair correction, the full Codex adapter suite passed 126
tests with two optional native tests skipped. A separate current-native probe
completed normal and read-only repair turns on one fresh test-owned native
conversation, with file-operation probes and permission attestation on both.

The final Space-only history smoke retained the project-only Computer allowlist.
Native history readback showed successful `read_history` and `reply` MCP calls,
and Space published `SPACE_HISTORY_OK: the revised budget is 2000 credits.`
The public trace reported `visible_reply`. The earlier startup failure and the
intermediate inability to load the native terminal CLI remain recorded as failed
attempts; the final implementation uses the bounded dispatch MCP reader without
widening filesystem access. Its 28 CLI regressions, four adapter-core MCP tests,
12 Codex argument tests, targeted Claude/OpenCode configuration cases, schema and
adapter builds, and CLI typecheck passed. All 71 changed code/configuration files
passed Biome, and the final repository static contracts passed.
Final deferred release-readiness verification rebuilt the packaged CLI and
Service against base `d053dc1846411928fb37fe3c47deeb05c5398d0c` and passed its
59 release-tool tests. Release metadata remains identical to that base; stamping
and production distribution are deferred to the release. The test Computer
policy was restored, the Profile was left in its original parallel mode, and
the owned Service and localhost Worker stack were stopped.

## Remaining Scope And Explicit Limits

Host RAM/CPU admission, a shared transient-provider cooldown budget, and the
complete tool-subprocess versus Controller termination classification matrix
remain unimplemented. Existing slot/resource exclusions and usage recovery do
not constitute those mechanisms. No claim of universal three-task performance
or OOM prevention is made.

The local receipt does not expose `accepted_for_finalization` or `published`;
Core execution and Space publication remain separate authoritative facts.
There is no Late reply presentation or automatically injected five-entry
recent-work brief in this implementation. General ACP Context support is
tracked after merge in [#1040](https://github.com/amplifthq/openmeld/issues/1040).

The draft Changelog entry must remain unpublished until the selected release
and its user-visible acceptance are proven.
