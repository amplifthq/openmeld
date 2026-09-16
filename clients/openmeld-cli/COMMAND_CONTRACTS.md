# OpenMeld CLI Command Contracts

This document defines the Golden Path for command-facing OpenMeld CLI changes.

## Goal

Every OpenMeld CLI command should have one source of truth for its command-facing contract:

- selector semantics
- required arguments
- optional arguments
- example commands
- validation error messages
- agent overview payloads
- dual-view guide commands and hints

Business logic stays in the existing command handlers. Command contracts only describe the public command surface.

## Core Rule

If the same command fact appears in more than one place, it must come from a shared contract.

Typical drift points:

- Commander option registration in `src/openmeld.ts`
- runtime validation inside `src/commands/*`
- agent overview payloads
- dual-view guide catalog entries
- command-specific hints

## Architecture

### Global identity

- Use existing `CommandEntryName` values as the stable key.
- Do not create a second naming layer for the same command.

### Thin registry

- Put entry-level contracts in `src/command-contracts/registry.ts`.
- Keep the registry thin: identity, overview metadata, guide scenarios, and hint builders.
- Per-entry summaries, stages, and notes can stay entry-specific.

### Family-local pattern contracts

When multiple sibling commands share the same selector or argument pattern, create a family-local contract next to that command family.

Current examples:

- `src/agents/builtin-selection-contract.ts`
- `src/skills/target-selection-contract.ts`
- `src/auth/login-request-contract.ts`
- `src/command-contracts/service-control-target.ts`
- `src/space/member-selection-contract.ts`

These helpers should own:

- option registration helpers
- selector validation helpers
- required and optional argument copy
- example command generation
- command-specific hint generation

## What To Reuse

Always extract and reuse:

- mutually exclusive selectors
- dependent argument rules
- required and optional argument text
- example commands
- validation error messages
- agent overview commands
- dual-view guide `agentRequiredArgs`
- dual-view guide `agentOptionalArgs`
- dual-view guide `agentCommands`
- command-specific hint lists

Do not force global reuse for:

- business logic
- command-specific execution steps
- domain-specific success payloads
- domain-specific recovery notes that are not part of the shared parameter surface

## Required Wiring For Migrated Commands

For any migrated command family:

1. `src/openmeld.ts` uses the contract helper for shared option registration.
2. Runtime validation calls the same contract helper.
3. Agent overview data comes from the same contract or pattern.
4. Dual-view guide data comes from the same contract or pattern.
5. Command-specific hints come from the contract registry, not from message-string matching.

## Hints Rule

- `resolveCommonHintByMessage()` is only for true global fallbacks.
- Do not add command-specific `message.includes(...)` branches for migrated commands.
- Command-specific hints belong in the command contract registry.

## Testing Checklist

Every migrated command family must have:

- parity tests for required arguments, optional arguments, and example commands
- validation tests for missing, conflict, and dependency cases
- overview tests proving overview is emitted before failure payloads
- dual-view guide tests proving guide output matches the contract

Recommended extra gate:

- one registry meta-test that checks migrated entry contracts resolve correctly

## Current Migrated Families

- builtin agents selection: `agents enable`, `agents repair`, `agents disable`
- skills target selection: `skills install`, `skills uninstall`
- auth login request contract: `auth login`
- daemon control target selection: `service interrupt`, `service cancel`
- space member selection: `space add-agents`, `space add-human-profiles`, `space add-members`, `space remove-members`
- registry-backed static overview entries: `root`, `view`, `doctor`, `whoami`, `upgrade`, `repair local-state`, `uninstall`, `reset`, `auth menu/status/logout`, `service menu/run/status/snapshot/install/reinstall/uninstall/stop`

## Golden Path For New Commands

1. Add or reuse the correct `CommandEntryName`.
2. Decide whether the command needs a family-local pattern contract.
3. If the argument surface is non-trivial, extract the pattern first.
4. Wire `openmeld.ts`, runtime validation, overview, guide, and hints to that contract.
5. Add parity and behavior tests before merging.

Done means the migrated command no longer has duplicated selector, argument, or example-command facts outside the contract layer.

## Machine-readable output (`--json`)

The contract a non-interactive driver (Desktop GUI, scripts, CI) reads. Opt-in via
`--json`; without it the command keeps its normal human/agent output unchanged.

### Source of truth

The `--json` envelope is a shared CLI JSON boundary, so its contract lives in
`packages/schemas` — `cliJsonOutputEnvelopeSchema` in
`packages/schemas/src/schemas/cli/json-output.ts` — NOT hand-written in the CLI.
That schema owns the version literal, the closed `type` discriminant set, the
failure-envelope shape, and the entry-check blocked-code enum. The CLI derives
its envelope type from it via `z.infer` and emits through one chokepoint,
`src/runtime/cli-json-output.ts#emitCliJsonEnvelope`, which validates against the
schema (fail-open) and then writes the original object bytes. Do not add a
hand-written envelope shape or a raw `outJsonLine({ schemaVersion, ... })` call
that can drift from the schema.

### Success envelope

Every `--json` success prints exactly one line of JSON to stdout (via
`emitCliJsonEnvelope`):

```json
{ "schemaVersion": 1, "type": "<namespace>.<command>", "...result": "flattened" }
```

- `type` namespaces: `daemon.*` (local service), `agents.*` (agents).
- Result fields are flattened onto the envelope — NOT nested under a `payload` key. The
  `payload`-wrapped `{ "type": "result", "code": ... }` lines are the separate `--view agent`
  presenter stream; a `--json` driver should parse the single envelope, not that stream.
