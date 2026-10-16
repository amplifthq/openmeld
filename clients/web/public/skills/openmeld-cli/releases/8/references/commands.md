# Resource commands

Use the relevant recipe, then `openmeld <command> --help` for additional
options. Replace placeholders with returned full IDs or user-provided values.
These are public CLI workflows; a missing command requires a compatible CLI,
not a private HTTP route.

## Find the right resource

| Resource | Start with | Scope and result |
| --- | --- | --- |
| Acting identity | `whoami --view agent`, `profiles list --view agent` | Use an explicit Profile for subsequent Space actions |
| Organization | `org current --view agent`, `org list --view agent` | Most resource groups use the active Organization |
| Teammate | `org directory --json` | Resolve owner and full Profile ID |
| Another computer | `org computers --json` | Discover team-visible computers/controllers, not private paths |
| Existing Space | `space list --profile <id> --view agent` | Reuse a suitable conversation and audience |
| Shared/private file | `files list --location team\|my --json` | Choose one location; see below |
| Organization Skill | `skills list --view agent` | Find a relevant enabled Skill, then load only that release |
| Project | `projects list --json` | Resolve Organization Project identity before connecting a path |
| Future cloud work | `routines list --json` | Reuse/update a matching schedule |

For a named Organization, prefer an explicit `--organization` when that
command supports it. Otherwise check `org current` first. Use
`org switch <slug> --view agent` only when the workflow needs that
Organization, and state the selection if it changes the user's default.

## Team files, My files, and Space files

- **Team files** are shared in the Organization.
- **My files** are private to the signed-in member.
- **Space files** belong to the selected Space and its audience.

Choose the destination from the task. If "save this" leaves a material audience
choice unresolved, ask where before uploading. An existing local file stays
local unless cloud storage/sharing is part of the request.

Read or save a Team/My file:

```bash
openmeld files list --location team --json
openmeld files read <file-id> --location team --json
openmeld files history <file-id> --location team --json
openmeld files read <file-id> --location team --revision <n> --json
openmeld files upload <local-path> --location my --json
openmeld files write <file-id> --location team --base-revision <n> --file <local-path> --json
openmeld files download <file-id> --location my --revision <n> --output <local-path> --json
```

Before editing, read the current file and revision. A write with that
`--base-revision` fails visibly on concurrent edits. Re-read and reconcile a
conflict; do not overwrite unseen work. Check the returned file/revision and
read back the changed content before claiming it is saved.

To share an exact authorized revision:

```bash
openmeld files copy <file-id> --source-location my --location team --revision <n> --json
openmeld files copy-to-space <file-id> --source-location team --space <space-id> --revision <n> --json
```

