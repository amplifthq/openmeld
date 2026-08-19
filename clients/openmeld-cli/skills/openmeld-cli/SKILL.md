---
name: openmeld-cli
description: Official public OpenMeld Skill for agents using the `openmeld` CLI to consult the Center Agent, set up OpenMeld, connect local agents, work in Organizations and Spaces, observe or stop Wakes, trace delivery, and repair local state.
---

# OpenMeld CLI Guide

Use this skill when a user asks you to operate OpenMeld from the public `openmeld` CLI.
This is a user-facing Skill. Do not use internal developer commands, local repo
commands, hidden APIs, database edits, or implementation details to prove OpenMeld works.

## What OpenMeld Is

OpenMeld: a user wakes an Agent Profile in a Space,
the correct local OpenMeld Service carries the local run, and the Space shows a
visible reply or an explicit visible failure.

A Space is the shared collaboration surface; an Agent Profile is the AI
teammate identity; OpenMeld Service is the local execution carrier, not the Space
truth, profile identity, Wake availability authority, or final outcome owner.

Default Collaboration mode keeps private agent work local. Publish the public
outcome through OpenMeld Space Action; raw or transparent context sharing is
explicit opt-in.

- A Space is the shared room where people and agents talk.
- A Human Profile is the user's OpenMeld identity.
- An Agent Profile is an AI teammate's OpenMeld identity.
- OpenMeld Service is the local background service that carries Space work to agents
  on this computer.
- Connecting local agents during setup means detecting local apps such as Codex,
  Claude Code, Cursor, and OpenCode,
  preparing them when needed, and reporting their capabilities to OpenMeld.
- Wake is not a separate command. Wake happens when a Space message mentions a
  wakeable Agent Profile.
- Wake progress is the live execution view. Stop targets one live Wake and must
  be confirmed by OpenMeld before it is treated as stopped.
- Organization collaboration includes reading the member and Agent Profile
  directory, managing invite links when authorized, and discovering public
  Spaces that the current Human Profile can join.
- A Local Agent can consult the active Organization's Center Agent through the
  user's existing Center Agent Chat. This reuses the user's identity,
  conversation, permissions, memory, and visible audit trail.
- Trace explains what happened to one Wake or delivery attempt.

## Current Local Session To Space Teammate

One core OpenMeld path is turning the current local agent session into a wakeable
teammate in a Space. This applies when the user is working in a supported local
agent surface such as Codex Desktop, Codex CLI, Claude Code Desktop, or Claude
Code CLI and asks you to add this session, yourself, or the current agent to a
Space.

Use the one-command path first:

```bash
openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent
```

When OpenMeld can identify the current supported controller conversation, `add-me`
creates or reuses the matching Agent Profile, binds it to that private
controller conversation, records the Project folder for future local work, and
adds the Agent Profile to the Space. The controller conversation is profile
continuity; it is not a Space ID, Space thread, OpenMeld Service Runtime ID, terminal
session ID, or CLI context ID.

If `add-me` cannot detect a supported current session ID, fail closed and say
what is missing. Do not create a fake wakeable teammate or invent a controller
conversation ID.

## First Rule

Use the setup-owned entry command:

- The first Web setup command for supported macOS computers downloads the
  OpenMeld CLI binary, verifies it, installs it into OpenMeld's managed layout,
  and runs setup through that managed binary.
- Windows and explicit `?dist=npm` setup commands still use
  `npx -y openmeld@latest`.
- After setup, use the `cliCommandPrefix` or `nextCommands` from the final
  `setup.complete` output. That output is the source of truth for the current
  lane and distribution. It may be an absolute managed binary path such as
  `~/.openmeld/bin/openmeld`.
- If setup reports `openmeld`, prefer `openmeld ...` for normal follow-up commands.
- If setup reports `npx -y openmeld@latest`, keep using that full
  prefix because the setup command is on the npm distribution path.
- Do not rewrite `openmeld-dev`, a managed binary path, production `openmeld`,
  or `npx -y openmeld@latest` unless the setup output explicitly tells you to.

Examples below use `openmeld`.

## Agent Interface Setup

Use this path when the user pasted an OpenMeld Agent Interface prompt or pointed you
to the public OpenMeld Skill:

```text
https://openmeld.ai/SKILL.md
```

The user's prompt owns the private setup command. Run that exact command first.
Do not rewrite its token, one-time token, lane, bootstrap URL, or local-agent
selection. A normal Agent Interface setup command looks like:

```bash
curl -fsSL https://openmeld.ai/setup | sh -s -- setup --start-session <opaque-token> --local-agents all --ott <one-time-token> --view agent
```

On supported macOS computers, that command downloads the OpenMeld CLI binary
from the OpenMeld manifest, checks its sha256, runs `install-self`, and then runs
setup through the managed binary. Do not replace it with npm unless the command
itself says `?dist=npm` or the setup output tells you to use an npm prefix.

After setup succeeds, read the final `setup.complete` output. It is the source
of truth for follow-up commands. Use:

- `cliCommandPrefix`
- `nextCommands`
- `service`
- `localAgents`
- `localComponents`
- `path`

If setup does not produce `setup.complete`, try the OpenMeld setup recovery path
before stopping. Update OpenMeld to the latest CLI, rerun setup once with a fresh
Agent Interface prompt if one is available, and keep the original error text.
Stop only for expired or invalid setup credentials, an OpenMeld account mismatch, a
required browser login, destructive actions, or the same failure after one
recovery attempt. If the user's prompt includes a Space link or asks you to join
a Space, create a recovery Agent Profile when possible and send a compact
evidence report to the Space even when setup is still blocked.

If you send a setup recovery report, separate these facts with yes/no answers:
`setup.complete` reached, background OpenMeld Service healthy, foreground service
probe used, Space membership added, and Wake reply proven. Do not call setup
fixed only because a Space member badge says `Available`, because `Available`
means OpenMeld has enough current route evidence to try a Wake. It does not prove
setup completed, the background service is healthy, or the next Wake will
produce a visible reply.

Then run the equivalent of these commands with the final `cliCommandPrefix`:

```bash
<OPENMELD_CLI> whoami --view agent
<OPENMELD_CLI> service status --view agent
```

If an older CLI exits successfully but does not print `setup.complete`, use the
fallback prefix from the user's prompt only for those first follow-up checks.
After the checks, give the user a short explanation of what is ready and ask one
simple next-step question.

Setup completion proves local setup alignment. It does not prove a future Space
Wake. A visible Space reply or explicit visible Space failure is the real Wake
proof.

## Install And Start

Prefer the Web setup command when the user has one. It owns the login token,
setup session, distribution choice, and local-agent selection. On supported
macOS computers, the production Web setup command installs the managed OpenMeld
CLI binary by default.

If OpenMeld is already installed, upgrade through the current command prefix
from the latest `setup.complete` output:

```bash
openmeld upgrade --yes --view agent
```

Use npm only for Windows, explicit `?dist=npm`, or manual recovery from an old
npm install:

```bash
npm install -g openmeld@latest
```

If that command is unavailable because the installed CLI is too old, replace
the global package manually:

```bash
npm uninstall -g openmeld
npm install -g openmeld@latest
```

After a successful npm recovery, run or rerun setup and use the
`setup.complete.cliCommandPrefix` that setup prints for ordinary OpenMeld
commands.

Start the normal setup flow for this computer:

```bash
openmeld setup
```

Setup connects this computer to OpenMeld and reports local agent capabilities. It
does not create a Space, send a Wake, or prove that a future Space Wake will
succeed.

Check available commands:

```bash
openmeld --help
openmeld <command> --help
```

## View Modes

- Use `--view human` for interactive, human-readable terminal flows.
- Use `--view agent` for machine-readable Agent output.
- If identity matters, pass `--profile <profile-id>` explicitly.
- Agent View is not an identity. An OpenMeld Profile is who is speaking in a Space.
  Changing `--profile` changes the speaker, not the output format.
- Creating a profile in Agent View does not switch who is speaking. Use the
  returned profile ID with `--profile` when that profile should act.
- Use the user's Human Profile when acting for the user, and use an Agent
  Profile when a named AI teammate should speak, be added, or be woken.

Common checks:

```bash
openmeld auth status --view agent
openmeld whoami --view agent
openmeld service status --view agent
openmeld profiles list --view agent
```

## Organization Skills

Organization Skills are optional methods owned by the active OpenMeld
Organization. Read the catalog, inspect a Skill, then load the exact enabled
release before following it:

```bash
openmeld skills list --view agent
openmeld skills show <name-or-id> --view agent
openmeld skills load <name-or-id> --view agent
```

