# CLI Client

## Agent Context

- Purpose: Define the OpenMeld CLI client's responsibility boundary as the local
  terminal client for setup, service surfaces, local capability presentation,
  Center Agent Routines, Wake availability presentation, trace,
  repair/reset/login entry points, and lane-aware user operations.
- Read this when: You are changing `openmeld`, `openmeld-dev`, `openmeld-canary`, CLI command
  boundaries, terminal copy, Human View, Agent View, setup handoff, Wake
  availability presentation, Space Board reads, Routine commands, trace output,
  lane safety, or CLI-facing diagnostics.
- Update this when: CLI client responsibilities, command model semantics,
  terminal presentation, setup handoff behavior, trace surface behavior, or lane
  protection rules change.
- Do not use this for: Command walkthroughs, release gates, local stack setup,
  test isolation procedures, Space truth, Binding truth, Core readiness truth,
  RuntimeCoordinator execution truth, daemon internals, or Web UI behavior.
- Source of truth: This file owns the durable client boundary for the OpenMeld CLI.

## Boundary

The CLI is the local terminal client for OpenMeld.

It gives users, support operators, and coding agents a user-operable way to
inspect and align the local side of the product loop:

```text
Space Wake -> RuntimeCoordinator -> local OpenMeld Service -> local agent -> Space reply or explicit failure
```

The CLI owns command experience and presentation. It does not own the durable
facts behind those commands.

Terminal output follows normal pipeline semantics. When a downstream consumer
closes an output pipe, the CLI handles the resulting `EPIPE` without printing a
runtime stack trace or overwriting the command's existing exit status. Other
output failures remain visible and fail normally.

The CLI must not become the source of truth for:

- Space membership, messages, threads, or reply placement
- Agent Profile identity
- Agent Profile Binding truth
- final Agent execution readiness
- RuntimeCoordinator execution lifecycle
- Dispatch Ledger or Wake trace truth
- OpenMeld Service execution authority itself

When the CLI needs these facts, it reads owner services and shared contracts. It
must not reconstruct final Wake availability or execution outcome from terminal
state, process health, route state, setup completion, or local inventory.

## Client Responsibilities

The CLI owns terminal-facing surfaces for:

- service status, lifecycle guidance, and service diagnostics
- local Prepare and setup handoff entry
- Agent Profile Wake availability and reply-recovery presentation
- user-operable Wake trace and diagnostics
- repair, reset, login, and lane-aware local state entry points
- Human View copy and Agent View structured output
- Center Agent Routine authoring, management, and Run-history commands
- Organization Skill listing, inspection, exact-release loading, and
  local-agent handoff output
- lane-sensitive protection for published, repo-local, and canary operations

These are client responsibilities, not authority responsibilities.

Agent View must surface local component drift through shared local component
projections. CLI setup status may report local installation evidence such as an
outdated Service bundle or stale OpenMeld-managed local helper skills.
`openmeld setup` remains the
primary entrypoint for connecting or repairing OpenMeld Service and full
computer setup. Component-only update surfaces may point users to
`openmeld upgrade` for OpenMeld CLI and the Setup/Doctor-owned local helper
repair action instead of sending them through Organization Skills.
For managed-binary upgrades, CLI prefers an exact-base delta when the running
binary's version, size, and sha256 match the manifest's declared base. It
reconstructs a temporary executable, verifies the final size and sha256, then
verifies the published Apple Developer ID identity before `install-self`. Any
delta failure automatically falls back to the complete gzip transport. The raw
download path remains only for backward compatibility with older manifests.
Before showing the download stage, CLI reads the current executable once and
resolves one update plan against every same-version delta candidate. The
reported transport and size come from that same plan used by the downloader;
a version-only match must not advertise a delta that the exact local bytes
cannot use. If CLI cannot read the current executable, it reports the preserved
filesystem error before using the complete archive; an ordinary readable-byte
mismatch selects the archive without presenting an error.

`openmeld skills` is the canonical Organization Skills command group. Phase 1
provides `list`, `show`, and `load` with Human View, Agent View, and strict JSON
contracts. `load` resolves one enabled exact release from the authenticated
route Organization, verifies the digest, and writes only to the private
Organization-scoped OpenMeld cache. It never copies a Skill into a global
Codex, Claude, Cursor, or `.agents/skills` directory.

The former `openmeld skills ensure|install|uninstall|check|update` commands
manage OpenMeld-owned setup assets, not Organization Skills. They remain
deprecated compatibility aliases for one published CLI window, print their
Setup/Doctor replacement, and preserve existing behavior during that window.
The old ambiguous local-helper `skills list` spelling is not retained because
`openmeld skills list` now lists Organization Skills.

CLI must not infer Wake blocking from local component drift by itself. Core owns
the user-visible local component update projection for Wake eligibility:
`available` means an update is available and current Wake work can continue;
`required` release policy blocks the affected capability, and a Service below
Core's monotonic minimum supported version receives the same effective
`required` result even when the latest release is advisory. CLI, Web, Space
status, and Agent-led guidance must preserve that Core-derived semantic result
when they tell a user whether a local Service can receive new Wake work.

`openmeld service status` and `openmeld doctor` may present the published CLI
channel beside Core's server-required local-component projection. That is a
release diagnostic, not two competing update policies: Core's projection owns
the current requirement, and the channel proves whether the artifact is
obtainable. If they disagree, CLI must say which projection is ahead or
unavailable instead of collapsing the result into a false "current" verdict.

Human-readable Service status must identify the current CLI lane and effective
local data root. Its owner summary applies only to that lane; a Service running
in another lane must not be presented as a second owner.

Detailed command sequences, release gates, local stack validation, test
isolation, and CI/release workflow belong in
`developing/engineering/development-workflow.md`.

## Command Model

Keep the command model stable across terminal use, Web handoff, and docs.

### Local Agent to Center Agent

Local Agent harnesses use the authenticated member's canonical Center Agent
Direct Message instead of creating a CLI conversation or a parallel Center
Agent session:

```text
openmeld center-agent context --view agent
openmeld center-agent context receipt <manifest-id> --all --view agent
openmeld center-agent ask "Summarize the release risk and handle what you can"
```

Without `--organization`, each top-level bridge command resolves the account's
current server-selected Organization when the command starts. The Auth-owned
account `lastSelectedOrganizationId` is the first choice; a valid Better Auth
Session active Organization is only the same backward-compatible recovery
preference used by Web when the account has never selected an Organization.
The CLI resolves that id against the current remote membership list. It must
not use a stale local Organization cache or let a later Organization switch
reroute the in-flight DM open, Signal write, poll, Context Manifest, or load
receipt. The resolved Organization id is bound to every Organization-scoped
API client for that command. The next top-level command resolves the current
selection again.

`--organization <slug-or-id>` explicitly targets another Organization in the
authenticated member's current membership list. The selector is never
authority: Gateway and Auth reauthorize that exact Organization on every
request. An explicit target does not change the account's default Organization
or affect a later command without the option. Long-running, concurrent, and
background Local Agents should use the option when their work must remain
pinned while the human may switch Organizations elsewhere. Commands generated
from an Organization-owned artifact, including Context Manifest load receipts,
carry that artifact's Organization explicitly.

Agent View represents this admission decision with the shared strict
`CenterAgentOrganizationScope` contract: `selection` is `current` or
`explicit`, and `target` is the frozen Organization. It does not emit a second
mutable `active` field that could become stale while the command runs.

