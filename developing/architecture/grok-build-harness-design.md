# Grok Build Local Agent Harness Design

## Agent Context

- Purpose: Keep the in-progress implementation contract for adding Grok Build
  as a first-class local Agent Controller while deepening the shared ACP seam.
- Read this when: Implementing or reviewing the Grok Build harness integration.
- Update this when: A verified Grok wire behavior or an implementation decision
  changes the integration contract below.
- Do not use this for: Stable product or architecture truth after the feature
  ships, raw wire captures, credentials, or general ACP documentation.
- Source of truth: This file owns only the in-progress Grok Build implementation
  design. Existing owner documents remain authoritative for product and runtime
  invariants.

Status: IN PROGRESS. Remove when Grok Build support ships; move stable decisions
into the existing scoped owner documents in the same PR.

## Base And Evidence

- Base: `origin/main` at
  `0f83428dd7044e8b0babb42dc555b6932117f45e`.
- Installed validation target: official macOS arm64 Grok Build 1.0.3.
- Vendor source baseline:
  `xai-org/grok-build@e5fd4816d43260c15ba785f103990c1ed6cea230`.
- Protocol baseline: Agent Client Protocol V1.
- Local raw investigation remains ignored under `dev-tmp/` and must not become
  a tracked dependency.

The implementation must use captured vendor behavior or vendor-owned types for
fixtures. Hand-written responses shaped after the implementation are not
acceptable evidence.

## Product Outcome

An owner can bind an Agent Profile to `builtin:grok-build`. OpenMeld detects and
verifies the user's installed `grok` binary, proves non-interactive cached
authentication, reports the controller's live capabilities and models, and
executes or resumes the profile's private Grok session through ACP. The same
Wake produces exactly one reply, explicit stopped outcome, or explicit failure.

Grok Build does not create a second readiness authority, execution authority,
permission model, session store, or finalization path.

## External Adapter Seam

Callers continue to use the existing `RuntimeAdapter` interface. The Grok
adapter must hide all vendor-specific details behind that interface:

- binary and launch-contract verification;
- ACP initialization and authentication;
- session new/resume/list/close;
- model and reasoning validation;
- permission, question, and plan interactions;
- stream and tool lifecycle normalization;
- provider failure classification;
- cancel, close, and process-tree cleanup.

No Service, dispatch, readiness, Web, or CLI caller may branch on Grok wire
events or Grok process details.

## Shared ACP Module

Cursor and Grok are the two concrete adapters that prove a real ACP seam.
Extract only protocol mechanics that both adapters need:

- JSON-RPC framing, pending request ownership, and stderr isolation;
- initialize/authenticate request sequencing;
- session lifecycle primitives;
- notification and reverse-request dispatch;
- active-turn registration;
- bounded protocol admission deadlines without a total execution deadline;
- cancellation, session close, stdin close, and process-tree cleanup;
- shared lifecycle/process telemetry.

Keep these details in each vendor adapter:

- launch arguments and authentication interpretation;
- advertised capability interpretation;
- model, reasoning, and mode inventory rules;
- permission-mode mapping;
- extension method names and payloads;
- tool/update presentation rules;
- error classification and repair guidance.

The shared ACP interface must stay smaller than either vendor implementation.
It must not expose raw Grok or Cursor message shapes to callers. A vendor
adapter may register narrow handlers for its extensions; it may not modify a
global switch statement in Service or dispatch code.

## Locked Grok Runtime Decisions

1. Production transport is ACP-first. Headless JSON is diagnostic and fixture
   infrastructure only; an ACP failure never replays the Wake through Headless.
2. Process working directory and `session/new.cwd` are the same canonical,
   prevalidated directory. OpenMeld fails before launch when the directory does
   not exist or is not a directory.
3. `initialize` is an execution probe with local Grok-home side effects, not a
   zero-write readiness probe. Version detection stays separate.
4. OpenMeld selects only models and reasoning efforts present in the complete
   live inventory for the current authenticated Grok account. Invalid values
   fail before prompt execution; Grok's permissive mode/effort handling is not
   validation.
5. Grok sessions use the canonical Agent Controller conversation ref with kind
   `session`. Reconnect prefers ACP `session/resume`; `session/load` is used
   only when replay is explicitly required by the client contract.
6. Grok permission names remain controller-native. ACP permission options are
   rendered from each live request. OpenMeld never fabricates an option,
   persists an `allow_always` response, or turns one-time approval into policy.
7. Both observed `_x.ai/*` extension methods and the pinned source's `x.ai/*`
   spelling are versioned Grok adapter inputs. Unknown blocking requests fail
   closed and remain diagnosable.
