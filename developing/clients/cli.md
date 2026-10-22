# CLI Client

## Agent Context

- Purpose: Define the OpenMeld CLI client's responsibility boundary as the local
  terminal client for setup, service surfaces, local capability presentation,
  Center Agent Routines, Wakeability presentation, trace,
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
must not reconstruct final Wakeability or execution outcome from terminal
state, process health, route state, setup completion, or local inventory.

## Client Responsibilities

`openmeld space dm <target-profile-id>` opens a Direct Message as the acting
Profile. With text, it opens first, emits `space.send.request` with the exact
Space, sender, client message ID and Wake targets, then publishes to that DM.
`--space <space-id> --message-id <uuid>` retries the pinned request without
opening another conversation. `--wake` is explicit; a plain message does not
start Agent work. Local dispatch tools open first and require `spaceId` when
starting work, so callers can immediately use the existing `space wake-stop`.

The CLI owns terminal-facing surfaces for:

- service status, lifecycle guidance, and service diagnostics
- local Prepare and setup handoff entry
- Agent Profile Wakeability and reply-recovery presentation
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

The published background Service reuses this same verified `openmeld upgrade`
path for automatic OpenMeld Tools updates. It does not implement a second
downloader or installer. The automatic request records durable local progress,
uses the CLI installation that created the active Service bundle, and hands the
same operation to the background Service switch. An explicit update and an
automatic update therefore have the same installation, verification, rollback,
and status behavior. A compatible connected Service can receive one
release-triggered automatic recheck over its existing Runtime Transport
connection only after it explicitly advertises automatic-request support.
Startup, reconnect, and hourly channel checks remain the fallback; the release
signal does not create a new polling loop. A disconnected request fails
immediately so a replacement Service can retry.

The `dev-local` managed binary also uses this maintenance path when setup
explicitly configures an HTTP(S) loopback binary manifest. Source/npm development
installs, missing manifests, and remote manifests do not opt the local lane into
automatic updates. This keeps localhost upgrade verification isolated from the
production release channel.

`openmeld skills` is the canonical Organization Skills command group. Phase 1
provides `list`, `show`, `load`, and `add` for GitHub or a local Skill directory with Human View, Agent View, and strict JSON
contracts. `load` resolves one enabled exact release from the authenticated
route Organization, verifies the digest, and writes only to the private
Organization-scoped OpenMeld cache. It never copies a Skill into a global
Codex, Claude, Cursor, or `.agents/skills` directory.
`add <github-url> --preview` shows one importable Skill and the resolved commit;
without `--preview`, the CLI pins that commit before installing it in the active
Team. `add <local-directory> [--preview]` previews one complete portable Skill
package through Core and installs it in one authorized operation unless
preview-only is requested. Local Agents
use the same authenticated member authority as the CLI user.
The current import endpoint still has its bundle limits and does not install a
whole multi-Skill repository in one call.

`openmeld files` is the terminal entry for Team files and the signed-in
member's private files in the active Organization. `--location team|my` is
required so a person or Local Agent chooses the audience explicitly. The
initial commands list files, read an exact text revision, download a binary
revision, inspect history, upload local content, copy one exact Team/My revision
to a stated Team or My destination, copy an exact Team/My revision into a named
Space with `copy-to-space`, and write a new revision
against the version previously read. `--view agent` and `--json` expose the same server-authorized results
without a second local file authority. Existing `openmeld space files`
commands remain the Space location entry; adding a location to the CLI never
changes Space membership or file access rules.

The former `openmeld skills ensure|install|uninstall|check|update` commands
manage OpenMeld-owned setup assets, not Organization Skills. They remain
deprecated compatibility aliases for one published CLI window, print their
Setup/Doctor replacement, and preserve existing behavior during that window.
The old ambiguous local-helper `skills list` spelling is not retained because
`openmeld skills list` now lists Organization Skills.
`openmeld skills scan <github-repository-url>` lists one pinned repository's
Skill directories and their declared blockers without installing anything.
`--json` and Agent View return the same server-authorized inventory, so a
Local Agent can select an exact Skill URL before `openmeld skills add`.
`openmeld skills add <github-repository-url> --all` installs every eligible
candidate at the scanned commit, reporting each installed, skipped, or failed
item. The result includes a pinned `retrySource` and an operation ID. A Local
Agent must pass both to retry without duplicating completed Skills.

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

`openmeld computer cloud` resolves the authenticated account's personal cloud
Computer. `--operation <json>` uses the shared Computer operation schema.
Start with `{"action":"describe"}` for official file-tool schemas and execution
capabilities. `files` takes a tool name and input object. `command` supports
container, worker-shell and worker-javascript plus environment, launch-time stdin
and structured JavaScript input/results. `browser` and `preview` use the existing
private browser capability when configured. Existing file actions stay supported.
Local Agents can use the same persistent files as that account's hosted Agents
without mounting or exposing their workstation. Keep command invocation IDs and
keys stable across retries; poll or list after uncertain outcomes. Computer
identity, command observations and publication remain server-owned. This command
does not manage OpenMeld Service or change the active local Computer connection.

`openmeld org invitation-requests` uses the signed-in account and the same Auth
contract as Web. `create --email ... [--space ...]` proposes an invitation;
`link [--space ...]` ensures an approval-required share link; `request --token ...`
submits the verified account behind a received link. `list`, `get --request ...`,
`approve`, `reject`, and `cancel` expose current owner decisions. Agent View
returns request IDs, status, delivery evidence, and next-action guidance; errors
retain server codes and exit nonzero. No local Service or speaking Profile is
required. Approval is not membership. Native email invitation acceptance remains
the membership boundary.

Keep the command model stable across terminal use, Web handoff, and docs.

### Agents, Sessions, And Sensitive Operations

Implementation status: MemberAgent program, PR #236, shipped.

`openmeld profiles create/list/show/set/update/delete` keep their contracts and
also print each Profile's parent MemberAgent, or say that the Profile is
unassigned. A default Agent Profile is created with its MemberAgent, so
`profiles create` creates only additional Profiles,
each with an explicit short name. `profiles create --member-agent <agent>`
refuses an Agent Controller whose harness differs from the parent's. Core
refuses an update that would move an assigned Profile to another harness.

`openmeld setup` treats the local agent selection (`--local-agent <id...>`,
or the Connect page) as the Local agents switch of this Computer: it turns the
selected agents on and every other detected agent off, through the running
OpenMeld Service so Core sees the change at once, before it asks Core to add
Agents. Core adds a MemberAgent for each harness turned on (see
`developing/product/agent-profiles.md`, MemberAgent Layer); `--local-agents
all` selects every detected harness. Setup prints the harnesses left off, and
`openmeld agent add <harness>` adds one of them: Core turns it on where it is
installed and creates its Agent, the same path as Add in OpenMeld Web. A
MemberAgent step that fails never fails setup; the next sync finishes it.

`openmeld agent list` prints one row per MemberAgent in the current
Organization with its derived state, running and queued counts, and latest
Session. `openmeld agent show <agent>` takes a MemberAgent id or harness kind
and prints its Profiles, the Computers that provide its harness, and each
Profile's Sessions. `openmeld session list --agent <agent> [--profile <id>]`
lists the signed-in member's Direct Message Sessions with that Agent, grouped
by Profile, active and archived. `session rename`, `archive`, `restore`, and
`delete` take a Session's Space id and call Core's dedicated Session
operations; Core decides who may change a Session, and the CLI maps a refusal
to one next step. `session delete` asks in Human View and requires `--yes` in
Agent View. Agent View returns stable ids and the same derived state as Web;
neither view stores or recomputes MemberAgent state.

Work started by a Wake receives a **task credential**: short-lived, verifiable
by Core, carrying the request chain, and valid for that task only. The injected
`openmeld` stand-in uses it for task-time Space actions in place of the local
dispatch context file.

Sensitive operations are: changing Agent Profile settings, folders, permission
mode, or concurrency limit; answering approvals; deleting; adding an Agent to a
Space; granting or revoking access; and archiving. They accept only a task
credential whose root requester is the owner, the owner's own App or Web
session, or the owner's CLI login credential under this risk-window rule: a
call made with the CLI login credential passes unless this computer is
currently running a task whose root requester is not the owner. Only inside
that window does Core send the owner a `credential_confirmation` Inbox card,
and the command reports that it is waiting for that confirmation instead of
applying the change. Ordinary terminal use is never interrupted, and the CLI
keeps no TTY elevation cache. Every sensitive operation is written to the audit
log with its request chain.

Other secrets on the computer, such as SSH keys, harness logins, and browser
data, are not protected by OpenMeld; a harness that can run any command can
reach them, as it can natively. When an owner grants a colleague access to a
full-access Profile, the product says so once.

### Space Watch Recovery

`space watch` retains the same view, read anchor, deduplication set and command
lock through a temporary socket interruption. The existing Space session
connection retries at most five times per failure episode, with capped backoff
and a five-second socket-open deadline. Completed catch-up followed by at least
30 seconds of stable connection resets that retry budget. Current authentication
headers are resolved on each reconnect; access or protocol refusals fail without
retry.