`center-agent context` is the progressive read side of the bridge. Core returns
a versioned Context Manifest built only from user-visible text Signals in that
member's existing Center Agent Direct Message. The default page is recent and
bounded by both message count and an explicit estimated-token budget. A stable
opaque cursor requests older visible messages. The CLI does not list Space
Signals itself, read Flue storage, infer authorization from a conversation or
session id, or construct its own summary. Each page is independently
authorized, source-linked, and audited.

Token-budget pages are contiguous. Core never advances the cursor past a
visible message that cannot be materialized inside the requested budget. If
that message's required metadata cannot fit even with empty text, Core returns
`center_agent.context_token_budget_too_small`; the CLI tells the Local Agent to
retry with a larger `--max-tokens` value instead of silently omitting the
message or returning a continuation that cannot recover it.

After adding manifest messages to its working context, the harness records the
exact load with `center-agent context receipt`. `--all` means every returned
message was added; repeated
`--entry '<sourceRef.id>=<materializedContentHash>'` arguments report an exact
subset. Core reauthorizes the member, requires the same Local Agent client,
verifies every source and materialized hash against the manifest, and keeps one
immutable receipt per manifest. The receipt proves only what the harness
reported adding to its working context. It does not claim that the model paid
attention to, relied on, or quoted every message. Human users should not need
to run this command themselves; supported harness integration owns the call.
Agent View therefore returns one `nextAction` only when the manifest contains
messages. After the harness has actually added every returned entry to its
working context, it runs that exact command. An explicit `--via` override is
carried forward only when the context request itself needed that override;
the resolved Organization is always carried forward because the human may
switch Organizations before the receipt runs. Codex and Claude Code automatic
detection remains the normal path. A harness that truncated or filtered the
command result must request a smaller manifest or report an exact subset
instead of claiming `--all`.

The read contract exposes only the honest `messages` view. It does not expose
hidden reasoning, system prompts, runtime recovery payloads, another member's
chat or memory, attachments, or a synthetic claim that all Organization context
was loaded. Read, continue, ask, reported model injection, and model reliance
remain separate operations.

The command opens or reuses the same member–Center Agent Direct Message that
Web Chat uses, posts one ordinary member-authored Signal, waits for the normal
Wake result by default, and returns that durable result. `--no-wait` submits
the same request without cancelling or changing the execution. A wait timeout
means that execution is still pending; it is not rewritten as failure.
The source Signal uses the client message id as its idempotency key. When the
first transport result is ambiguous, the CLI replays that exact request once
with the same id. If delivery still cannot be confirmed, the CLI returns
`submission_unknown`, preserves the client message id and bounded transport
diagnostics, and tells the user not to submit a duplicate.
After the source Signal is accepted, a later status or visible-reply read
failure also returns the request as pending with its stable Space, Signal,
client-message, and target-profile identifiers plus bounded read-failure
diagnostics. The CLI must not erase those accepted identifiers, claim the
request was never submitted, or invite a duplicate retry merely because it
could not finish observing the result.

OpenMeld automatically detects supported Codex and Claude Code harnesses and
their current thread or session locator. `--via` and `--session` remain explicit
overrides for another harness or a caller that needs to report a different
locator. They are attribution and trace locators only. They never
replace authenticated member identity, grant Organization access, select a
conversation, or add Local Agent context to the Center Agent. The visible
Signal keeps the `via <client>` attribution while session metadata stays out of
ordinary message presentation. A Local Agent that needs more Organization
context asks through this same command and receives only what the represented
member and current environment authorize.

When the Center Agent creates one or more canonical Tasks during that turn, the
visible reply already carries typed Task references. Agent View preserves those
references and adds Organization-scoped Web URLs instead of reducing the reply
to text. The CLI still does not create a parallel Task API or decide that every
request is a Task: quick answers and immediate safe actions stay in Chat, while
the Center Agent may create durable, asynchronous, parallel, or recoverable
work through the existing Task tool. A returned Task reference means the work
already exists and must not be resubmitted.

If the Center Agent needs human input, Human View points the member to the same
Center Agent Chat. Agent View returns the structured pending interaction and
stable Space, Signal, client-message, and target-profile identifiers. Neither
view fabricates a final answer or starts a second turn.

`OpenMeld Service` means the local background service only. Local service lifecycle
and service diagnosis belong under:

```text
openmeld service ...
```

Local agent capability is a separate layer. The primary user-facing command for
connecting this computer to Space Wake is:

```text
openmeld setup
```

Old profile-status and local-preparation command routes are not public entry
points. The setup path must not reintroduce alternate user or Agent
instructions.

The canonical Web/CLI setup handoff command is:

```text
openmeld setup --start-session <opaque-token>
```

The ordinary handoff automatically enables newly detected runnable local agents
and preserves every existing local enabled/disabled decision. It has no human
local-agent selector. Human View may open or print the matching OpenMeld Web
setup page only as a progress and recovery surface. The URL remains the durable
fallback for remote terminals, blocked browser launches, or users who need to
inspect setup progress manually. Agent View should not auto-open a browser.

If discovery returns multiple verified installations for one controller, setup
does not stop for a prompt. It keeps a valid saved launch contract; otherwise it
selects the first PATH-ordered candidate and persists it. Human completion copy
uses friendly product names and says how many local agents are **connected**;
it must not label the selected set as merely detected or expose internal ids.
The authenticated Computer owner may change that installation later from Web.

`openmeld setup` is single-instance per computer: only one setup may mutate local
setup state at a time, guarded by a setup command lock that records the holder
pid. A stuck setup must never trap the user with no way forward. When a
deliberate new Web-issued command (one carrying `--start-session`) finds the
lock held by a live holder, it may take over within a bounded window: it asks
the holder to stand down (SIGTERM, never SIGKILL, because the holder may be mid
lifecycle change) and waits a short window for the lock to free before
continuing. The holder releases the lock and exits cleanly when it receives that
signal. If the holder does not stand down in time, setup falls back to a refusal
that never dumps raw lock JSON to a human: Human View shows one actionable line
(holder start time, pid, and how to stop it) and only Agent View retains the
structured lock diagnostics.

Setup also enforces a coarse global deadline (a hard ceiling on a single
invocation). Individual step-level waits inside the setup Prepare Session block
on the setup WebSocket staying open, so a single executor pass can hang
indefinitely if Core or Web stalls without closing the socket; the bounded
reconnect loop only reacts to a socket close, not to a stalled-but-open stream.
On the deadline, setup fails cleanly with a support code, releases the setup
lock, and exits, so no shape of stuck setup can hold the single-instance lock
forever. This deadline governs the setup process only; it is not a Wake
execution timeout and does not fail an in-flight Wake.

Setup no longer creates or binds a separate onboarding assistant. In human view
it must not ask which selected local agent should run a managed welcoming
assistant, and in Agent View it must not synthesize one. Setup also must not
infer managed profile identity from a display name.

Agent-led setup may explicitly scope local agents from the terminal side of the
same Prepare Session:

```text
openmeld setup --start-session <opaque-token> --local-agents all --view agent
openmeld setup --start-session <opaque-token> --local-agent codex claude-code grok-build cursor opencode --view agent
```

`--local-agents all` means all selectable local agents reported by the local
catalog. `--local-agents none` intentionally prepares no local agents.
`--local-agent <id...>` chooses explicit selectable local agent IDs for a
Prepare Session.

Without one of those explicit flags, setup atomically registers and enables
only runnable built-in controllers that have no local registration. Existing
registrations are never rewritten, so a Computers Off decision survives every
setup rerun and update. Setup reports per-controller attention honestly; a
signed-out or broken controller remains unavailable without turning a different
healthy controller's successful connection into a failure.

