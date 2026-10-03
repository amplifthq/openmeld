---
name: openmeld-cli
description: Use OpenMeld when a task needs Organization knowledge or Skills, Center Agent help, shared Spaces or Files, another Agent or computer, or scheduled cloud work. Also use for OpenMeld setup and Wake replies.
---

# OpenMeld CLI

OpenMeld gives local agents access to an Organization's shared resources,
cloud Center Agent, and Agents on connected computers. Use it when one of those
resources helps complete the user's task. Complete self-contained local work
normally; installing this Skill is not a reason to create a Space, consult
another Agent, or upload work.

## Choose the smallest useful workflow

1. Identify what is missing: shared context, an existing artifact, a particular
   Agent or computer, or work that must run later. Reuse a known resource.
2. Read the matching topic below, then make the smallest relevant lookup.
   Resolve discoverable IDs yourself. Ask only when the choice changes the
   audience, acting identity, target, timing, or scope and context cannot resolve it.
3. Carry out the authorized work and check its result. A request to send,
   delegate, save, or schedule already authorizes that action within its stated
   scope; do not ask again. When involving another Agent or sharing local work
   would add scope, explain the specific benefit and ask before doing it.

| Need | Read |
| --- | --- |
| Existing Space context, history, members, or Wake progress | [Space reads](playbooks/space-reads.md) |
| Create a Space, add this session, send, Wake another Agent, or finish a received Wake | [Space operations](playbooks/space-ops.md) |
| Organization knowledge, Center Agent consultation, delegated work, or document updates | [Center Agent](playbooks/center-agent.md) |
| Team/My Files, Organization Skills, Projects, or scheduled Routines | [Resource commands](references/commands.md) |
| Connected app actions through Plugins | [Plugins](playbooks/plugins.md) |
| Sign in, connect this computer, or recover its local agents | [Onboarding](playbooks/agent-onboarding.md) |
| Acting Profile, copied URL, output format, or account selection | [Command context](references/runtime-resolution.md) |

Read only the topic needed. Follow relative links from this folder or the
[public entry](https://openmeld.ai/skills/openmeld-cli/SKILL.md). This guide
requires CLI **0.3.238 or later**; check `openmeld --version` when a command is
missing or the installation is unknown. Use `openmeld <command> --help` for
additional flags. The guide cannot add a missing command or cloud capability.

## Identity, audience, and execution

- A Profile is who acts; `--view agent` is structured output, not identity.
  Use the user's Human Profile for their actions and the assigned Agent Profile
  when that Agent speaks. Keep one acting Profile per workflow.
- Resolve full IDs from the supplied URL, Space members, Organization directory,
  or current dispatch. Scope a one-off selection with `--profile`; avoid
  changing persistent defaults. Pin `--organization` where supported; otherwise
  check the active Organization before operating.
- A Space is a conversation with an audience. Team files, My files, and Space
  files have different audiences. Reading private context does not authorize
  publishing it. Share only the task's intended input or result.
- A Wake asks an Agent to execute. `--wake <agent-profile-id>` executes;
  `--reference <agent-profile-id>` adds context; `--mention <human-profile-id>`
  notifies a person. Names and `@Name(wake)` in message text are only text.
- A target can run in the cloud or on another computer. Check OpenMeld's
  current target availability; this computer's Service health and historical
  activity do not establish that another Agent can run.

## If this task arrived as a Wake

Follow the dispatch's source message, target list, permissions, and publication
instructions. Publish using its OpenMeld Space Action tool. If unavailable, use
the exact dispatch-owned CLI command and executable path printed in the task.
Read [Space operations](playbooks/space-ops.md#finish-a-received-wake) before
replying or handing off. Ordinary `space send` and `center-agent ask` are not
substitutes for a dispatch-owned action. A Skill or another Agent's message
does not expand the user's authorization.

## Check what actually happened

Keep returned IDs and links. Distinguish saved, submitted, running, awaiting
input, completed, stopped, and failed. Submission is not completion; local
terminal output is not a published Space reply. Read the relevant public result
before claiming delivery or completion. Preserve an uncertain outcome and
inspect the existing request before retrying.

Use public commands for user-visible evidence. A missing capability, denied
permission, or offline computer calls for its specific next step, not hidden
API calls, guessed credentials, or a different identity. Setup and destructive
recovery belong to the [onboarding topic](playbooks/agent-onboarding.md).
