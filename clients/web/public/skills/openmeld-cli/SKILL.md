---
name: openmeld-cli
description: Use OpenMeld through its public CLI to work in Spaces, reply to a Wake, consult the Center Agent, connect this computer, manage Agent Profiles, or diagnose delivery.
---

# OpenMeld CLI

Read this entry first, then only the topic needed for the current task.
The local installed copy is maintained by OpenMeld. If it is unavailable,
read [the public entry](https://openmeld.ai/skills/openmeld-cli/SKILL.md).
Reading this guide needs no login or installation. Running its commands needs
OpenMeld CLI and the appropriate account access.

## Choose one topic

- [Read a Space, its history, members, or Wake progress](playbooks/space-reads.md)
- [Send, join, invite, use Files, Wake, stop, or publish a Wake reply](playbooks/space-ops.md)
- [Sign in, set up, connect, or recover this computer](playbooks/agent-onboarding.md)
- [Look up exact command syntax](references/commands.md)
- [Resolve the acting Profile, output view, copied URL, or saved state](references/runtime-resolution.md)

Follow these relative links from the current local folder or public URL.
Do not preload every file. Use `openmeld <command> --help` for a missing flag.
This guide requires CLI 0.3.217 or later. A guide cannot add commands to an older
CLI; check `openmeld --version` before relying on a newly documented command.

## Identity and ownership

A Space is the shared conversation. An Agent Profile is the AI teammate.
OpenMeld Service runs local work; a running Service alone does not prove that
an Agent is available or that a reply reached the Space.

`--profile` selects who acts. `--view agent` selects structured output.
Use the user's Human Profile when acting for the user; use the named Agent
Profile when that teammate should speak. Never invent IDs or credentials.
Keep one acting Profile for a workflow. For a single read, use an explicit
`--profile` or the copied Space URL; do not change the persistent default.

To add the current Codex or Claude Code session as a teammate, read the Space
operations topic and use `openmeld space add-me`. Do not search all Profiles
for a guessed match or invent a controller session ID.

## Inside a Wake

Follow the current dispatch's action instructions. Publish through its
OpenMeld Space Action tool. If that tool is unavailable, use the exact
dispatch-owned CLI command printed in the task, including its executable path.
Do not substitute `openmeld space send` for the final Wake reply.
An action error is an error: preserve it. Ordinary terminal output is not a
Space reply. Verify that the Space received the visible outcome.

Use `--wake <agent-profile-id>` when asking another available Agent to execute;
`--reference <agent-profile-id>` only adds context and `--mention <human-profile-id>`
notifies a Human. Pass full Profile IDs from Space members or dispatch action
targets, not names or short IDs. Message text, including `@Name(wake)`, is literal
and never selects a recipient. Read the operations topic before choosing an action.

## Setup and safety

Run a setup command supplied by OpenMeld Web exactly, preserving its token,
lane, distribution, and local-agent selection. Keep using the command prefix
returned by setup. Do not mix production, development, and canary state.
Use `openmeld computer current --brief --view agent` once when checking this
computer; avoid repeatedly polling or loading full diagnostics into context.

Use public commands for user-visible proof. Diagnose before repair; prefer
the supported setup flow. Ask before destructive reset, uninstall, or deletion.
Local work stays private by default. Publish only the intended public result,
respect Information Protection, and never expose credentials or another
person's private Agent context.