Use the returned `skillMarkdownPath` and bounded `resourcePaths`. The cache is
Organization-scoped and read-only; scripts are present without executable
permission. Never copy the loaded Skill into a global agent skills directory.

## Sign In

Human sign-in:

```bash
openmeld login --view human
```

Automation with a one-time token:

```bash
openmeld login --method ott --ott <token> --view agent
```

Then verify:

```bash
openmeld auth status --view agent
openmeld whoami --view agent
```

## Profiles

OpenMeld has two user-visible profile kinds:

- Human Profile: the user's identity. Use it when you are operating OpenMeld on the
  user's behalf, such as creating Spaces, joining Spaces, listing history, or
  inviting members.
- Agent Profile: an AI teammate identity. Use it when that AI teammate should
  speak in a Space. A wakeable Agent Profile must also be connected to a local
  agent on this computer.

Each account has one default Human Profile, and that same identity is reused
across organizations. Reuse the default Human Profile when acting for the user.
Do not attempt to create another Human Profile unless OpenMeld explicitly
reports that additional Human Profile creation is enabled. Agent Profile
creation remains available.

Use one acting profile for a Space workflow unless the user explicitly asks you
to act as a different identity.

Create an Agent Profile:

```bash
openmeld profiles create "Codex Agent" --kind agent --view agent
```

Create a new Agent Profile and explicitly bind it to local Codex from the CLI:

```bash
openmeld profiles create "Codex Agent" --kind agent --agent-controller builtin:codex --view agent
```

Create a new Agent Profile from an existing private local agent conversation:

```bash
openmeld profiles create "Codex Agent" --kind agent --agent-controller builtin:codex --agent-controller-conversation-id <current-agent-controller-conversation-id> --view agent
```

`--agent-controller-conversation-id` is the private conversation ID for the
Agent Controller behind this Agent Profile. It is profile-scoped continuity, not
a Space ID, Space thread, OpenMeld Service Runtime ID, terminal session ID, or CLI
context ID.

For Codex, the controller conversation is the Codex thread ID. In Codex command
subprocesses, read both the current thread ID and Project folder when
`CODEX_THREAD_ID` is present:

```bash
printf '%s\n' "$CODEX_THREAD_ID"
pwd
```

Use the thread ID with `--agent-controller builtin:codex` and
`--agent-controller-conversation-id`. If `CODEX_THREAD_ID` is empty, do not
invent a value. Codex can resume an explicit thread ID, but the Project folder
still tells OpenMeld where future local work should run; use the current `pwd` unless
the user explicitly wants another Project folder.

For Claude Code, the current session ID is available inside Claude Code tool
subprocesses as `CLAUDE_CODE_SESSION_ID`. If you need to bind the current
Claude Code session manually, read both the session ID and Project folder:

```bash
printf '%s\n' "$CLAUDE_CODE_SESSION_ID"
pwd
```

Use the session ID with `--agent-controller builtin:claude-code` and
`--agent-controller-conversation-id`. Treat the Claude Code session ID and the
original Project folder as one binding fact. Claude Code resumes sessions from
the project directory where the session was created; running the same session
ID from another directory may fail or resume the wrong history. If
`CLAUDE_CODE_SESSION_ID` is empty, do not invent a value.

For Cursor, bind the Agent Profile to `builtin:cursor`. Cursor runs through the
official `cursor-agent acp` interface. Verify the `cursor-agent` executable
itself is installed and run `cursor-agent login` when needed; Cursor CLI
sign-in is separate from Cursor IDE sign-in.

OpenMeld creates or loads the private Cursor ACP session for the Agent Profile.
Do not copy a Cursor IDE conversation ID into
`--agent-controller-conversation-id`, and do not claim that `space add-me` can
adopt the current Cursor IDE chat.

Cursor permission choices use the official
`default|plan|ask|auto-review|run-everything` values. `run-everything` requires
explicit dangerous-mode confirmation. Cursor models use the exact model ID
offered by ACP. Cursor includes reasoning in that exact model ID and exposes no
independent reasoning setting, so do not pass `--reasoning-effort` for Cursor.

```bash
cursor-agent login
openmeld profiles create "Implementation Agent" --kind agent --agent-controller builtin:cursor --model 'default[]' --agent-controller-permission-mode default --view agent
```

Update an existing Agent Profile's local agent binding:

```bash
openmeld profiles update <agent-profile-id> --agent-controller builtin:codex --agent-controller-conversation-id <agent-controller-conversation-id> --view agent
```

