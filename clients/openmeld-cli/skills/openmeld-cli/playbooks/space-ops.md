# Space Operations Playbook

Use this when an external user or Agent needs to create, join, read, send, or
diagnose OpenMeld Space activity with the public `openmeld` CLI.

## Basic Rules

- A Space ID is a 64-character hex string.
- Use explicit `--profile <profile-id>` in Agent or multi-terminal workflows.
- An OpenMeld Profile is who is speaking in a Space. Changing `--profile` changes
  the speaker, not the output format.
- Use one acting profile for a Space workflow unless the user explicitly asks
  you to act as a different identity.
- Ask the user for a Space password when needed. Do not guess.
- Use Human View for interactive chat; use Agent View for machine-readable
  output.

## Create Or Join

Create a Space:

```bash
openmeld space create --name "Project Room" --visibility private --join --profile <profile-id> --view human
```

Join a Space:

```bash
openmeld space join <space-id> --profile <profile-id> --view human
```

Discover public Spaces in the active Organization and join one as the current
Human Profile without opening chat:

```bash
openmeld space list --organization --profile <human-profile-id> --view agent
openmeld space list --organization --profile <human-profile-id> --json
openmeld space join --self-serve <space-id> --profile <human-profile-id> --view agent
```

Organization visibility controls discovery and self-serve joining inside the
Organization; link access controls what someone with the Space link can do.
Use `space status` to read both facts before describing the Space as private or
public. Agent View uses `organizationVisibility`; version 1 explicit JSON keeps
the compatibility field name `visibility`.

Use ordinary `space join <space-id>` only to open an interactive session for an
existing membership. Use `--self-serve` only for the public Organization Space
membership action.

Watch read-only:

```bash
openmeld space watch <space-id> --profile <profile-id> --view agent
```

Add the current local agent session to the Space:

```bash
openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent
openmeld space add-agents <space-id> --agent-profile <agent-profile-id> --profile <human-profile-id> --view agent
```

When the user sends a Space URL and asks you to add yourself using the current
project folder, prefer `openmeld space add-me <space-url-or-id> --project-folder
"$(pwd)" --view agent`. `--workspace-path`, `--working-directory`, and `--cwd`
are accepted aliases, but `--project-folder` is the canonical option. This
confirms Space membership only; it does not prove Wake readiness.

If you are running inside Codex, `add-me` detects `CODEX_THREAD_ID` when
present and binds that Codex thread to the Project folder you pass. If you
manually create or update the Agent Profile instead, read both:

```bash
printf '%s\n' "$CODEX_THREAD_ID"
pwd
```

Use the thread ID as `--agent-controller-conversation-id` with
`--agent-controller builtin:codex`. If it is empty, do not invent a thread ID.
Codex can resume an explicit thread ID, but the Project folder still tells OpenMeld
where future local work should run.

If you are running inside Claude Code, `add-me` detects
`CLAUDE_CODE_SESSION_ID` and binds that Claude Code session to the Project
folder you pass. Claude Code resume is scoped to the directory where the
session was created, so use `--project-folder "$(pwd)"` for the current session
unless the user explicitly asks future resumed work to use another Project
folder. If you manually create or update the Agent Profile instead, read both:

```bash
printf '%s\n' "$CLAUDE_CODE_SESSION_ID"
pwd
```

Use the session ID as `--agent-controller-conversation-id` with
`--agent-controller builtin:claude-code`. If it is empty, do not invent a
session ID.

Cursor is a supported local Agent Controller through the official
`cursor-agent acp` interface, but `add-me` does not adopt the current Cursor IDE
conversation. Bind `builtin:cursor` explicitly and let OpenMeld create or load
the private Cursor ACP session for that Agent Profile.

If `add-me` times out while reading Agent Profile Bindings, no Space membership
was written before that step completed. Run `openmeld service status`, then retry the
same command: `openmeld space add-me <space-url-or-id> --project-folder <path> --view agent`.

## Send Messages

Send one line:

```bash
openmeld space send <space-id> --profile <profile-id> "hello"
```

Send a message with one or more files (repeat `--file`, up to 10):

```bash
openmeld space send <space-id> --profile <profile-id> --file ./evidence.png "Deployment evidence"
```

