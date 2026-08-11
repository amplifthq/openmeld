# Zero-Token Provider Session Pre-Warm Research (2026-07-03)

## Agent Context

- Purpose: Preserve the proposal and evidence for a zero-token provider
  session pre-warm experiment.
- Read this when: Evaluating controller cold-start work or pre-warm safety.
- Update this when: The proposal is approved, rejected, or invalidated.
- Do not use this for: Current controller behavior or a shipped capability.
- Source of truth: This file owns only the research proposal; owner documents
  own current execution rules.

Status: DESIGN PROPOSAL — do not implement without review. Remove this file
when the proposal is implemented through a ticket or explicitly rejected.

Question: can OpenMeld pre-warm a provider session when an Agent Profile is created
or bound, without sending any prompt and without consuming user model tokens?

Short answer: yes for a narrow Codex MVP, but only if the first version
pre-warms the Codex App Server and starts an empty Codex thread. Do not try to
pre-warm Claude Code, OpenCode, or OpenClaw sessions in the first slice.

The product constraint is strict:

```text
pre-warm may start local provider process/session scaffolding
pre-warm must not send a prompt
pre-warm must not start a model turn
pre-warm must not consume user model tokens
pre-warm failure must never block profile creation, Binding, or Wake
```

## Current Evidence

Baseline source:
`developing/architecture/review/2026-07-wake-latency-baseline.md`, "Cold-profile
first-wake baseline".

Fresh profile first-wake results:

| Controller | Cold first Wake | Warm same-day Wake | Cold penalty | Main cold-specific cost |
| --- | ---: | ---: | ---: | --- |
| claude-code | 36.9s | 20.3s | +16.6s | bootstrap injection and first-run CLI cost; process start was healthy |
| codex | 184.6s, about 121s excluding disconnect | 42.3s | about +79s excluding disconnect | Codex process cold start: 61s invocation to `task_started` |
| opencode | 27.1s | 22.6s | +4.5s | small first-run effect |

Current OpenMeld adapter behavior:

| Controller | Current OpenMeld launch path | Prompt required by current adapter? | Existing zero-prompt session surface |
| --- | --- | --- | --- |
| codex | `codex app-server --listen stdio://`, JSON-RPC per dispatch, closed after dispatch | Yes for dispatch; `turn/start` sends prompt | Yes: `initialize` and `thread/start` can run without `turn/start` |
| claude-code | `@anthropic-ai/claude-agent-sdk` `query()` per dispatch | Yes; SDK query is created with a user prompt | No documented headless session init without prompt |
| opencode | `opencode run --format json --dir ... <prompt>` | Yes; CLI run takes message | Server can be idle, but OpenMeld does not use server transport today |
| openclaw | `openclaw agent --local --agent ... --message <prompt> --json` | Yes | No OpenMeld-usable zero-prompt local session surface found |

Local zero-prompt probes:

| Probe | Result |
| --- | --- |
| Codex `app-server initialize`, real user `CODEX_HOME`, no thread, no turn | first stdout and initialize response in 249ms; RSS about 47MB; no stderr |
| Codex temp `CODEX_HOME`, `initialize` + `thread/start`, no `turn/start` | thread started in 280ms; RSS about 47MB; succeeded without auth, proving no model call was required |
| OpenCode `serve`, clean HOME, no prompt | listen in about 0.76s; RSS about 371MB; useful surface exists but not cheap enough for the first slice |

The Codex probe is the key token-safety evidence: `thread/start` succeeded in a
temporary `CODEX_HOME` with no auth. If a model/provider call were required, it
would not have succeeded. This does not prove that Codex's full 61s cold
penalty is eliminated by empty thread start; it proves the pre-warm primitive is
available and token-free.

## What Is Probably Slow

Codex:

- OpenMeld currently starts a fresh app-server process for every dispatch, then runs
  `thread/start` or `thread/resume`, then `turn/start`.
- The 61s cold span was measured from runtime invocation to Codex
  `task_started` in a fresh profile workspace.
- Local zero-prompt startup shows app-server process initialization and empty
  thread creation are cheap on this machine. Therefore the cold 61s is likely
  after or around first real `turn/start`: workspace trust/config scan,
  instruction/MCP/tool initialization, model/provider turn startup, or Codex's
  first event emission path.
- A Codex pre-warm can safely remove any cost before the first real turn
  (`app-server` startup, JSON-RPC initialize, empty thread creation, workspace
  materialization). It may not remove all first-turn cost.

Claude Code:

- Current steady-state process start is about 3s, not the earlier 9.9s
  environmental sample.
- The cold cost is mainly first bootstrap injection and first-run command tail,
  not a provider process that clearly supports idle headless pre-start.
- The Agent SDK `query()` session is prompt-driven. Session ID appears from the
  initial query stream after a user prompt starts the session.
- A zero-prompt Claude pre-warm would need upstream SDK support or a Claude
  Code background-agent contract that creates a durable session without a user
  turn. Do not invent this by sending empty prompts.

OpenCode:

- OpenCode is barely affected in the baseline.
- It has a headless server and `run --attach`, but current OpenMeld uses one-shot
  CLI `run`.
- An idle server is not cheap enough for modest hardware compared with the
  measured gain: about 371MB RSS for a 4.5s cold penalty.
- Defer until OpenMeld has a reason to adopt an OpenCode server transport for other
  capabilities.

OpenClaw:

- Current OpenMeld path is message-based local CLI.
- OpenClaw already has its own gateway/bootstrap preparation path, and the
  first OpenMeld priority is keeping gateway visibility and local agent binding
  honest.