Standalone Agent Profile setup may connect one explicit local agent:

```text
openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id> --view agent
```

That command connects one Agent Profile identity to one local runtime
capability. It does not create Space membership, send a Wake, or prove final
Wake execution truth.

CLI Profile creation reads Auth's `GET /v1/profiles/capabilities` contract.
Interactive kind selection omits Human when additional Human Profile creation
is disabled, while Agent remains selectable. An explicit `--kind human`
request fails before mutation with Auth's stable capability error. A missing or
invalid capability response fails closed for Human creation; Auth remains the
final enforcement boundary for older CLI versions.

`openmeld profiles create` is the one CLI and Local Agent creation entry for
both self-owned and teammate-owned Agent Profiles. Supplying `--owner` routes
the intent through the shared Agent Profile Creation Request capability:

```text
openmeld profiles create "Release Reviewer" --kind agent --owner <user-id> --computer <computer-id> --agent-controller builtin:codex --session new
openmeld profiles create "API Debugger" --kind agent --owner self --computer <computer-id> --agent-controller builtin:codex --session resume --native-session <provider-native-id>
openmeld profiles requests list
openmeld profiles requests approve <request-id>
openmeld profiles requests decline <request-id>
openmeld profiles requests cancel <request-id>
openmeld profiles requests retry <request-id>
openmeld profiles requests preferences get
openmeld profiles requests preferences set --new-session ask-every-time --existing-session ask-every-time
```

The creation command resolves the current or explicit Organization, accepts `self` or an
exact target owner user ID, preserves the exact provider-native Session ID, and
supports a caller-supplied stable request key for safe retries. Human View
explains current status and next action. Agent View emits the shared strict
request envelopes. Local Agents set source `local-agent`; ordinary terminal
use defaults to `cli`.

The current executor completes new-Session identity creation. Resume and fork
requests return an explicit unavailable outcome until Agent Activity and the
local Binding path can verify and perform that exact Session strategy. The CLI
must never replace either strategy with new-Session creation. An optional Space
ID records intent only and does not grant membership.

Agent Profile creation and maintenance may also set the Binding's Agent
Controller Permission Mode:

```text
openmeld profiles create <name> --kind agent --agent-controller builtin:codex --agent-controller-permission-mode approve-for-me
openmeld profiles update <agent-profile-id> --agent-controller-permission-mode full-access --confirm-dangerous-agent-controller-permission-mode
```

`--agent-controller-permission-mode` accepts controller-native values. Claude
Code supports `ask-permissions`, `accept-edits`, `plan`, `auto`, `dont-ask`,
and `bypass-permissions`. Codex supports `ask-for-approval`, `approve-for-me`,
`full-access`, and `custom-config`. Cursor supports `default`, `plan`, `ask`,
`auto-review`, and `run-everything`. Grok Build supports `default`,
`accept-edits`, `plan`, `auto`, `dont-ask`, and `bypass-permissions`. Dangerous modes require
`--confirm-dangerous-agent-controller-permission-mode` in non-interactive use.
These commands write Binding metadata only; they do not create Space
membership, prove Wake readiness, or bypass OpenMeld Space action rules.

The local Service route-catalog read negotiates expected-routes
`contractVersion=v2` to receive Codex Collaboration Mode. When an older cloud
rejects that version query as `invalid_payload`, surfaced either as the direct
Gateway code or its legacy upstream-code alias, the CLI retries the unchanged v1
query and keeps existing Wake routing available with Codex Default collaboration
behavior. It must not treat a network error or 5xx response as an old contract,
and it must preserve a negotiated mode in the versioned route cache across
Service restarts.

Cursor model selection uses the exact account-scoped model ID returned by
`cursor-agent acp`. Reasoning-bearing Cursor variants remain part of that exact
model ID, so CLI must not accept or synthesize an independent
`--reasoning-effort` value for a Cursor Binding.

Grok Build setup resolves the official `grok` install, including the default
`~/.grok/bin/grok` location, and verifies it without dispatch-time PATH
guessing. ACI authentication uses only an existing cached token or API-key
method; when neither is available the CLI tells the user to run `grok login`
in a terminal and does not open a browser from the Service. Model and reasoning
selection must exist in both the reviewed catalog and the complete live ACP
inventory for the current Grok account. A missing live choice fails before the
prompt instead of selecting another model or using Headless JSON.

`openmeld agents show <agent-id>` may display Agent Controller Interface (ACI)
evidence for the selected local controller: selected install, version,
version advisory, controller sign-in status, native control capabilities, and
controller-provided models or skills when the controller exposes them through a
stable surface. Version advisory may include a manual update command such as an
official controller command or package-manager command, but CLI output must
present it as guidance the user runs on that computer, not as a hidden mutation.
Agent View and `--json` expose that local evidence under
`agentControllerInterface` so Desktop and other local clients can reuse the same
local-controller facts.

ACI evidence is local controller evidence only. The CLI must not treat a healthy
ACI snapshot as final Agent Profile readiness, and it must not hide unknown
controller facts behind success copy. `Available for Wake` remains Core-owned
readiness across Binding, runtime, account, route, service compatibility, claim
eligibility, and RuntimeCoordinator evidence.

`openmeld setup` also aligns OpenMeld-managed skills for the setup path. Skills are part
of local component alignment because they are the instructions agents use after
setup. In the current hard-cut phase, stale OpenMeld-managed skills are treated as a
required update, not an advisory update.

During the one-window compatibility period, the deprecated
`openmeld skills ensure --all --view agent` alias remains a diagnostic and
manual operation for explicitly selected local-helper targets. It reuses the
existing selectors and must stay scoped to them. Product setup surfaces point
to `openmeld setup` or `openmeld doctor`, not to the deprecated alias.

When a Web setup bootstrap runs a lane-specific command, the CLI-facing setup
contract should expose the exact follow-up command prefix in the final
`setup.complete` output. Agents must use that prefix for later commands. For
example, local development binary setup uses `~/.openmeld-dev/bin/openmeld`, and
production binary setup on supported macOS uses `~/.openmeld/bin/openmeld`.
Windows, explicit `?dist=npm`, or npm recovery setup may report
`npx -y openmeld@latest` as the explicit fallback. Do not ask agents to infer the
lane from prose or switch to a different CLI entry after setup.

`setup.complete` should also include the normalized Local Components status.
That status is the CLI/Agent View projection for local CLI, OpenMeld Service, and
OpenMeld skills alignment. It exposes one setup action label such as `Connect OpenMeld
Service`, `Reconnect OpenMeld Service`, `Update OpenMeld Service`, `Update OpenMeld skills`,
or `Everything is up to date`. Optional CLI package drift may appear as `OpenMeld CLI
update available`. When the Core-owned release policy marks CLI or Service
drift `required`, setup must preserve that `update_required` projection and must
not present local component alignment as complete until the requirement clears.
Command-entry contract incompatibility remains a separate pre-command gate.

`setup.complete.serviceGuidance` is the structured setup guidance for OpenMeld
Service lifecycle transparency. It must include the setup-owned status text,
the login auto-start explanation, the exact lane-aware autostart disable
command, the exact lane-aware stop command, and the user-visible consequence
that local agents cannot be activated until OpenMeld Service starts again. GUI
surfaces should consume this field instead of copying CLI Human View cards.
CLI Human View may summarize that same truth in a compact completion card:
service is running and starts at login, the stop command, the autostart-disable
command, and the short consequence that stopped service means local agents are
off. Detailed component and service facts stay in Agent View. Long-running setup
work should show short progress lines when stdout is not a TTY, because Web
setup pipes the CLI output through the bootstrap script and hidden spinners make
the flow look stuck. Every completed setup/Prepare step that takes at least
100 ms shows its elapsed time in Human View and includes exact `durationMs` in
Agent View. Fast steps stay quiet, while a slow Service, local-agent, skill, or
verification phase leaves one stable timing record instead of disappearing
with the spinner.

