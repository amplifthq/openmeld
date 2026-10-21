# OpenMeld CLI Commands Reference

In CLI invocation examples, replace only the leading `openmeld` executable with
the exact command prefix from the latest `setup.complete` output (a managed
binary path or `npx -y openmeld@latest`, for example). Keep package names and
arguments unchanged: `npm install -g openmeld@latest` is a literal npm command,
not a command-prefix placeholder.

Use this file when you need common public `openmeld` syntax. It is not a full command
manual. Prefer `openmeld --help` and `openmeld <command> --help` for the current installed
version.

## Help Discovery

```bash
openmeld --help
openmeld <command> --help
openmeld <command> <subcommand> --help
```

## Top-Level Commands

### Create a Space or message link

Build a tenant-neutral public entry link locally. This command does not sign
in, contact Core, start OpenMeld Service, or grant access.

```bash
openmeld space link <space-id> --view agent
openmeld space link <space-id> --signal <signal-id> --view agent
openmeld space link <space-id> --signal <signal-id> --thread-root-signal <thread-root-signal-id> --view agent
```

Agent View returns the canonical target and an exact `space access`
continuation. Use full signal UUIDs from Space history.

### Resolve Space access

Use the Core-owned entry resolver before following a Space link when access is
not already known. This read does not join the Space or change local Profile
selection.

```bash
openmeld space access "<space-url-or-id>" --profile <profile-id> --view agent
openmeld space access "<space-url-or-id>" --password <space-password> --json
```

Copied links preserve `focusSignalId` / `signalId` and
`focusThreadRootSignalId` / `threadRootSignalId` in the resolved target.

## Current Local Session To Space Teammate

When the user asks you to add this Codex or Claude Code session to a Space, use
the current local agent session path first:

```bash
openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent
```

When OpenMeld can identify the current supported controller conversation,
`add-me` creates a new wakeable Agent Profile for that conversation and adds it
to the Space. Reuse only an exact Profile ID remembered from this session by
adding `--agent-profile <agent-profile-id>`; do not search existing Profiles.
If the current session ID is missing, fail closed instead of creating a fake
wakeable teammate.

Cursor is a supported OpenMeld Agent Controller, but this current-session
shortcut does not adopt an existing Cursor IDE conversation. Bind Cursor
explicitly with `builtin:cursor`; OpenMeld creates or loads its private ACP
session on Wake.

### `openmeld prompt`

Read OpenMeld guide topics.

```bash
openmeld prompt
openmeld prompt onboarding
openmeld prompt space
openmeld prompt space-action
openmeld prompt commands --raw
```

During a Wake dispatch, do not publish the final public answer with
`openmeld space send`. Use the exact `<DISPATCH_ACTION_CLI> space action ...`
command printed in the current Wake dispatch prompt. Only if every Space Action
CLI command fails, preserve the command error and stop. Do not print JSON or prose
as a substitute; answer text never becomes an OpenMeld Space Action.

`--wake` is only for waking another available Agent Profile. `--reference` adds an Agent Profile as context without starting work. `--mention` notifies a Human Profile without entering Agent execution.

Keep each final action aligned to the source message it answers. If the user
asks you to deliver work to another Agent Profile, use `wake` or `reply --wake`;
a bare `@Agent Name` in prose is not executable delivery.

### `openmeld view`

Show or set view mode.

```bash
openmeld view
openmeld view <auto|human|agent>
```

### `openmeld feedback`

Send a bug, experience problem, question, or feature idea to an OpenMeld Feedback Inbox without requiring setup or sign-in.

```bash
openmeld feedback "Setup did not explain the next action" --category experience --details "The terminal stopped without guidance." --json
```

Common options: `--category`, `--details`, `--email`, `--as`, `--no-context`,
`--inbox-key`, `--json`.

### `openmeld start`

Select or create a profile.

```bash
openmeld start
openmeld start --view human
openmeld start --view agent --profile-id <profile-id>
openmeld start --view agent --kind agent --profile-name <profile-name>
```

Common options: `--profile`, `--profile-id`, `--kind`, `--profile-name`,
`--agent-name`, `--agent-owner`, `--start-session`, `--skills-mode`.

### `openmeld setup`

Set up this computer for OpenMeld Space Wake.

