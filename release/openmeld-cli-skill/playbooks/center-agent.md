# Center Agent

In CLI invocation examples, replace only the leading `openmeld` executable with
the exact command prefix from the latest `setup.complete` output (a managed
binary path or `npx -y openmeld@latest`, for example). Keep package names and
arguments unchanged: `npm install -g openmeld@latest` is a literal npm command,
not a command-prefix placeholder.

Use this topic when the task needs Organization knowledge, the user's existing
Center Agent conversation, or work the user wants the Center Agent to handle.
The Center Agent is the Organization's cloud agent. It can use authorized
Organization resources and tools; it is not access to everyone's private chats,
local files, or all connected accounts.

## Choose context or a request

| Need | Action |
| --- | --- |
| Continue the user's previous Center Agent conversation | Read a bounded `context` manifest |
| Find Organization knowledge or ask for a specific answer | `ask` with the question and relevant scope |
| Have the Center Agent do work | `ask` with the outcome, allowed actions, destination, and completion criteria |
| Inspect a known shared file or Space | Read that resource directly; a consultation is optional |

`ask` sends a new request. Use it when the user's request or existing
authorization covers the consultation/delegation. Otherwise explain what
information or capability it would add and ask once before sending.
Send only the context needed for the work, not the local transcript.

## Read existing conversation context

```bash
openmeld center-agent context --organization <slug-or-id> --view agent
openmeld center-agent context --organization <slug-or-id> --conversation <space-id> --limit 10 --max-tokens 2000 --view agent
openmeld center-agent context --organization <slug-or-id> --cursor <opaque-cursor> --view agent
```

The manifest contains the authenticated member's visible Center Agent Chat
messages, bounded by the requested budget. It is not a search of Organization
Documents or hidden model memory. Use the opaque cursor only if older messages
are needed. `--conversation` selects an authorized conversation;
`--session` on `ask` is local attribution and does not select context.

After the returned messages enter your working context without truncation, run
the manifest's exact `nextAction.command`. This records a truthful receipt for
the loaded entries. Use `--all` only if all returned entries were loaded; if
the tool truncated them, request a smaller manifest or receipt only the exact
loaded subset using `context receipt --help`. A receipt records context
delivery, not proof that you used every message.

## Ask or delegate from an ordinary local session

```bash
openmeld center-agent ask --organization <slug-or-id> --view agent "Find the agreed release checklist and cite its source. Read only; do not change documents."
openmeld center-agent ask --organization <slug-or-id> --view agent "Draft an update to the onboarding document using these verified findings: <findings>. Keep it as a draft for review and return its link."
```

The command opens or reuses the user's Center Agent Direct Message, the same
Chat used in Web. It detects Codex/Claude Code attribution automatically.
Use `--via` and `--session` only for another harness or an explicit override.
Pin `--organization` when a particular Organization is intended; it does not
change the default or grant membership.

For delegation, specify the desired result, relevant sources, permitted
mutations, output destination, and what counts as done. Include a target
Project or Agent when known. Do not promise that private local files are
available to the cloud; share only authorized inputs through the appropriate
Files or Space workflow.

Read the structured result:

- `completed`: inspect the returned answer and any resulting artifact.
- `needs_input`: surface the material question to the user.
- `pending` or `submitted`: keep the returned request/message/Space IDs.
  Continue reading the existing work rather than submitting another turn.
- `submission_unknown`: the request may have arrived. Inspect that request
  before retrying; a client timeout does not prove failure.

For a known request, use the returned identifiers:

```bash
openmeld space wake-progress <space-id> --client-message <client-message-id> --target-profile <center-agent-profile-id> --profile <human-profile-id> --view agent
openmeld space history <space-id> --profile <human-profile-id> --kind text --brief --limit 10 --view agent
```

During a received Wake, `center-agent ask` is blocked as an unrelated public
write. Follow the current dispatch's Space Action targets and permissions.
If the needed Center Agent handoff is unavailable there, report that limitation
through the current Wake; do not open a different conversation to bypass it.

## Documents, Tasks, and future work

Organization Documents have their own review workflow. Ask the Center Agent to
read the relevant document and prepare a bounded draft with sources. Ordinary
knowledge can be saved directly only when the authorized owner/admin explicitly
requests it and no pending draft conflicts. Brief and Profile Report documents
retain their specialized workflows. A managed Knowledge file in Team files is
a projection of that document; ordinary file writes do not bypass review.

Direct Messages do not own durable Space Tasks. A long request in Center Chat
does not automatically create a Task. When ongoing work needs a shared record,
use an ordinary shared Space and its supported Task workflow in Web or through
the Center Agent. Task assignment records responsibility; a Wake starts
execution. There is no `openmeld space tasks` command in this CLI.

For work that must run later, use the public
[Routine commands](../references/commands.md#scheduled-routines).
A live local conversation is not a scheduler, and a cloud schedule does not
keep an offline workstation available.