Direct `openmeld service start` reports the total time from command entry until
the local service is ready. `openmeld upgrade` reports separate timings for the
release check, CLI download/install, and OpenMeld Service alignment. These are
user-visible stage timings, not hidden debug logs, so a slow network, install,
or service restart is immediately distinguishable.
The binary download stage also shows the manifest-declared transfer size: an
exact-base delta when available, otherwise the complete gzip archive (currently
about 25 MB), never the larger installed executable size.

The human-facing Web setup command is generated by Web. On supported macOS it
defaults to binary setup. Before that binary path runs `openmeld setup`, the
bootstrap must verify whether the current terminal's ordinary `openmeld`
command already reaches the downloaded managed version. If a known global npm
copy is older, the bootstrap updates it to the exact manifest version and
verifies the result before setup can report completion. This migration is a
bootstrap responsibility, not a second CLI authority. For Windows, explicit
`?dist=npm`, or npm recovery, package-based update or repair copy should use:

```text
npm install -g openmeld@latest && openmeld setup
```

For npm distribution, Agent-led setup and Agent View recovery copy may use:

```text
npm install -g openmeld@latest && openmeld setup --view agent
```

Use `npx -y openmeld@latest setup` only for npm bootstrap or fallback when the
global `openmeld` command is not installed yet.

Do not ask a human user to run an Agent View setup command from Web. Do not ask
an agent to use Human View when the agent needs structured `setup.complete`
facts.

`openmeld skills check` and `openmeld skills ensure` must also report legacy or
unmanaged OpenMeld skill copies in known agent skill roots. A stale OpenMeld skill such as
an old `openmeld-cli-guide` directory can still be loaded by an agent even when the
current OpenMeld-managed `openmeld-cli` skill is up to date, so the CLI must show the
path, explain that OpenMeld does not manage it, and recommend installing the current
skill before removing or renaming the legacy directory. OpenMeld must not silently
delete or overwrite those unmanaged directories.

`--view agent` is a global option, but agents often inspect nested command help
directly. Nested command help should make the global `--view <mode>` option
discoverable so the documented Agent View commands do not look like hidden or
invalid flags.

Entry-point boundary: `openmeld start` is account/identity first-run (sign-in and
first profiles); `openmeld setup` is this computer's execution capability (service,
local agents, readiness) and receives the Web handoff via `--start-session`.
`openmeld start` points to `openmeld setup` when local capability is needed; neither
replaces the other. For machine-state problems the human-facing answer is
always `openmeld setup`; the `openmeld service ...` subcommands are scoped lifecycle
primitives (`update` converges to the expected version, `repair` redoes the
installation only when the installed bundle, service registration, runtime contract,
or saved running state is not aligned). A repair against an already aligned Service
is a successful no-op: it must not stop, reinstall, or restart healthy local work.
When a replacement is required, the CLI prepares and validates it while the
current Service remains available. A preparation failure must leave the current
Service running. The CLI drains and stops the current Service only after that
preflight succeeds, then activates the prepared replacement and verifies its
health before reporting success.
`openmeld uninstall` removes local OpenMeld data
for this device as a whole, while `openmeld service uninstall` removes only the
daemon registration and disposable Runtime state. The lane's stable local device
identity survives service update, repair, uninstall, and reinstall; only an explicit
destructive OpenMeld reset removes it.

Human `openmeld setup` output must keep OpenMeld Service lifecycle copy short and explicit:
OpenMeld Service is running, starts automatically when the user signs in, and can be
changed with `openmeld service autostart disable` or stopped with `openmeld service stop`.
The stop copy must state that local agents cannot be activated until OpenMeld Service
starts again.

Higher-level commands such as `openmeld start`, `openmeld space join`,
`openmeld space create --join`, and the membership commands
(`openmeld space add-members`, `openmeld space add-agents`,
`openmeld space add-human-profiles`, `openmeld space add-me`) are orchestration entry points. They must
reuse shared service, Prepare, readiness, Space, and Binding contracts instead
of inventing command-specific truth. The membership commands share one
candidate planner, while their mutation authority follows the selected source.
`add-members` and `add-agents` preserve the existing interactive and `--all`
selection and caller-owned membership writer. Explicit Profile ids may also
select active profiles from the current Organization Directory; those
Directory selections atomically write through the Organization Directory
profiles-to-Space endpoint. A command that mixes external Directory profiles
with account-only profiles fails before either writer runs. When the selected
profile is the displayed Center Agent, the CLI sends the displayed Center Agent
Profile id as the expected designation and fails closed if Core reports that
the designation changed. `add-members` accepts Human and Agent Profiles
(`add-profiles` stays its alias), while `add-agents` accepts Agent Profiles only.
`add-human-profiles` and `add-me` retain the caller-owned membership path. No
command falls back to the legacy Center Agent endpoint.

`openmeld space add-me <space-url-or-id>` is the one-command self-add path. If the
current process is not a recognized local agent controller, it adds the current
Human Profile (or the Human Profile selected by `profileId` in a Space Web URL)
through the same membership write path as `add-human-profiles`. It may bypass
only the CLI no-op guard that normally rejects adding the acting profile to the
same Space; it must not bypass Space access, authentication, authorization, or
the Space membership API. Ordinary `openmeld space add-members --member <current-profile>`
must keep rejecting acting self-selection.

When `add-me` detects Claude Code via `CLAUDE_CODE_SESSION_ID`, it creates or
reuses the Agent Profile bound to `builtin:claude-code` and that session ID.
The Project folder defaults to the command's current working directory, and
Claude Code session ID plus Project folder are treated as one binding fact. If
the same Claude Code session is already associated with a different Project
folder, the command must fail closed. When `add-me` detects Codex with a
reliable `CODEX_THREAD_ID`, it binds `builtin:codex` to that thread ID. If the
process looks like Codex but no reliable thread ID is present, the command must
fail closed with a clear next action instead of pretending to bind an unknown
thread.

The canonical workspace term in CLI copy for this flow is `Project folder`.
The primary option is `--project-folder <path>`. `--workspace-path`,
`--working-directory`, and `--cwd` are accepted aliases for agent convenience,
but all aliases must normalize to one canonical Project folder value. Multiple
different paths must fail closed with the conflicting inputs preserved. A
relative Project folder argument may be resolved against the current working
directory before validation, but the final stored profile workspace value must
be absolute and must use the profile workspace config as the single source of
state.

`add-me` may create or reuse an Agent Profile Binding and then add that profile
to a Space. That proves only that the normal membership path completed. Space
membership and Agent Profile Binding still do not prove Wake readiness; CLI
must keep Wake readiness under the existing readiness/reporting and diagnostic
surfaces.

Agent-facing command output must stay compact by default. The default answer is
the result, the next useful action, and the command to inspect details. Expensive
diagnostic evidence, full trace payloads, candidate scans, and projection
internals belong behind explicit detail surfaces such as `--details`, `--json`,
or a focused trace command.

`add-me` agent preparation may need to read existing Agent Profile Bindings
before any Space membership write. Slow preparation should emit sparse progress
only after a short delay in Agent View or detail mode; fast paths should stay
silent. If Binding reads time out before the membership write, the error must
say that no Space membership was written before that step completed and include
the next recovery commands: check `openmeld service status`, then retry the same
`openmeld space add-me <space-url-or-id> --project-folder <path>` command.