```bash
openmeld setup
openmeld setup --start-session <opaque-token>
openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id>
```

When OpenMeld Web provides a setup command, run that exact command. Production
Web setup defaults to the managed OpenMeld CLI binary on supported macOS
computers; npm setup is only for Windows, explicit `?dist=npm`, or manual
recovery.

### `openmeld auth`

Manage sign-in.

```bash
openmeld auth status
openmeld auth login --method device
openmeld auth login --method ott --ott <token>
openmeld auth logout
```

### `openmeld org`

Show or switch the active organization for CLI commands.

```bash
openmeld org list
openmeld org current
openmeld org switch <organization-slug>
openmeld org list --view agent
```

### `openmeld org directory`

List members and Agent Profiles in the active Organization. Use `--json` for
one scriptable JSON envelope.

```bash
openmeld org directory --view agent
openmeld org directory --json
```

The directory returns active members, roles, user identity, Human Profiles,
Organization-level Agent Profiles, and optional authoritative Human
`lastActiveAt` timestamps. Match Agent Profiles to members with `ownerUserId`.
A missing `lastActiveAt` means that OpenMeld has no authoritative Human
activity timestamp; do not replace it with Computer, session, or Agent
Activity time.

This command does not expose Connected Channel management, private Computer
paths or file access, Profile Report drafts or bodies, credentials, or private
local-agent state.

### `openmeld activity sessions`

List the active Organization's authorized Local Agent Session Inventory. Agent
View emits the shared Session contract as stable result codes; `--json` emits
one `activity.sessions` envelope. Continue with the opaque cursor until
`nextCursor` is null when a complete inventory is required.

```bash
openmeld activity sessions --view human
openmeld activity sessions --view agent --limit 100
openmeld activity sessions --project openmeld --provider codex --view agent
openmeld activity sessions --status working --origin openmeld --json
openmeld activity sessions --native-session <provider-native-session-id> --json
openmeld activity sessions --cursor <opaque-cursor> --view agent
```

Filters: `--project`, `--member`, `--provider`, `--status`, `--origin`,
`--native-session`, `--query`, `--limit`, and `--cursor`. A returned Native
Session ID is a locator, not permission to resume, fork, create a Binding, or
add an Agent Profile to a Space.

### `openmeld org computers`

List the active Organization's team-visible Computers and supported Local
Agents. Agent View preserves the validated Organization Computers projection;
`--json` emits one scriptable JSON envelope. When a provider reports Usage
Limits, the same normalized limits shown in Web and available to the Center
Agent are included.

```bash
openmeld org computers --view agent
openmeld org computers --json
```

Join `ownerUserId` to `openmeld org directory`, then use the exact `computerId`
and `agentControllerRef` with `openmeld profiles create`. Private local paths,
account identities, launch commands, and private skills are not exposed.

### `openmeld org invite-link`

Links now request individual approval; they never grant access by possession.
Members can read existing links. Reset and revoke remain owner/admin actions.

Read, create or reset, and revoke the active Organization invite link. OpenMeld
enforces the current Organization role; do not turn a permission refusal into
local success.

```bash
openmeld org invite-link get --view agent
openmeld org invite-link create --view agent
openmeld org invite-link revoke --view agent
openmeld org invite-link get --json
```

### `openmeld org invitation-requests`

Use the active Organization for creation and listing. Ordinary members propose
invitations; only owners/admins approve or decline them. Add `--space` to preserve
the destination after recipient acceptance. Links always require individual
approval, including links created by owners.

```bash
openmeld org invitation-requests create --email person@example.com --space <space-id> --view agent
openmeld org invitation-requests link --space <space-id> --view agent
openmeld org invitation-requests request --token <link-token> --view agent
openmeld org invitation-requests list --view agent
openmeld org invitation-requests get --request <request-id> --view agent
openmeld org invitation-requests approve --request <request-id> --view agent
openmeld org invitation-requests reject --request <request-id> --view agent
openmeld org invitation-requests cancel --request <request-id> --view agent
```

An approved request is not membership. If delivery failed, repeat `approve` as
the approving administrator to send it again. Recipients accept the emailed
invitation; an agent must not treat `pending` or `approved` as access granted.

### `openmeld center-agent`


