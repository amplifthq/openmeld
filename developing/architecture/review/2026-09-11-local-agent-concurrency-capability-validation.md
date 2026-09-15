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
| Profile capacity | One Work Coordinator, five new reservations, 50 waiting Wakes, one writer per Context, and legacy exclusivity. Readers accept five reservations and 55 total items. | Five-way Codex project smoke passed below. Automatic host-resource admission and universal five-task performance remain unproven. |
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
The owner subsequently requested restoring five. The shared policy, its existing
five/sixth admission and slot tests, serial-mode drainage, and current owner docs
now use five again. The historical three-way smoke below remains three-way
evidence; it does not certify five simultaneous native turns.

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

The previously validated local build ran three new Space-context Wakes on the
same Codex Profile after its owner switched the Profile from serial to parallel through
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

## Five-Way Native Project Smoke — September 15

Tested candidate: `66ab067dd0f5a532568c3e4fac3cd5443f91aca2` on macOS arm64,
48 GiB host RAM, with native Codex `0.154.0-alpha.6.2`. Six consecutive public
`openmeld-dev space send --new-task --task-access workspace --task-workspace
isolated` requests targeted the same Agent in one Space. The isolated localhost
Worker lane and owned temporary `OPENMELD_HOME` were used; production OpenMeld
state was not used. Computer access allowed only the test source repository.

Each task read the same committed `base.txt`, ran a 45-second sleep, wrote its
own marker to `five-result.txt`, and submitted its assigned Space reply. Native
history readback confirmed these completed turn intervals (Asia/Shanghai):

| Task | Native start | Native completion | Final outcome |
| --- | --- | --- | --- |
| A | 10:43:10 | 10:45:17 | Correct file and linked Space reply |
| B | 10:43:11 | 10:45:09 | Correct file and linked Space reply |
| C | 10:43:09 | 10:45:05 | Correct file and linked Space reply |
| D | 10:43:13 | 10:45:04 | Correct file and linked Space reply |
| E | 10:43:12 | 10:45:04 | Correct file and linked Space reply |
| F | 10:45:12 | 10:48:42 | Initially queued; then correct file and linked reply |

The first five native turns overlapped for **111 seconds**. F's initial public
trace diagnostics recorded `status=queued`, `latestAttempt=profile_queue_waiting`,
and `head=queued`; Service events placed F's reservation after E's completion.
All six final public traces reported `delivered=true` and `visible_reply`, with
reply IDs matching the exact original source messages. Six distinct native
conversations, six worktrees, and six private Git common directories were
verified. All Git HEADs matched frozen source commit
`f355d47d4d9b76050a9c2975733c7e5881ced9ac`. The source remained clean and its
registered worktree list was unchanged. Each task's own result file was retained.

Two-second resource samples observed at most five identified task execution
processes. The Service plus attached descendants peaked at 3,189.9 MiB summed
RSS, with estimated available host memory no lower than 16.3 GiB and normal
memory pressure throughout. The maximum sum of sampled `ps` CPU percentages was
292.9%. These are observations for this workload: summed RSS may double-count
shared pages, `ps` CPU is process accounting rather than an instantaneous host
measurement, and preparation/helper processes are not additional model turns.
They do not implement a host budget or certify heavier tasks or other harnesses.

The Computer policy was restored, parallel mode retained, and the owned Service
and Worker stack stopped. Local artifacts under `dev-tmp/five-native-smoke/`
include request selectors, final traces, native history, verified file/Git
results, and resource samples. They are diagnostic evidence, not production
dependencies. No production-code change was made for this run.

One non-blocking diagnostic defect was observed: while F was correctly queued,
the concise `agentSummary` said `final_projection_pending` and suggested
reconnect guidance. Its detailed diagnostics correctly identified the queue;
the final outcome was correctly reported. This smoke records the defect and
does not claim to fix that summary projection.

## Remaining Scope And Explicit Limits

Host RAM/CPU admission, a shared transient-provider cooldown budget, and the
complete tool-subprocess versus Controller termination classification matrix
remain unimplemented. Existing slot/resource exclusions and usage recovery do
not constitute those mechanisms. No claim of universal five-task performance
or OOM prevention is made.

The local receipt does not expose `accepted_for_finalization` or `published`;
Core execution and Space publication remain separate authoritative facts.
There is no Late reply presentation or automatically injected five-entry
recent-work brief in this implementation. General ACP Context support is
tracked after merge in [#1040](https://github.com/amplifthq/openmeld/issues/1040).

The draft Changelog entry must remain unpublished until the selected release
and its user-visible acceptance are proven.