Protected Space password handling is Core-owned. CLI commands may accept
`--password` so a user or agent can join a protected Space once, but CLI must
not teach agents to attach the Space password to every later read, status,
history, action, or diagnostic command. When Core returns
`space.password_required`, CLI guidance should first help the caller confirm the
active OpenMeld account/profile and then join once with the Space password or ask an
existing Space member to add the profile.

Space Publication Mode is the exception because it changes how Agent output
becomes visible in the room. The clear agent-facing command is:

```text
openmeld space publication set <space-id> <collaboration|transparent> --password <space-password>
```

This command is a thin client entry over the Space contract
`publicationMode`. It must not introduce a second source of truth. Core decides
whether the acting profile is the Space owner and verifies the supplied Space
password for this specific mode change. Membership, same-account access, or a
previous successful password entry must not silently authorize this operation.
`transparent` is the user-facing CLI spelling for the internal
`raw_context_sharing` publication mode.

### Agent Activity

`openmeld projects` owns explicit local Project opt-in. `bind` resolves a real,
readable directory to its canonical path, rejects a path already bound to any
other Organization or Project, stores only local mode-0600 binding state, and
uploads at most the Project id plus an optional safe repository fingerprint.
The same successful `bind` action installs OpenMeld-owned Codex and Claude Code
hooks, Cursor hooks, and the OpenCode plugin. Grok Build does not add a managed
hook or become an Agent Activity provider in this phase; its Wake lifecycle
events remain execution telemetry, and direct user-started Grok sessions are
not observed. If compare-and-swap protection rejects a
configuration edit, the binding remains valid and the command reports
`integrationSetup.status = needs_attention`; `openmeld activity install` is the
explicit repair command. `unbind` stops new observation and removes unsent
activity for that binding.

`openmeld activity` consumes the Core-owned Organization snapshot and supports
Project, member, provider, and status filters. `openmeld activity read` remains
an explicit compatibility alias. Human View is concise;
explicit `--json` emits the strict shared `activity.read` envelope. The managed
`install`, `uninstall`, `status`, `health`, `sync`, and `context` JSON outputs
also use the closed shared CLI envelope union. Hook commands are hidden
provider adapters, not public data readers.

OpenMeld Service observes only sessions inside an explicitly bound Project and
delivers them through a bounded durable outbox. A 404 or unavailable service
keeps retryable evidence locally and does not break Wake. Context injection
reads only a fresh mode-0600 cache, uses a provider-independent 300-byte UTF-8
ceiling, labels the content as awareness rather than authority, and emits
nothing on missing, stale, or malformed cache data.

Watcher roots that do not exist when the Service starts are retried after the
provider creates them. The CLI remains startable on its declared Node 20 floor;
OpenCode SQLite reconciliation is optional capability detection, while the
managed OpenCode plugin is the low-latency primary path.

### Center Agent Routines

`openmeld routines` is the terminal surface for the active organization's
Center Agent Routines. It exposes exactly eight commands:

```text
list
create
show
update
pause
resume
delete
runs
```

`show` selects one Routine from the canonical strict list response; it does not
require or imply a separate HTTP endpoint. `runs` reads the shared paginated Run
projection. All active organization members may read Routines and Runs. Core's
owner/admin/member creator-scope remains the mutation authority; CLI must not
infer it from local state.

Create requires a name, instructions, and explicit target Space. It accepts
either `--run-at <ISO-8601>` with an explicit timezone offset for one future
Run, or one raw five-field schedule expression/`--daily HH:MM` plus an explicit
IANA timezone for recurrence. The schedule selectors are mutually exclusive.
A recurring schedule update carries an explicit timezone so Core can revalidate
the pair; a one-time update carries the complete nullable schedule quartet.
Changing only the target is a separate explicit update.

The CLI never invents a target Space. It sends the user-selected
`--target-space` value and lets Core validate organization scope, represented
member visibility, current Center Agent designation, and publication
eligibility.

Human output renders one-time schedules, terminal `completed` definitions, and
Slack destinations returned by the shared read contract without passing their
nullable fields into the recurring schedule formatter. CLI create and
destination updates remain Space-only; durable current-thread Slack authoring
belongs to the Center Agent conversation tool.

Delete requires confirmation before the HTTP request. Interactive Human View
prompts with the Routine id. Agent View, `--json`, and other non-interactive
flows require explicit `--yes`; without it they fail before mutation. The richer
Center Agent conversational rule to restate the Routine name and action belongs
to the Remote Agent prompt/tool layer, not the CLI's current confirmation
contract.

Routine output has three distinct forms:

- Human View renders concise terminal cards.
- Agent View emits flat presenter frames such as `result`, `hints`, and `error`
  without a `schemaVersion`.
- Explicit `--json` silences the presenter and emits one versioned
  `cliJsonOutputEnvelopeSchema` envelope through `emitCliJsonEnvelope`.

The eight Routine JSON success types reuse strict shared HTTP response shapes.
The existing strict v1 failure envelope is unchanged. API responses are parsed
before presentation, so missing required fields, unknown fields, or unknown Run
statuses fail closed as an invalid response. The emitter's own schema check is
a debug diagnostic, not the source of that strictness.

Run and `lastRun` `scheduledFor`, and the `runs --before-scheduled-for`
pagination cursor, use the shared signed safe-integer contract. A negative Run
value is accepted only for `skipped` plus `routine.schedule_invalid`
quarantine evidence; other negative combinations fail closed. CLI preserves
that evidence instead of clamping or hiding it. Other Routine timestamps remain
nonnegative.

The current CLI's shared API client sends `contract=practical-v2` on Routine
list, mutation, and Run-history requests. Previously published CLI `0.2.30`
omits that query and continues receiving the frozen recurring-Space v1
projection. Core hides practical-only Routines from that legacy list and
returns `routine.client_update_required` before an old client can mutate one by
known id. This is response compatibility, not permission or execution
authority.

Mixed versions must fail visibly. An old Gateway or Core without the practical
contract is not translated into a successful practical response, and a new
producer must not add unknown required response fields to the no-contract v1
projection.
Deployment order and the separate W2/W5 Remote Agent windows live in
`developing/product/center-agent-routines.md` and
`developing/engineering/development-workflow.md`.

### OpenMeld Space Action Commands

`openmeld space action ...` is the canonical agent-facing operation surface for a
Wake dispatch final outcome. In static docs, `<DISPATCH_ACTION_CLI>` means the
exact Space Action command prefix printed in the current Wake dispatch prompt:

```text
<DISPATCH_ACTION_CLI> space action reply "message"
<DISPATCH_ACTION_CLI> space action wake "@Agent Name" "summary and request"
<DISPATCH_ACTION_CLI> space action reply --wake "@Agent Name" "message"
<DISPATCH_ACTION_CLI> space action status done "short completion update"
<DISPATCH_ACTION_CLI> space action silent --reason "No public reply is needed."
<DISPATCH_ACTION_CLI> space action targets
<DISPATCH_ACTION_CLI> space action help
```

The current dispatch prompt should present one primary final action before any
optional action forms. Optional handoff, Reference, status, silent, target,
help, or fallback examples must not sit at the same priority as the primary
final action for a normal Wake.

Agents must keep the final action aligned to the current source. If the answer
uses other Space messages, private context, memory, or tool results, the visible
outcome still needs to map to the source message and request being handled.