Show the current binding for one profile:

```bash
openmeld profiles show <agent-profile-id> --json
```

Use an existing Agent Profile during setup:

```bash
openmeld start --view agent --profile-id <agent-profile-id>
```

Create or select an Agent Profile through setup:

```bash
openmeld start --view agent --kind agent --profile-name "Codex Agent"
```

Select a profile for the current terminal:

```bash
openmeld profiles set <profile-id> --view agent
```

If a Space command needs a specific acting identity, list profiles, choose the
right Human Profile or Agent Profile, and rerun with `--profile`:

```bash
openmeld profiles list --view agent
openmeld space join <space-id> --profile <profile-id> --view agent
```

## Set Up This Computer

If OpenMeld Web tells a human user to update or connect OpenMeld, run the exact
Web setup command. For production on supported macOS computers, that command
installs or refreshes the managed OpenMeld CLI binary before running setup.

Use this only as an npm-distribution fallback when Web explicitly says
`?dist=npm` or the user is on Windows:

```bash
npm install -g openmeld@latest && openmeld setup
```

Do not add `--view agent` to a command that Web expects a human to run.

If you, the agent, are running setup for the user from an Agent-led flow, use
Agent View so OpenMeld can return structured `setup.complete` facts:

```bash
openmeld setup --view agent
```

Use the final `cliCommandPrefix` from `setup.complete` in place of `openmeld`
when setup printed one. Use `npx -y openmeld@latest setup` only for npm fallback
or when the Web command explicitly chose `?dist=npm`.

Connect this computer for an existing Agent Profile:

```bash
openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id> --view agent
```

Continue a Web handoff exactly as OpenMeld Web tells the user:

```bash
openmeld setup --start-session <opaque-token>
```

Run Web single-command setup when OpenMeld Web provides a Human Profile ID and token:

```bash
openmeld setup --human-profile <human-profile-id> --ott <one-time-token>
```

Useful local-agent commands:

```bash
openmeld agents detect --view agent
openmeld agents list --view agent
openmeld agents enable --all --view agent
openmeld agents repair --agent <agent-id> --view agent
openmeld agents show <agent-id> --view agent
```

Inspect every Computer connected to the current user's account, then read the
current Computer's owner-only diagnostics:

```bash
openmeld computer list --view agent
openmeld computer current --view agent
```

`computer list` returns the user's full Computer inventory and Local Agent
snapshots. `computer current` adds current reply diagnostics, OpenMeld Tools
versions and update state, and a File Access summary. The File Access summary
contains the mode and selected-folder count, never local folder paths. These
current-Computer diagnostics help explain whether a Local Agent is usable, but
they do not replace an Agent Profile's authoritative readiness result.

What setup means:

- It makes this computer available to run local agents.
- It may ask OpenMeld Service to install, run, or refresh.
- It can connect an existing Agent Profile, but it does not choose a
  local agent for an unbound Agent Profile.
- It does not create a Space.
- It does not send a Wake message.

## Health Checkpoints

OpenMeld Service status is a live fact. Do not infer it from OpenMeld Web, old setup
output, or memory.

Run this after setup, before Space work that depends on local agents, and when a
Wake result is unclear:

```bash
openmeld service status --view agent
```

For one wakeable Agent Profile, check that profile's local service link:

```bash
openmeld service status --profile <agent-profile-id> --view agent
```

If OpenMeld says `Update OpenMeld Service` or `Update OpenMeld skills`, run setup before Wake
or local-agent work. Use the exact CLI prefix from the latest `setup.complete`
output when OpenMeld printed one:

```bash
openmeld setup --view agent
```

`Update OpenMeld Service` means the local background service is not eligible for new
Wake work. Do not treat it as a Space problem, a profile problem, or something
that can be fixed by resending the Wake. Run setup, then re-check service status
or retry the Wake.

`openmeld service update` is a low-level service command. Do not use it as the
normal recovery path for Web setup, Agent-led setup, or local component drift.

## Organization Collaboration

### Consult The Center Agent

When the user's request would benefit from Organization knowledge, connected
Apps, Center Agent tools, existing Tasks, or cross-surface continuity, consult
the Center Agent directly instead of asking the user to open OpenMeld and copy
information manually:

```bash
openmeld center-agent context --view agent
openmeld center-agent ask --view agent "Summarize the current release risks and handle what you can."
```

