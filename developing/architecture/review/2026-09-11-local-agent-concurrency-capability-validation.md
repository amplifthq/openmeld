# Local Agent Concurrency: Capability Validation And Implementation Log

## Agent Context

- Purpose: Record source-confirmed facts, native capability probes, and implemented slices for the "Stable Local Agent Identity And Concurrent Work" design so implementation decisions rest on evidence rather than the design's assumptions.
- Read this when: Implementing, reviewing, or continuing the design in `local-agent-concurrency-design.md`, or judging whether a claimed capability is source-confirmed, natively verified, or still unverified.
- Update this when: A probe result changes, a slice lands, or a design premise is proven true or false.
- Do not use this for: Product rules (owner documents), release authorization, or as proof that any incident is fixed in production.
- Source of truth: Evidence log for PR #948 implementation. Owner documents remain authoritative for behavior.

Status: DRAFT — capability validation in progress; activation off.

Remove when the feature ships and this evidence is incorporated into the scoped
owner documents and the design document is deleted.

## Evidence Levels

| Level | Meaning |
| --- | --- |
| SOURCE | Confirmed by reading current checkout source (file:line cited). |
| NATIVE | Verified by a local native Controller test in a temporary directory. |
| UNVERIFIED | Not yet proven; the minimal external condition is named. |
| NOT SUPPORTED | Current source cannot satisfy the design contract as written. |

## Current Source Facts (baseline `origin/main` at `7cf0b014`)

| Fact | Level | Evidence |
| --- | --- | --- |
| Work Coordinator has one structural slot: index zero owns execution; `start` only when `queuePosition === 0`; `summarize` destructures `[currentWork, ...queuedWork]`. | SOURCE | `services/core/src/runtime-transport/application/agent-profile-work-coordinator.ts:28,155,422` |
| Waiting bound is `AGENT_PROFILE_WORK_COORDINATOR_MAX_WAITING = 50`; overflow returns `queue_full`. | SOURCE | same file `:116-127` |
| Release = `removeAgentProfileWork` promotes `workItems[0]` only; `settleAgentProfileWork` moves a `usage_exhausted` head into a single `recoveryGate.interruptedWork`. | SOURCE | same file `:160-202,204-288` |
| Admission DO record is versioned (`openmeld.runtime_coordinator.agent_profile_work_coordinator.v1`, legacy `agent_profile_execution_admission.v1`) and upgraded at read time, not by a stored migration step. | SOURCE | `agent-profile-execution-admission.ts:64-71,108-120,4155-4193` |
| Single interrupted-work pointer compared by `dispatchId`. | SOURCE | `agent-profile-execution-admission.ts:432-433,1375,1391` |
| No fixed wall-clock execution deadline exists; termination is progress-evidence staleness (`progressEvidenceStaleTerminalAfterMs`) and pre-accept waiting boundaries. `DEFAULT_AGENT_EXECUTION_TIMEOUT_MS = null`. | SOURCE | `runtime-coordinator-authority.ts:328,1071,1151,917-920`; `packages/agent-runtime/src/dispatch-timeout.ts:4` |
| Late-result eligibility already exists: terminal-late token, matched run, `failed_terminal`, reason in {progress-stale, local-runtime-lost}, task `success|partial_success`. | SOURCE | `runtime-coordinator-authority.ts:304-321` |
| Local ledger is Profile-wide: key = `[targetProfileId, agentControllerRef, transportMode, runtimeWorkspaceFingerprint]`, one native conversation per key, `LEDGER_STATE_VERSION = 1`. | SOURCE | `runtime/local-execution/src/ledger-store.ts:12,79-92,127` |
| Ledger version mismatch is a backup-and-reset, not an upgrade. | NOT SUPPORTED (design asks for versioned upgrade) | `ledger-store.ts:559-561,857-866,973-989` |
| Local Space Action recorder checks only a 12h local TTL and env/context identity; no remote dispatch-state check before writing the proposal. | SOURCE | `clients/openmeld-cli/src/runtime/dispatch-space-action-context.ts:36,131,174-221,323-346,432-438` |
| MCP tool returned the success-looking "Action recorded" text even when the remote dispatch had closed. | SOURCE | `clients/openmeld-cli/src/space/action-mcp-server.ts` (pre-change `:153-177`) |
| Codex fork calls app-server `thread/fork` with `{ excludeTurns: true, threadId }` and no `lastTurnId` / completed-turn cutoff; no summary-injection fallback exists. | NOT SUPPORTED (no frozen boundary) | `runtime/adapters/codex/src/transport/codex-app-server-transport.ts:579-584,626-634,712-723` |
| CLI fork is coupled to Agent Profile creation: the only cloud caller feeds the child thread into `rpcEnsureAgentProfilePrimaryBinding`. | SOURCE | `services/core/src/agent-profile-creation-request/agent-profile-creation-request-rpc.ts:854-872`; `clients/openmeld-cli/src/local-service/session-control/fork-agent-session.ts` |
| Fork operations are idempotent per `operationId` (partial lost-ack coverage). | SOURCE | `clients/openmeld-cli/src/local-service/session-control/session-fork-operation-store.ts:9-13,46-88` |
| Binding conversation column is nullable text. | SOURCE | `packages/db/src/core/agent-profile-binding.schema.ts:22,89-90` |
| Claude Code exposes only `--resume <id> --fork-session` (repair-gated) and SDK `forkSession`; no turn-cutoff parameter. | NOT SUPPORTED (for the completed-prefix contract) | `runtime/adapters/claude-code/src/transport/claude-cli-transport.ts:320-324`; `claude-agent-sdk-transport.ts:637-642` |

