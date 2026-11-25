---
name: verify-runtime-coordinator-liveness
description: "Check RuntimeCoordinator liveness for one workstation Wake. Fresh progress is not a failure, an open question pauses the stale watchdog, and the first terminal outcome sticks. Use when changing hasRuntimeCoordinatorLocalProgressStaleTerminalExpired or the terminal settle functions."
---

# Verify RuntimeCoordinator liveness

A running Wake is not failed for silence while accepted progress is inside the window: five minutes normally, thirty minutes when the communication-recovery baseline is still that same progress. An unanswered question pauses that decision. The first of reply, stop, or failure sticks. Harm: a long task dies while the agent is still reporting, or a reply and a failure both become the Space outcome.

The question is the order of progress, time, disconnect, stop, and reply. That is a model check, so the spec is TLA+ and the checker is TLC 1.7.4 (jar sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`). The code check calls the stale-progress predicate and both terminal settlement functions. Java 11 or newer must be on `PATH`. The check downloads the jar into `~/.cache/openmeld-tlc/` on first run.

## When this applies

Run it when a change touches any of these:

- `services/core/src/runtime-transport/application/runtime-coordinator-authority.ts`
  - `hasRuntimeCoordinatorLocalProgressStaleTerminalExpired`
  - `RUNTIME_COORDINATOR_PROGRESS_EVIDENCE_STALE_TERMINAL_AFTER_MS`
  - `RUNTIME_COORDINATOR_COMMUNICATION_RECOVERY_WINDOW_MS`
  - `settleRuntimeCoordinatorAuthorityForTerminalDecision`
  - `settleRuntimeCoordinatorAuthorityForCancellationAccepted`
- `services/core/src/runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo.ts`
  - `LOCKED_TERMINAL_STATUSES`

Confirmed against commit `965d9eb3219fa2c35789f9ab9a2206ab8699de9b`. Move that commit forward only after you have confirmed that `RuntimeCoordinatorLiveness.tla` and `check.test.ts` still describe those functions.

## Run

From the repository root, after `pnpm install`:

```sh
node .agents/skills/verify-runtime-coordinator-liveness/check.mjs
```

Exit 0 means fresh progress is not a failure and a later stop or timeout preserves the recorded terminal outcome.

Read every TLC result with `/statechart`. The user-facing labels are in `view.mjs` next to the spec.

## What a failure means

- The five-minute or thirty-minute assertion failed: the stale predicate no longer matches those windows. A wake that fails while progress is newer than the window is a product bug. A predicate that never fails is also a bug: silence would never become "couldn't finish".
- `does not fail a wake while it is waiting for the user` failed: an open question no longer pauses the watchdog.
- `FreshProgressIsNotAFailure` or `TerminalOutcomeSticks` failed in TLC: either the model gained a step the code does not have, or you need to add a step the code does have. Time in the spec is a 5-minute tick, from 0 through 6. Do not raise the tick limit to hide a counterexample.

`TerminalOutcomeSticks` compares consecutive states. A model that allows a published reply to become a stop fails even if both fields change together. The code check independently applies a late stop to a published reply and a late timeout to a settled stop. The PostgreSQL ledger is outside this executable replay.

## Scope

One accepted Wake. Left out: pre-accept redelivery, token mismatch, and `failed_retryable`. The chart hides stop, reply, and "the agent asks you" from the states where the computer is already away. Those actions still exist. Stop and reply are shown from Working, and stop is also shown from "No progress for five minutes".

## After a change that skipped this skill

Use `/maintain-formal-verification-skill` to bring this check back in line.