8. Native ACP image and audio are not advertised when initialization reports
   them unsupported. Local file-path attachment support remains a separately
   gated capability.
9. Hooks are supplemental observability only. Hook success, failure, or absence
   never decides Wake execution or final outcome.
10. Stop is not complete after `session/cancel`. The adapter must cancel,
    close the session, close/terminate the Grok process when necessary, and
    verify supervised Grok, shell, MCP, subagent, and background descendants
    are reaped before reporting controller cancellation.

## Shared-System Deepening

The integration should improve the fifth and later harness experience in these
specific places:

1. Add one shared ACP protocol module instead of copying Cursor's transport.
2. Keep built-in controller registration declarative: one controller
   definition supplies adapter identity, installer, launch verification,
   interface capabilities, and maintenance metadata.
3. Keep provider contract coverage exhaustive so adding a runtime-supported
   registry adapter without tests fails CI.
4. Reuse adapter-core process supervision for every spawned ACP process. ACP
   session cancellation supplements process supervision; it does not replace
   it.
5. Keep live ACI evidence capability-shaped. Future controllers may expose
   only a subset; absence must stay explicit instead of creating synthetic
   parity.

Do not combine unrelated registries merely to reduce file count. The runtime
registry, release model catalog, product display metadata, and installer
definitions have different owners and rollout risks. Unification is justified
only where it removes an actual duplicated decision.

## Negative Surface Checklist

The completed integration must not:

- mark an Agent Profile Available from Grok detection, auth, or ACP initialize;
- mutate an already accepted Wake when Binding settings change;
- reuse one Grok session across different Agent Profiles;
- start a prompt before exact model/reasoning validation finishes;
- silently fall back to another model, effort, mode, transport, or working
  directory;
- open a login browser from the unattended Service;
- copy or print Grok credentials;
- replace user Grok rules, skills, MCP servers, hooks, or trust policy;
- claim macOS Grok sandbox blocks child network access;
- treat Plan as a filesystem security boundary;
- use hook output as Agent Activity or execution truth;
- publish success while a supervised background descendant remains alive;
- retry a potentially accepted prompt on an admission timeout;
- add Grok-specific branches to RuntimeCoordinator, Space publication, or
  Core readiness;
- ship an ACP-to-Headless automatic fallback.

## Verification Gates

### Shared contract tests

- existing provider contract suite includes Grok;
- Cursor behavior remains unchanged after ACP extraction;
- registry coverage fails when any supported adapter lacks shared tests;
- conversation refs reject cross-controller or cross-kind reuse;
- model/reasoning selection rejects incomplete or conflicting inventory;
- unknown blocking reverse requests fail closed;
- malformed/unknown optional notifications do not corrupt the transport.

### Grok fixture tests

- captured initialize/auth/model/session/update/error shapes parse;
- stdout remains JSON-RPC-only and stderr remains diagnostic-only;
- permission, question, plan approval, plan feedback, and cancellation round
  trip through the shared Agent Interaction contract;
- cancel while streaming, running a foreground tool, waiting for interaction,
  running a subagent, and running a background task settles correctly;
- close and process exit reap Grok, shell, MCP, subagent, and background
  processes;
- invalid cwd, model, effort, session, auth, and non-zero exits preserve stable
  error codes and bounded diagnostics.

### Repository and release gates

- focused adapter, Service, CLI, schema, and agent-runtime tests;
- `pnpm run check:affected` and `pnpm run test:affected`;
- Contract Impact Audit for CLI, Service, schemas, and local component rollout;
- `pnpm run verify:release-ready` after the final source state is stamped by the
  supported release command;
- a real-user smoke through an isolated OpenMeld lane and the installed Grok
  CLI, followed by trace evidence for one Wake and one Stop.

## Implementation Order

1. Capture/redact stable ACP fixtures and add failing shared-contract tests.
2. Extract the shared ACP protocol/process module while keeping Cursor green.
3. Add the Grok adapter package and its fixture-driven transport tests.
4. Register Grok across schemas, conversation capability, brand, permission
   policy, model catalog, runtime registry, installer, and ACI inventory.
5. Add user-operable CLI setup/repair guidance and managed skill documentation.
6. Validate model/reasoning, interactions, stop, cleanup, and recovery through
   the adapter interface.
7. Complete owner-document updates, Contract Impact Audit, release stamping,
   and real-user smoke.
8. Remove this design document after its stable rules are incorporated into the
   existing owner documents.
