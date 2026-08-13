# Runtime Layer

The runtime layer executes mention dispatch tasks from daemon through adapters.

## Four-Layer Model

This is the current extension model for adding new runnable providers.

1. `Driver` (`runtime/adapters/core/src/drivers`)
Transport mechanics only (CLI process, HTTP responses contract).

2. `Adapter` (`runtime/adapters/<provider>/src`)
Provider semantics only (args, parser, context-heal, error mapping).

3. `Installer` (`runtime/local-service/src/adapters/installers`)
Local Service adapter assembly only.

4. `Registry` (`config/agents/registry.json`)
Business source of truth for runtime support, controller matching, and static execution target declaration.

## Builtin Local Agent Golden Path

Builtin local CLI agents now follow one shared machine-launch contract.

This is the single source of truth for:

1. whether OpenMeld can start a builtin agent on this device
2. how OpenMeld starts that agent on this device
3. when OpenMeld should show `ready`, `needs repair`, or `not available`

Current builtin local agents on this path:

1. `codex`
2. `claude-code`
3. `openclaw`
4. `grok-build`

### Golden Path Rules

For builtin local CLI agents:

1. `detected` is not the same as `runnable`
2. normal user flows may only enable/select agents with a verified launch contract
3. runtime dispatch must use the persisted launch contract only
4. do not guess `PATH` during verification or dispatch
5. do not silently fall back to the current shell or current Node version
6. if a stored launch contract breaks later, keep the controller enabled but mark it `needs repair`
7. `openmeld agents detect` is read-only; `openmeld agents repair` is the write path that refreshes the machine launch contract

### Launch Contract Single Source of Truth

Shared schema:

1. `packages/schemas/src/schemas/daemon/controller-contract.ts`

Persisted device state:

1. `launchContract` on `RuntimeAgentControllerState`

Shared execution helpers:

1. `runtime/adapters/core/src/launch-contract.ts`

CLI builtin resolver/repair entry:

1. `clients/openmeld-cli/src/agents/launch-contract.ts`

The launch contract shape is:

```ts
type RuntimeAgentControllerLaunchContract =
  | {
      kind: "executable";
      commandPath: string;
      argsPrefix?: string[];
    }
  | {
      kind: "node_script";
      nodePath: string;
      scriptPath: string;
      argsPrefix?: string[];
    };
```

Use:

1. `node_script` for CLIs installed as `#!/usr/bin/env node`
2. `executable` for real standalone binaries

Today, the builtin golden path for `codex`, `claude-code`, and `openclaw` uses
`node_script`. The official Grok Build install is a native binary and uses
`executable`; install discovery still handles an official launcher safely when
the vendor changes packaging.

### Builtin Launch Lifecycle

Every builtin local CLI agent follows the same lifecycle:

1. detect: OpenMeld decides whether the agent is installed on this device
2. resolve: the adapter resolves an installed launch contract
3. verify: OpenMeld verifies the launch contract without PATH guessing
4. persist: OpenMeld stores the verified launch contract on the controller state
5. dispatch: runtime adapters launch from the persisted contract only
6. repair: OpenMeld refreshes the launch contract when it becomes invalid

User-facing launch status is derived, not stored:

1. `ready`
2. `needs_repair`
3. `not_available`

Readiness/system reason for a broken machine launch contract:

1. `controller.launch.needs_repair`

### What Goes In The Adapter vs Shared Core

Shared core owns:

1. launch contract schema
2. launch-command materialization
3. launch-contract file verification
4. probe execution for contract verification
5. CLI/daemon/runtime reuse of the same persisted launch contract

Each builtin adapter owns:

1. `resolveInstalledLaunchContract()`
2. `verifyLaunchContract()`
3. provider-specific probe args
4. provider-specific install inspection details
5. provider-specific dispatch args, output parsing, context-heal, and error mapping

This split is the template for future builtin agents:

1. shared launch framework stays universal
2. install discovery stays provider-specific
3. provider runtime behavior stays provider-specific

### Repair Semantics

`openmeld agents repair --agent <id...>` must:

1. resolve a fresh launch contract from the current machine state
2. verify that contract before persisting it
3. write it back into device runtime state only after verification succeeds

Repair must not:

1. silently disable the controller
2. discard a valid stored launch contract during disable flows
3. treat a PATH lookup at dispatch time as a successful repair

If repair cannot resolve one safe launch contract, OpenMeld should surface
`needs repair` with a specific human-readable reason.

## What Is Universal vs Provider-Specific

Universal:

1. Dispatch/cancel/interrupt contracts in `@openmeld/adapter-core`.
2. Driver contracts (`cli-driver`, `http-responses-driver-contract`).
3. Daemon dispatch routing, queue/backpressure, and result framing.

Provider-specific:

1. CLI args and output parsing.
2. Context lost detection/rebuild heuristics.
3. Provider error normalization details.

## Current Status

Codex, Claude Code, and OpenClaw run on the universal CLI driver path. Cursor
and Grok Build use ACP transports while preserving the same `RuntimeAdapter`,
launch-contract, cancellation, telemetry, and supervised-process boundaries.

Cursor and Grok Build share `AcpProcessSession` for JSON-RPC/session/process
mechanics. Vendor launch arguments, authentication, models, modes, extensions,
and errors stay inside their adapter packages; adding another ACP controller
must not add vendor switches to Local Service or RuntimeCoordinator.

What this means:

1. Daemon no longer embeds Codex invoke/context-heal logic.
2. Adapter returns context metadata through a generic `contextDelta` field.
3. Daemon persists context generically without provider-specific side maps.
4. Claude authentication failures are surfaced as provider-original messages.

Still intentionally explicit in this phase:

1. Installer list is static (`list-installers.ts`), not registry dynamic loading.
2. This is deliberate for stability before the next-phase dynamic loader work.

## New Model Support Guide (Beginner Friendly)

Use `new-agent` as the example.

### Step 0: Pick Primary Transport

Pick transport before coding:

1. `local-cli` for CLI session-resume style.

### Step 1: Create Adapter Package

Create:

```text
runtime/adapters/new-agent/
  package.json
  tsconfig.json
  tsconfig.build.json
  src/
    index.ts
    transport/
    config/
    context/
    output/
  test/
```

### Step 2: Implement Builtin Launch Contract Hooks

For builtin local CLI agents, the adapter must expose:

1. `resolveInstalledLaunchContract()`
2. `verifyLaunchContract()`

Required rule:

1. runtime dispatch must fail fast when `launchContract` is missing

Use shared helpers from `@openmeld/adapter-core`:

1. `resolveInstalledNodeScriptLaunchContract(...)` for Node-backed CLIs
2. `buildExecutableLaunchContract(...)` for standalone binaries
3. `verifyCliLaunchContract(...)` to verify the pinned machine launch command
4. `buildCliLaunchInvocation(...)` to materialize actual runtime CLI args

Example decision rule:

1. if the installed command is a Node script, persist `nodePath + scriptPath`
2. if the installed command is a real binary, persist `commandPath`

Do not ship a builtin adapter that only answers "detected" without also
answering "how OpenMeld starts it on this device".

### Step 3: Reuse Core Driver Contracts

From `@openmeld/adapter-core`:

1. For CLI-backed providers, use `runCliDriver`.
2. For HTTP-backed providers, implement the contract from
   `http-responses-driver-contract` (actual implementation can stay provider-side
   until global HTTP driver is introduced).

### Step 4: Implement Adapter Contract

In `src/index.ts` expose:

1. `adapterId` (stable, lowercase, unique).
2. `dispatch` (required).
3. `interrupt` and `cancel` (recommended; explicit unsupported semantics if not supported).

Dispatch success should return:

1. `output`
2. optional `contextDelta` when provider exposes new/updated context id.

### Step 5: Wire Builtin Launch Resolution Into CLI

If the agent is a builtin local CLI agent, register its resolver in:

1. `clients/openmeld-cli/src/agents/launch-contract.ts`

This is what makes the agent participate in:

1. `openmeld agents detect`
2. `openmeld agents enable`
3. `openmeld agents repair`
4. `openmeld agents manage`
5. first-machine `openmeld start` local-agent setup
6. `openmeld setup`
7. join/bootstrap/system guidance

### Step 6: Add Local Service Adapter Installer

Add one installer file:

1. `runtime/local-service/src/adapters/installers/install-new-agent.ts`

Register it in:

1. `runtime/local-service/src/adapters/installers/list-installers.ts`

Do not add provider logic to Local Service.

### Step 7: Add Registry Runtime Mapping

Update `config/agents/registry.json`:

1. set `runtime.supported=true` for the provider.
2. add `runtime.adapters[]` with `adapterId`, matcher, `transportModes`, and `capabilityDeclaration`.
3. set `defaultTransportMode` and optional `defaultStreamingMode`.

### Step 8: Run Tests and Gates

From repo root:

```bash
pnpm check
pnpm build
pnpm turbo run test --filter=@openmeld/adapter-core
pnpm turbo run test --filter=@openmeld/adapter-claude-code
pnpm turbo run test --filter=@openmeld/adapter-codex
pnpm turbo run test --filter=@openmeld/adapter-openclaw
pnpm turbo run test --filter=@openmeld/local-execution
pnpm turbo run test:local-service --filter=openmeld
```

Builtin-launch-contract tests must also cover:

1. installed contract resolution
2. persisted contract verification
3. broken launch contract -> `needs repair`
4. runtime dispatch from persisted contract only
5. no PATH guessing during verification or dispatch

### Step 9: Real Space Validation

Required:

1. plain message path.
2. mention auto reply.
3. second mention context continuity.

Template:

```bash
openmeld-dev --view human space send <SPACE_ID> "gate plain" --profile <HUMAN_PROFILE_ID>
openmeld-dev --view human space send <SPACE_ID> "@<AGENT_ALIAS> gate mention 1" --profile <CEO_PROFILE_ID>
openmeld-dev --view human space send <SPACE_ID> "@<AGENT_ALIAS> gate mention 2" --profile <HUMAN_PROFILE_ID>
openmeld-dev --view human space history <SPACE_ID> --limit 50 --json --profile <CEO_PROFILE_ID>
```

## Common Pitfalls

1. Adapter exists but installer was not added to `list-installers.ts`.
2. Registry matcher does not match `agentControllerRef` from profile binding.
3. Builtin agent was marked detected, but no verified launch contract was implemented.
4. Dispatch still shells out to bare `codex` / `claude` / `openclaw` instead of the persisted launch contract.
5. Repair rewrites state before verification succeeds.
6. Adapter returns success but misses context metadata; second mention continuity breaks.
7. Only one mention was validated; continuity regressions are missed.

## Related Docs

1. `config/agents/README.md`
2. `dev-tmp/archive/scope-daemon-service-adapters/daemon-adapter-universal-ssot-plan.zh-CN.md`