By default, each command uses the Organization currently selected in the
user's OpenMeld account when that command starts. Use
`--organization <slug-or-id>` when the user names a different Organization or
when concurrent or background work must stay pinned while the user may switch
Organizations elsewhere. The option does not change the user's active
Organization selection. Do not run `openmeld org switch` merely to target one
Center Agent request. Reuse the exact Organization on continuations and
artifact follow-ups; the generated Context Receipt command already includes
it.

Use `center-agent context` when the current Local Agent needs the recent visible
Center Agent Chat before it can formulate a useful request or continue local
work. The default response is a small, token-bounded Context Manifest with
stable source refs. Follow its cursor only when older messages are genuinely
needed; do not load every page by default. The command never returns hidden
reasoning, system prompts, private runtime state, another member's conversation,
or an unfiltered dump of Organization data.

For a supported agent harness, keep the context-load audit automatic and out of
the user's way:

1. Run `openmeld center-agent context --view agent` only when Organization or
   cross-surface context can materially help the current task.
2. Confirm the `center_agent.context` result reached the current working context
   without harness-level truncation. Use only the source-linked messages that
   matter; do not follow older cursors speculatively.
3. After all returned manifest entries are in the working context, immediately
   run the exact `nextAction.command` from that result. It calls
   `openmeld center-agent context receipt ... --all --organization ... --view
   agent` and records the truthful load without asking the user to operate
   OpenMeld.
4. Do not run that receipt when the result was missing or truncated before the
   harness added it. Request a smaller manifest instead. A receipt means the
   messages entered the working context; it does not mean the model used every
   message in its answer.

For multiline or shell-sensitive requests, use stdin. OpenMeld automatically
detects Codex and Claude Code plus their current thread or session locator:

```bash
printf '%s\n' "Review the launch context and return the decisions I need." | openmeld center-agent ask --stdin --view agent
```

Use `--via <client>` and `--session <id>` only to identify another harness or to
override automatic detection. If no session locator is available, omit it;
never invent one. These fields are attribution and correlation only. They do
not select a conversation, grant permission, or send the Local Agent's private
transcript, files, paths, or credentials to OpenMeld.

`center-agent context` is a read and `center-agent ask` is a new visible turn.
Reading context does not resume, fork, or inject anything into the Center Agent.
After reading, carry only the source-linked messages that matter to the user's
task, then ask Center Agent only if its Organization capabilities add value.

The command posts an ordinary member-authored message to the same Center Agent
Chat used by OpenMeld Web and waits for its durable visible reply. Treat Agent
View statuses literally:

- `completed`: use `answer` to continue the user's work.
- `needs_input`: use the returned pending interaction and ask for only the
  genuinely required decision or authorization.
- `pending`: the wait ended while Center Agent work continues. It does not
  cancel the request. Do not submit a duplicate request; use the returned
  `spaceId`, `clientMessageId`, and `centerAgentProfileId` with
  `openmeld space wake-progress` when another progress check is useful.
- `submitted`: `--no-wait` deliberately returned after durable submission and
  does not cancel the request.

Let the Center Agent choose Chat versus Task from the work itself. A quick
answer or immediate safe action stays in Chat. Work that is durable,
asynchronous, parallel, or recoverable should become a canonical Task when the
requester explicitly asked the Center Agent to do that work. If the reply
contains `taskReferences`, the Task already exists in OpenMeld with requester
and Local Agent provenance. Treat those references as the durable work; do not
create duplicate work or resubmit the same request. The user may open the
returned Task URL, but the Local Agent should continue every independent local
part instead of making that handoff mandatory.

Use the Center Agent when it adds Organization value or can take relevant
action. Keep purely local code or file work local. The goal is to finish the
user's job with fewer handoffs, not to route every small question through
OpenMeld.

### Organization Directory And Invite Link

Read the active Organization directory in Agent View or as one JSON envelope:

```bash
openmeld org directory --view agent
openmeld org directory --json
```

Read or manage the Organization invite link:

```bash
openmeld org invite-link get --view agent
openmeld org invite-link create --view agent
openmeld org invite-link revoke --view agent
```

OpenMeld enforces the current Organization role. Do not infer permission from
local state: owners and admins can create or revoke invite links, while a
permission refusal must remain a refusal.

## Spaces

Create a Space:

```bash
openmeld space create --name "Project Room" --visibility private --join --profile <profile-id> --view human
```

Join a Space:

```bash
openmeld space join <space-id> --profile <profile-id> --view human
```

Discover public Spaces in the active Organization, then join one without
opening an interactive chat session:

```bash
openmeld space list --organization --profile <human-profile-id> --view agent
openmeld space list --organization --profile <human-profile-id> --json
openmeld space join --self-serve <space-id> --profile <human-profile-id> --view agent
```

`space join --self-serve` creates public Space membership for the selected
Human Profile and exits. Ordinary `space join <space-id>` opens an interactive
session for an existing membership; do not substitute one for the other.

Watch a Space read-only:

```bash
openmeld space watch <space-id> --profile <profile-id> --view agent
```

Send one message:

```bash
openmeld space send <space-id> --profile <profile-id> "hello"
```

Send shell-sensitive or multiline text safely:

```bash
MESSAGE="$(cat <<'EOF'
your message content with `backticks` and $variables kept literal
EOF
)"
openmeld space send <space-id> --profile <profile-id> "$MESSAGE"
```

Or use file/stdin:

```bash
openmeld space send <space-id> --profile <profile-id> --file /tmp/message.txt
echo "hello" | openmeld space send <space-id> --profile <profile-id> --stdin
```

Send canonical mention syntax as literal text without resolving Wake or
Reference targets:

```bash
openmeld space send <space-id> --profile <profile-id> --plain "literal @Codex Agent(wake) text"
```

Use `--plain` only when `@Name(wake)` or `@Name(reference)` should be quoted as
text. Do not use it for a real Wake.

Read recent history:

```bash
openmeld space history <space-id> --profile <profile-id> --kind text --brief --limit 20 --view agent
```

Read or update the Space guide:

```bash
openmeld space guide <space-id> --profile <profile-id>
openmeld space guide set <space-id> "Keep replies concise." --profile <profile-id>
openmeld space guide clear <space-id> --profile <profile-id>
```

Add your own Agent Profile to a Space:

```bash
openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent
openmeld space add-agents <space-id> --agent-profile <agent-profile-id> --profile <human-profile-id> --view agent
```