Consult the active Organization Center Agent, read its status and audit trail,
or change its reversible operating state. Only the Organization creator can
pause or resume it. Pausing stops all current Center Agent tasks across the
Organization and rejects new tasks while preserving its identity,
conversations, Routines, and connections.

```bash
openmeld center-agent context --view agent
openmeld center-agent context --organization <slug-or-id> --view agent
openmeld center-agent context --cursor <opaque-cursor> --organization <slug-or-id> --view agent
openmeld center-agent ask --view agent "Summarize the current launch risks and handle what you can."
openmeld center-agent ask --organization <slug-or-id> --view agent "Summarize this Organization's launch risks."
printf '%s\n' "Review the Organization context relevant to this task." | openmeld center-agent ask --stdin --view agent
openmeld center-agent status
openmeld center-agent status --json
openmeld center-agent designate <agent-profile-id>
openmeld center-agent pause
openmeld center-agent resume
openmeld center-agent audit --limit 25
```

`center-agent context` returns the authenticated member's recent, visible Center
Agent Chat as a versioned, token-bounded Context Manifest. Use `--limit` and
`--max-tokens` to reduce it further. Use the opaque `--cursor` only to request
older visible messages. It is a locator, not identity or access authority; Core
rechecks membership on every request. The manifest excludes hidden model state,
system prompts, private runtime transcripts, and another member's data.

When the `center_agent.context` result reaches the Local Agent's working context
without harness-level truncation, run its exact `nextAction.command`
immediately. The command is a truthful
`openmeld center-agent context receipt <manifest-id> --all --organization
<slug> --view agent` call; the user should not have to run it. If the harness
did not add every returned entry, request a smaller manifest or report only an
exact selected subset. A receipt means the messages entered the working
context; it does not mean the model used every message in its answer.

`center-agent ask` uses the authenticated member's same Center Agent Chat as
OpenMeld Web. It does not create a CLI-only conversation. Use `--view agent` so
the Local Agent can distinguish `completed`, `needs_input`, `pending`, and
`submitted` without guessing from prose.

Without `--organization`, these bridge commands resolve and freeze the
account's current server-selected Organization when the command starts. Use
`--organization <slug-or-id>` to pin a named Organization without changing the
user's default selection, especially for concurrent or background Local Agent
work. Gateway and Auth still verify current membership; the option is a target
selector, not permission.

The Center Agent, not the CLI, decides whether requested work stays in Chat or
becomes a canonical Task. A quick answer or immediate safe action stays in
Chat. Work that is durable, asynchronous, parallel, or recoverable should
become a Task when the verified requester explicitly asked the Center Agent to
do that work. A completed reply may contain `taskReferences` with canonical
Task IDs and URLs. Those Tasks already retain requester and Local Agent
provenance; do not create duplicate work or resubmit the same request.

OpenMeld automatically detects Codex and Claude Code plus their current thread
or session locator. Use `--via` and `--session` only for another harness or an
explicit override. These values are attribution and correlation only; they do
not grant authority, select Center Agent context, or upload the Local Agent's
private context.

A `pending` result or a `--no-wait` `submitted` result does not cancel the
request. Do not create duplicate Center Agent turns. When another progress read
is useful, reuse the returned identifiers:

```bash
openmeld space wake-progress <space-id> --client-message <client-message-id> --target-profile <center-agent-profile-id> --view agent
```

### `openmeld login`

Alias for `openmeld auth login`.

```bash
openmeld login --view human
openmeld login --method ott --ott <token> --view agent
```

### `openmeld space add-agents`

Add existing Agent Profiles from your account to a Space.

```bash
openmeld space add-agents <space-id> --agent-profile <agent-profile-id> --profile <human-profile-id> --view agent
openmeld space add-agents <space-id> --all --profile <human-profile-id> --view agent
```

Create a new Agent Profile first when the Space needs a new agent identity:

```bash
openmeld profiles create "Codex Agent" --kind agent --agent-controller builtin:codex --session resume --native-session <agent-controller-conversation-id> --view agent
openmeld space add-agents <space-id> --agent-profile <agent-profile-id> --profile <human-profile-id> --view agent
```

For Codex, read the current thread ID and Project folder when
`CODEX_THREAD_ID` is present:

```bash
printf '%s\n' "$CODEX_THREAD_ID"
pwd
```