The local dispatch prompt follows the shared progressive-context order without
replacing its existing Entry Brief or Dispatch Brief. It uses the provided Wake
message and reply facts first and points thread work to the exact
`space thread` read. When continuity says relevant messages precede the current
Wake, the prompt points to a bounded history window anchored on the current
source signal before broader recent history. Broader recent history remains an
explicit fallback when the provided facts, exact thread, and anchored window are
insufficient. Truncated source summaries carry an explicit `[truncated]`
marker.

These commands are dispatch-scoped. Write actions require the active
dispatch-owned runtime context and must fail closed without it. The command
shown to the agent inside a Wake is not a hard-coded production `openmeld` command.
OpenMeld resolves the active lane (`openmeld`, `openmeld-dev`, or `openmeld-canary`), injects a
per-dispatch CLI shim ahead of `PATH`, and binds that shim to the current
dispatch ID, target Agent Profile, and Space Action context. Agents should run
the exact `space action` command printed in the dispatch prompt and must not
rewrite it to `npx`. Outside a Wake dispatch, help must use the
`<DISPATCH_ACTION_CLI>` placeholder instead of presenting a guessed runnable
command. `targets` requires the current dispatch target snapshot.

`npx -y openmeld@latest` is valid for setup and ordinary
follow-up commands when the setup contract exposes it as `cliCommandPrefix`.
It is not the preferred visible entry for dispatch-owned Space Actions because
the action must record against the active Wake context. If a runtime needs a
package-backed implementation, OpenMeld may hide that behind the injected shim.

The CLI action command records one local action record for the current dispatch
attempt. It must not publish a Space message directly and must not bypass
RuntimeCoordinator or Agent Transport Space Action Delivery. The daemon reads a
valid CLI action before parsing fallback `openmeld-space-action` blocks. A valid CLI
action wins and is reported with `spaceActionProvenance: "cli_action"`.
The command result must describe that record as an unpublished proposal for the
current Wake. It must not say `Posted to Space` or otherwise claim publication;
only RuntimeCoordinator finalization followed by Space acceptance can make that
claim.

`wake` and `reply --wake` are `post_message` outcomes with
`messageEnvelope.activationTargets`. They close the current Wake with a visible
handoff message and start the next ready Agent Profile through normal Space
message addressing. Blocked wake targets must fail closed before recording a
dispatch action.

If the user asks an Agent Profile to deliver work to another Agent Profile,
`reply` is not enough. The agent must use `wake` or `reply --wake` so OpenMeld creates
executable work for the next Agent Profile. A bare `@Agent Name` in message text
is prose only and does not define delivery intent.

OpenMeld metadata in prompts and action targets is infrastructure context, not proof
of what a human or agent is currently doing. Agents may use Space context,
private context, memory, and tools when appropriate, but must avoid exposing
secrets, credentials, private files, or high-risk sensitive information unless
the owner clearly authorizes it.

First phase intentionally does not support non-dispatch `--space` actions,
external chat surfaces, Approval Bridge, or non-final progress updates.
`status working` must be rejected because current `post_status` closes the Wake.
Outside an OpenMeld-launched Wake dispatch, agents should use regular
`openmeld space ...` commands for setup, list, history, status, create, join, and
member management. `openmeld space action ...` must not be taught as a normal
local-chat or setup command.

Read-only status commands must stay read-only. Reporting status must not
silently repair, reinstall, stop, start, reset, rewrite local state, or mutate
runtime state.

Mutating commands must be explicit, user-visible, and lane-scoped.

## Setup And Prepare Boundary

The CLI is the local terminal side of setup and Prepare.

During Web setup handoff, the CLI receives an opaque Prepare Session token. That
token represents user intent to align this terminal and local OpenMeld Service with
the browser account that started setup.

When the handoff also includes a Web-issued one-time token, that token is a
login method for this computer. The token itself stays short-lived and
single-use, but a successful exchange must persist a normal local CLI auth
session for the same OpenMeld account. `openmeld setup` must not claim success from a Web
handoff unless that local session can be reloaded, because OpenMeld Service depends
on it when launchd/systemd starts the service after sign-in.

The CLI must prove account alignment. Missing, unknown, expired, or mismatched
terminal authentication must fail closed and tell the user the next safe action.

When local service identity is known, the CLI must preserve service-derived
runtime evidence such as device and lane. It must not infer runtime identity
from Web state.

For an explicit reconnect, the authenticated Prepare Session may also name the
existing `connectedComputerId` selected in Web. CLI may pass that trusted target
to local-runtime enrollment so a repaired service identity remains attached to
the same Computer. CLI must not source this target from cached local state or
reuse it across accounts, and enrollment must not create or move Agent Profile
Binding truth.

Setup may help the local side become able to work by checking OpenMeld Service,
discovering local Agent Controllers, preparing runnable Agent Controllers,
updating OpenMeld-managed skills, and reporting Agent Controller availability
evidence.

One CLI command entry owns its interactive authentication and choice prompts.
Nested Service install, repair, and background-start operations must inherit
that completed entry context and must not open the same authentication prompt
again. A prompt-capable Human View setup or Prepare session renders progress as
durable lines; it must not leave an animated terminal writer active while a
prompt owns the terminal. User cancellation is a control-flow outcome: setup
must stop, and an active Prepare step remains resumable instead of being written
as failed.

The local setup portion must not create or join a Space, create Binding truth as
a side effect, choose Space members, send a Wake, decide execution ownership,
decide final Wake outcome, or decide final user-facing Wake availability.

After setup succeeds, the CLI records a structured setup bootstrap result for
cross-client compatibility, but current runs do not create a managed welcoming
Agent Profile, Welcoming Space, membership, Binding, or welcome message. Those
retired fields are `null`. The user's personal Center Agent DM owns first-touch
setup guidance, and Web routes users there through normal product navigation.
The CLI must not ask the user to choose a Space, and must not let a bootstrap
failure turn successful local setup into a setup failure. Agent View must include
the structured bootstrap result in `setup.complete`; Web setup handoff sessions
must persist the same result on the Prepare Session.

A CLI setup flow succeeds when the terminal is authenticated, the local OpenMeld
Service is aligned for the current account/device/lane, runnable local agent
capabilities were prepared and reported, and OpenMeld-managed skills were aligned.
Individual enabled controllers may still report explicit sign-in, repair, or
install-choice attention; those controllers remain unavailable and do not make
healthy controllers unavailable.
It does not prove that an Agent Profile can reply in a specific Space or that a
future Wake will succeed.

A CLI repair flow must not claim success merely because a command ran, a
process started, a controller was detected, a service snapshot streamed, or
capability inventory exists. Repair success should be scoped to the component it
repairs and should not be projected as final Wake availability.

## Human View And Agent View

CLI output has two product audiences.

Human View should answer:

```text
Can OpenMeld be used now?
Why not?
What should I do next?
```

Human View must use clear product language and one concrete next action. It
should not lead with raw anomaly names, fingerprints, cleanup plans, route
details, claim details, runtime internals, or stack traces.

Agent View keeps machine-readable evidence for coding agents, operators, and
support flows. It may include safe reason codes, anomaly codes, environment
targets, service contract evidence, compatibility evidence, counts, and raw
diagnostic messages.

`computer list --view agent` is the authenticated user's complete Computer and
Local Runtime inventory. `computer current --view agent` composes that same
inventory with the existing current-computer reply diagnostics, OpenMeld Tools
versions and update state, and a File Access summary. The summary reports mode,
revision, updated time, and selected-folder count, never local folder paths.
These commands are read-only owner tools for Local Agents; they do not make CLI
inventory or current-computer diagnostics authoritative for Agent Profile
readiness, Wake availability, or execution outcome.

