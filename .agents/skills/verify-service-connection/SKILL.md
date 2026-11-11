---
name: verify-service-connection
description: "Check the local OpenMeld Service connection loop. The computer is shown as connected only while the session is online, stopping is idle, and quitting does not reconnect. Use when changing the service run loop, toHealthProjection, or classifyConnectionFailureReason."
---

# Verify the service connection

Only the local Service's online state reports healthy. Connecting, starting, and authentication problems report degraded, and stopping reports idle. The loop model also checks that quitting prevents reconnection. Core owns the separate Wakeability projection.

This is an ordering question about one connection loop, so the spec is TLA+ and the checker is TLC 1.7.4 (jar sha256 `936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88`). The code check calls `toHealthProjection`, `classifyConnectionFailureReason`, and `createServiceConnectionStateTracker`. Java 11 or newer must be on `PATH`. The check downloads the jar into `~/.cache/openmeld-tlc/` on first run.

## When this applies

Run it when a change touches any of these:

- `clients/openmeld-cli/src/local-service/state/service-connection-state.ts`
  - `createServiceConnectionStateTracker`
  - `toHealthProjection`
  - `classifyConnectionFailureReason`
- `clients/openmeld-cli/src/local-service/carrier/service-runner.ts`
  - the run loop that sets `connecting`, `online`, and the failure states
  - `noteAuthenticationRequiredState`
  - `noteReconnectFailureState`
  - `markStopping`

Confirmed against commit `965d9eb3219fa2c35789f9ab9a2206ab8699de9b`. Move that commit forward only after you have confirmed that `ServiceConnection.tla` and `check.mjs` still describe those functions.

## Run

From the repository root:

```sh
node .agents/skills/verify-service-connection/check.mjs
```

Exit 0 means the health projection, the upgrade-rejection classification, and the loop model all hold. `pnpm install` is not required for this check.

Read every TLC result with `/statechart`. The user-facing labels are in `view.mjs` next to the spec.

## What a failure means

- A health mismatch names the phase and the actual and expected values. The code check calls `toHealthProjection` for all six service connection states. In particular, `connecting` must report `degraded/suspect` until the connection is online.
- `a non-401 stream upgrade rejection is internal`: `classifyConnectionFailureReason` treated a 500, or a message that merely contains "401" or "socket", as sign-in or network. That sends the user to the wrong recovery.
- `NoReconnectAfterQuit` failed: the model now has a path from stopping back to connecting. Check `markStopping` and the `while (!stopRequested)` loop before you weaken the rule.
- TLC cannot parse the spec: the model drifted. One step in the spec is one `connectionState.set` in the run loop, or the health read that forces `stopping` while draining.

## Scope

One service process. Backoff durations are not in the model. `sign_in_unavailable` is degraded reason `auth_unavailable`, not `authentication_required`. The chart hides "you quit" from connecting, sign-in, and the reconnecting states. You can still quit from those; the chart shows quit from Starting and Connected, and every other state can still try again or fail.

## After a change that skipped this skill

Use `/maintain-formal-verification-skill` to bring this check back in line.