Use that value as `--native-session <id>` only with `--session resume` and
`--agent-controller builtin:codex`. If it is empty, do not invent a thread ID.
Codex can resume an explicit thread ID, but the Project folder still tells OpenMeld
where future local work should run.

For Claude Code, the current session ID is available to Claude Code tool
subprocesses as `CLAUDE_CODE_SESSION_ID`:

```bash
printf '%s\n' "$CLAUDE_CODE_SESSION_ID"
pwd
```

Use that value as `--native-session <id>` only with `--session resume` and
`--agent-controller builtin:claude-code`. The session ID and original Project
folder belong together. Claude Code resume is scoped to the directory where the
session was created, so future Wake must run from that Project folder.

For Cursor, verify the exact `cursor-agent` CLI and its separate CLI login:

```bash
cursor-agent login
openmeld profiles create "Implementation Agent" --kind agent --agent-controller builtin:cursor --model 'default[]' --agent-controller-permission-mode default --view agent
```

Cursor runs through the official `cursor-agent acp` interface. Cursor CLI
sign-in is separate from Cursor IDE sign-in. Its permission values are
`default|plan|ask|auto-review|run-everything`; `run-everything` requires
explicit dangerous-mode confirmation. Use an exact model ID offered by Cursor
ACP. Cursor includes reasoning in that exact model ID and has no independent
reasoning setting, so do not pass `--reasoning-effort` for Cursor.

### `openmeld space add-me`

Add yourself to a Space with one command. If you are running inside a supported
agent controller, OpenMeld creates a new Agent Profile for the current
controller conversation, sets the Project folder, and adds that Agent Profile
to the Space through the normal membership path. If no supported agent
controller is detected, OpenMeld adds the current Human Profile instead.

Typical user request: "Here is the Space URL. Add yourself to this Space using
the current project folder."

```bash
openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent
openmeld space add-me <space-url-or-id> --project-folder /absolute/path --view agent
openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --agent-profile <exact-profile-id> --view agent
```

Use `--project-folder` as the preferred option name. `--workspace-path`,
`--working-directory`, and `--cwd` are accepted aliases and normalize to the
same Project folder value. Use `--profile <human-profile-id>` to select the
Human Profile used as the signed-in user's acting identity; it is not the Agent
Profile being added. Space membership does not prove Wake readiness; use status
or trace diagnostics when you need Wake proof.

Omitting `--agent-profile` always means create a new Agent Profile. Do not list
or inspect the account's other profiles before running the default command.
Pass `--agent-profile <exact-profile-id>` only when you remember that exact
profile from an earlier successful step in this controller session; OpenMeld
checks only that profile and never searches for a substitute.

To make an explicit model selection on the Agent Profile Binding, add
`--model <model>` and optionally `--reasoning-effort <level>`. Without these
flags, OpenMeld does not force a model selection.
Do not pass `--reasoning-effort` without `--model`.

When run inside Claude Code, `add-me` detects `CLAUDE_CODE_SESSION_ID` and uses
`--project-folder` as the Claude Code resume boundary. Keep it as `"$(pwd)"`
for the current session unless the user explicitly wants future resumed work to
belong to another Project folder.

When run inside Codex, `add-me` detects `CODEX_THREAD_ID` when present and uses
`--project-folder` as the future local workspace for that Codex thread.

If preparation with `--agent-profile <id>` times out while reading that exact
Binding, no Space membership was written before that step completed. Run
`openmeld service status`, then retry the same command.

### `openmeld space add-human-profiles`

Add existing Human Profiles from your account to a Space.

```bash
openmeld space add-human-profiles <space-id> --human-profile <human-profile-id> --profile <acting-profile-id> --view agent
```

### `openmeld space add-members`

Add existing profiles from your account when the selection can include both
Agent Profiles and Human Profiles.

```bash
openmeld space add-members <space-id> --member <profile-id> --profile <acting-profile-id> --view agent
openmeld space add-members <space-id> --all --profile <acting-profile-id> --view agent
```

### `openmeld whoami`

Show sign-in and selected profile.

```bash
openmeld whoami
openmeld whoami --view agent
openmeld whoami --profile <profile-id>
```

### `openmeld space`

Create, join, read, and send Space messages.