The CLI may expose the authenticated user's local owner inventory because it is
the user's direct local Agent View. The Center Agent RPC is a separate
model-facing boundary: even in a requester-private conversation it receives
only the shared model-safe owner projection and never receives controller
accounts, executable paths, launch arguments, update commands, raw diagnostic
messages, or private skills.

Agent View is an output and interaction mode, not an acting identity. The
acting identity is the OpenMeld profile resolved from `--profile` or the current
selected profile. Space commands may use a human or agent profile in Agent View;
system profiles remain internal and must fail closed as an acting identity.
Agent View profile creation must not silently switch the current acting
identity. Creating a profile in Agent View should report the new profile ID and
tell agents to pass `--profile` explicitly when that new profile should act.

Local Folder Picker is a human interaction capability, not an Agent View path
resolver. Agent-facing Project, Agent Profile, Space, and attachment commands
keep explicit path arguments and deterministic current-working-directory
defaults. They must never open an operating-system chooser implicitly, because
an agent or non-interactive process may have no person present to answer it.

The initial Local Folder Picker release adds no public CLI command. Web invokes
the capability through the exact current Service. A future Human View command
may expose an explicit opt-in such as `--choose-folder`, but it must reuse the
same Service request/result contract, remain invalid in Agent View and
non-interactive sessions, and leave the existing path argument as the complete
agent-operable interface.

Agent View read commands should state what they prove. `space list` proves that
Space records are visible to the acting profile. It does not prove conversation
history is readable, members are wake-ready, or a Wake produced a visible reply.
`space list` must read Account Space Index, the Core projection from Space
truth, instead of rebuilding known Spaces from local profile history, cache
maintenance, or deletion tombstones.
`space history --kind text --brief` is the narrow check for readable recent
conversation history without presence-event noise. `space status` is the current
Space/member status check.

`space members <space-id>` reads the shared member-directory projection for the
people and agents currently in the Space, including canonical mention labels
and the Wake/Reference relations each member accepts. It is an authoring aid,
not membership, readiness, presence, or execution authority. Agent View emits
the full validated directory through the presenter protocol; explicit `--json`
emits the strict versioned `space.members` envelope.

`space send --attach <path>` accepts repeatable local JPEG/PNG paths up to the
shared per-message count. The CLI validates every file before upload and uploads
every attachment before posting the normal Space message. A validation or
upload failure must leave the message unsent and preserve a structured error;
the command must never downgrade to an attachment-free success. Thread replies
fail closed until their shared HTTP body supports attachment references.

`space wake-progress <space-id>` is the live, polling-oriented Wake read. With
no selector it returns the active Wake summary for the Space. With
`--client-message <id>` it returns the progress associated with that authored
message, optionally narrowed by `--target-profile <id>`. Agent View emits the
stable `mode`, `pollState`, active and terminal counts, validated query, and
validated progress items. A valid read exits zero even when `pollState` is
`idle` or `not_observed`; transport, permission, and projection failures exit
one with a structured error. This command does not replace `space result`,
which reads archived results, or `service trace`, which diagnoses the execution
chain.

`space wake-stop <space-id>` requires one Space-visible selector and an exact
target profile: either `--source-signal <id> --target-profile <id>` or
`--client-message <id> --target-profile <id>`. It must never expose
`dispatchId` as a public Stop selector. Before POST, the CLI explicitly reads
Wake Stop eligibility and fails closed when the selected active Wake or its
eligibility is missing. The server remains the access and cancellation
authority. Agent View exits zero only for the server-confirmed `cancelled` and
`already_cancelled` responses, exits two for `cancellation_requested`, and
exits one for permission, eligibility, transport, or semantic failure. A
pending request is not presented as a stopped Wake; Core and
RuntimeCoordinator remain responsible for the visible stopped Space outcome.

`space list --organization` reads the active Organization Space directory and
preserves Core-owned visibility, `joined`, and nullable member-count facts. It
lists every public Space plus private Spaces already joined by the current
account; the CLI does not infer membership from local history. Explicit
`--json` emits one strict versioned `space.list.organization` envelope rather
than Agent View presenter frames. `space join --self-serve <space-id>` asks Core
to add the selected Human Profile to one public Space and exits without opening
a chat session. `--password` is forwarded to the existing Space-owned join
authorization for password-gated public membership; the CLI does not interpret
the access mode itself. The server verifies active Organization membership,
public visibility, Human Profile identity, and any required password proof.
The existing `space join <space-id>` command continues to open an interactive
session for an existing membership and does not perform self-service membership.

`org directory` reads the current Organization Directory and presents members
and Agent Profiles as separate groups. Agent View emits the full validated
response through the presenter protocol; `org directory --json` emits the
strict versioned `organization.directory` envelope.

`org computers` reads the same team-safe Organization Computers projection used
by Web and the Center Agent. Agent View exposes the exact validated Computer,
owner, local-agent controller, readiness, version, model, and capability fields
that the Organization contract permits; `--json` emits the strict versioned
`organization.computers` envelope. It never expands the projection with private
local paths, account identities, launch commands, or private skills.

`org invite-link get|create|revoke` manages the active Organization invite link
through Auth's owner/admin permission boundary. The CLI sends only the active
Organization id and bearer session; it does not trust the cached role to grant
access. Auth remains the authority and a member refusal preserves the shared
`organization.join_link.forbidden` code. Agent View payloads preserve the exact
Auth response, while explicit `--json` emits the corresponding strict
`organization.invite_link.*` envelope.

`space board <space-id>` is the room-scoped read for Space identity, purpose,
steward-maintained guide, member counts, current work, and the ten most recent
outcomes. It consumes the shared Board response and standard Space access
boundary. It must not recompute membership, readiness, or execution state in
the CLI, and it must not turn an unavailable execution projection into an empty
or apparently current Board. Explicit `--json` preserves the shared response
shape for agents and tools.

Environment mismatch must appear as `Wrong OpenMeld Environment` in Human View.
Agent View should keep precise Gateway/Auth environment evidence.

## Profile Name Color System

CLI profile-name coloring has one source of truth:
`clients/openmeld-cli/src/ui/profile-label-color.ts`. Every visible human, owner,
or agent name in CLI UI routes through its semantic helpers
(`colorizeDisplayProfileLabel`, `colorizePersonLabel`, `colorizeAgentLabel`,
`colorizeResolvedProfileLabel`); do not add ad-hoc `picocolors` styling or
local hash/color logic for profile names, and do not fork the palette per view
or component.

Identity rules:

- Person names key on `ownerUserId` (fallback `profileId` only when no owner
  user exists).
- Builtin agent names resolve through the shared controller brand registry
  (`packages/schemas/src/agent-controller-brand.ts`); pinned brand colors must
  not be re-encoded in Web CSS, CLI renderers, or local maps.
- Custom agent names key on the Agent Profile's own `profileId`.
- Type detection uses `profileKind`, never `hum_*` / `agt_*` string prefixes.
- Colors are identity-stable first; the shared palette assigns hues with one
  space-scoped max-separation pass before reusing nearby hues.

`HUMAN_PROFILE_NAME_COLOR_ENABLED` in the shared entrypoint is the temporary
switch that renders human names as plain text while agent coloring stays on.

## Local Capability And Execution Boundary

The CLI may display Agent Profile Wake availability, but it does not own the
execution truth.

Final user-facing Wake availability comes from Core-owned Agent execution
status. CLI must not recompute it from:

- Space membership
- Binding existence
- completed setup evidence
- route-online evidence
- process health
- service status
- capability inventory
- local workspace presence

