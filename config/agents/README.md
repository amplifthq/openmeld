# OpenMeld Agent Registry (SSOT)

This folder is the single source of truth for agent-related configuration used by Skills and Runtime execution planning.

## Scope

The registry is designed to unify:

- local agent detection
- skills installability
- runtime support and adapter mapping

The current baseline is `schemaVersion: 1.0.0` for the expanded SSOT dataset.

Versioning notes:

- Keep `schemaVersion: 1.0.0` as the working baseline while the project remains in internal-only development.
- Record all subsequent schema-compatible or schema-contract changes as `1.0.1+` increments.

## Core principles

1. One canonical agent record defines all relevant capabilities.
2. Runtime support is the final authority for execution.
3. Stable states must come from `detection`, `service`, and `runtime` fields for new logic.
4. Repeated capability checks must read this file only.

## Agent entry schema summary

- `id`: canonical identifier, used by runtime and profile binding.
- `aliases`: optional alternate identifiers.
- `displayName`: human readable name.
- `category`: `builtin` or `custom`.
- `detection`: machine availability checks.
- `skillsDir`: relative skills folder pattern under each agent workspace.
- `globalSkillsDir`: resolved global skills directory pattern (if available). This can be a single template or an ordered list of candidate templates; consumers should pick the first existing path.
- `service`:
  - `skillsInstallable`: whether local skills folders can be scanned/installed.
- `runtime`:
  - `supported`: final Agent Controller runtime support flag.
  - `adapters`: list of adapter capabilities.
  - each adapter includes `adapterId`, `controllerRefMatcher`, `transportModes`, and `capabilityDeclaration`.
  - `capabilityDeclaration` is the static shared-runtime vocabulary snapshot for that adapter integration. Keep only stable integration facts here, never dynamic local runtime state.
- `lifecycle`:
  - `status`: product availability policy for new local-agent selection.
  - `active`: the local agent may appear in new setup, enable, and Agent Profile creation choices when runtime/detection facts allow it.
  - `suspended`: hide or reject new setup, enable, and Agent Profile creation choices while preserving best-effort runtime support for existing configured users and existing Agent Profiles.
  - omitted lifecycle status defaults to `active`; supported built-ins should still declare it explicitly so product policy is visible in the registry.
- `originLaunch`:
	  - optional official CLI command template for reopening the Agent Controller conversation.
	  - supported placeholders:
	    - `{agentControllerConversationId}`
	    - `{workingDirectory}`
	  - examples:
	    - `codex resume {agentControllerConversationId}`
	    - `cd {workingDirectory} && claude --resume {agentControllerConversationId}`
	    - `openclaw tui --session {agentControllerConversationId}`
- `transportModes` / `defaultTransportMode`:
  - optional top-level mirror fields.
  - must only exist when `runtime.supported=true`.
  - values must be derived from adapter `transportModes` (no extra mode outside adapters).
- `capabilityDeclaration`:
  - `streamingCapability`: whether the adapter is preview-capable or final-only.
  - `runtimeWorkingDirectoryMode`: how the current adapter receives its runtime working directory today.
  - `preparationRequirement`: whether the runtime requires an explicit preparation boundary.
  - `continuationCapability`: whether continuation follows the standard shared path or a provider-specific path.
  - registry owns this declaration because it is static integration metadata. Do not store local device state, bootstrap state, or workspace paths here.

## Detection and variable handling

- Detection paths are defined as `pathExists` checks.
- Placeholders in values (for example `${HOME}`, `${HOME}/.config/...`, `${CODEX_HOME}`, `${CLAUDE_CONFIG_DIR}`, `${XDG_CONFIG_HOME}`, `${CWD}`) are part of the configuration contract and must be expanded by the resolver used by consuming code.
- When multiple `checks` exist, `detection.mode` controls evaluation strategy:
  - `any`: at least one check passes.
  - `all`: all checks must pass.

## Computed state model (for implementation)

- `Detected`: result of `detection`.
- `RuntimeSupported`: `runtime.supported` and adapter/controller matching.
- `Runnable` (future stable target): `Detected && RuntimeSupported && Enabled && Bound`.
- `StableSource`: long-term derivations should always use `detection`, `service`, and `runtime`.

## Files

- `registry.json`: concrete agent data.
- `registry.schema.json`: JSON Schema for validation.
- `registry.json` is source; other files in this folder should be treated as documentation.

## How To Add A New Model (Quick Routing)

If you are adding a new provider/model support, use this reading order:

1. `runtime/README.md`
   End-to-end adapter implementation guide (from package creation to Space gate validation).
2. `config/agents/README.md` (this file)
   Registry field semantics and validation constraints.

Important:

1. `registry.json` is still the single business source of truth.
2. Adapter runtime logic must stay in `runtime/adapters/<provider>`.
3. Daemon local wiring must go through installer modules:
   `clients/openmeld-cli/src/daemon/adapters/installers/`.
4. Do not put provider private transport logic into daemon modules.
