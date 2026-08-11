# Cursor ACP Phase-1 Integration Decision

## Agent Context

- Purpose: Record the approved Cursor local-controller design, the evidence
  behind it, the Phase-1 capability boundary, and the rollout contract.
- Read this when: Changing Cursor detection, setup, Binding, permission modes,
  model selection, ACP transport, session continuation, cancellation, or
  diagnostics.
- Update this when: Cursor changes its ACP protocol, mode names, model option
  shape, authentication behavior, installation contract, or interaction
  methods.
- Do not use this for: Cursor IDE automation, Cursor Cloud Agents, Cursor Agent
  Activity ingestion, or a Cursor-only approval system.
- Source of truth: Product and architecture owner documents own durable
  OpenMeld behavior. This file records the dated vendor evidence and the
  implementation decision that informed those contracts.

Date: 2026-07-18

Status: APPROVED PHASE-1 IMPLEMENTATION DECISION. Remove this file when a newer
Cursor compatibility review supersedes this dated vendor evidence and the
durable contract remains captured in the owner documents.

This decision supersedes the earlier broad comparison of print-mode CLI, ACP,
SDK, IDE, and Cloud Agent surfaces, which is retained in git history. The
authenticated evidence pass closed the open questions differently: OpenMeld
ships Cursor through ACP only.

## Bottom Line

OpenMeld supports Cursor as a local Agent Controller by launching:

```text
cursor-agent acp
```

and speaking the official Agent Client Protocol over newline-delimited JSON-RPC
on standard input and output.

There is no second Cursor `-p --output-format stream-json` adapter. The
`cursor-agent` executable is still the required local installation, but its ACP
interface is the only Wake transport. This gives OpenMeld structured sessions,
model selection, tool events, cancellation, permission requests, and Cursor's
question and plan methods without creating two continuation stores or two
failure models for one provider.

Phase 1 deliberately stops before interactive user handling. If Cursor asks for
a permission, question, or plan approval that the selected native mode did not
resolve, OpenMeld sends a protocol-valid rejection or skip and fails the Wake
explicitly. A later project will add one shared interaction contract for
Cursor, Codex, Claude Code, and OpenCode rather than adding Cursor-only Core
state or UI.

## Evidence That Changed the Original Recommendation

The original independent report and the supplied external report agreed that
Cursor's headless CLI was feasible. They disagreed mainly on how much of the
live protocol could be reused and whether ACP should be deferred.

Authenticated inspection of `cursor-agent acp` established:

- protocol version 1 works over stdio and authenticates with `cursor_login`;
- `session/new`, `session/load`, `session/prompt`, `session/set_mode`,
  `session/set_model`, and `session/cancel` provide the Phase-1 lifecycle;
- session descriptors return account-scoped model and mode options;
- blocking permission, question, and plan requests have structured response
  contracts, so OpenMeld can fail closed without hanging even before it has a
  human interaction surface;
- the ACP session store is distinct from print-mode CLI and IDE chat stores.

Those facts remove the main reason to start with print mode. ACP requires a
focused JSON-RPC client inside the Cursor adapter, but it does not require a new
Core approval model for Phase 1. The current shared adapter boundary already
supports an in-process transport with session identity, progress events,
tool-activity events, cancellation, and one final result.

## Runtime Contract

### Launch and authentication

OpenMeld resolves and invokes `cursor-agent`, never the generic `agent`
command. This matters because other products can own an `agent` executable on
the same computer.

Detection checks:

1. `cursor-agent` on `PATH`;
2. `~/.local/bin/cursor-agent`;
3. `~/.cursor/bin/cursor-agent`.

The existence of `~/.cursor` is not executable evidence because Cursor IDE can
be installed and signed in while Cursor CLI is absent or signed out.

Setup uses Cursor's official installer and asks the user to run:

```text
cursor-agent login
cursor-agent status
```

Cursor CLI sign-in is separate from Cursor IDE sign-in. Runtime inventory uses
`cursor-agent --version` and `cursor-agent status`; it does not infer
authentication from IDE files.

### Session lifecycle

For a new Agent Profile conversation:

```text
initialize
authenticate
session/new
session/set_mode        when the requested mode differs
session/set_model       when the requested model differs
session/prompt
```

For continuation, `session/load` replaces `session/new`. The ACP session ID is
stored through OpenMeld's existing `agentControllerConversationId` bridge. It
belongs to one Agent Profile and is not interchangeable with a Cursor IDE chat,
Space thread, Binding, or RuntimeCoordinator execution ID.

OpenMeld collects `session/update` agent message chunks for the final answer and
maps ACP tool-call updates into the shared bounded tool-activity event shape.
Unknown future updates are ignored unless they invalidate a required terminal
contract.

Cancellation and interruption send `session/cancel` for the active session.
Process termination remains the cleanup fallback, not the primary cancellation
protocol.

### Failure behavior

The adapter:

- requires a successful `session/prompt` stop reason;
- retains bounded stderr and process lifecycle telemetry;
- distinguishes authentication, network, context, model, protocol, timeout,
  cancellation, and interaction-required failures;