`openmeld setup` reports local Agent Controller availability and connects this
computer. It does not prove that a specific Agent Profile can reply in a
specific Space.

Service status and setup diagnostics may include `localServiceDiagnostics`. This
is local OpenMeld Service evidence only. It must not be labeled as final Wake
availability, final Wake truth, or final Space delivery truth.

Reply-recovery copy may use shared Agent Profile recovery semantics. The CLI
adapts terminal-local and current-local-runtime evidence into one clear next
action. The copy explains known evidence; it does not decide readiness truth.

## Trace And Diagnostics Boundary

CLI trace is a user-operable diagnostic surface.

For Wake diagnosis, the selector shape is:

```text
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <profileId> --view agent
```

The selector must include `clientMessageId` and `targetProfileId` for
Web-authored Wake diagnosis because one message can Wake multiple Agent
Profiles.

CLI trace reads the shared observability model. It must not become a direct D1
reader, direct Durable Object reader, or second trace system.

In Agent View, `--details` requests the bounded Remote Agent runtime diagnostic
projection when the selected dispatch used the hosted Center Agent. The caller
still supplies only the normal Space and dispatch selectors. Core resolves the
frozen runtime conversation generation; the CLI must not accept or reconstruct
that generation identity.

When the shared result inbox reports `late_result_available`, trace shows the
retained result and recovery-notice references, preserves the RuntimeCoordinator
terminal outcome, and sets `agentSummary.nextAction` to recover the retained
result instead of `none` or fresh Retry. The recovery action is Core's
authorized idempotent retained-result command; reconnect and a new Wake are not
substitutes. An archival Dispatch Ledger `dispatching`/`waiting_result` row must
not override those current facts. Trace also preserves the bounded stop cause
without guessing that an unattributed SIGTERM was an update.

For a Space Wake routed to the hosted Center Agent, CLI reads the terminal
Dispatch Ledger projection written from confirmed native-delivery evidence. It
must show the recorded terminal status and attempt reason instead of leaving
the Wake at `dispatching` / `waiting_result`, and it must not suggest checking a
local OpenMeld Service for a native runtime failure.

Hosted traces derive `correlation.bindingId` from the native-delivery ledger
when no workstation RuntimeCoordinator or execution-identity evidence exists.
The shared trace schema must also verify that the native delivery's dispatch,
Space destination, and target Agent Profile match the traced Wake. CLI consumes
that shared projection; it must not require workstation-only identity fields or
relax hosted identity drift checks locally.

`openmeld doctor` also reads the local Runtime Reporting Health record for both
Runtime Agent Controller reporting and provider conversation proof reporting.
It may show healthy, starting, or degraded diagnostics and preserve per-channel
facts in Agent View. This check is read-only and advisory: it does not repair the
service, fail the whole doctor run by itself, or decide service liveness, Wake
availability, or execution outcome.

Repo-local wrappers may exist for operator convenience, but they must stay thin
wrappers around the same selector and read model.

`Final Visible Outcome` means the Wake reached a visible reply or explicit
visible failure. CLI must not label current service health, current setup status,
route-online state, or local capability evidence as the Wake's final outcome.

Diagnostics must not include secrets, access tokens, one-time tokens, passwords,
cookies, full message text, prompt bodies, or arbitrary payload dumps.

## Lane Safety Boundary

The CLI has three standard lanes:

| Lane                   | Command               | Default home         | Boundary                             |
| ---------------------- | --------------------- | -------------------- | ------------------------------------ |
| Published production   | `openmeld ...`        | `~/.openmeld`        | Real user state.                     |
| Repo-local development | `openmeld-dev ...`    | `~/.openmeld-dev`    | Workspace-source validation.         |
| Packaged candidate     | `openmeld-canary ...` | `~/.openmeld-canary` | Package-shaped candidate validation. |

`OPENMELD_HOME` overrides the default lane root.

Each lane owns its local state root, service identity, runtime root, and system
service registration. One lane must not silently stop, repair, reset, or mutate
another lane.

The published `~/.openmeld` lane is real user state. Tests, fixtures, local
harnesses, and destructive validation must not read from or write to `~/.openmeld`
unless the task explicitly validates the real installed product and the user
asked for that exact validation.

Repair and reset are lane-scoped. Prefer repair before reset. Reset is a
last-resort destructive action for the active lane only.

Login is environment-sensitive. CLI must fail clearly when the selected Gateway,
Auth, account, or lane does not match the intended environment.

Detailed lane setup, command examples, release gates, local-stack validation,
and test isolation policy belong in
`developing/engineering/development-workflow.md`.

## Owner Boundaries

Use scoped owner documents for deeper rules:

- `developing/product/product-model.md`: product promise and main loop.
- `developing/product/agent-profiles.md`: Agent Profile identity and recovery
  semantics.
- `developing/product/center-agent-routines.md`: Routine and Run semantics,
  authority, scheduling, and result surfaces.
- `developing/product/space-collaboration.md`: Space addressing, threads, and
  visible outcome semantics.
- `developing/architecture/agent-transport-contract.md`: readiness, Wake
  execution, RuntimeCoordinator authority, and final outcome.
- `developing/architecture/local-openmeld-service.md`: local service, account,
  device, lane, Prepare, update, and trust-boundary rules.
- `developing/architecture/data-and-observability.md`: trace selectors,
  diagnostic read models, and sensitive-data boundaries.
- `developing/architecture/shared-contracts.md`: shared schemas, shared runtime
  policy, cross-client reuse, and password normalization.
- `developing/engineering/development-workflow.md`: command sequences,
  validation workflow, local stack workflow, test isolation, and release gates.

## Product Invariants

- CLI is the local terminal client, not execution authority.
- `openmeld service ...` owns local service command experience only.
- `openmeld setup` connects this computer and reports local agent capability; it is
  not final Wake execution truth.
- `openmeld setup --start-session <opaque-token>` is the canonical Web/CLI
  setup handoff command.
- `openmeld setup --start-session <opaque-token> --local-agents all --view agent` is
  the canonical Agent-led setup handoff when the user wants the agent to connect
  all selected local agents.
- Production Web setup defaults to the managed binary on supported macOS; npm is
  the Windows, explicit opt-out, and recovery distribution.
- `openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id>
--view agent` is the explicit standalone Agent Profile connection path.
- OpenMeld-managed skills are aligned by `openmeld setup`; `openmeld skills ensure --all
--view agent` remains an explicit diagnostic/manual skills command.
- CLI must not recompute Core-owned Agent execution readiness.
- CLI must not decide Binding truth, Space truth, or RuntimeCoordinator truth.
- `space board` consumes the shared read projection and must not infer live work
  from local or historical evidence.
- `space members` consumes the shared member-directory projection and must not
  reinterpret it as membership, readiness, presence, or execution authority.
- `space send --attach` uploads all validated images before posting the message;
  attachment failure must not publish a text-only fallback.
- Status commands must remain read-only.
- Mutating commands must be explicit and lane-scoped.
- `openmeld routines` exposes exactly eight commands, uses an explicit target
  and timezone, and keeps Human View, Agent View, and `--json` separate.
- Human View gives clear next actions; Agent View keeps structured diagnostics.
- CLI trace must use the shared selector and must not become a second trace
  system.
- `clientMessageId + targetProfileId` is required for per-target Wake diagnosis.
- Published `openmeld` state under `~/.openmeld` is real user state.
- Tests and harnesses must not mutate `~/.openmeld` unless explicitly validating the
  real installed product.
- Detailed workflows and release gates belong in
  `developing/engineering/development-workflow.md`.