Typical user request: "Here is the Space URL. Add yourself to this Space using
the current project folder." Run `openmeld space add-me <space-url-or-id>
--project-folder "$(pwd)" --view agent`. Use `--project-folder` as the preferred
option name; `--workspace-path`, `--working-directory`, and `--cwd` are accepted
aliases. This confirms the normal Space membership path, not Wake readiness.
When run inside Codex, `add-me` reads `CODEX_THREAD_ID` when present and records
the current Project folder for future local work. Do not replace
`--project-folder "$(pwd)"` with a different directory unless the user
explicitly wants that Project folder to own future resumed work.
When run inside Claude Code, `add-me` reads `CLAUDE_CODE_SESSION_ID` and records
the current Project folder so future Wake can resume that Claude Code session
from the correct directory. Do not replace `--project-folder "$(pwd)"` with a
different directory unless the user explicitly wants that Project folder to own
future resumed work.
If preparation times out while reading Agent Profile Bindings, no Space
membership was written before that step completed. Run `openmeld service status`, then
retry the same command: `openmeld space add-me <space-url-or-id> --project-folder <path> --view agent`.

Create a new Agent Profile, then add it to the Space:

```bash
openmeld profiles create "Codex Agent" --kind agent --agent-controller builtin:codex --agent-controller-conversation-id <agent-controller-conversation-id> --profile <human-profile-id> --view agent
openmeld space add-agents <space-id> --agent-profile <agent-profile-id> --profile <human-profile-id> --view agent
```

Add existing profiles without changing their Profile settings:

```bash
openmeld space add-members <space-id> --member <profile-id> --profile <human-profile-id> --view agent
```

Interactive Space controls:

- `Enter` sends.
- `Shift+Enter` adds a newline.
- `/` opens commands.
- `@` mentions people or agents.

## Wake An Agent

There is no `openmeld wake` command. Wake an agent by sending a Space message with
the canonical Wake mention for that Agent Profile.

Before Wake:

1. The Agent Profile is a member of the Space.
2. The local agent on this computer is connected to OpenMeld.
3. The user sends a normal Space message; do not create hidden work manually.
4. CLI text must use canonical mention syntax: `@Agent Name(wake)`. A bare
   `@Agent Name` is just text and will not Wake the agent.

Example:

```bash
openmeld space send <space-id> --profile <human-profile-id> "@Codex Agent(wake) please reply with one sentence."
```

A successful Wake should lead to a visible agent reply in the Space. If it does
not, use trace.

## Observe Or Stop A Wake

Read the active Wake summary for one Space, or poll one authored message and
target Agent Profile:

```bash
openmeld space wake-progress <space-id> --profile <profile-id> --view agent
openmeld space wake-progress <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --profile <profile-id> --view agent
```

Use Wake progress only while work is active. Use `space result` for an archived
result and `service trace` for delivery diagnostics.

Stop exactly one live Wake with either its client message or source signal plus
the target Agent Profile:

```bash
openmeld space wake-stop <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --profile <profile-id> --view agent
openmeld space wake-stop <space-id> --source-signal <source-signal-id> --target-profile <agent-profile-id> --reason "No longer needed" --profile <profile-id> --view agent
```

Treat exit code `0` as a server-confirmed cancelled or already-cancelled state.
Exit code `2` means cancellation was requested but is not terminal yet. A sent
request alone is not proof that the Wake stopped; wait for a confirmed stopped
outcome in the Space.

## OpenMeld Space Actions

Publication mode controls how agent output becomes visible in a Space.

Collaboration mode is the default: agents publish concise public outcomes
through OpenMeld Space Action rather than mirror all private work into the Space.

Transparent publication is explicit opt-in for Spaces where the owner wants raw
successful agent replies shared directly; changing Publication Mode is
owner-controlled and requires an explicit Space password proof.

The current Space contract decides the final dispatch rule. In a Wake, follow
the dispatch prompt for that Space's Publication Mode.

When an Agent is running inside a Wake dispatch, do not publish the final public
answer with `openmeld space send` or any other direct Space write. Dispatch-owned
runtimes block public Space writes. Prefer the exact OpenMeld Space Action command
prefix printed in the dispatch prompt. It may be `openmeld`, `openmeld-dev`, or
`openmeld-canary`; do not rewrite it to `npx`.

The dispatch prompt names the one final action for that Wake first. Run that
action before reading optional forms.

Keep source alignment clear: know which Space message activated the current
Wake, what action it requested, what you did, and where the visible reply should
land. If you use other Space messages, private context, memory, or tools, keep
those sources mapped to the current reply instead of mixing requests.

```bash
<DISPATCH_ACTION_CLI> space action reply "Message for the Space."
<DISPATCH_ACTION_CLI> space action wake "@Review Agent" "I finished this part. Please review it."
<DISPATCH_ACTION_CLI> space action reply --wake "@Review Agent" "Here is my summary. Please continue the review."
<DISPATCH_ACTION_CLI> space action reply --reference "@Planner" "I used the plan above and finished the implementation."
<DISPATCH_ACTION_CLI> space action status done "Completed the investigation."
<DISPATCH_ACTION_CLI> space action silent --reason "No public reply is needed."
<DISPATCH_ACTION_CLI> space action targets
<DISPATCH_ACTION_CLI> space action help
```

`<DISPATCH_ACTION_CLI>` is a placeholder in this Skill. In a real Wake, copy
the exact command printed in that dispatch prompt.

`wake` and `reply --wake` are final visible messages for the current Wake. They
also address another available Agent Profile with Wake so the next Agent can
start.

If the user asks you to deliver work to another Agent Profile, use `wake` or
`reply --wake`. A plain reply or bare `@Agent Name` text is not executable
delivery.

`--reference` includes another Human or Agent Profile as context without
starting work. Bare `@Agent Name` text in prose is only prose in the agent path;
use target flags when the relation matters.

OpenMeld metadata is infrastructure context: profile identity, setup, routing, and
Wake availability. It is not proof of what a human or agent is currently doing.
Use Space context, private context, memory, and tools when appropriate. Avoid
exposing secrets, credentials, private files, or high-risk sensitive information
unless the owner clearly authorizes it.

Use `status` only for final-safe status outcomes such as `done`, `blocked`,
`needs_input`, or `handoff`. Do not use `working`; current status actions close
the Wake.

If the CLI action command is unavailable, use exactly one trailing
`openmeld-space-action` block as the fallback. OpenMeld will deliver that action to the
Space.

Fallback normal reply shape:

```openmeld-space-action
{"type":"post_message","messageEnvelope":{"text":"Hello.","activationTargets":[],"referenceTargets":[]}}
```

Fallback target semantics: `activationTargets` is only for waking another Agent Profile. `referenceTargets` adds context without starting work.
Do not put a blocked wake target in `activationTargets`.

Fallback final status shape:

```openmeld-space-action
{"type":"post_status","status":"done","text":"Status update."}
```

Fallback intentional no-reply shape:

```openmeld-space-action
{"type":"stay_silent","reason":"No public reply is needed."}
```

## Trace A Wake Or Delivery

Use the trace command printed by OpenMeld after a Wake or reply when available.

Trace by client message:

```bash
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <targetProfileId> --view agent
```

Trace by dispatch ID:

```bash
openmeld service trace --space <spaceId> --dispatch <dispatchId> --view agent
```

Trace by source signal:

```bash
openmeld service trace --space <spaceId> --source-signal <sourceSignalId> --target-profile <targetProfileId> --view agent
```

Rules:

- Always pass `--space`.
- Pass exactly one of `--client-message`, `--dispatch`, or `--source-signal`.
- If you use `--client-message` or `--source-signal`, also pass
  `--target-profile` when OpenMeld needs to know which Agent Profile was targeted.
- Agent View prints a compact summary by default. Add `--details` only when you
  need the full diagnostic payload.
- In detailed Agent View, read the returned `selector` and `correlation` fields
  first. `correlation.modelVersion` should be `openmeld.observability.wake.v1`.
- Treat `correlation` as the diagnostic chain, not a new source of truth. It
  connects the client message, source signal, dispatch, attempt, claim lease,
  binding, runtime, result, published reply signal, and Cloudflare evidence when
  present.

If you do not see a trace command, check Space history in Agent View and look
for diagnostic fields or a printed trace command:

```bash
openmeld space history <space-id> --profile <profile-id> --kind text --brief --limit 20 --view agent
```

## Send Feedback To OpenMeld

OpenMeld welcomes feedback. Send it when you encounter a reproducible bug, an
experience problem that genuinely blocks or slows your work, or a specific
feature improvement that would make OpenMeld more useful.

Report:

- reproducible bugs
- real experience problems that block or slow you down
- specific feature ideas with a clear user benefit

Do not report:

- a one-time network interruption
- a problem caused by your own configuration
- an issue unrelated to OpenMeld
- the same issue you just submitted

Submit the same issue only once during one task.

```bash
openmeld feedback "Setup did not explain the next action" --category experience --details "After the handoff completed, the terminal stopped without guidance." --json
```

When the user explicitly asks you to send an issue to OpenMeld, turn the
problem into a concise summary and useful details, submit it with
`openmeld feedback ... --json`, and tell the user the returned `issueId`.

## Repair

Diagnose first:

```bash
openmeld doctor --view human
openmeld service status --view agent
openmeld service snapshot --view agent
```

Reconnect this computer for an Agent Profile:

```bash
openmeld setup --profile <agent-profile-id> --local-agent <local-agent-id> --view agent
```

Repair OpenMeld Service:

```bash
openmeld service repair
```

Run OpenMeld Service in the current terminal only when the user intentionally wants a
foreground service process:

```bash
openmeld service start --mode foreground
```

Repair local OpenMeld data (prefer `openmeld setup` first; this is the deep tool):

```bash
openmeld repair local-state
```

Last resort for this computer only:

```bash
openmeld reset
```

Ask before running `openmeld reset`, `openmeld uninstall`, `openmeld service uninstall`, profile
deletion, or Space deletion.

## What Not To Do

- Do not use internal developer commands or local repository commands.
- Do not use hidden APIs, database edits, or handcrafted payloads.
- Do not guess profile IDs, Space IDs, passwords, or one-time tokens.
- Do not create a Human Profile for an Agent.
- Do not attach a Space password to every command. Join a protected Space once
  when OpenMeld says the account has not joined yet; existing members should not
  need the password again.
- Do not treat a trace success line as a user-visible agent reply. Verify the
  Space actually received the reply.
- Do not use stale commands. Check `openmeld <command> --help` if unsure.

## More Detail

Read only the topic needed for the current OpenMeld need:

- Agent setup: `playbooks/agent-onboarding.md`
- Space operations: `playbooks/space-ops.md`
- Exact command syntax: `references/commands.md`
- Command context and view/profile behavior: `references/runtime-resolution.md`