Human session initialization installs its history barrier before socket I/O.
An initialization error releases the barrier and closes its owned connection;
manual Stop retains normal completion. A disconnect during the first member
read leaves the replacement hello and catch-up with the recovery owner.
Stream-only sessions observe socket events before their startup HTTP reads.
Recovery that ends during those reads retains its nonzero exit and cannot
report a connected session after the reads return.

Reconnect catches up from the last confirmed durable Signal ID, advances full
200-message pages and deduplicates history with buffered live messages. The
anchor follows Space's storage order, not message timestamps. Catch-up stops
after 50 pages or when its live buffer overflows; a missing or expired anchor
also fails explicitly. It never falls back to a recent window and silently
omits a larger gap. Only the current socket's completed catch-up can report
recovery. A watch that has not observed a durable message has no resume anchor.

Exhausted recovery, access refusal and incomplete catch-up exit nonzero. An
explicit Ctrl+C, Ctrl+D, `/quit` or `:q` retains normal exit behavior. Recovery
does not resend unconfirmed messages, replay Wakes, or change execution truth.
An exact message echo read during catch-up can confirm its original send
receipt; a historical text match without that receipt ID cannot.

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

`--conversation <space-id>` selects one exact Center Agent session. This is
separate from `--session`, which only overrides the Local Agent source locator.
An unavailable selected conversation fails instead of reading a different
chat. Omitting `--conversation` retains the default conversation behavior;
session-aware callers must pass their selection on each context page.

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

The private Center Agent Direct Message does not create Space Tasks or return a
parallel Task reference. When the same Agent Profile participates in an
ordinary shared Space, it may use the Space-owned Task contract described
below. Quick answers and immediate safe actions stay in Messages on both
surfaces.

If the Center Agent needs human input, Human View points the member to the same
Center Agent Chat. Agent View returns the structured pending interaction and
stable Space, Signal, client-message, and target-profile identifiers. Neither
view fabricates a final answer or starts a second turn.

`openmeld space respond <space>` reads the same owner-private pending questions
as Web and Desktop. Human View offers the available single-choice answers in
the terminal. Agent View or non-interactive invocation returns the pending
requests in the existing `GetActiveSpaceWakeProgressResponse` shape without
selecting an answer. Explicit automation supplies `--execution`,
`--interaction`, and `--response` JSON from that request. Core remains the sole
response authority and rejects stale, unauthorized, or conflicting answers.
An accepted response is reported as sent; it is never described as a completed
task. `space wake-progress` and the Space retain the final outcome path.

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

The ordinary handoff authenticates the terminal, aligns and connects OpenMeld
Service, then returns `Computer connected` without waiting for deep local-agent
discovery. The running Service's background catalog refresh automatically
registers and enables newly detected runnable local agents while preserving
every existing local enabled/disabled decision, including agents installed
after the first connection. The handoff has no human local-agent selector.
Human View may open or print the matching OpenMeld Web
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

Setup enforces a fixed 15-minute watchdog. Task counts and Service responses
cannot renew it or extend ownership of the setup mutation lock.
Individual step-level waits inside the setup Prepare Session block
on the setup WebSocket staying open, so a single executor pass can hang
indefinitely if Core or Web stalls without closing the socket; the bounded
reconnect loop only reacts to a socket close, not to a stalled-but-open stream.
On the deadline, setup fails cleanly with a support code, releases the setup
lock, and exits, so no shape of stuck setup can hold the single-instance lock
forever. This deadline governs the setup process only; it is not a Wake
execution timeout and does not fail an in-flight Wake.

`computer wait-for-update --view agent` observes an existing Tools/Service
update before Desktop requests expiring connection authorization. This read-only
observer never takes the setup lock. It reads the existing update operation and
Service readiness projection, with a fixed 30-minute observation limit. The
longer window permits drains beyond the setup limit without leaving a detached
Desktop observer indefinitely. Expiry ends only observation and reports that
tasks and the background update continue; the user can check status and retry.
It does not schedule updates, switch accounts, or stop
tasks. `computer.update_ready` confirms the observed update completed, or no
pending update exists; it does not claim connection readiness or Wakeability.

Human recovery never asks the user to run OpenMeld Service in foreground mode
or copy another setup command as a diagnostic procedure. Setup automatically
repairs deterministically recoverable Service state. When local evidence proves
that automatic repair is unsafe, Human View gives one explicit repair action
and a support code while retaining the detailed evidence for Agent View.

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

With one of those explicit flags, setup prepares and reports the selected
controllers before completing that explicit request. Without an explicit flag,
the ordinary Web handoff leaves controller reconciliation to the running
Service's non-blocking background catalog refresh. That reconciliation registers
only runnable built-in controllers with no local registration. Existing
registrations are never rewritten, so a Computers Off decision survives every
setup rerun, update, and catalog refresh. Per-controller attention remains
visible; a signed-out or broken controller remains unavailable without changing
the connected Computer result.

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

Profile inspection reuses the primary Binding to select applicable diagnostics.
For a hosted Binding, `profiles show` retains Binding information and omits the
workstation runtime fields (`runtime: {}` in JSON); it does not inspect a
local workspace or infer hosted Wakeability from local Service state.

`agents repair --agent <id> --install <install-id>` may select another valid
installation even when the current installation is ready. It uses the existing
install resolver and preserves enabled state and all selector validation.

`openmeld profiles create` is the one CLI and Local Agent creation entry for
both self-owned and teammate-owned Agent Profiles. Supplying `--owner` routes
the intent through the shared Agent Profile Creation Request capability:

