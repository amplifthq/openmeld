# Codex Desktop and OpenMeld session coexistence

## Agent Context

- Purpose: Track the bounded Codex coexistence correction and experiment.
- Read this when: Implementing or reviewing this correction.
- Update this when: Behavior checks or interoperability evidence change.
- Do not use this for: Production release authority or a Desktop connection contract.
- Source of truth: Current code, observed experiments, and linked provider sources.
- Remove after the correction ships and the remaining compatibility decision is
  recorded in the owning local Service document.

Status: Draft implementation and bounded compatibility investigation.

## Outcome

Keep Codex Desktop open while OpenMeld accurately reports whether its own Wake
is waiting or running. Cancelling a waiting Wake must prevent later execution;
stopping an OpenMeld turn must not stop unrelated Desktop work.

## Delivery order

1. Reuse RuntimeCoordinator lifecycle evidence for working elapsed time instead
   of including admission and controller-occupancy waiting time.
2. Show `Waiting for Codex` with `Another app is using this conversation.` for
   proven Codex conversation occupancy. Preserve existing cancellation fences
   and correct cancellation diagnostics after a retry has started execution.
3. Run an isolated shared App Server experiment and inspect primary-source
   open-source implementations. Distinguish multiple clients of one server from
   independent servers competing for one conversation, and distinguish CLI
   remote support from actual Desktop integration support.

## Boundaries

RuntimeCoordinator remains Wake execution authority. Provider events are
execution evidence, not a second cloud scheduler. Do not clear provider locks,
restart the user's Desktop or Service, or change production connections during
the experiment. Deleted Agent retry projections are outside this work.

## Acceptance evidence

Record focused lifecycle and cancellation regression results, browser evidence
for the changed presentation, installed Codex version, experiment topology,
observed event routing and cancellation behavior, and source revision links.
An isolated two-client experiment does not prove the installed Desktop can
join that server. Keep that limitation explicit until directly verified.

## Implemented correction

- Project the coordinator's existing `runningAtMs` through lifecycle event
  metadata. Read it only when timing is requested, with the existing indexed
  execution/event lookup. Legacy evidence without this timestamp has no timer.
- Show `Waiting for {Agent name}` and `Another app is using this conversation.`
  for confirmed occupancy. Reuse `Cancel waiting` and the existing abort fences.
  Cancellation diagnostics remain accurate if a retry already started a turn.
- Keep immediate file-change wakeups, but retry official admission every 30
  seconds while occupied even if the lock file remains. A crashed writer leaves
  the file after the OS releases its lock. `retry_due` is not release evidence;
  only successful official admission clears occupancy. No lock is deleted and
  no additional polling is added to the normal execution path.

## Isolated provider experiment

On 2026-09-14, installed Codex `0.154.0-alpha.6.2` was exercised with a fresh
temporary HOME and CODEX_HOME. One actual WebSocket App Server had two clients
and a reconnecting client; a separate stdio App Server shared only that temporary
CODEX_HOME. A loopback holding HTTP provider kept a real turn active without
credentials, paid inference, or tool execution. No user Desktop or Service was
modified or restarted.

| Scenario | Observed result |
| --- | --- |
| Two clients resume one loaded conversation | Both observe the active turn and completion |
| Separate server reads that conversation | `notLoaded`, not evidence of idle |
| Separate server resumes while first server owns it | Official active-writer rejection, even when first server is idle |
| Peer interrupts the exact turn | Both observe `interrupted`; another conversation remains active |
| Reconnect after interruption | Official status is `idle` |
| Interrupt an old turn after a new one starts | Rejected; new turn stays active |
| Start another turn on the same active conversation | Returns the same active turn ID; not an independent Wake queue |
| Kill only the disposable owning server | Lock file remains, but separate server can resume |
| OpenMeld waiter sees that stale file | Returns `retry_due`; official resume then succeeds |

The complete final run passed these observations. Early attempts to resume
before the first provider request reached the holding endpoint intermittently
returned `list_turns is not supported yet`; the final harness synchronizes on
that request rather than sleeping. This alpha-version initialization behavior
is another reason not to claim general Desktop compatibility from this test.

## Official and open-source evidence

- [Official App Server documentation](https://learn.chatgpt.com/docs/app-server)
  documents transports and lifecycle methods. A transport endpoint alone does
  not establish that the installed Desktop exposes or accepts that endpoint.
- [Official writer lock implementation](https://github.com/openai/codex/blob/4d8eca1ff34ff9da717323a7b0a5d0b5ebcf3bb6/codex-rs/rollout/src/writer_lock.rs)
  acquires an OS file lock. File existence is not ownership evidence.
- [Linux Desktop shared socket implementation](https://github.com/ilysenko/codex-desktop-linux/blob/750963be9e82b47749be10f18c75af5c0b27a3d5/linux-features/shared-app-server-socket/README.md)
  patches Desktop's transport factory to use one shared service. It demonstrates
  the topology, but requires a bundle patch and is not a stock macOS contract.
- [codex-monitor WebSocket transport](https://github.com/lucianlamp/codex-monitor/blob/8b57ce67520285740c437409889a2eee52027d99/src/transport/ws.rs)
  distinguishes externally owned servers from managed child processes. Closing
  an observer must not kill a server owned by another application.
- [CodexMonitor](https://github.com/Dimillian/CodexMonitor/blob/dd61b9abd37de5ded86e82b9fe8a83fd49d46fa5/README.md)
  uses its own workspace App Servers and remote daemon; it is not proof of
  attaching to an already-running official Desktop service.

## Compatibility decision and next priority

Shared observation is feasible when both clients actually use the same server.
Separate servers cannot infer the other server's active turn from `notLoaded`
or a writer lock. Do not ship a WebSocket switch alone: first prove a supported
Desktop endpoint discovery and attachment path, then define per-turn ownership,
approval routing, reconnect reconciliation, and cancellation authority. In
particular, never treat a same-turn response to a new Wake as a newly admitted
OpenMeld execution or interrupt an unrelated Desktop turn.

## Contract impact audit

RuntimeCoordinator remains the sole Wake execution owner. Existing generic
lifecycle event metadata carries its timestamp; there is no database migration,
new external frame, enum, protocol epoch, or parallel execution state. Old
writers without timing evidence render without elapsed time. Old and new CLI,
Service, Core, Gateway, Web, and Skills retain their setup, Wake, Space action,
and diagnostic interfaces. Both upgrade directions remain compatible. Local
components are available updates, not a raised required floor. The matching
transport, Service, and Web owner documents are updated in this PR.

Focused validation includes real SQLite timestamp/heartbeat/query-plan checks,
the active Space projection integration case, UI status/cancellation/sidebar
regressions, and Codex cancellation and stale-lock admission regressions.

Localhost browser smoke used the existing disposable Space runtime fixture
adapter through the normal authenticated Web route. The conversation-occupied
bubble had no working timer, exposed `Cancel waiting`, showed the correct
confirmation dialog, and left the waiting state after confirmation. Screenshots
were saved locally. The initial cold route remained blank before eventually
loading; it was not counted as a successful render until the full Space appeared.
This proves UI behavior with fixture data, not an end-to-end production Wake.

The same smoke exposed a remaining details-panel projection that called all
active progress `Working`. Conversation occupancy now projects `Waiting` there
and includes the shared other-app explanation. The updated details view was
verified in the browser; its presentation and drawer suites passed 61 tests.