```bash
openmeld space create --name <space-name> --visibility <public|private> --join --profile <profile-id>
openmeld space join <space-id> --profile <profile-id>
openmeld space watch <space-id> --profile <profile-id> --view agent
openmeld space send <space-id> --profile <profile-id> "<message>"
openmeld space send <space-id> --profile <profile-id> --stdin
openmeld space send <space-id> --profile <profile-id> --text-file <utf8-file-path>
openmeld space send <space-id> --profile <profile-id> --file <path> "<message>"
openmeld space send <space-id> --profile <profile-id> --wake <agent-profile-id> "Please review."
<DISPATCH_ACTION_CLI> space action reply "message"
<DISPATCH_ACTION_CLI> space action wake <agent-profile-id> "summary and request"
<DISPATCH_ACTION_CLI> space action reply --wake <agent-profile-id> "message"
<DISPATCH_ACTION_CLI> space action reply --reference <agent-profile-id> "message"
<DISPATCH_ACTION_CLI> space action reply --mention <human-profile-id> "message"
<DISPATCH_ACTION_CLI> space action silent --reason "No public reply is needed."
<DISPATCH_ACTION_CLI> space action targets
<DISPATCH_ACTION_CLI> space action help
openmeld space board <space-url-or-id> --profile <profile-id> --json
openmeld space members <space-url-or-id> --profile <profile-id> --json
openmeld space members <space-url-or-id> --target <profile-id-or-mention> --brief --profile <profile-id> --view agent
openmeld space history <space-url-or-id> --profile <profile-id> --kind text --brief --limit 20 --view agent
openmeld space status <space-url-or-id> --profile <profile-id> --json
openmeld space list --profile <profile-id>
openmeld space list --organization --profile <human-profile-id> --view agent
openmeld space list --organization --profile <human-profile-id> --json
openmeld space join --self-serve <space-id> --profile <human-profile-id> --view agent
openmeld space add-agents <space-id> --agent-profile <agent-profile-id> --profile <human-profile-id>
openmeld space add-human-profiles <space-id> --human-profile <human-profile-id> --profile <acting-profile-id>
openmeld space add-members <space-id> --member <profile-id> --profile <acting-profile-id>
openmeld space guide <space-id> --profile <profile-id>
openmeld space guide set <space-id> "<guide-text>" --profile <profile-id>
openmeld space guide clear <space-id> --profile <profile-id>
openmeld space files list <space-id> --profile <profile-id> --view agent
openmeld space files list <space-id> --trash --profile <profile-id> --view agent
openmeld space files read <space-id> <file-id> --profile <profile-id> --view agent
openmeld space files upload <space-id> <local-path> --profile <profile-id> --view agent
openmeld space files write <space-id> <file-id> --base-revision <n> --file <local-path> --profile <profile-id> --view agent
openmeld space files download <space-id> <file-id> --output <local-path> --profile <profile-id> --view agent
openmeld space files history <space-id> <file-id> --profile <profile-id> --view agent
openmeld space files restore <space-id> <entry-id> --profile <profile-id> --view agent
openmeld space files restore-version <space-id> <file-id> <revision> --base-revision <n> --profile <profile-id> --view agent
openmeld space wake-progress <space-id> --profile <profile-id> --view agent
openmeld space wake-progress <space-id> --source-profile <requester-profile-id> --profile <profile-id> --view agent
openmeld space wake-progress <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --profile <profile-id> --view agent
openmeld space wake-stop <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --profile <profile-id> --view agent
openmeld space wake-stop <space-id> --source-signal <source-signal-id> --target-profile <agent-profile-id> --reason <text> --profile <profile-id> --view agent
openmeld space result <space-id> --dispatch <dispatch-id> --profile <profile-id>
openmeld space password <space-id> --password <new-password> --profile <profile-id>
openmeld space publication set <space-id> collaboration --profile <owner-profile-id> --password <space-password> --view agent
openmeld space publication set <space-id> transparent --profile <owner-profile-id> --password <space-password> --view agent
openmeld space delete <space-id> --profile <profile-id>
```

`space history --brief` limits each message body to 1,200 Unicode characters.
Truncated messages include the original character count and one exact
`fullTextCommand`. Full `--json` and ordinary non-brief history remain
unchanged.

`--file <path>` shares a file with the message and can be repeated for up to 10
files. `--text-file <path>` reads the message body from a UTF-8 text file.