- The schema validates the envelope frame (`schemaVersion` + `type`) and the
  per-type literal fields it pins; the rest of the flattened result is a
  deliberately relaxed boundary because its deep shape stays owned by the
  daemon / agents runtime contracts (re-deriving it here would create a second
  source of truth).

### Failure envelope

When a command throws while `--json` is set, the top-level boundary prints one error
envelope and sets exit code 1:

```json
{ "schemaVersion": 1, "type": "error", "error": { "code": "cli.error", "message": "...", "requestId": "..." } }
```

`requestId` appears only when the underlying error carries one. Shape owned by
`cliJsonErrorEnvelopeSchema` (`packages/schemas`); built in
`src/runtime/cli-error-json.ts` (which derives its type from the schema) and
emitted from `main()`'s catch.

### Blocked entry checks

Before a command body runs, the entry-check flow
(`src/command-entry-checks/run-command-entry-flow.ts`) can block on sign-in,
profile, or local-state problems. Under `--json` the flow runs with a silent
presenter so advisory check output never reaches stdout, and a blocking check
prints exactly one canonical error envelope (then exit code 1) instead of the
presenter payload. The human/agent (non-`--json`) paths are unchanged. The
closed set of blocked codes is owned by `cliJsonEntryCheckBlockedErrorCodeSchema`
(`packages/schemas`); the CLI's blocked-state → code mapping lives in
`src/command-entry-checks/entry-check-blocked-json.ts` (bound to that enum via
`satisfies`):

| Blocked entry check | Error `code` |
| --- | --- |
| sign-in required | `auth.authentication_required` |
| profile required | `profile.required` |
| local state repair required | `local_state.repair_required` |
| CLI update required | `upgrade.required` |

The CLI-update check turns into a hard block only when the running version is
below the published required-update floor — `openmeld.minRequiredCliVersion` on the
npm `latest` manifest, which is the release-time projection of
`release/local-components.json`'s `cli.updatePolicy`. The floor must be a plain
published release version (`X.Y.Z`, no prerelease or build metadata); a
non-plain or malformed floor is treated as no signal (fails open) and rejected
by release `verify`. When the floor is breached
the check blocks every non-exempt command (`upgrade.required` + exit 1), under
`--json` as a canonical envelope, under human view as an upgrade-or-cancel card
(declining or aborting a required update exits non-zero, never a silent exit 0).
Otherwise an available-but-optional update never blocks and stays silent under
`--json`. The check fails open: any failure to resolve the floor (offline,
registry error, malformed floor, dev lane) lets the command run. The floor is
resolved cache-first (24h) so `--json` commands do not pay a network probe each
invocation. Exempt from the block:

- self-rescue commands that never carry the check at all (`upgrade`, `auth.*`,
  `reset`, `uninstall`, `repair.local-state`);
- `openmeld --version` (handled by the argument parser before entry checks);
- the local OpenMeld Service lifecycle/liveness surface, which skips the check
  entirely (no block, no prompt, no network): `service run` (blocking the
  daemon's own entry would crash-loop it under launchd/systemd), and the
  `service status` / `service snapshot` liveness probes the GUI reads
  unauthenticated;
- `openmeld doctor`, which skips the entry-gate and instead reports the pending
  required update as its own top check.

Service compatibility is enforced by the Service Wake gate, not by killing
these commands. Source: `src/command-entry-checks/cli-update-assessment.ts`
(single floor resolver, shared with `doctor`) and
`src/command-entry-checks/check-cli-update.ts`.

> Note: shipping a required floor is breaking for older `--json` automation —
> below-floor invocations begin returning the `upgrade.required` envelope and
> exit 1. The Desktop GUI needs no change (its `cli_error` mapping already
> renders a typed "please upgrade" problem). The
> `OPENMELD_INTERNAL_SKIP_STARTUP_UPGRADE=1` escape hatch still bypasses the check
> (it is how the post-upgrade rerun avoids re-triggering itself); it is internal
> and only affects the local caller — the cloud-side Service Wake gate remains
> the authoritative backstop for compatibility.

### Covered commands

| Command | `type` |
| --- | --- |
| `service status` | `daemon.status` |
| `service control-capabilities --json` | `service.control_capabilities` |
| `service start` | `daemon.run` |
| `service install` | `daemon.install` |
| `service uninstall` | `daemon.uninstall` |
| `service stop` | `daemon.stop` |
| `service repair` / `service update` | `daemon.reinstall` |
| `agents detect` | `agents.detect` |
| `agents list` | `agents.list` |
| `agents show` | `agents.show` |
| `agents enable` | `agents.enable` |
| `agents disable` | `agents.disable` |

### Rules for adding `--json` to a command

1. Compute the structured result, then branch on `--json` BEFORE any human/agent rendering
   and early-return — mirror `runDaemonStatus`.
2. Emit `emitCliJsonEnvelope({ schemaVersion: 1, type: "<ns>.<cmd>", ...result })`. One line,
   nothing else on stdout. A NEW `type` must first be added to the discriminated union in
   `packages/schemas/src/schemas/cli/json-output.ts` — `emitCliJsonEnvelope` only accepts the
   shared envelope type, so an unregistered `type` fails to compile.
3. If the command renders progress or prompts before its result, suppress them in `--json`
   (force the interactive gate off and/or use a silent presenter — see `service stop`,
   `agents enable`) so stdout stays a single clean line.
4. `--json` changes output only, never behavior. Non-interactive confirmation (e.g.
   `service uninstall`) follows from the silent/agent path, not a new prompt.
5. Add a `parseJsonEnvelope`-style integration test asserting `schemaVersion`, `type`, and the
   key result fields — that test is the contract's regression lock. Cover the new envelope's
   success/failure/boundary cases in the schema parity test
   (`packages/schemas/tests/cli/json-output.test.ts`).
