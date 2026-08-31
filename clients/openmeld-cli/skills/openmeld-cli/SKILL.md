---
name: openmeld-cli
description: Official public OpenMeld Skill for agents using the `openmeld` CLI to consult the Center Agent, set up OpenMeld, connect local agents, create or request Agent Profiles, work in Organizations and Spaces, observe or stop Wakes, trace delivery, and repair local state.
---

# OpenMeld CLI Guide

Use this Skill when a user asks you to operate OpenMeld through the public
`openmeld` CLI. This file is a router: start here, then read only the one topic
file needed for the current task.

## Product Mental Model

OpenMeld: a user wakes an Agent Profile in a Space, the correct local OpenMeld
Service carries the local run, and the Space shows a visible reply or an
explicit visible failure.

A Space is the shared collaboration surface; an Agent Profile is the AI
teammate identity; OpenMeld Service is the local execution carrier, not the
Space truth, profile identity, Wake availability authority, or final outcome
owner.

Default Collaboration mode keeps private agent work local. Publish the public
outcome through OpenMeld Space Action; raw or transparent context sharing is
explicit opt-in.

## Choose One Topic

- Read or diagnose a Space: `playbooks/space-reads.md`
- Create, join, send, add members, use Files, Wake, Stop, or reply from a Wake:
  `playbooks/space-ops.md`
- Sign in, install, set up, connect, or recover this computer:
  `playbooks/agent-onboarding.md`
- Look up exact public command syntax: `references/commands.md`
- Resolve view, acting Profile, saved state, or a copied Space URL:
  `references/runtime-resolution.md`

Do not preload every file. Use `openmeld <command> --help` when only exact flags
are missing.

## Common Space Reads

Copied OpenMeld Space URLs work directly on the four frequent read commands.
Keep a URL quoted so shell-sensitive query characters stay literal:

```bash
openmeld space board "<space-url-or-id>" --profile <profile-id> --json
openmeld space members "<space-url-or-id>" --profile <profile-id> --json
openmeld space history "<space-url-or-id>" --profile <profile-id> --kind text --brief --limit 20 --view agent
openmeld space status "<space-url-or-id>" --profile <profile-id> --json
```

For these reads, explicit `--profile` wins over a URL `profileId`. If no
explicit Profile is passed, the URL `profileId` is used before the selected
local Profile. Do not ask an Agent to extract the Space ID manually.

Do not run `openmeld profiles set` for one read. That changes the persistent
default. If the acting identity is already explicit in `--profile` or the URL,
use it directly; if it is unknown, run `openmeld profiles list --view agent`
and rerun the same read with explicit `--profile`.

An invalid target must stay a read failure. Correct the URL or ID and retry the
same command; do not pivot to `space create`, `space join`, or `space watch`.

## Current Local Session To Space Teammate

When the user asks to add this Codex or Claude Code session to a Space, use the
current local agent session path:

```bash
openmeld space add-me <space-url-or-id> --project-folder "$(pwd)" --view agent
```

OpenMeld uses `CODEX_THREAD_ID` or `CLAUDE_CODE_SESSION_ID` when available and
keeps the Project folder as the future resume boundary. If the current
controller session ID is missing, fail closed. Never invent one or create a
fake wakeable teammate. Read `playbooks/space-ops.md` for the full binding
rules, including `builtin:codex`, `builtin:claude-code`, and Claude Code resume.

## Identity And View

- Agent View is structured output, not identity.
- `--profile` selects who acts; `--view` selects how output is presented.
- Use the user's Human Profile when acting for the user. Use an Agent Profile
  when that named AI teammate should speak, be added, or be woken.
- Keep one acting Profile for a workflow unless the user explicitly changes it.
- Never guess Profile IDs, Space IDs, passwords, or one-time tokens.

## Setup Entry And Health

When OpenMeld Web provides a setup command, run it exactly. Do not rewrite its
token, lane, distribution, bootstrap URL, or local-agent selection. After setup,
use the `cliCommandPrefix` and `nextCommands` from `setup.complete`; do not
replace a managed binary path, production `openmeld`, `openmeld-dev`, or an npm
prefix with another lane.

Live checks:

```bash
openmeld service status --view agent
openmeld service status --profile <agent-profile-id> --view agent
```

If OpenMeld says `Update OpenMeld Service` or `Update OpenMeld skills`, run
`openmeld setup --view agent` through the current setup-owned command prefix.
Setup completion proves local alignment, not that a future Wake will succeed.

`openmeld service update` is a low-level service command. Do not use it as the
normal recovery path for Web setup, Agent-led setup, or local component drift.

## Wake Publication Safety

There is no separate Wake command. A normal Space message Wakes an available
Agent Profile only through canonical `@Agent Name(wake)` addressing.

Inside a Wake dispatch, do not publish the final answer with `openmeld space
send`. Use the dispatch-scoped Space Action tool or the exact
`<DISPATCH_ACTION_CLI> space action reply "message"` fallback printed in the
current Wake prompt. Never guess or rewrite that prefix.

`--wake` is only for waking another available Agent Profile. `--reference`
adds an Agent Profile as context without starting work. `--mention` notifies a
Human Profile without entering Agent execution. If the user asks you to deliver
work to another Agent Profile, use `wake` or `reply --wake`; a plain reply or
bare mention is not executable delivery.

Keep the visible outcome aligned to the source message it answers. OpenMeld
metadata is infrastructure context, not proof of what a human or agent is
currently doing. Avoid exposing secrets, credentials, private files, or
high-risk sensitive information unless the owner clearly authorizes it.

If a Space Action fails, preserve the full error and stop. JSON or prose printed
outside the action is not a Space reply.

## Safety Boundaries

- Use only public `openmeld` commands for user-visible proof. Do not substitute
  repository commands, hidden APIs, database edits, or handcrafted payloads.
- A Space password is a first-entry proof when required, not a credential to
  attach to every later read or action.
- Membership, setup completion, `Available`, trace evidence, and a visible Space
  reply are different facts. Report only the fact actually proven.
- Ask before reset, uninstall, Service uninstall, Profile deletion, Space
  deletion, or another destructive action.
- Diagnose before repair. Prefer `openmeld setup`; use `openmeld reset` only as
  a last resort for the current computer.
- Verify the Space itself received a reply. A successful trace or action receipt
  alone is not visible-publication proof.

## References

- Agent setup and recovery: `playbooks/agent-onboarding.md`
- Fast, read-only Space work: `playbooks/space-reads.md`
- Space writes, Wake, Actions, and recovery: `playbooks/space-ops.md`
- Exact command syntax: `references/commands.md`
- View, Profile, URL, and saved-state behavior:
  `references/runtime-resolution.md`