```text
openmeld profiles create "Release Reviewer" --kind agent --owner <user-id> --computer <computer-id> --agent-controller builtin:codex --session new
openmeld profiles create "API Debugger" --kind agent --owner self --computer <computer-id> --agent-controller builtin:codex --session resume --native-session <provider-native-id>
openmeld profiles create "Release Investigator" --kind agent --owner self --computer <computer-id> --agent-controller builtin:codex --session fork --native-session <provider-native-id>
openmeld profiles create "Migration Agent" --kind agent --computer <computer-id> --agent-controller builtin:codex --project <project-id> --model gpt-5.6-sol --reasoning-effort high --agent-controller-collaboration-mode plan --agent-controller-permission-mode custom-config
openmeld profiles create "Remote Reviewer" --kind agent --agent-controller hosted:remote-agent --model openai/gpt-6-sol --reasoning-effort medium
openmeld profile update <remote-agent-profile-id> --model openai/gpt-6-sol --reasoning-effort high
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

Supplying a Computer, Project, Space, explicit owner or Organization, or another
request-scoped target routes both owner-self terminal use and Local Agent use
through the shared creation request contract. On that path, model, reasoning
effort, Agent Controller Collaboration Mode, Agent Controller Permission Mode,
OpenCode permission JSON, and Session strategy use the same concrete selection
fields as Web and Center Agent creation. Core applies the selection through the
same Binding and Default Project owners, and successful setup updates the same
remembered creation defaults. The legacy current-computer shortcut remains
available for backward-compatible local-only creation.

For a self-owned configured Agent, an explicit `--project <project-id>` wins.
When `--project` is omitted, the CLI reads the current member's saved Default
Project for the selected Agent Controller from the same Core-owned creation
defaults used by Web and Center Agent creation. `--no-default-project` is the
explicit choice to let OpenMeld choose the working folder instead. A
teammate-owned request does not read the requester's saved Default Project as
if it belonged to the teammate.

For a self-owned configured Agent, `--agent-controller <ref>` without
`--computer` selects this computer only when that Local Agent is enabled and
ready here. The CLI resolves the computer's existing Organization identity and
passes it into the shared creation request; Core remains responsible for final
Computer, Local Agent, Project, and Binding validation. Teammate-owned requests
require an explicit `--computer`, and the CLI never guesses another computer.
An explicit `--computer` accepts only the exact `computerId` returned by
`openmeld org computers --view agent`. That value is the device ID used by this
command. A Connected Computer record ID and an Agent Profile ID belong to
different records and fail before the creation request is submitted. Other
profile-scoped commands require a full current Profile ID; display names such
as `Human` are not implicit aliases unless that command documents one.

The executor completes new-Session identity creation, exact native Resume, and
provider-native Fork after Agent Activity and the local Binding path verify the
selected Session. The CLI must never replace either existing-Session strategy
with new-Session creation. An optional Space ID records intent only and does not
grant membership.

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

Codex creation additionally accepts
`--agent-controller-collaboration-mode default|plan`. OpenCode creation accepts
`--open-code-permission` as one JSON object validated by the shared OpenCode
permission contract. These are ordinary fields in the shared creation
selection, not CLI-only capability.

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

`openmeld agents login antigravity` explicitly signs in to the selected official
Antigravity ACP installation. `--method` selects a method offered by that server
(default `oauth-personal`); non-personal methods require their native settings
or environment credentials. The command prints the Google authorization link,
supports Ctrl+C, and verifies a new process after authentication. It never
prints or copies tokens. Run `agents show antigravity` or select **Check again**
on the computer after login to refresh account evidence. Background checks use
the normal inventory TTL. Legacy `agy` users first install the official ACP
server and select it with `agents manage`.
All ACP paths use the same native file credential store and suppress automatic
browser launches. Signing in through a standalone client's Keychain store does
not establish this file-store sign-in. Subscription usage remains unsupported.

Space `--new-task` and `--continue-from` support official Antigravity ACP.
Omit `--task-access` to retain Agent settings; extra access limits and
`--fork-from` are not supported for Antigravity. `--task-workspace isolated`
selects a managed working copy, not a filesystem sandbox. A legacy installation
must be replaced by the selected official ACP installation before independent
work can run. Agent delegation uses the same checks as human requests.

ACI evidence is local controller evidence only. The CLI must not treat a healthy
ACI snapshot as final Agent Profile Wakeability, and it must not hide unknown
controller facts behind success copy. `Available` remains the Core-owned
Wakeability verdict across Binding, runtime, account, route, service
compatibility, claim eligibility, and RuntimeCoordinator evidence.

`openmeld setup` also aligns OpenMeld-managed skills for the setup path. Skills are part
of local component alignment because they are the instructions agents use after
setup. In the current hard-cut phase, stale OpenMeld-managed skills are treated as a
required update, not an advisory update.

The offline baseline and independently maintained official guide have separate
release lifecycles. Installation, prompt reads, and local readiness use the
same compatible content selection. See
[Official CLI Skill delivery](../engineering/official-cli-skill.md) for
publication, automatic maintenance, discovery, and bridge rollout ordering.

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
Managed Windows setup uses the lane's `bin/openmeld.exe`; its launcher reads
the installer-owned active version record. Explicit `?dist=npm` or npm recovery setup may report
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
CLI Human View leaves Service versions, running state, autostart controls, and
stop commands to `openmeld service status`; detailed component and Service facts
stay in Agent View. Setup work should show short progress lines when stdout is
not a TTY, because Web setup runs the CLI through the bootstrap script
and hidden spinners make the flow look stuck. Every important completed
setup/Prepare step leaves one stable Human View record in the form
`[HH:mm:ss] ✓ Result · elapsed`, using the local time zone of the computer
running the CLI and a zero-padded 24-hour clock. Active spinner and internal
detail lines remain untimestamped. Agent View keeps its existing structured
progress and includes exact `durationMs` for steps that take at least 100 ms.
These presentation timestamps neither control execution nor change waiting,
Service lifecycle, or readiness decisions.

Direct `openmeld service start` reports the total time from command entry until
the local service is ready. `openmeld upgrade` reports separate timings for the
release check, CLI download/install, and OpenMeld Service alignment. These are
user-visible stage timings, not hidden debug logs, so a slow network, install,
or service restart is immediately distinguishable.

Local integrations can use `openmeld service start|stop --json --expected-account
<account-id>` for an already connected POSIX Service. The CLI verifies that
account at the mutation owner, including concurrent sign-in changes. The option
requires JSON output and rejects profile, force, and startup overrides. It does
not log in, install a missing Service, or take over another account's Service.
Missing, expired, mismatched, busy, or unsupported ownership returns an explicit
error; no unguarded retry is allowed. The
[Service admission contract](../architecture/local-openmeld-service.md#account-checked-service-start-and-stop)
owns its cross-process behavior. Desktop's pilot controls remain disabled.

The binary download stage also shows the manifest-declared transfer size: an
exact-base delta when available, otherwise the complete gzip archive (currently
about 25 MB), never the larger installed executable size.

The human-facing Web setup command is generated by Web. On supported macOS it
defaults to binary setup. Before that binary path runs `openmeld setup`, the
bootstrap must verify whether the current terminal's ordinary `openmeld`
command already reaches the downloaded managed version. If a known global npm
copy is older and Node is supported (22, 24, or 25, with 24 recommended), the bootstrap
updates it to the exact manifest version and verifies the result. With unsupported
Node, leave that package unchanged and direct the user to the managed standalone
binary in the follow-up commands. If no older global package exists, do not print
a skipped-update warning. This migration is a
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

Generated POSIX and Windows bootstrap commands use the shared start package's
supported Node policy; the CLI package engine declaration is checked against
that policy. Reject unsupported majors before acquisition instead of promising
that any newer Node version works. Native npm exit codes own success/failure,
including Windows PowerShell 5.1 stderr warnings. An unresolved catalog or
workspace dependency is a package-acquisition error, not evidence that the user
must reset OpenMeld, reinstall Node or change network settings. Preserve the
original npm error and direct users to a corrected CLI release.

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

CLI metadata reads such as `openmeld --version`, `openmeld --help`, nested
`--help`, and `openmeld help ...` must remain side-effect free. They must not
initialize or recover `OPENMELD_HOME`, authenticate, or contact OpenMeld
services merely to describe the installed command surface. Explicit
`--view agent` selects Agent-oriented help without consulting a saved Profile
preference; metadata reads otherwise use ordinary Human help.

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
For an update, a handoff response says only that the update started in the
background after the prepared replacement and durable job reached the operating
system's update worker. It must not say updated, complete, or aligned. A terminal
that remains attached may use those completion words only after the operation is
`updated` and the exact operation-scoped CLI and Service targets are observed.
Older operations expose only one legacy target and readers apply it to both
components. An eligible CLI-only release can explicitly retain an older healthy
Service, so clients must not substitute the CLI target for a present Service
target. The user may close
the Terminal or Web Setup immediately after handoff. The worker waits for all
accepted Wake work and durable result receipts, resumes after interruption or
computer restart, verifies the replacement, and restores the previous verified
Service if replacement startup fails. Setup uses this background path only when
the current Service has trustworthy running evidence and the drift includes a
version change. Broken or ambiguous Service state remains an explicit repair.
Core's update projection selects the job policy: `available` keeps admitting new
Wake work while waiting for an idle switch; `required` stops new admission but
still lets already accepted work finish safely.

For npm installation or repair, the selected package root must identify the
requested package name and version before its Service bundle can be prepared.
An explicit CLI script path is not permission to relabel older package bytes as
a newer Service. A mismatch fails actionably and leaves the current Service
untouched. npm continues to source CLI and Service from the same actual package;
the independent retained-Service selection is a managed-binary release feature.
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

`add-me` accepts `--model <model>` and optional `--reasoning-effort <level>`
for the detected Agent Profile. These flags write through the existing primary
Binding model-selection contract for both newly created and reused Bindings;
`--reasoning-effort` without `--model` fails before Binding or membership
mutation.
When the flags are omitted, `add-me` does not create an implicit explicit
selection. In particular, an existing Codex thread keeps its current model and
reasoning settings instead of being rewritten to the catalog default.

The canonical workspace term in CLI copy for this flow is `Project folder`.
The primary option is `--project-folder <path>`. `--workspace-path`,
`--working-directory`, and `--cwd` are accepted aliases for agent convenience,
but all aliases must normalize to one canonical Project folder value. Multiple
different paths must fail closed with the conflicting inputs preserved. A
relative Project folder argument may be resolved against the current working
directory before validation, but the final stored profile workspace value must
be absolute and must use the profile workspace config as the single source of
state.

When a supported local Agent is detected, `add-me` creates a new Agent Profile
by default and must not enumerate account profiles or read unrelated Bindings
to guess a reusable identity. Reuse is an
explicit exact-ID path through `--agent-profile <id>` for a caller that already
remembers the Profile created for this controller session. That path reads only
the named Profile and its primary Binding; it must never search for a
substitute. An authorization or Organization-boundary failure on the named
Profile fails closed. If Core confirms that the exact active Profile has no
primary Binding, `add-me` treats it as an incomplete earlier attempt and resumes
its Project-folder, runtime-reporting, Binding, and membership steps. A Profile
bound to another controller Session is left unchanged and the ordinary
new-Profile path is used. An unavailable or ambiguous Binding read never counts
as an unbound Profile.

`profiles current-session` is the explicit recovery lookup for a caller that
remembers creating an identity for the exact current Codex thread or Claude
Code session but no longer has its Profile ID. It performs one owner-scoped
Binding reverse lookup and reports whether the result belongs to the active
Organization. The default `add-me` path must not call it. A not-found,
unavailable, or different-Organization result never authorizes a broad Profile
scan or implicit reuse.

Profile creation is an observable commit point inside `add-me`, not proof that
the remaining setup completed. Immediately after a new Profile is committed,
CLI emits one compact recovery receipt with the exact Profile ID, the facts that
setup and Space membership are still unconfirmed, and a retry command containing
that ID. The retry command preserves non-secret identity, Project-folder,
permission, and model selections. It never prints the Space password; when the
original attempt supplied one, the receipt says that the caller may need to add
`--password` again. A later Binding or membership failure preserves its original
error and must not emit the final `space.add_me` success result.

`add-me` then adds the resolved profile to a Space. That proves only that the
normal membership path completed. Space membership and Agent Profile Binding
still do not prove Wake readiness; CLI
must keep Wake readiness under the existing readiness/reporting and diagnostic
surfaces.

With no folder option, `add-me` records its observed current directory as a
native-session import through the existing local configuration writer. Explicit
folder options record explicit configuration instead. Initialization runs under
the existing lock only when no configuration exists; a concurrent or later
saved choice wins. Reuse validates that saved choice and refuses a mismatch
rather than replacing it. Import origin is local metadata, not permission to
follow a native worktree or infer a replacement for a missing directory.

Agent-facing command output must stay compact by default. The default answer is
the result, the next useful action, and the command to inspect details. Expensive
diagnostic evidence, full trace payloads, candidate scans, and projection
internals belong behind explicit detail surfaces such as `--details`, `--json`,
or a focused trace command.

The explicit `add-me --agent-profile <id>` reuse path may need to read that
Agent Profile Binding before any Space membership write. Slow preparation
should emit sparse progress only after a short delay in Agent View or detail
mode; fast paths should stay silent. If Binding reads time out before the
membership write, the error must say that no Space membership was written
before that step completed and include the next recovery commands: check
`openmeld service status`, then retry the same `openmeld space add-me
<space-url-or-id> --project-folder <path> --agent-profile <id>` command.

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
readable directory to its canonical path and checks the selected repository
against current Project settings. `--repository <url>` names one associated
repository when a Project has several. A same-Organization folder already
connected to another Project requires the owner to see the conflict first and
repeat `bind` with `--share`; cross-Organization sharing and cross-account
reuse remain forbidden. The store remains local mode-0600 state and uploads at
most the Project id plus an optional safe repository fingerprint.
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

Session discovery canonicalizes each provider-reported working directory before
matching the target against every legal Project connection in the current lane.
A Session whose lexical path starts inside one Project but resolves through a
symlink into another is attributed only to the canonical target owner. A
missing, looping, or unreadable path is skipped fail-closed. The CLI reads path
metadata only and never uploads the local path.

Watcher roots that do not exist when the Service starts are retried after the
provider creates them. The npm CLI requires Node 22, 24, or 25; Node 24 is recommended.
The entry checks the shared setup runtime policy before loading business commands.
Standalone Bun binaries do not depend on the user's Node installation.
OpenCode SQLite reconciliation is optional capability detection, while the
managed OpenCode plugin is the low-latency primary path.

### Routines

`openmeld routines` is the terminal surface for the active organization's
personal and Team Routines. It exposes exactly eight commands:

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
projection. List/show request the v3 management contract, including scope,
executor, and available executor choices. Core enforces creator-only personal
reads and destination-scoped Team reads; CLI never infers authority locally.

Create accepts `--scope personal|team` (default personal) and
`--agent <profile-id>|center`. List exposes authorized executor choices; an Agent
uses an exact returned ID. The selected Agent supplies model and reasoning settings.
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
`developing/product/routines.md` and
`developing/engineering/development-workflow.md`.

### Space File Commands

`space files handoff` also accepts a version 2 work manifest. It binds a shared
source message revision, execution choices, and a complete brief. A manifest
without `code` uses `execution: { workspace: "isolated", access: "space_context" }`
and permits an empty or explicit shared-file selection. No Project connection
is required. A manifest with `code` requires its Project/repository fingerprint
and complete commit SHA, and keeps the existing repository access choices.
The receiving Service resolves its own local connection only for that variant
and reports the actual outcome. Reuse the client
message ID only for an unchanged retry and retain the original `--thread`.
The manifest grants no sender identity, private history, or local path access.

Selected-file work uses these explicit boundaries:

```text
openmeld space files working-copy prepare <space-id> --selection <json> --directory <new-directory>
openmeld space files working-copy status <space-id> <copy-id>
openmeld space files working-copy resume <space-id> <copy-id>
openmeld space files working-copy commit <space-id> <copy-id>
openmeld space files working-copy reconcile <space-id> <copy-id>
openmeld space files working-copy refresh <space-id> <copy-id>
openmeld space files working-copy resolve <space-id> <copy-id> --file-id <file-id> --revision <incoming-revision>
openmeld space files working-copy incoming <space-id> <copy-id> --directory <new-directory>
openmeld space files handoff <space-id> --manifest <json> --target <profile-id> --client-message-id <stable-id> [--thread <thread-id>]
```

Selection JSON follows `spaceWorkSelectionSchema`; the handoff follows
`spaceWorkHandoffSchema`. Prepare requires a fresh directory. Resume preserves
edits to completed downloads. Commit freezes changed bytes and persists their
mutation identities before upload. Reconcile retries those exact bytes after
an unknown outcome, keeping subsequent local edits dirty. Incoming downloads
the current shared versions to a separate directory for manual comparison;
it never resets the existing copy. No background watcher uploads changes.

A definite `space_file.conflict` stops retrying the rejected snapshot. For that
same copy, `refresh` downloads the conflicting shared version alongside the
working file; `status` returns its path and revision. Merge into the original
working file, then explicitly `resolve` that file against the downloaded
revision before committing. Identical local and incoming bytes can adopt that
revision without another upload. Resolve rejects an unchanged rejected snapshot
that differs from incoming, or
an unprepared revision. It neither merges automatically nor selects latest
silently. The server still rejects a base that advanced again. The original
rejected snapshot and incoming content remain available; unknown upload outcomes
continue to reconcile the same mutation instead of entering this flow.

Use commit's returned exact references in a later handoff or final reply.
Handoff posts one complete message through existing Wake admission. It does not
upload an arbitrary directory or claim that the successor started. Account or
Organization changes fence network work. Working copies are lane-, account-,
Organization-, Space-, and Profile-scoped local bookkeeping, not permission.

An admitted selected-work Wake prepares the same working copy before running.
Its `working_copy` model tool exposes status, commit, reconcile, refresh, and
resolve only for that Wake's copy; final `reply` can select returned exact file
references. Managed-copy commands require macOS; automatic workstation execution
requires the Codex App Server permission profile and actual access probe.

`openmeld space files` is the canonical terminal and workstation-Agent entry to
the current Space filesystem. The MVP commands are:

```text
openmeld space files list <space-id> [--folder <folder-id>] [--all] [--json]
openmeld space files read <space-id> <file-id> [--revision <n>]
openmeld space files upload <space-id> <local-path> [--name <name>] [--folder <folder-id>]
openmeld space files write <space-id> <file-id> --base-revision <n> (--file <local-path> | --stdin)
openmeld space files mkdir <space-id> <name> [--folder <folder-id>]
openmeld space files rename <space-id> <entry-id> <name>
openmeld space files move <space-id> <entry-id> [--folder <folder-id>]
openmeld space files trash <space-id> <entry-id>
openmeld space files download <space-id> <file-id> --output <local-path> [--force]
```

Human View uses readable rows and conflict guidance. Agent View uses canonical
JSON with stable ids, paths, revisions, actor attribution, capability flags, and
structured error codes. A local Agent uses the signed-in account and its exact
active Agent Profile; CLI does not turn local filesystem access or a Space
password into Space membership. File writes use the same revision fence as Web
and Center Agent tools and never auto-overwrite a conflict.

Before a Space File command starts, one `session_token_unavailable` credential
read is reread once. A recovered reread continues without login guidance. A
persistent failure preserves the sanitized token-store reason in Agent View and
uses `auth.session_token_unavailable` plus the sanitized cause in the existing
strict `--json` error shape; it never turns an unavailable Keychain read into a
missing-session or login-required diagnosis.

`openmeld space send <space-id> [text...] --file <path>` and the top-level
`openmeld send --space <space-id>` alias accept repeatable local paths and may
send files with or without message text. `--text-file <path>` is the distinct
UTF-8 message-body input; it must never be confused with a file being shared.
The CLI validates and uploads every selected file as a canonical root-level
Space File before publishing the message, then sends only the server-returned
file ids and revisions. A validation or upload failure leaves the message
unsent. If a later upload fails, CLI moves only files confirmed as newly
uploaded by that invocation to recoverable Trash; it never discovers cleanup
targets by name or touches existing Space Files. Any cleanup failure preserves
the original upload error and prints the exact file id and `space files trash`
command needed to finish recovery, including the actual acting Profile. For a
password-protected Space, the guidance tells the caller to reuse the same
password without printing or embedding that password in output. Thread replies
use the same message file contract.

### OpenMeld Space Action Commands

The dispatch Space Action MCP also exposes non-final `list_tasks`,
`create_task`, `start_task`, `submit_task_result`, `review_task`, and
`cancel_task` tools in an eligible shared Space. Their Space, source Signal,
and Agent actor are fixed by the active dispatch context. They call the shared
Space Task API with the task credential (see Agents, Sessions, And Sensitive
Operations) and recheck that the context
did not change before accepting the result. A Task tool does not consume or
replace the Wake's one required final Space action.

Agents create a Task only for a clear delivery obligation that needs durable
ownership, progress, review, or later closure. Questions and tiny same-turn
actions stay in Messages. Creating assigns the current Agent by default and
leaves the Task in To do; starting, result submission, review, and cancellation
are explicit revision-bound writes. Task cancellation may request the existing
Wake Stop path, but the Task receipt never claims that a process stopped.
`review_task` also requires `expectedResultRevision` from the exact submitted
result the Agent read. A Task or result revision conflict requires reading the
changed Task and making a new decision; clients never silently retry the old
decision against a newer revision. Older CLI/Service Task review tools without
this field must be upgraded and fail closed on the new server contract.
The Space owns delivery of review and rework handoffs through normal Wake
admission. A successful Task transition must not prompt the Agent to publish a
second manual Wake for that transition.

An Agent chooses exactly one dispatch-scoped OpenMeld Space Action as a Wake's
final outcome. A supported controller receives first-party `reply`, `status`,
and `stay_silent` tools for text, status, and silent outcomes. Those tools are
scoped to the current dispatch, record through the same action writer as the
CLI, and do not require approval for an arbitrary shell command. They do not
weaken the Agent Profile's controller-native filesystem, network, or general
command permissions.

`openmeld space action ...` remains the fallback, attachment, diagnostic, and
backward-compatible operation surface. In static docs,
`<DISPATCH_ACTION_CLI>` means the exact Space Action command prefix printed in
the current Wake dispatch prompt:

```text
<DISPATCH_ACTION_CLI> space action reply "message"
<DISPATCH_ACTION_CLI> space action reply --message-file <path>
printf '%s' "message" | <DISPATCH_ACTION_CLI> space action reply --message-file -
<DISPATCH_ACTION_CLI> space action reply --file <path> "message"
<DISPATCH_ACTION_CLI> space action wake "@Agent Name" "summary and request"
<DISPATCH_ACTION_CLI> space action reply --wake "@Agent Name" "message"
<DISPATCH_ACTION_CLI> space action status done "short completion update"
<DISPATCH_ACTION_CLI> space action silent --reason "No public reply is needed."
<DISPATCH_ACTION_CLI> space action targets
<DISPATCH_ACTION_CLI> space action help
```

The current dispatch prompt should present one primary final action before any
optional action forms. It tells the Agent to use the first-party Space Action
tool when available and presents the exact CLI command only as fallback.
Optional handoff, Reference, status, silent, target, help, or fallback examples
must not sit at the same priority as the primary final action for a normal Wake.

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

Both tool and CLI writes are dispatch-scoped. Write actions require the active
dispatch-owned runtime context and must fail closed without it. The command
shown to the agent inside a Wake is not a hard-coded production `openmeld` command.
OpenMeld resolves the active lane (`openmeld`, `openmeld-dev`, or `openmeld-canary`), injects a
per-dispatch CLI shim ahead of `PATH`, and binds that shim to the current
dispatch ID, target Agent Profile, and Space Action context. When the first-party
tool is unavailable, Agents should run the exact fallback `space action`
command printed in the dispatch prompt and must not rewrite it to `npx`.
The native Windows binary carrier uses its verified lane-owned `openmeld.exe`
directly for the dispatch MCP and fallback command, with the same dispatch ID,
target Agent Profile, and context in the inherited runtime environment. Windows
does not attempt to execute the POSIX shim as a process.
Outside a Wake dispatch, help must use the
`<DISPATCH_ACTION_CLI>` placeholder instead of presenting a guessed runnable
command. `targets` requires the current dispatch target snapshot.

`npx -y openmeld@latest` is valid for setup and ordinary
follow-up commands when the setup contract exposes it as `cliCommandPrefix`.
It is not the preferred visible entry for dispatch-owned Space Actions because
the action must record against the active Wake context. If a runtime needs a
package-backed implementation, OpenMeld may hide that behind the injected shim.

The first-party tool and CLI action command share one local action writer and
record one local action record for the current dispatch attempt. Neither may
publish a Space message directly or bypass
RuntimeCoordinator or Agent Transport Space Action Delivery. The daemon accepts
only this dispatch-scoped record or another typed runtime action; it never parses
model-authored answer text into a Space action. The existing diagnostic
provenance value for this shared local record path remains
`spaceActionProvenance: "cli_action"`; it is a compatibility label, not proof
that the Agent used a shell command.

`reply --message-file <path>` reads the reply body as UTF-8; `--message-file -`
reads it from stdin. This input is distinct from repeatable `--file <path>`,
which shares an attachment. A reply must use either positional message text or
`--message-file`, never both. The message-file path preserves real line breaks
and literal backslashes as separate content; it must not decode literal `\n`
sequences or reinterpret shell metacharacters.
The command result must describe that record as an unpublished proposal for the
current Wake. It must not say `Posted to Space` or otherwise claim publication;
only RuntimeCoordinator finalization followed by Space acceptance can make that
claim.

The `reply`, `status`, and `stay_silent` MCP tools advertise the shared
`dispatchSpaceActionToolResultSchema` and return it as `structuredContent`.
The receipt distinguishes `proposal_saved_locally`, `rejected_closed`, and
`outcome_unknown`; Coordinator acceptance and Space publication remain
`unconfirmed`. Local receipts include the original context, dispatch, attempt,
action type, and recording time, but never the context nonce.

After local context expiry, an exact already-recorded action may recover its
original local receipt without changing the record or extending execution
authority. Dispatch and target identity checks still apply. Different or new
actions are rejected, and file reads, uploads, and target listing still require
an active context. Invalid or unreadable records stay preserved and produce an
unknown receipt rather than a claim that nothing was recorded or published.

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

The CLI aligns OpenMeld Service first and writes that successful step, with its
device and Runtime lane evidence, to the same Prepare Session before it resolves
or writes Agent Controller selection. It reuses that recorded result for
explicit selections; it must not run a second forced Service refresh for the
same handoff. Selecting no Agent Controllers still requires the recorded Service
step before Prepare can complete.

A scheduled Service update is a durable background handoff, not aligned Service
evidence. Setup and Prepare complete only when that operation is `updated` and
the exact target CLI and Service versions are present. `restored` and
`needs_help` fail with one next action, even if stale version fields happen to
match the target.

That result is valid only for the Terminal connection epoch that wrote it. A
replacement or reconnected Terminal repeats Service alignment and the remaining
Terminal-owned work instead of inheriting device or lane evidence from the
previous connection.

When the handoff also includes a Web-approved Device Authorization code, the
CLI exchanges it for a new Computer-owned auth session. The browser and
Computer sessions must belong to the same OpenMeld user but remain independently
revocable; signing out in Web must not sign out the Computer. The grant stays
short-lived and single-use. The CLI validates the Prepare owner and candidate
session before changing local auth. A cross-account switch requires explicit
interactive confirmation. That confirmation is bound to the stable identity of
the exact committed session the user reviewed and is compared again inside the
auth mutation lock; a changed session fails closed and requires fresh review.
The Web bootstrap is piped to `sh` and may reopen the controlling terminal
for the managed CLI. Its entire install body must be one top-level shell
compound that cannot execute before the closing `fi` arrives. Any prompt
reachable from that bootstrap must use
the CLI's binary-safe interactive prompt primitive, which reads the reopened
terminal synchronously in the compiled binary. It must not bypass that owner
with an asynchronous third-party prompt. If no controlling terminal is usable,
setup must not render a prompt; it fails before mutation and tells the user to
rerun the setup command in an interactive Terminal.
Until commit, ordinary CLI processes continue to see the previous committed
session while only the transition owner and candidate OpenMeld Service can use
the candidate. The local session switch is committed only after Prepare
succeeds; cancellation or failure restores the previous local session and
Service alignment. The pending switch remains recoverable across a killed
Terminal, process crash, or computer restart: the next CLI or Service auth read
restores the previous session, or clears an incomplete first connection. Once
commit is durably recorded, restart recovery keeps the new session. `--ott`
remains a compatibility receiver for commands generated before this contract
changed and uses the same fail-atomic Prepare handoff; it is not the
Web-recommended handoff.

`computer disconnect --expected-account <id> --device <id> --runtime-lane <lane>`
is the Web Computer menu's terminal handoff. It snapshots the local session and
checks the account, device, and lane under the existing Service lifecycle lock
before using the same Disconnect operation. A mismatched target fails without
stopping a Service or clearing credentials. Publish this additive CLI command
before Web exposes the handoff; older CLI versions reject the new options.
Existing setup, Wake, Space actions, diagnostics, and Desktop's reviewed-intent
command remain compatible, so this addition does not raise a runtime contract
floor. Roll back the Web caller before rolling back the CLI.

`computer disconnect --connection-intent <json>` ends the explicitly reviewed
local account connection while retaining its cloud Computer record. The intent
uses the same expected account and stable previous-session identity as setup.
The existing Service admission owner checks that identity under its auth lock
before Stop, including same-account re-login. Controlled Stop must complete
before the existing auth owner clears that exact session; lifecycle ownership
covers both operations. A cleanup retry requires matching stopped Service intent,
environment ownership, and verified runtime absence. Desktop sign-in is separate.
Ordinary Service Stop keeps CLI credentials; cloud Forget removes the saved
Computer record. Neither is an alias for Disconnect. Entry checks must not
sign in, update, repair, or start the Service before reviewed admission.

Isolated macOS `dev-local` sign-ins use the existing private-file store when
Auth and Gateway are loopback endpoints and an explicit Home is outside the
default user-state directories (including symlink targets). The CLI warns that
this is unencrypted test storage. Existing token references are never migrated;
Service reads use the same reference after restart. Set
`OPENMELD_DEV_CREDENTIAL_STORE=system` at login to retain normal OS storage
selection; use a fresh Home and verify the provider for Keychain acceptance.
See [local development sign-in](../engineering/development-workflow.md#local-macos-cliservice-sign-in).

The signed macOS binary otherwise stores new bearer sessions in the user's macOS
Keychain through Security.framework. The bare Developer ID CLI must not request
a restricted Keychain access-group entitlement, because it has no embedded
provisioning profile and macOS would reject the executable before it starts.
The session file stores only the opaque secure-storage reference. Existing
macOS Keychain references remain readable by the packaged CLI for
compatibility. If the user's Keychain returns an error or does not answer
within five seconds, setup writes
the bearer session to a private OpenMeld directory with mode `0700` and a file
with mode `0600`, warns clearly about that fallback, and continues. Packaged
CLI Keychain operations run in a short-lived child process so a blocked
Security.framework call can be terminated without blocking setup or the
Service. Before reading its request, that child must verify through macOS Code
Signing Services that its parent is the same OpenMeld executable. Direct helper
invocation by a shell or another local program fails before Keychain access.
Every Keychain operation is noninteractive: if an existing entry needs
approval, the operation fails immediately and Agent View preserves the reason
and the interactive setup-or-login recovery path. The CLI must not create a
macOS authorization window that can outlive its helper. Normal setup and login
writes remain silent. If macOS requires interaction to save a replacement,
setup uses the documented private-file fallback instead. After one timeout,
that CLI process does not retry Keychain; a new process may try again. Access
tokens cross that private child boundary through stdin, never argv. A later
command authentication check may re-read the CLI-owned session once when the
first result is `session_token_unavailable`. A cached Keychain timeout makes
that re-read fail immediately without launching another Keychain child; other
one-off helper failures may recover through the single bounded retry. If the
session is still unavailable, the command fails closed, preserves
`session_token_unavailable` in Agent View, and tells the caller to retry from a
fresh CLI process or inspect `openmeld auth status --view agent`. It must not
promise the condition is temporary, misreport it as an invalid sign-in, or
require a new login without that evidence. A later
login through a packaged CLI stores its newly issued replacement in Keychain
only when that Keychain write succeeds, then removes the previous private file.
A failed old credential deletion is retained as pending cleanup outside the
active session and retried only during a later explicit login or logout; it is
never reported internally as deleted or silently forgotten. This cleanup does
not migrate the current private-file session into Keychain. A future signed
local client must reuse the CLI-owned session through the local OpenMeld Service
contract instead of reading the token directly or creating a parallel sign-in
state. Setup verifies that the newly stored token can be reloaded before it
writes the session file or reports success.

An npm-distributed CLI or unattended developer script that cannot embed the
native helper must never fall back to `/usr/bin/security`. New npm CLI logins
use the same warned mode-`0600` private-file fallback. An existing Keychain
reference fails immediately with a setup-or-login recovery action. Developer
HTTP tools require an isolated lane with private local token storage or must
route the request through the packaged CLI. This prevents concurrent dev
processes from queuing authorization windows that outlive the requesting
command. Logout removes the active session file even when its referenced token
cannot be read, so an unreadable old session cannot block a new login. An npm
login that replaces such a session keeps the old Keychain reference in pending
cleanup while the new private-file session becomes usable immediately.

The CLI must prove account alignment. Missing, unknown, expired, or mismatched
terminal authentication must fail closed and tell the user the next safe action.
When a stored session reaches its local expiry, a request may first ask Auth for
the session's current server expiry. A successful refresh may keep an active
Computer signed in, but a known-expired credential must never be attached when
that refresh cannot prove a future expiry. Explicitly supplied and stored
sessions use the same token-attachment decision, including host compatibility.
Sessions created before expiry metadata existed remain compatible when no
`expiresAt` value is present; malformed expiry metadata fails closed. A CLI
command stops locally with structured auth diagnostics instead of continuing as
an unauthenticated request when known credentials cannot be attached safely.

When local service identity is known, the CLI must preserve service-derived
runtime evidence such as device and lane. It must not infer runtime identity
from Web state.

For an explicit reconnect, the authenticated Prepare Session may also name the
existing `connectedComputerId` selected in Web. CLI may pass that trusted target
to local-runtime enrollment so a repaired service identity remains attached to
the same Computer. CLI must not source this target from cached local state or
reuse it across accounts, and enrollment must not create or move Agent Profile
Binding truth.

Standalone Profile setup must enroll its local runtime and save the returned
Computer identity before reporting completion. A previously accepted runtime
report is not proof of that enrollment. Tokenized Prepare setup retains its
existing trusted enrollment and reconnect target; completion must not repeat
it without that target.
Enrollment fixes the request to the Service contract's account and Gateway.
Its returned identity commits under the existing lifecycle-then-auth locks,
only while the account and exact contract state/generation remain unchanged.
A late response must not replace newer Computer evidence or restore a stopped
Service. First enrollment still preserves the running generation.
Computer Prepare may read its own pending sign-in candidate under the auth
mutation lock. The existing journal must remain pending, have the same frozen
ID, and belong to the current active process identity and Gateway. This read
does not refresh credentials or recover the journal. Other processes,
replaced/expired candidates and changed accounts cannot commit enrollment.
Ordinary Service admission still requires a committed sign-in. All canonical
contract writes and clears use the same owner-root lifecycle lock, including
ordinary installation; nested callers reuse that lock and explicit path inputs
select the matching owner root.

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
decide final Wake outcome, or decide final user-facing Wakeability.

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

For a Web Prepare handoff, `Computer connected` is the earlier, narrower
milestone: authentication is reloadable and OpenMeld Service is aligned and
connected for the intended account/device/lane. Agent Controller discovery,
Skills, diagnostics, and Project discovery may still be converging in the
background and are not implied by that result.

Successful Human View completion uses the mode-independent title `OpenMeld is
ready` and prints only the connected-computer outcome, the truthful local-agent
state, and one OpenMeld Web return link. It says the computer is connected, not
that the whole computer is ready. Each sentence occupies one line and sentences
are separated by blank lines. The CLI does not infer Setup versus Update from an
existing Computer id because reconnect can carry the same fact. An
ordinary Web handoff with an empty Agent Controller selection means background
catalog synchronization, not `None connected`; only standalone discovery that
found no supported controller may show the installation guide. CLI and Service
versions, running state, autostart controls, and stop commands remain available
through `openmeld service status`. Agent View retains the complete structured
`setup.complete` payload, and partial completion retains its reason and recovery
command.

A CLI repair flow must not claim success merely because a command ran, a
process started, a controller was detected, a service snapshot streamed, or
capability inventory exists. Repair success should be scoped to the component it
repairs and should not be projected as final Wakeability.

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
Local Runtime inventory. `computer current --brief --view agent` is the compact
Agent preflight. It returns current-computer identity, current reply blocker and
next action, the unified CLI/Service/Skill update state, and each local Agent's
reported capability status and usage-limit evidence. It does not fetch File
Access diagnostics or unrelated Computer detail. Missing usage-limit evidence
means unavailable evidence, not zero capacity.

Both inventory commands read Core's PeopleComputers projection without updating
device registration or metadata. `computer list` exposes explicit connection
evidence and `isThisComputer` from local device proof. `computer current` selects
that local device and the active CLI environment, never the account's preferred
Binding. Its legacy-shaped diagnostic inventory uses the shared
`projectPeopleComputersToLegacyLocalRuntimes` adapter; Web uses the same adapter
with its explicitly named routing preference instead of claiming browser-local
device proof. File Access diagnostics address the exact local device and lane.

`computer current --view agent` composes the complete current inventory with
the existing current-computer reply diagnostics, OpenMeld Tools
versions and update state, and a File Access summary. The summary reports mode,
revision, updated time, and selected-folder count, never local folder paths.
These commands are read-only owner tools for Local Agents; they do not make CLI
inventory or current-computer diagnostics authoritative for Agent Profile
readiness, Wakeability, or execution outcome.

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
`space access`, `space board`, `space members`, `space history`, and
`space status` accept a
canonical Space ID or a copied Space Web URL. A copied URL may select a Gateway
only through the shared trusted production, staging, fixture, or standard
loopback Web-to-Gateway mapping. Custom local Web URLs require an explicit
`--gateway-url`; the CLI must not derive an authentication or password target
from an arbitrary host. An explicit `--profile` and `--gateway-url` take
precedence over values derived from the copied URL without changing persistent
Profile selection.

`space access` is the read-only, public-capable entry preflight shared with Web.
It sends the target plus any copied message/thread focus to the Core-owned entry
resolver and must not recreate visibility or membership policy in the CLI. It
may run without authentication so Core can return a safe `sign_in_required`,
public-read, membership-blocked, password-blocked, or unavailable outcome.
Blocked outcomes are successful resolution results rather than process errors.
Agent View returns the canonical resolution plus one structured `viewAction`;
Human View states one cause and one practical next action. The command never
joins a Space, changes selected Profile state, prompts for a password, or
invents a join-request capability.

`space link <space-id>` is the passive, local link builder for the same public
Space-entry target. Optional `--signal` and `--thread-root-signal` selectors
produce a message or Thread-message destination without contacting Core,
requiring authentication, starting OpenMeld Service, or changing local Profile
state. Human View prints the link and states that access is still checked.
Agent View returns the canonical target, URL, `grantsAccess: false`, and an exact
`space access` continuation command. It must use the shared target schema and
link builder rather than manually concatenating a Web route.

Brief history retains canonical Space File references on their source messages,
including the exact revision. It omits file bytes, not the pointers required to
read them. An Agent receiving a later handoff must be able to discover an earlier
attachment without asking the user to upload it again.

`space history --kind text --brief` is the narrow check for readable recent
conversation history without presence-event noise. Brief mode caps every
message body at 1,200 Unicode code points, reports the original character count
and truncation fact, and gives an exact anchored non-brief command when the
caller genuinely needs one complete message. An anchored read always includes
the anchor itself; `--before 0 --after 0` therefore means exactly that one
message rather than an invalid empty window. Raw JSON and ordinary non-brief
history remain complete. `space status` is the current
Space/member status check. Its Human View labels the independent access facts
as `Organization visibility` and `Link access`; Agent View and explicit JSON
return `organizationVisibility` and `accessMode`. During mixed-version rollout,
an older status response may omit `organizationVisibility`; the CLI must keep
showing link access without inventing Organization visibility. The Core-owned
`latestVisibleUpdate.previewText` is a summary, not a second history payload: it
is bounded to at most 240 UTF-16 code units including any trailing ellipsis.
This status-only budget does not redefine Inbox preview sanitization. Callers
use `space history` when they need the complete message. Legacy history session
metadata may still expose `security` as a password-protection label; consumers
must use the canonical `organizationVisibility`, `accessMode`, and
`passwordProtected` fields for access decisions.

`space members <space-id>` returns current identities, full Profile IDs, and
allowed Wake/Reference/Human Mention relations. Human View shows explicit
recipient flags; Agent View keeps the validated directory and full IDs.
`space members --target <profile-id-or-mention> --brief` remains a read-only
lookup aid; resolving a name here never authorizes a send.

`space send`, its top-level `send` alias, and `space action reply` use repeatable
`--wake <agent-profile-id>`, `--reference <agent-profile-id>`, and
`--mention <human-profile-id>`. Send selectors are full current Profile IDs.
A missing member, conflicting relation, or incompatible Profile kind fails
before upload/publication. Repeating an ID in one relation is deduplicated.
Recipient flags insert visible names. A body that starts with the same selected
recipient is rejected before publication with an instruction to remove the
duplicate address. Ordinary body text is never converted into recipients.
Dispatch-owned replies still use their prompt-owned context and publication
boundary; generic send cannot replace a dispatch action.

`--continue-from` and `--fork-from` accept the original Wake request or an Agent
reply. Before publication, the CLI reads authorized message details and uses
the recorded Wake source for the selected Agent. For that Agent's reply, the
reply link selects its original request even when the reply also Wakes another
Agent. Ordinary replies from people or other Agents do not select task history.
An absent source or different target fails before any upload or message write.
Core remains authoritative for
Context access, requester, discussion scope, and execution eligibility. A valid
source identity does not guarantee resumability. `--reply-to` independently
controls thread placement; continuation never creates or selects a thread.
Continue or fork within the original discussion scope. To start work in a new
thread below a main-conversation reply, use `--reply-to` with `--new-task`;
that starts a separate task and does not carry over native session history.

For a new code task, `space send` and its `send` alias accept
`--project <slug>` and optional `--repository <url>`. The CLI reads the current
Project repository settings, uses the configured default or sole repository
when no URL is supplied, and asks for an exact URL when several repositories
remain. It freezes the Project ID and repository fingerprint in the Execution
Context selection. This option requires one `--wake` and `--new-task`; it
cannot move a continued or forked Context. Core and the current local
Service still verify the Project, repository, owner-local connection, and file
policy before execution. No CLI flag grants repository access by itself.

Project selection defaults to an independent working copy while retaining the
Agent's native permissions. `--task-workspace isolated|current` chooses placement
only. `--task-access space_context|read_only|workspace` adds an explicit task
restriction; omit it to use Agent settings and the current Computer policy.
Continuations retain their accepted settings, and forks inherit their source's
working-copy mode rather than returning an isolated task to the current folder.

Message text is literal, including old `@Name(wake)` syntax, code, and examples.
`--plain` optionally asserts that no recipient flags were supplied. Plain sends
need no member-directory read. Explicit recipients are resolved against one
current snapshot and displayed by current name; the message envelope carries
Profile IDs and relations. Agent View reports the exact addressing summary.
Interactive terminal selections retain identity beside the text; typing or
pasting the same name does not select a recipient. Raw stdio input is literal;
use `space send` recipient flags for non-interactive addressing.

Current CLI HTTP reads declare Space Addressing response version 1, and current
Space WebSocket sessions declare `spaceMessageAddressing` in the hello
capabilities. Outbound messages with a Human Mention preserve `mentionTargets`;
messages without Human Mention keep the empty retired wire field during the
compatibility window. This negotiation must not change Wake, Reference, Mention,
membership, or readiness semantics.

`space send --file <path>` accepts up to ten repeatable local paths of any MIME
type admitted by the shared Space File contract. The CLI validates every file,
uploads every canonical Space File, and only then posts the normal or thread
message with the returned references. A validation or upload failure must leave
the message unsent and preserve a structured error; the command must never
downgrade to a file-free success. `space action reply --file <path>` provides
the same output path to a Local Agent handling a Wake.

`space wake-progress <space-id-or-url>` is the live, polling-oriented Wake read. With
no selector it returns the active Wake summary for the Space. With
`--client-message <id>` it returns the progress associated with that authored
message, optionally narrowed by `--target-profile <id>`. The active summary can
also use `--source-profile <id>` to show only work requested by one Human or
Agent Profile. The CLI fails closed if a mixed-version server does not echo the
requested source filter, rather than presenting unfiltered work as filtered.
Agent View emits the stable `mode`, `pollState`, active and
terminal counts, validated query, and validated progress items. Each current
CLI read opts into Space-owned public source context: requester Profile ID,
kind, display name, sanitized source-message preview, and nullable thread ID.
While a deleted Agent's accepted Wake is still
stopping, its progress item uses the Space's frozen membership name instead of
degrading to the removed Profile id. A valid read exits zero even when `pollState` is
`idle` or `not_observed`; transport, permission, and projection failures exit
one with a structured error. The current CLI requests the optional occupancy
wait reason with `includeWaitReason=true`; older CLI versions omit that query
and must continue receiving the previous strict response shape. This command
does not replace `space result`,
which reads archived or published results, or `service trace`, which diagnoses
the execution chain. `space result --dispatch` retains an existing archive's
output. Only an explicit missing archive triggers the existing cross-runtime
trace read and an exact canonical message read. Hosted replies therefore need
no workstation archive. The additive `source: published_message` output contains
the original signal and its proven visible outcome, including failure and stop
notices. It never substitutes diagnostic text or declares completion before
publication. Authorization and storage errors remain errors. `--result-ref`
continues to select an archive only.
Wake progress, Stop, and result accept trusted Space URLs through the shared
target resolver before authentication. Explicit Profile and Gateway options
retain precedence.

`space wake-stop <space-id-or-url>` requires one Space-visible selector and an exact
target profile: either `--source-signal <id> --target-profile <id>` or
`--client-message <id> --target-profile <id>`. It must never expose
`dispatchId` as a public Stop selector. POST the exact selector directly: a
progress projection may not exist yet, so a preflight read must not block Stop.
The server remains the access and cancellation authority. `space send` accepts
`--client-message <id>` and emits a `space.send.request` receipt before file
upload or network admission. Callers can retain or supply that ID and stop the
same request while send is still pending. Agent View exits zero only for the
server-confirmed `cancelled` and
`already_cancelled` responses, exits two for `cancellation_requested`, and
exits one for permission, eligibility, transport, or semantic failure. A
pending request is not presented as a stopped Wake; Core and
RuntimeCoordinator remain responsible for the visible stopped Space outcome.

`space list --organization` reads the active Organization Space directory and
preserves Core-owned visibility, `joined`, and nullable member-count facts. It
lists every public Space plus private Spaces already joined by the current
account; the CLI does not infer membership from local history. Explicit
`--json` emits one strict versioned `space.list.organization` envelope rather
than Agent View presenter frames and retains the version 1 directory field name
`visibility`. Human and Agent Views call that fact `Organization visibility`;
they never present it as whole-Space privacy or link access.
`space join --self-serve <space-id>` asks Core
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
strict versioned `organization.directory` envelope. Both agent-facing forms
request the optional Core-owned member `lastActiveAt` projection. A local agent
therefore sees the same Organization member, Human Profile, Agent Profile,
role, and authoritative Human activity facts as Web, under the signed-in
member's current Organization authority. The CLI does not expose private local
paths, credentials, Connected Channel management authority, provisional
Profile Report drafts, or another member's owner-self controls through this
Directory command. Missing `lastActiveAt` stays absent; the CLI never fills it
from Computer, login/session, or Agent Activity timestamps.

`org computers` reads the same team-safe Organization Computers projection used
by Web and the Center Agent. Agent View exposes the exact validated Computer,
owner, local-agent controller, readiness, version, model, and capability fields
that the Organization contract permits; `--json` emits the strict versioned
`organization.computers` envelope. Usage Limits are requested explicitly on
this compatibility-sensitive endpoint so older readers keep the legacy shape.
The command never expands the projection with private local paths, account
identities, launch commands, or private skills.

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

Agent Profile owners can read or change admission through
`openmeld profiles execution-mode <profile-id> [--mode serial|parallel]`.
The command calls Core's current-Organization owner-authorized API; it does not
edit a local concurrency default or restart the Service. The response includes
the selected mode, migration phase, and revision. Serial mode limits future
reservations to one; parallel mode uses the Profile's owner-adjustable
concurrency limit, which defaults to five.
Running and waiting Wakes retain their Context, native identity, and results.
Changing this policy cannot cancel work, replay effects, or revert stored
formats. The Core/Gateway receiver must be released before this command is
distributed with the CLI.

The CLI may display Agent Profile Wakeability, but it does not own the
execution truth.

Final user-facing Wakeability comes from the Core-owned Wakeability projection.
CLI must not recompute it from:

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
is local OpenMeld Service evidence only. Local readiness labels say "Local setup
ready", not "Can reply". Access and current Usage admission remain Core-owned. It must not be labeled as final
Wakeability, final Wake truth, or final Space delivery truth.

Reply-recovery copy may use shared Agent Profile recovery semantics. The CLI
adapts terminal-local and current-local-runtime evidence into one clear next
action. The copy explains known evidence; it does not decide Wakeability truth.

## Trace And Diagnostics Boundary

CLI trace is a user-operable diagnostic surface.

For Wake diagnosis, the selector shape is:

```text
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <profileId> --view agent
```

The selector must include `clientMessageId` and `targetProfileId` for
Web-authored Wake diagnosis because one message can Wake multiple Agent
Profiles.

CLI trace reads the shared observability model. It must not become a direct PostgreSQL
reader, direct Durable Object reader, or second trace system.

The current CLI explicitly requests dispatch-trace response contract version
`7`. The detailed trace includes the Core-owned retained task assignment when
available, alongside the Service's existing conversation and working-directory
observations. An unavailable Context projection is not current Agent settings.
Its default Agent View surfaces an authoritative RuntimeCoordinator
head-waiting reason, hard deadline, wait target, and recovery action before it
considers historical attempt errors. An older Core may return the legacy
subset; the CLI must still parse that response and report only the evidence it
contains. Core and Gateway continue accepting the frozen version `2` request
used by already-published CLIs. That projection omits version-3-only disabled
Local Agent and reliable Usage head no-execution details while retaining
parseable generic dispatch and attempt evidence; the CLI must not infer the
missing exact reason from those historical facts.

An authoritative pre-result RuntimeCoordinator status such as `running` or
`completed_local` also takes precedence over the generic absence-of-final-message
`projection_pending` diagnostic. The latter explains why no final message can
yet be linked; it must not relabel active execution as final publication work or
tell the operator that the target Computer is offline.

A found Coordinator head with `status: queued` and no linked execution also
precedes `projection_pending`. Agent View reports `current_state=queued`, the
shared `runtime_coordinator.head_queued` reason, and asks the caller to wait for
the Agent's execution slot before checking again. Dispatch or attempt queue
labels alone cannot establish this state. The shared head-status reason mapper
also supplies human execution-authority diagnostics so those views agree.
This changes diagnostic values only: trace request version 3, response fields,
and parsing of older Core responses remain unchanged.

In Agent View, `--details` requests the bounded Remote Agent runtime diagnostic
projection when the selected dispatch used the hosted Center Agent. The caller
still supplies only the normal Space and dispatch selectors. Core resolves the
frozen runtime conversation generation; the CLI must not accept or reconstruct
that generation identity.

Detailed trace explains the retained runtime counters. `modelCallCount` is the
legacy field for completed agent prompt operations, each of which can contain
many tool-loop requests. `providerRequestCount` counts individual model-provider
requests. Conversation compaction is separate retained-history evidence. None
of these counters proves Space delivery. A pending final projection does not
establish that a Computer is offline, for either runtime family.

Center Agent self-diagnostics use the same exact runtime-conversation boundary
for Message Channel turns. The projection distinguishes retained runtime
evidence, a turn with no retained evidence, and an unavailable runtime read.
CLI or operator views must preserve those structured states and must not infer
tool use, completion, or failure from assistant text.

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

Exact-dispatch trace also reads native continuations that have no workstation
Dispatch Ledger row. The negotiated v6 `nativeDeliveryTrace` projection reports
the recorded native execution status, publication state, and verified final
visible outcome separately. A completed turn without a visible Space message
does not become `delivered` or `not_found`. `--details` preserves durable facts
when frozen runtime evidence is unavailable. Source-signal and client-message
lookup do not infer continuation identity without an owning durable mapping.

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

Diagnostics must not include secrets, access tokens, one-time tokens, Computer
authorization codes, passwords,
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
- `developing/product/routines.md`: Routine and Run semantics,
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
- `openmeld agent list/show` read the Core-owned MemberAgent projection; the CLI
  never derives MemberAgent state.
- A CLI-credential sensitive operation needs owner confirmation only while this
  computer runs a task whose root requester is not the owner.
- CLI must not decide Binding truth, Space truth, or RuntimeCoordinator truth.
- `space board` consumes the shared read projection and must not infer live work
  from local or historical evidence.
- `space members` consumes the shared member-directory projection and must not
  reinterpret it as membership, readiness, presence, or execution authority.
- `space send --file` and `space action reply --file` upload all validated
  canonical Space Files before posting; file failure must not publish a
  file-free fallback.
- `space files list --trash`, `space files history`, `space files restore`, and
  `space files restore-version` consume the same member-only Trash and immutable
  revision contract as Web; restoring a version creates a new latest revision.
- `space files list` defaults to artifacts only, matching Web's default; pass
  `--all` to also see files shared as chat uploads. `space files upload` always
  records the new file as an artifact; `space send --file` and
  `space action reply --file` always record theirs as chat uploads. A CLI
  build that predates this classification omits `origin` on upload; Core
  treats that omission as `artifact`, matching the pre-feature create
  default, so an old CLI keeps working against new Core without an update.
  Reading `origin` back is negotiated: a current CLI declares an explicit
  capability header on every Space Files request and gets `origin` in the
  response; a CLI build that predates this feature never declares it and
  keeps getting the exact pre-origin response shape it already parses, so
  it is never forced to update.
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
## Plugins

`openmeld plugins list`, `plugins connect <service>`, `plugins actions <service>`, and
`plugins call <service> <action-id>` use the current Organization's connected
accounts through Core. Calls require a Local Agent owned by the signed-in
account and an enabled workstation Binding; `--profile` selects that Agent.
Inside a Wake the dispatch context selects it automatically and Core reads the
recorded requester and destination to prevent accidental use of the Agent
owner's private account for another member's request. A direct CLI invocation
uses the signed-in account's authority. The local account and its Service are
the trust boundary; a dispatch ID is provenance, not a RuntimeCoordinator token
or a sandbox protecting the account from arbitrary local programs.

`plugins connect <service> --account personal|shared|choose` returns the shared
secure setup URL and an exact final-reply suffix. `choose` is only for unspecified
intent, not permission to substitute accounts during execution. In a Wake, put
`replyText` unchanged in the final reply: Web/Desktop uses the same lazy setup
surface as Hosted Agent messages. Only the original human can continue, and Core
checks the actual RuntimeCoordinator published reply, current Local Binding,
original source/revision, Thread and Local Agent Plugin permission. A connection
callback never resumes work. Subsequent Local Plugin actions enforce the private
Space account binding, including across successive Plugin setups. Standalone
CLI invocation has no conversation to resume and returns setup guidance only.

Action discovery and execution explicitly select `--account personal|shared`.
There is no fallback between these identities. `--view agent` returns the shared
structured response. `--operation` is required for execution and identifies an
exact request; changing input requires a new operation ID. High-risk actions
first return a confirmation token; the Agent must review the exact action,
input, and account with the requester before using `--confirm`. A replay reports
the previous status rather than executing again. Failed or unknown outcomes
exit unsuccessfully; discovery and confirmation are not successful execution.
## Read authorized session history

`openmeld activity history --device <id> --lane <lane> --project-id <id>
--session <native-session-id> [--provider codex|claude-code|opencode|grok-build]
[--offset <n>] [--limit <n>] --json` reads bounded
local agent messages from a connected Computer. Omitted provider means Codex.
Select IDs and provider from current Computer and
Activity inventory, not guessed paths. The Computer owner enables access for
the connected Project on the Computer page. A Wake uses its admitted
Agent identity and execution proof; missing proof cannot fall back to a human
caller. The command does not resume the source session or persist its messages.
