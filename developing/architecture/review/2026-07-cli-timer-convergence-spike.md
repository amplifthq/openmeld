# CLI Timer Convergence Spike Proposal

## Agent Context

- Purpose: Define the bounded experiment for simplifying local carrier timers.
- Read this when: Evaluating heartbeat or evidence-reconciliation timing work.
- Update this when: The spike is approved, rejected, run, or made obsolete.
- Do not use this for: Current OpenMeld Service lifecycle truth.
- Source of truth: This file owns only the proposal; architecture owner
  documents own current timing and execution contracts.

Date: 2026-07-03
Status: proposal only. Do not implement until external review approves the
spike. Remove this file when the spike is approved and implemented, or
explicitly rejected.

## Goal

Determine whether the OpenMeld CLI / local OpenMeld Service carrier can converge the
current heartbeat, route-catalog sync, controller report, provider proof, and
keepalive timing surface into two product-level loops:

```text
one carrier heartbeat + one slow evidence reconciliation loop
```

The goal is fewer timing concepts and less hidden heartbeat tail work, while
preserving liveness, setup convergence, Wake delivery, diagnostics, and
mixed-version safety.

This spike must not turn setup evidence, local service diagnostics, or
heartbeat facts into final Wake readiness truth. Core-owned
`AgentExecutionReadiness` remains the user-facing Wake availability projection.

## Experiment Method

1. Instrument the current CLI carrier in a dev lane with durations and wakeups
   for:
   - heartbeat send and acknowledgement;
   - dispatch outbox flush from the heartbeat tail;
   - route-catalog sync;
   - catalog signal-file polling;
   - runtime agent controller report sync;
   - provider conversation proof sync;
   - WebSocket keepalive.
2. Build a throwaway refactor with two named loops:
   - carrier heartbeat: session liveness, lease evidence, and required
     dispatch outbox flush;
   - slow evidence reconciliation: route catalog, controller reports,
     provider proof, and other non-liveness evidence.
3. Treat WebSocket keepalive as socket-level transport maintenance. The spike
   may keep it as a narrow transport timer if removing it makes idle connection
   behavior worse; do not hide that decision under product timer convergence.
4. Run with a fresh temporary `OPENMELD_HOME`, then with the repo-local `openmeld-dev`
   lane. Do not mutate the published `~/.ats` lane.
5. Exercise:
   - service start, stop, repair, and restart;
   - setup completion and profile catalog convergence;
   - one successful local Wake;
   - local OpenMeld Service reconnect after temporary network failure;
   - controller report update;
   - provider proof update;
   - signal-file route-catalog nudge.

## Passing Criteria

Correctness passes only if:

- Heartbeat freshness remains the OpenMeld Service liveness evidence.
- Slow report/catalog/proof work cannot delay or skip liveness heartbeats.
- Dispatch outbox flushing still runs promptly enough for accepted local work
  and does not wait for the slow reconciliation cadence.
- Setup, service status, trace, and diagnostics continue to show the same or
  clearer evidence.

Convergence passes only if:

- Route-catalog changes still become visible to Web/CLI surfaces within the
  current behavior envelope.
- Controller report and provider proof updates do not regress beyond the
  current five-minute evidence windows.
- The first setup-complete path does not add another foreground wait.

Load and simplicity pass only if:

- The refactor removes independent product-level timer concepts instead of
  renaming them.
- The heartbeat p95 duration decreases or stays flat after slow work moves out.
- The slow loop has explicit jitter/backoff and does not create synchronized
  account-wide bursts.

Mixed-version safety passes only if:

- Old cloud code can continue talking to the current local component.
- New cloud code can continue talking to the old local component during rollout.
- No shared schema, command contract, or release manifest change is hidden
  inside the timer refactor.

## Rollback Plan

Keep the current timer behavior as the default until the spike passes review.
The spike should be revert-only or flag-controlled, with no required local state
migration.

If the approved implementation touches CLI carrier files or OpenMeld Service
lifecycle behavior, run `pnpm run verify:release-ready`, complete the Contract
Impact Audit, and document why existing users can keep running Wake, setup,
service status, and diagnostics during rollout.