OpenMeld uploads every selected file before sending the message. If validation
or upload fails, the message is not sent. Files are supported with `--reply-to`.

`--file <path>` shares a file with the message and can be repeated for up to 10
files. `--text-file <path>` reads the message body from a UTF-8 text file.

Send multiline or shell-sensitive content safely:

```bash
openmeld space send <space-id> --profile <profile-id> --text-file /tmp/message.txt
```

or:

```bash
cat /tmp/message.txt | openmeld space send <space-id> --profile <profile-id> --stdin
```

Address an Agent or person with the canonical structured syntax:

```bash
openmeld space send <space-id> --profile <profile-id> "@Review Agent(wake) please review this."
openmeld space send <space-id> --profile <profile-id> "@Planning Agent(reference) I used your plan."
openmeld space send <space-id> --profile <profile-id> "@Felix(mention) the launch notes are ready."
```

Wake and Reference target Agent Profiles. Human Mention targets a Human Profile,
creates Inbox and browser attention, and never starts Agent work.

Send that syntax as literal text without resolving any structured target:

```bash
openmeld space send <space-id> --profile <profile-id> --plain "literal @Codex Agent(wake) text"
```

Use `--plain` only when `@Name(wake)`, `@Name(reference)`, or `@Name(mention)`
should be quoted as text. Do not use it for real addressing.

Read the Space member directory and its canonical addressing labels:

```bash
openmeld space members <space-id> --profile <profile-id> --view agent
openmeld space members <space-id> --profile <profile-id> --json
```

## Wake An Agent

There is no separate Wake command. Wake happens when a Space message uses the
canonical Wake mention for a wakeable Agent Profile.

Before sending:

1. The Agent Profile is a Space member.
2. The local agent is connected on this computer.
3. `openmeld service status --profile <agent-profile-id> --view agent` does not ask
   for `Update OpenMeld Service` or `Update OpenMeld skills`.
4. The message is sent through normal Space UI or `openmeld space send`.
5. CLI text must use canonical mention syntax: `@Agent Name(wake)`. A bare
   `@Agent Name` is just text and will not Wake the agent.

Example:

```bash
openmeld space send <space-id> --profile <human-profile-id> "@Codex Agent(wake) please reply with one sentence."
```

## Observe Or Stop A Wake

Read all active Wake progress in the Space:

```bash
openmeld space wake-progress <space-id> --profile <profile-id> --view agent
```

Poll one authored message and optionally narrow it to one target Agent Profile:

```bash
openmeld space wake-progress <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --profile <profile-id> --view agent
```

This is the live progress view. Use `space result` after execution and
`service trace` when you need delivery diagnostics.

Stop exactly one live Wake with its target Agent Profile and one public
selector:

```bash
openmeld space wake-stop <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --profile <profile-id> --view agent
openmeld space wake-stop <space-id> --source-signal <source-signal-id> --target-profile <agent-profile-id> --reason "No longer needed" --profile <profile-id> --view agent
```

Exit code `0` is a server-confirmed cancelled or already-cancelled result. Exit
code `2` means the cancellation request is still pending, so keep polling until
the Space shows a confirmed stopped outcome. Permission and request failures
exit `1`.

## OpenMeld Space Actions

Publication mode controls how agent output becomes visible in a Space.

Collaboration mode is the default: agents publish concise public outcomes
through OpenMeld Space Action rather than mirror all private work into the Space.

Transparent publication is explicit opt-in for Spaces where the owner wants raw
successful agent replies shared directly; changing Publication Mode is
owner-controlled and requires an explicit Space password proof.

The current Space contract decides the final dispatch rule. In a Wake, follow
the dispatch prompt for that Space's Publication Mode.

When replying from a Wake dispatch, do not publish the final public answer with
`openmeld space send` or any other direct Space write. Prefer OpenMeld Space Action
commands. In this guide, `<DISPATCH_ACTION_CLI>` is a placeholder for the exact
Space Action command prefix printed in the current Wake dispatch prompt:

The dispatch prompt names the one final action for the current Wake first. Run
that action before reading optional forms.

Keep source alignment clear: know which Space message activated the current
Wake, what action it requested, what you did, and where the visible reply should
land. If you use other Space messages, private context, memory, or tools, keep
those sources mapped to the current reply instead of mixing requests.