## Native Probes

| Capability | Level | Evidence / blocker |
| --- | --- | --- |
| Codex native fork with completed-turn cutoff | UNVERIFIED | `codex-cli 0.148.0` installed at `/opt/homebrew/bin/codex`; `codex login status` = Not logged in. Unblock: `codex login` on the validation host, then one `thread/fork` with `lastTurnId` on a multi-turn thread. |
| Claude Code local-cli: three independent sessions in parallel | NATIVE | `claude` 2.1.268; three concurrent `claude -p "Reply with exactly: OK <n>" --output-format json --max-turns 1` in separate `mktemp -d` dirs all returned rc=0 with the correct text and distinct `session_id`s; wall 21 s / 26 s / 84 s. |
| Claude Code local-cli: resume from the same cwd | NATIVE | `claude -p --resume <session_id> "What did you reply before?"` returned "I replied: OK 3" with the same `session_id`, rc=0, 28 s. Resume from a different cwd, a long task, a fourth waiter, and cleanup were not exercised. |
| Service allows three Claude Code executions per Profile | NOT SUPPORTED today | `runtime/local-service/src/local-execution-slots.ts:1,312-324` (`LOCAL_EXECUTION_LANE_CONCURRENCY_LIMIT = 1`); `dispatch-queue-routing.ts:81-93` lane key falls back to `agent-profile:<profileId>` without a bound native conversation; `agent-context-policy.ts:475-490` `profile_conversation_conflict`. The transport itself is stateless per spawn (`claude-cli-transport.ts:319-338`). |
| Exit code vs termination signal recorded separately | SOURCE | `runtime/adapters/core/src/drivers/cli-driver.ts:262-268` (`close` event with `exitCode`, `signal`); signal maps to `provider.process_terminated` (`claude-cli-transport.ts:566-571`). Exit 137 without a signal is not labelled OOM but falls to generic `upstream_unreachable`. |
| Tool-subprocess death distinguishable from Controller death | NOT SUPPORTED | Only the `claude` child process is observed; tool failures surface only as model-reported text. |
| Active tool call counts as running evidence | NOT SUPPORTED | No `tool_use`/`tool_result`/progress/heartbeat handling in the transport or preview emitter; only `firstStdoutAtMs`/`firstOutputAtMs` are stamped. A silent long tool call is indistinguishable from a hang. |
| Fixed wall-clock timeout in the Claude Code path | SOURCE | One request-level `claudeTimeoutMs` (SIGTERM then SIGKILL, `cli-driver.ts:178-195`) from `OPENMELD_DAEMON_RUNTIME_REQUEST_TIMEOUT_MS` (`config/claude-runtime-config.ts:78-82`); unbounded when unset. No idle timer. |

## Implemented Slices (activation off)

1. Shared work-capacity policy module: `packages/agent-runtime/src/work-policy.ts` exports `AGENT_PROFILE_WORK_CONCURRENCY_LIMIT = 3`, `AGENT_PROFILE_WORK_MAX_WAITING = 50`, a policy type, frozen default, and guard. The coordinator's waiting constant now imports the shared value; the one-slot rule is untouched and the concurrency limit is not consumed anywhere. Tests: `packages/agent-runtime/tests/work-policy.test.ts`, `services/core/src/__tests__/agent-profile-work-coordinator.test.ts`.
2. Typed Space Action receipts at the local recorder and MCP boundary: `dispatchSpaceActionReceiptKindSchema` (`proposal_saved_locally | rejected_closed | outcome_unknown`), closed-reason codes, `DispatchSpaceActionClosedError`. A known-expired or mismatched context now returns an MCP error with `receipt: rejected_closed` and a reason code; a saved proposal is reported as local only, with Coordinator acceptance and Space publication explicitly unconfirmed. The "Action recorded" text no longer exists at the MCP boundary. Exact replay returns the identical receipt. Test: `clients/openmeld-cli/tests/space-action-command.test.ts`.

## Not Implemented Yet

- Three-reservation admission, per-item interrupted work, context-keyed DO and ledger records with versioned upgrade, legacy drain and atomic switch.
- Execution Context identity, `contextSelection` contract, scoped automatic continuation, recent-work brief, work-history projection.
- Remote authoritative receipts (`accepted_for_finalization`, `published`), Coordinator-serialized closure, Late reply presentation, CLI stdout wording in `action-command.ts`, and the Space-side closure notice.
- Completed-prefix native fork (Codex `lastTurnId`), same-Profile fork entry point decoupled from Profile creation, child-authority rejection checks.
- Host memory/CPU admission, shared provider cooldown, process-termination classification end to end.

## Contract Impact Notes

- MCP tool result text changed; anything string-matching "Action recorded" (skills, prompts, tests) must update. Error path is additive. On-disk record format and Service/Coordinator wire payloads are unchanged, so old and new CLI/Service interoperate; old CLIs keep the misleading wording.
- No shared schema, daemon contract, or D1 change in this slice.