- No zero-prompt local session pre-warm surface was found. Do not pre-warm by
  sending an empty `--message`.

## Recommended MVP

Build only Codex App Server warm thread pre-warm.

Trigger:

- Start from Binding creation/reconnect, not raw Agent Profile creation.
- The concrete local trigger should be daemon route-catalog sync after
  `agent_profile_binding_changed`.
- Pre-warm only profiles that are newly added to the local route catalog or
  whose route changed to Codex `codex-app-server`.

Why Binding/catalog sync instead of profile creation:

- Agent Profile creation is identity; it may not yet have a local execution
  target.
- Binding is the execution connection from Agent Profile to OpenMeld Service Runtime
  and Agent Controller.
- Route catalog sync happens on the local daemon that owns controller process
  evidence and can resolve the real profile workspace.
- Failure can be naturally fail-open: log diagnostics and keep the route
  catalog/Wake path unchanged.

Pre-warm operation:

1. Resolve the profile workspace using the same runtime workspace rules as
   dispatch.
2. Start `codex app-server --listen stdio://` with the selected launch contract,
   permission mode, model, reasoning effort, cwd, and environment that dispatch
   would use.
3. Send JSON-RPC `initialize`.
4. Send JSON-RPC `thread/start`.
5. Persist the returned Codex thread ID as the Binding's
   `agentControllerConversationId` only through the normal Binding command
   boundary, or record it locally and let the next successful Wake commit the
   observed provider conversation if review rejects a local write-back.
6. Keep the app-server process idle briefly, then reap it.

Suggested limits:

- one warm process per Codex Agent Profile
- global warm concurrency: 1
- idle TTL: 2-5 minutes
- max retained warm processes: 1 or 2
- warm process RSS budget: about 50MB each based on probe
- kill on route removal, Binding change, service stop, launch contract change,
  workspace change, account/lane mismatch, or memory pressure

The first version may be even smaller: `thread/start`, persist the thread ID,
then close the app-server immediately. That proves token safety and Binding
integration without paying idle process memory. If it does not improve Codex
first Wake enough, add a short idle process pool in the second slice.

## Lifecycle And Diagnostics

Pre-warm is local evidence only.

It must not:

- affect `Available for Wake`
- reserve RuntimeCoordinator execution
- publish Space replies
- change Queue or D1 dispatch state
- mark bootstrap injected
- create a local execution lane owner
- make a Wake fail if pre-warm failed

It may:

- create provider-local empty session/thread scaffolding
- report local diagnostic events
- update local warm-pool state
- write a provider conversation proof only if it uses the existing shared
  provider conversation proof path and does not claim final readiness

Required diagnostics:

| Event | Purpose |
| --- | --- |
| `provider_prewarm.started` | profile, binding, controller, workspace fingerprint, reason |
| `provider_prewarm.ready` | process spawned, initialize ms, thread start ms, thread id present, RSS |
| `provider_prewarm.reaped` | TTL, route removed, binding changed, stop, memory pressure |
| `provider_prewarm.failed` | stable reason code and error context |

Reason codes should be specific:

- `provider_prewarm.unsupported_controller`
- `provider_prewarm.workspace_unavailable`
- `provider_prewarm.launch_unavailable`
- `provider_prewarm.initialize_failed`
- `provider_prewarm.thread_start_failed`
- `provider_prewarm.resource_budget_exceeded`
- `provider_prewarm.reaped_before_wake`

## Acceptance Criteria

Token safety:

- Unit/integration test proves the Codex pre-warm path never calls
  `turn/start`, `codex exec`, `opencode run`, `claude query`, or
  `openclaw agent --message`.
- A local smoke with temporary `OPENMELD_HOME`, temporary profile workspace, and
  temporary `CODEX_HOME` shows `initialize + thread/start` succeeds without
  auth and without prompt.

Product safety:

- Binding creation succeeds even when pre-warm throws.
- Wake still executes normally when no warm session exists.
- Pre-warm never changes Core-owned readiness directly.
- Route removal or Binding change reaps stale warm state.

Performance proof:

- Compare cold Codex first Wake for fresh profile with and without pre-warm.
- Separate timings:
  - app-server process spawn
  - initialize
  - thread/start or thread/resume
  - first `turn/start` to Codex `task_started`
  - total runtime invocation to first output
- The MVP is successful only if first Codex Wake drops materially without
  adding noticeable idle CPU or more than the configured RSS budget.

## Non-Goals

- Do not pre-send a "hello", "warm up", empty string, or hidden system prompt.
- Do not mark bootstrap injected before a real Wake.
- Do not run Claude Code `query()` with an empty prompt.
- Do not start an OpenCode server by default for all profiles.
- Do not start OpenClaw local agent turns without a real user message.
- Do not let warm-pool state become a second source of Binding, readiness, or
  RuntimeCoordinator execution truth.

## Architecture Compliance Check

This proposal does not require changing the owner documents if implemented as
described.

- `local-openmeld-service.md`: compliant. OpenMeld Service owns local controller process
  evidence and can run a local, fail-open warm helper, but it must not own
  Agent Profile identity, Binding truth, final readiness, or RuntimeCoordinator
  execution.
- `agent-transport-contract.md`: compliant. Pre-warm does not create a Wake,
  lease, execution token, lifecycle, result, or Space outcome.
- `agent-profiles.md`: compliant. Profile creation remains identity-only;
  Binding remains the execution connection.

If implementation chooses to write `agentControllerConversationId` back to Core
before the first Wake, review must explicitly confirm that the write uses the
Binding command boundary and preserves the "different Agent Profiles must not
share one controller conversation" invariant.