- checks network evidence before classifying ambiguous "invalid API key" text,
  because Cursor can report connectivity failures as credential failures;
- performs one context-heal retry when a stored ACP session no longer exists;
- has no default fixed total execution timeout.

A test-only or explicitly configured timeout is allowed. Production execution
continues to follow RuntimeCoordinator's progress-staleness rules and must not
fail a healthy long-running Wake because a total wall-clock duration elapsed.

## Official Permission Modes

OpenMeld stores one controller-native Cursor preset on the Binding:

| OpenMeld label | Stored value | Native mapping | Phase-1 residual interaction |
| --- | --- | --- | --- |
| Default | `cursor:default` | ACP `agent` mode with Cursor's standard permissions | Reject once when offered; otherwise cancel and fail the Wake |
| Plan | `cursor:plan` | ACP `plan` mode: read-only planning and design | Reject once when offered; otherwise cancel and fail if Cursor still asks |
| Ask | `cursor:ask` | ACP `ask` mode: Q&A with no edits or command execution | Reject once when offered; otherwise cancel and fail if Cursor still asks |
| Auto-review (Smart Auto) | `cursor:autoReview` | `cursor-agent --auto-review acp` | Reject once when offered; otherwise cancel and fail if Smart Auto still asks |
| Run Everything | `cursor:force` | `cursor-agent --force acp` | Select only `allow_once` when offered |

Run Everything requires explicit confirmation. OpenMeld never chooses
`allow_always` or `reject_always`, and never writes a persistent Cursor
permission on the user's behalf. Explicit Cursor deny rules remain
authoritative.

Until the shared interaction project ships:

- `session/request_permission` receives `reject_once` when offered, otherwise
  it is cancelled; Run Everything selects only an offered one-time allow
  option;
- `cursor/ask_question` receives `skipped`;
- `cursor/create_plan` receives `rejected`;
- an unknown client request receives JSON-RPC `Method not found`;
- the Wake then fails with an explicit interaction-required reason.

ACI therefore reports `approvals: false` and `structuredInput: false` even
though the wire protocol can carry those requests. Reporting the future
capability before OpenMeld can involve a person would be a false product claim.

## Models and Reasoning

Cursor ACP model selection is not equivalent to the legacy
`cursor-agent models` output. ACP returns exact account-scoped option values
inside `session/new` or `session/load`. Parameterized values such as reasoning,
context, thinking, and fast mode are part of that exact model ID.

OpenMeld:

- records the authenticated ACP option snapshot in
  `release/vendor-models.json`;
- uses `default[]`, displayed as **Auto**, as Cursor's default exact ID;
- calls `session/set_model` only with an exact selected ID;
- validates the selected ID against the current session's available options;
- fails with `model.unavailable` when the current account does not offer it.

Cursor ACP does not expose reasoning strength as an independent session option.
Every Cursor catalog entry therefore has:

```json
{
  "supportedReasoningLevels": []
}
```

and the adapter rejects a separate Binding `reasoningLevel` as
`model.reasoning_unsupported`. This is intentional alignment with the native
contract, not a missing OpenMeld control. Users choose reasoning-bearing Cursor
variants through the exact model list when Cursor exposes them.

The repo catalog is a reviewed selection snapshot, not live entitlement truth.
The runtime session inventory remains the final local compatibility check.

## Product and Setup Language

The user-facing product name is **Cursor CLI** because `cursor-agent` is the
installed local controller. The transport description is **Agent Client
Protocol (ACP)**.

Setup copy must state:

- install Cursor CLI with Cursor's official installer;
- sign in with `cursor-agent login`;
- Cursor IDE sign-in does not sign in Cursor CLI;
- OpenMeld verifies `cursor-agent --version` and `cursor-agent status`;
- OpenMeld runs Cursor through ACP.

OpenMeld must not claim that a Wake appears in the Cursor IDE chat history or
that IDE sessions can be resumed through ACP. It can accurately claim that the
local Cursor agent uses the user's Cursor account, project rules, and supported
local configuration where Cursor itself shares those inputs.

## Phase-1 Boundary

Included:

- local detection, installation guidance, version and sign-in evidence;
- Binding and profile editing;
- ACP-only structured execution;
- new and resumed ACP sessions;
- native mode selection;
- exact model selection;
- output streaming and bounded tool activity;
- cancellation and interruption;
- explicit structured failure for unsupported interactions;
- Cursor brand and install-guide presentation.

Not included:

- permission, question, or plan UI;
- Core-owned interaction request state;
- persistent native approval decisions;
- Cursor IDE control or IDE/ACP chat synchronization;
- print-mode CLI transport;
- Cursor SDK or Cloud Agents;
- image input.

The subsequent product-surface parity pass added Cursor Agent Activity through
Cursor's official Hooks lifecycle. That observer is separate from the ACP
execution transport, remains metadata-only, and does not read transcripts or
claim visibility into a Cursor session without a confirmed Local Project
Connection.

The follow-up interaction project must extend shared Core and local contracts
for all relevant controllers. It must not preserve a Cursor-specific approval
authority merely because ACP exposed the first structured request.

## Architecture Acceptance

This integration does not change OpenMeld's execution authority:

- RuntimeCoordinator remains the in-flight Wake truth;
- the local OpenMeld Service remains the execution carrier and trust boundary;
- Cursor ACP events are progress and result evidence, not a second finalization
  owner;
- D1 remains a durable ledger and projection;
- Binding owns controller-native permission, model, and conversation intent;
- ACI owns local evidence only;
- shared cross-process values use `packages/schemas`;
- current readiness and one concrete Wake outcome remain separate.

The change adds an `acp` enum value and Cursor permission values to shared
readers. The dispatch and reporting payload shapes are unchanged, but their
closed transport and permission enums are expanded. RuntimeCoordinator tokens,
service handshake envelopes, Prepare Session payloads, local state versions,
and OpenMeld-managed skills are unchanged.

## Contract Impact Audit

Changed boundaries:

- shared runtime transport and native-interface enum readers accept `acp`;
- shared Binding readers accept five Cursor permission values;
- local registry, CLI ACI, and Service adapter inventory add Cursor;
- the model catalog adds Cursor exact model IDs;
- Core finalization and local execution ledgers accept ACP as transport
  evidence.

Mixed-version behavior:

- old local components do not advertise or select Cursor, so existing
  Claude Code, Codex, OpenCode, OpenClaw, setup, status, trace, and self-rescue
  flows are unchanged;
- new local components remain compatible with old cloud code while they run an
  existing controller because those existing enum values and envelope shapes
  are unchanged;
- Cursor must remain disabled in production until updated cloud readers are
  deployed, because old readers reject the new strict `acp` transport and
  Cursor permission enum values;
- no existing profile is rewritten and no compatibility fallback changes
  another controller's execution.

Release order:

1. deploy Web and Core readers containing the new shared values;
2. publish/stamp the CLI and OpenMeld Service local component;
3. enable production Cursor setup and Binding writes.

No execution-contract epoch or service handshake version bump is required
because the Wake, lifecycle, result, setup, status, trace, and self-rescue
envelopes are unchanged. The local component must still be stamped
`available`, and `verify:release-ready` must pass against the final publishing
commit on `main`. Repository release policy explicitly keeps the version bump
and manifest re-stamp out of this non-publishing feature branch.

## Validation Record

The implementation proves:

- adapter contract tests for new, resumed, mode-selected, model-selected, and
  cancelled sessions;
- protocol-valid fail-closed handling for permission, question, and plan
  requests;
- exact launch flags for Auto-review and Run Everything;
- rejection of independent reasoning strength;
- registry, installer, ACI, schema, model-catalog, brand, UI, and install-guide
  alignment;
- package and affected validation gates;
- React diff health after the install-guide and logo changes;
- an isolated localhost Wake through a real signed-in `cursor-agent acp`,
  including a visible reply and deterministic OpenMeld trace.

The real-user smoke ran on 2026-07-18 against Cursor CLI
`2026.07.16-899851b` on a signed-in Hobby account. It used an isolated
`OPENMELD_HOME`, localhost Auth, Gateway, Core, and Web services, and the
public OpenMeld CLI. The OpenMeld Service ran in the foreground for this
localhost acceptance; the publishing smoke must separately verify that the
installed background service can read Cursor's login:

- an Agent Profile was created and bound to `builtin:cursor`, transport
  `acp`, exact model `default[]`, and permission mode `cursor:force`;
- a Binding-only permission update succeeded without an unrelated profile
  rename, and the route catalog reported `cursor:force` before dispatch;
- the first default-permission probe rejected a real ACP permission request
  and surfaced `interaction.permission_required` instead of hanging;
- authenticated protocol inspection confirmed Cursor offered
  `allow_once`, `allow_always`, and `reject_once`, while OpenMeld's Run
  Everything handler selected only `allow_once`;
- the successful provider process command contained `--force acp`;
- OpenMeld loaded and continued the existing Cursor ACP session
  `a8ca2ff6-abd4-410e-8e89-158fb94232d9`;
- client message `91a512fe-7871-4c05-a18c-2d6376c4fdfb` produced dispatch
  `a7ec725c-fd51-4d8b-9e3f-dd79c187a616`;
- Space signal `13903019-36d5-4bda-887a-e5906f968579` visibly replied
  `Cursor ACP wake passed.` in the source message's thread;
- `openmeld-dev service trace` resolved the selector to the same dispatch and
  reported `status=succeeded`, `reply_published`, `visible_reply`,
  `agent_controller_conversation_resume=continued`, and
  `local_runtime_context=reused`.

## Official Sources

- [Cursor ACP](https://cursor.com/docs/cli/acp)
- [Cursor CLI parameters](https://cursor.com/docs/cli/reference/parameters)
- [Cursor CLI authentication](https://cursor.com/docs/cli/reference/authentication)
- [Cursor CLI configuration](https://cursor.com/docs/cli/reference/configuration)
- [Cursor CLI installation](https://cursor.com/docs/cli/installation)
- [Agent Client Protocol schema](https://github.com/agentclientprotocol/agent-client-protocol)
- [Homebrew cursor-cli cask](https://formulae.brew.sh/cask/cursor-cli)
