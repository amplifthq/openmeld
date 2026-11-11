---
name: verify-remote-agent-execution
description: "Check Remote Agent native execution. A stop is not stored as a reply, and a stored reply is not rewritten as a stop. Use when changing initializeRemoteAgentExecutionState, markRemoteAgentExecutionProgress, requestRemoteAgentExecutionCancellation, or completeRemoteAgentExecutionState."
---

# Verify Remote Agent execution

A stop that wins before a reply is stored never becomes a completed reply, and a reply that is already stored stays a reply. Harm: the Space shows a successful answer after the member stopped the hosted agent, or a stop erases an answer that already landed.

The steps are compare-and-set transitions on one submission, so the spec is TLA+ and the checker is TLC 1.7.4 (jar sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`). The code check calls the real functions with the in-memory storage from `services/remote-agent/tests/storage.ts` and rereads the terminal outcome using `resolveRemoteAgentTerminalExecutionOutcome`. Java 11 or newer must be on `PATH`. The check downloads the jar into `~/.cache/openmeld-tlc/` on first run.

## When this applies

Run it when a change touches any of these in `services/remote-agent/agent-core/execution-state.ts`:

- `initializeRemoteAgentExecutionState`
- `markRemoteAgentExecutionProgress`
- `requestRemoteAgentExecutionCancellation`
- `completeRemoteAgentExecutionState`
- `resolveSettledExecutionStatus`

Confirmed against commit `965d9eb3219fa2c35789f9ab9a2206ab8699de9b`. Move that commit forward only after you have confirmed that `RemoteAgentExecution.tla` and `check.test.ts` still describe those functions.

## Run

From the repository root, after `pnpm install`:

```sh
node .agents/skills/verify-remote-agent-execution/check.mjs
```

The stop-then-complete replay must return `aborted`. The persisted outcome must also be readable as `aborted` with no completed answer text. A failure during readback catches an inconsistent stored record even if completion returned the expected status.

Read every TLC result with `/statechart`. The user-facing labels are in `view.mjs` next to the spec.

## What a failure means

- `settles a stop as stopped` expected `aborted` and got `completed`: `resolveSettledExecutionStatus` no longer turns `cancellation_requested` into `aborted`. That is the bug the rule exists to catch.
- `keeps a stored reply` failed: stop after `completed` changed the row or reported it as stoppable.
- `does not start after a stop that arrived first` failed: initialization ignored the admission stop intent.
- TLC failed while the code check passed: the model allows a step the functions do not, or the opposite. One spec step is one successful compare-and-set. Do not drop `AStopIsNotAReplyOrMoreWork` to make TLC pass.

## Scope

One submission. `repairRemoteAgentCompletedExecutionWithoutAnswer` is not in the model: a completed row with no stored answer can still become `failed`. The chart hides the idle end step and a progress tick that stays on Working.

## After a change that skipped this skill

Use `/maintain-formal-verification-skill` to bring this check back in line.