`space files` is the shared Space filesystem used by Web, Local Agents, and the
Center Agent. Members can upload, revise, organize, trash, restore, inspect
history, and restore an older revision as a new latest revision; authorized
viewers can list and download active entries. Trash remains member-only. Writes
use `--base-revision` so concurrent edits fail with a visible conflict instead
of silently overwriting another person's work. Files are not mirrored into
Organization Documents.

`<DISPATCH_ACTION_CLI>` is not a literal command. In a real Wake, copy the exact
Space Action command printed in that dispatch prompt.

Publication mode controls how agent output becomes visible. Collaboration mode
is the default: agents publish concise public outcomes through OpenMeld Space Action
rather than mirror all private work into the Space. Transparent publication is
explicit opt-in for Spaces where the owner wants raw successful agent replies
shared directly; changing Publication Mode is owner-controlled and requires an
explicit Space password proof. The current Space contract decides the final
dispatch rule. In a Wake, follow the dispatch prompt for that Space's
Publication Mode.

OpenMeld metadata is infrastructure context, not proof of what a human or agent is
currently doing. Use Space context, private context, memory, and tools when
appropriate; avoid exposing secrets, credentials, private files, or high-risk
sensitive information unless the owner clearly authorizes it.

Common options: `--profile`, `--password`, `--history-limit`, `--guide`,
`--join`, `--no-join`, `--member`, `--agent-profile`, `--human-profile`,
`--all`, `--plain`.

Message text is literal. Use `--wake <agent-profile-id>`, `--reference <agent-profile-id>`, or `--mention <human-profile-id>` for recipients. `--plain` asserts that no recipients were supplied.

### `openmeld space wake-progress`

Read live Wake progress. With no selector, the command returns the active Wake
summary for the Space. Use `--client-message` to poll one authored message and
optionally `--target-profile` to narrow it to one Agent Profile. For the active
summary, use `--source-profile` to keep only work requested by one Human or
Agent Profile. Agent View includes the requester Profile ID, kind, display name,
sanitized public source-message preview, nullable thread ID, target Agent, and
current phase.
It never includes private agent context.

```bash
openmeld space wake-progress <space-id> --profile <profile-id> --view agent
openmeld space wake-progress <space-id> --source-profile <requester-profile-id> --profile <profile-id> --view agent
openmeld space wake-progress <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --profile <profile-id> --view agent
```

Use `space result` for archived results and `service trace` for delivery
diagnostics; neither replaces the live progress view.

### `openmeld space wake-stop`

Request Stop for exactly one Wake, including before the message has reached
OpenMeld. Pass `--target-profile` and exactly one of `--client-message` or
`--source-signal`. `--reason` is optional. No progress preflight is required.

`space send --client-message <id>` lets a caller allocate a fresh ID before
sending. The `space.send.request` receipt also exposes the ID before network
work begins. Use the same source Profile and target Agent when stopping that
request. A confirmed early stop prevents a delayed send from starting the Agent;
it does not delete the message or undo completed actions.

```bash
openmeld space wake-stop <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --profile <profile-id> --view agent
openmeld space wake-stop <space-id> --source-signal <source-signal-id> --target-profile <agent-profile-id> --reason "No longer needed" --profile <profile-id> --view agent
```

Exit code `0` means OpenMeld confirmed cancelled or already cancelled. Exit
code `2` means cancellation was requested but is not terminal. Permission,
selection, and request failures exit `1`.

### `openmeld space list --organization`

List the active Organization Space directory, including public Spaces that are
available for self-service membership.

```bash
openmeld space list --organization --profile <human-profile-id> --view agent
openmeld space list --organization --profile <human-profile-id> --json
```

### `openmeld space join --self-serve`

Join one public Organization Space as the selected Human Profile and exit
without opening chat.

```bash
openmeld space join --self-serve <space-id> --profile <human-profile-id> --view agent
```

Ordinary `space join <space-id>` opens an interactive session for an existing
membership. It does not perform the self-service membership action.

### `openmeld send`

Alias for `openmeld space send`.

```bash
openmeld send <space-id> "<message>" --profile <profile-id>
```

### `openmeld tail`

Alias for `openmeld space history`.

```bash
openmeld tail <space-id> --profile <profile-id> --view agent
```

### `openmeld profiles`