A copy creates an independent file from that revision; it is not a live link.
Confirm a private-to-shared audience change unless the user already requested
that sharing. Managed Knowledge entries retain their document review workflow;
see [Center Agent documents](../playbooks/center-agent.md#documents-tasks-and-future-work).

For Space files:

```bash
openmeld space files list <space-id> --profile <profile-id> --view agent
openmeld space files read <space-id> <file-id> --profile <profile-id> --view agent
openmeld space files upload <space-id> <local-path> --profile <profile-id> --view agent
openmeld space files write <space-id> <file-id> --base-revision <n> --file <local-path> --profile <profile-id> --view agent
openmeld space files history <space-id> <file-id> --profile <profile-id> --view agent
```

Use `space files --help` for download, folder, trash, and revision restoration.
Space files are not automatically mirrored into Organization Documents.

## Organization Skills

Organization Skills are reusable instructions and resources the Organization
has published. They are separate from this OpenMeld CLI guide.

```bash
openmeld skills list --view agent
openmeld skills show <skill-id-or-slug> --view agent
openmeld skills load <skill-id-or-slug> --view agent
openmeld skills load <skill-id-or-slug> --release <release-id> --view agent
```

Load only a Skill relevant to the task. The command checks access and downloads
an immutable release to an Organization-scoped local cache. Read the returned
`skillMarkdownPath`, then only required supporting resources under
`cachePath`. Loading files is not executing their instructions; review them
against the user's task and permissions first. Keep the returned release ID
for reproducible work and honor an explicitly supplied exact release.

`load` does not install into global Codex/Claude skill directories. Treat the
cache as read-only. A disabled, inaccessible, missing, or mismatched release
is a real limitation; do not substitute another release silently.

When asked to publish a Skill to the Organization:

```bash
openmeld skills add <local-skill-directory> --view agent
openmeld skills add <github-url> --view agent
```

Inspect the intended bundle before uploading it. For repositories containing
multiple Skills, select the intended one; `--all` imports all and belongs only
to a request for the whole collection. Additional publish/update/enable
operations are discoverable through `skills --help`.
Use `setup` or `doctor` for the installed official OpenMeld helper's health;
the legacy helper `skills install|ensure|update` aliases are not Organization
Skill management.

## Projects and another computer

A Project is an Organization resource. A local connection maps that Project
to a folder on one computer; it does not copy the repository between computers.

```bash
openmeld projects list --json
openmeld projects connections list <project-slug> --json
openmeld projects bind <project-slug> --path <local-repository-path> --json
```

Use an existing matching Project. If the user needs a new Project:

```bash
openmeld projects create --name "Website" --slug website --json
```

Binding opts this folder into the Project. Verify its returned connection and
availability. On another computer, resolve that computer's connection; a local
absolute path is not portable. A Wake's Project or workspace error needs that
connection fixed, not a guessed path or a newly duplicated Project.

To find a suitable Agent, use the Organization directory, computers, and the
target Space's members. A discovered controller or native session is not
permission to resume someone's private session. To add this current session,
use [`space add-me`](../playbooks/space-ops.md#add-this-session-or-an-existing-agent).
To execute elsewhere, send an explicit Wake after resolving its target and
permissions.

## Scheduled Routines

Use a Routine when the user requests cloud work at a future time or repeatedly.
A Routine stores the Center Agent instructions, schedule, timezone, and target
Space; a Run is one execution. It does not keep a local Agent process alive.

```bash
openmeld routines list --json
openmeld routines create --name "Morning project summary" --instructions "Summarize new project updates in this Space." --daily 09:00 --timezone America/New_York --target-space <space-id> --json
openmeld routines show <routine-id> --json
openmeld routines runs <routine-id> --limit 5 --json
```

Use exactly one schedule input: `--daily HH:MM`, five-field `--cron`, or
`--run-at <ISO-8601-with-timezone>`. Supply an explicit IANA `--timezone`
and `--target-space`. Resolve missing timing or audience before creating.
Check for a matching Routine first to avoid duplicates.

```bash
openmeld routines update <routine-id> --daily 10:00 --timezone America/New_York --json
openmeld routines pause <routine-id> --json
openmeld routines resume <routine-id> --json
```

Read the saved configuration to verify the schedule and destination. A saved
Routine is not a successful Run; inspect `runs` and the Space result for that
claim. Scheduling cloud work does not make an offline workstation wakeable.

## Directory and session reads

```bash
openmeld org directory --json
openmeld org computers --json
openmeld activity sessions --project <project-slug> --provider codex --view agent
openmeld activity sessions --native-session <native-session-id> --json
```

Join Profiles to members using returned `ownerUserId`. Session Inventory is a
read projection, not authority to resume/fork a session. Use its opaque cursor
when the task requires more pages. Human `lastActiveAt`, computer presence,
session activity, and Wake availability describe different things.

## Invitations and public links

Only send invitations when requested. Invitation requests use the signed-in
account and active Organization, not the speaking Profile:

```bash
openmeld org invitation-requests create --email person@example.com --space <space-id> --view agent
openmeld org invitation-requests link --space <space-id> --view agent
openmeld org invitation-requests get --request <request-id> --view agent
openmeld org invitation-requests list --view agent
```

Members propose; owners/admins approve or decline. An approved request is not
membership: the recipient must accept. Approval-required links do not grant
access just because someone possesses them. Use `invitation-requests --help`
for review, cancellation, and received-link actions.

Build a link locally or check access without joining:

```bash
openmeld space link <space-id> --signal <signal-id> --view agent
openmeld space access "<space-url-or-id>" --profile <profile-id> --view agent
```

A link is a locator, not access authority. Access resolution does not join a
Space or change the selected Profile.

## Setup and diagnostics

Read [onboarding](../playbooks/agent-onboarding.md) for login, local Profiles,
setup, and recovery. Read [Space reads](../playbooks/space-reads.md) for compact
history, progress, results, and trace commands. Use
[Plugins](../playbooks/plugins.md) for connected app actions.

```bash
openmeld computer current --brief --view agent
openmeld service status --profile <agent-profile-id> --view agent
openmeld doctor --view agent
openmeld prompt commands --raw
```

`computer current` and `service status` concern this computer. Inspect the
actual failed Wake with `service trace` before attributing another computer's
problem to this one. A setup success does not prove a future Wake can complete.