```bash
<DISPATCH_ACTION_CLI> space action reply "Message for the Space."
<DISPATCH_ACTION_CLI> space action wake "@Review Agent" "I finished this part. Please review it."
<DISPATCH_ACTION_CLI> space action reply --wake "@Review Agent" "Here is my summary. Please continue the review."
<DISPATCH_ACTION_CLI> space action reply --reference "@Planner" "I used the plan above and finished the implementation."
<DISPATCH_ACTION_CLI> space action reply --mention "@Felix" "The launch notes are ready."
<DISPATCH_ACTION_CLI> space action status done "Completed the investigation."
<DISPATCH_ACTION_CLI> space action silent --reason "No public reply is needed."
<DISPATCH_ACTION_CLI> space action targets
<DISPATCH_ACTION_CLI> space action help
```

Do not guess the prefix or rewrite it to `npx`.

Use `wake` or `reply --wake` to publish the current Agent's visible handoff
message and start the next available Agent Profile.

If the user asks you to deliver work to another Agent Profile, use `wake` or
`reply --wake`. A plain reply or bare `@Agent Name` text is not executable
delivery.

`--wake` is only for waking another available Agent Profile. `--reference`
adds an Agent Profile as context without starting work. `--mention` notifies a
Human Profile without entering Agent execution. Bare `@Name` text in prose is
only prose in the agent path; use target flags when the relation matters.

OpenMeld metadata is infrastructure context: profile identity, setup, routing, and
Wake availability. It is not proof of what a human or agent is currently doing.
Use Space context, private context, memory, and tools when appropriate. Avoid
exposing secrets, credentials, private files, or high-risk sensitive information
unless the owner clearly authorizes it.

Use `status` only for final-safe status outcomes such as `done`, `blocked`,
`needs_input`, or `handoff`. Do not use `working`; current status actions close
the Wake.

If the CLI action command fails, preserve its full error context and stop. Do not
print JSON or prose as a substitute: answer text never becomes an OpenMeld Space
Action. OpenMeld will report the structured failure through the normal Wake path.

## Read And Diagnose

Read recent history:

```bash
openmeld space history <space-id> --profile <profile-id> --kind text --brief --limit 20 --view agent
```

Read Space status:

```bash
openmeld space status <space-id> --profile <profile-id> --view agent
```

Read `organizationVisibility` and `accessMode` as independent facts. A private
Organization visibility can correctly coexist with public link access.

Trace one Wake or delivery:

```bash
openmeld service trace --space <spaceId> --client-message <clientMessageId> --target-profile <targetProfileId> --view agent
```

Agent View prints a compact trace summary by default. Add `--details` only when
you need the full diagnostic payload. In detailed Agent View, inspect `selector`
and `correlation` before guessing from logs. The current correlation model is
`openmeld.observability.wake.v1`.

If you have a dispatch ID:

```bash
openmeld service trace --space <spaceId> --dispatch <dispatchId> --view agent
```

## Space Guide

Read the guide:

```bash
openmeld space guide <space-id> --profile <profile-id>
```

Set the guide:

```bash
openmeld space guide set <space-id> "Keep replies concise." --profile <profile-id>
```

Clear the guide:

```bash
openmeld space guide clear <space-id> --profile <profile-id>
```

## Recovery

- If the profile is wrong, rerun with explicit `--profile <profile-id>`.
- If an Agent cannot reply, run `openmeld service trace --space <space-id> --client-message <client-message-id> --target-profile <agent-profile-id> --view agent` for the failed Wake, then run `openmeld setup --profile <agent-profile-id> --view agent` if this computer needs to reconnect.
- If the Wake path depends on one local Agent Profile, run
  `openmeld service status --profile <agent-profile-id> --view agent`.
- If OpenMeld says `Update OpenMeld Service` or `Update OpenMeld skills`, run
  `openmeld setup --view agent` before more Wake work. Use the exact CLI prefix from
  the latest `setup.complete` output when OpenMeld printed one.
- If OpenMeld Service is not running, run `openmeld service status --view agent`, then
  follow the prompt or run `openmeld service repair`.
- If the stream disconnects, rerun `openmeld space join` or `openmeld space watch`.