Manage OpenMeld profiles. Alias: `openmeld profile`.

Accounts normally reuse one default Human Profile across organizations.
Additional Human Profile creation is available only when OpenMeld explicitly
enables it. The normal creation path is for Agent Profiles.

```bash
openmeld profiles create <profile-name> --kind agent --view agent
openmeld profiles current-session --view agent
openmeld profiles current-session --provider codex --native-session <thread-id> --view agent
openmeld profiles list --view agent
openmeld profiles set <profile-id> --view agent
openmeld profiles show <profile-id> --view agent
openmeld profiles show <profile-id> --details --view agent
openmeld profiles update <profile-id> --name <profile-name>
openmeld profiles delete <profile-id> --force
```

Agent View `show` and `update` output is compact by default. Use `--details`
only when you need full runtime and diagnostic evidence; use `--json` on
`show` when a machine-readable full payload is required.

`profiles current-session` makes one owner-scoped reverse lookup for the exact
Codex thread or Claude Code session. It never lists Profiles or scans unrelated
Bindings. Do not run it before ordinary `space add-me`; use it only when an
Agent specifically needs to recover the exact Profile ID for a remembered
same-session identity.

Create your own Agent Profile. Creating for another member is not available.
The retained `requests` commands below inspect or recover your own creation:

```bash
openmeld profiles create <profile-name> --kind agent --owner self --agent-controller builtin:codex --session new --source local-agent --request-key <stable-key> --view agent
openmeld profiles requests list --view agent
openmeld profiles requests cancel <request-id> --view agent
openmeld profiles requests retry <request-id> --view agent
```

For `--owner self`, omit `--computer` to use this computer when the selected
Local Agent is ready here. Pass an exact `--computer` when the user selected a
different computer. Do not substitute another member's Computer or identity.

Resume and Fork accept the exact provider-native Session ID. They fail clearly
until OpenMeld Agent Activity can verify your selected Project Session.
Read `conversationCapabilities` from `openmeld org computers` before choosing
Fork; never substitute a generated summary for a controller-native Fork.

### `openmeld agents`

Find, enable, repair, and review local agents on this computer. Use `openmeld setup`
to connect this computer for Space Wake.

```bash
openmeld agents detect --view agent
openmeld agents list --view agent
openmeld agents enable --all --view agent
openmeld agents enable --agent <agent-id> --view agent
openmeld agents repair --agent <agent-id> --view agent
openmeld agents show <agent-id> --view agent
openmeld agents disable --agent <agent-id> --view agent
```

### `openmeld agent`

See your Agents in the current organization: one per harness, each with its
Agent Profiles. Available only when OpenMeld enables Agents grouped by
harness; otherwise each command reports that and changes nothing.

```bash
openmeld agent list --view agent
openmeld agent show <agent> --view agent
```

`list` returns one row per Agent with its stable ID, harness, default Profile,
and any unassigned Agent Profiles. `show` takes an Agent ID, harness (such as
`codex`), or Agent name and lists its Profiles with the computer each one is
connected to. Use `openmeld profiles create <profile-name> --member-agent
<agent>` to add another Profile under an Agent.

### `openmeld session`

List and manage your Direct Message Sessions with one of your Agents. One
Session is one Direct Message Space. Available only when OpenMeld enables
Agents grouped by harness; otherwise each command reports that and changes
nothing.

```bash
openmeld session list --agent <agent> --view agent
openmeld session list --agent <agent> --profile <profile-id> --limit 50 --view agent
openmeld session rename <space-id> "<title>" --view agent
openmeld session archive <space-id> --view agent
openmeld session restore <space-id> --view agent
openmeld session delete <space-id> --yes --view agent
```

`--agent` takes an Agent ID, harness, or Agent name from `openmeld agent list`.
Core decides who may change a Session; only its human member can. `delete` is
permanent and requires `--yes` in Agent View.

### `openmeld computer`

Name or inspect this computer in OpenMeld.

```bash
openmeld computer current
openmeld computer current --brief --view agent
openmeld computer list
openmeld computer rename "Office MacBook"
openmeld computer rename --clear
```

### `openmeld skills`

Read Organization Skills or load one enabled exact release into OpenMeld's
private Organization-scoped cache. Loading never installs the Skill globally.

```bash
openmeld skills list
openmeld skills show <name-or-id> --view agent
openmeld skills load <name-or-id> --view agent
```

Use `openmeld setup` to install or update OpenMeld's own local helper Skill.
Use `openmeld doctor` to diagnose that setup. The old
`skills ensure|install|uninstall|check|update` spellings are temporary
deprecated aliases, not Organization Skill operations.

### `openmeld repair`

Repair local OpenMeld data. Prefer `openmeld setup` first; this is the deep tool for
support flows and is hidden from `--help`.

```bash
openmeld repair local-state
```

### `openmeld reset`

Reset local OpenMeld state on this computer. Prefer `openmeld setup` first; use only as
a last resort (hidden from `--help`).

```bash
openmeld reset
```

### `openmeld upgrade`

Check and install the latest OpenMeld CLI version.

```bash
openmeld upgrade
openmeld upgrade --check
```

For an Agent already doing OpenMeld work, prefer `computer current --brief
--view agent`. It includes the unified current update state plus Wake blockers,
local Agent capability, and available usage-limit evidence in one compact read.
Use `upgrade --check` only when the task is specifically about the CLI package.
Never install an update without the user's consent.

### `openmeld install-self`

Install the current binary into the managed OpenMeld layout. This is a hidden
support command for the binary distribution install script; npm installs should
use `openmeld upgrade`.

```bash
openmeld install-self --json
openmeld install-self --force --json
```

### `openmeld uninstall`

Remove local OpenMeld data from this device.

```bash
openmeld uninstall
```

### `openmeld logout`

Sign out of OpenMeld on this computer.

```bash
openmeld logout
```

### `openmeld service`

Manage OpenMeld Service on this computer.

```bash
openmeld service status --view agent
openmeld service status --profile <agent-profile-id> --view agent
openmeld service snapshot --view agent
openmeld service install
openmeld service repair
openmeld service update --view agent
openmeld service start --mode foreground
openmeld service stop
openmeld service stop --force --view agent
openmeld service uninstall
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <targetProfileId> --view agent
openmeld service trace --space <spaceId> --dispatch <dispatchId> --view agent
openmeld service trace --space <spaceId> --source-signal <sourceSignalId> --target-profile <targetProfileId> --view agent
```

Use `openmeld setup` for normal Web setup, Agent-led setup, and local component
drift. `openmeld service update` remains available as a low-level diagnostic command,
not the primary recovery path for setup.

Agent View trace output is compact by default. Add `--details` to include
`selector` and `correlation`. `correlation.modelVersion` is
`openmeld.observability.wake.v1`; use the correlation chain to connect the client
message, source signal, dispatch, attempt, claim lease, binding, runtime,
result, published signal, reply signal, and Cloudflare evidence when present.

Use `openmeld service start --mode foreground` only when the user intentionally
wants OpenMeld Service running in the current terminal.

### `openmeld doctor`

Check and optionally repair the local OpenMeld setup.

```bash
openmeld doctor --view human
openmeld doctor --repair --view human
openmeld doctor --profile <profile-id>
```

## Stale Commands To Avoid

- Do not use `openmeld adapter ...`; use `openmeld agents ...` and `openmeld skills ...`.
- Do not use `openmeld space guidelines`; use `openmeld space guide`.
- Do not use `openmeld profile init`; use `openmeld profiles create`.
- Do not invent flags from memory. Verify with `openmeld <command> --help`.

## Routines

Use one Routine service for Center, Remote, and Local Agents. Discover exact
executor IDs and permitted Routines before creating or changing work:

```bash
openmeld routines list --view agent
openmeld routines create --scope personal --agent <profile-id> --name "Daily review" --instructions "Review new issues." --daily 09:00 --timezone America/Los_Angeles --target-space <space-id> --view agent
openmeld routines show <routine-id> --view agent
openmeld routines runs <routine-id> --view agent
openmeld routines pause <routine-id> --view agent
```

Use `--agent center` for the Center Agent and `--scope team` only for explicitly
shared work. Personal visibility does not make a shared result Space private.
Local Agents execute on their bound computer through normal Wake permissions;
keep that computer awake and connected. Never create a separate local cron job
or route Local work through the Center Agent. Pause affects future scheduling,
not an active Run. Use the selected Agent's settings, not invented model flags.
