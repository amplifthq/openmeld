# Work on the cloud Computer

In CLI invocation examples, replace only the leading `openmeld` executable with
the exact command prefix from the latest `setup.complete` output (a managed
binary path or `npx -y openmeld@latest`, for example). Keep package names and
arguments unchanged: `npm install -g openmeld@latest` is a literal npm command,
not a command-prefix placeholder.

A Local Agent uses its already authorized local Project folder or working
directory for code work by default. Use cloud Computer when the user chooses
it or a concrete environment or isolation requirement justifies it. Explain
the requirement before changing environments. Continue an existing cloud task
in its current environment and preserve its work.

Use `openmeld computer cloud --operation '{"action":"describe"}' --view agent`
to inspect current capabilities and persistent storage. Missing storage data
on an older server means unknown, not empty. The Computer belongs to the signed-in
human; its project directories do not grant Team access or publish files.

## Reuse repositories by default

Inspect known project paths, repository identity, `git status` and
`git worktree list` before cloning. Prefer an existing matching repository.
For a new persistent checkout, a useful convention is
`/computer/projects/<organization-id>/<project-id>/repo`, with task worktrees
in the adjacent `worktrees/<task-id>` directory. This is not a required layout
or a new OpenMeld Project registration. Use verified Project/repository identity;
do not reuse a directory based only on its display name. Keep existing layouts
unless a move is needed and safe.
Use Organization/Project IDs only when already known. Do not search for or
create a Project merely to construct a directory name. Without those IDs, choose
a distinct repository key from known repository identity (or a synthetic key for
a test) under `/computer/projects/<repository-key>`. Verify before reusing it.

Keep the primary checkout on its actual default branch when practical. Give
each modifying task its own branch/worktree, based on an explicit commit.
Do not pull, reset or switch a checkout while another task uses it. Read-only
work can reuse a stable checkout; use a detached worktree when a fixed snapshot
is necessary. Separate clones remain valid for isolation or one-time work.
Worktrees share Git objects, but working files, dependencies and builds can still
consume space. Do not share mutable dependency directories across tasks blindly.

Use the selected Plugin account for fresh Git access; see `plugins.md`.
Refresh temporary Git transport through the current Plugin connection before
fetching in a reused repository. Keep the same selected account and connection
key. Do not save temporary URLs or credentials in Git remotes or configuration.
Cached files do not grant new permissions to fetch, publish or disclose code.
Pass an explicit `cwd` in the Computer command. Task logs and temporary outputs
can remain under `/computer/tasks/<task-id>`.

## Recover command results

Start once with a stable invocation ID and command key. Poll that same key.
Use `list` after an uncertain response. A timeout or missing native record
never proves the command had no effect and never permits an automatic relaunch.

Keep the returned `reference`. It addresses the exact invocation, key, native
execution ID and backend. For owner CLI inspection of a Remote command, use
that reference's `invocationId` as the operation's `invocationId`, its `key`
as the poll/stop key, and include the unchanged object as `command.reference`.
This avoids adding the CLI's `local:` namespace to a Remote invocation.
The reference grants no access to another account's Computer. Contradictory
references fail closed. Add `includeReceiptDetails:true` to `action:list`
when recovering references and phases; ordinary list keeps its older shape.

`phase` separates accepted receipt, uncertain launch, observed running process,
exit, pending file sync, completed sync and unavailable result. A missing receipt
returns `computer.command_not_found`; acceptance remains unknown. Receipt
expiry is separate from the provider's native result retention. Already collected
output survives native expiry, but an uncollected expired result may be lost.

`syncPending` means the process exited but file synchronization is unconfirmed.
Continue polling unless `syncError` or `nextAction: inspect` is present. Then
stop polling and inspect persistent files. The receipt preserves the known
exit code and output. An exit code does not prove file synchronization succeeded.
Explain unresolved synchronization before treating a generated file as complete.

## Check capacity and preserve work

Before a large clone, download, dependency install or build, inspect
`capabilities.storage`. Explain `near_limit` or `at_limit` to the user before
starting more large writes. Its database bytes include internal records; growth
headroom is not guaranteed free file space. Other tasks may consume space after
the sample. Linux temporary disk and inodes are separate: use `df -h /tmp` and
`df -i /tmp` for those, not as a measurement of persistent `/computer` capacity.

On `computer.storage_full`, `computer.disk_full`, `SQLITE_FULL` or `ENOSPC`, stop
blind retries. Inspect the existing command receipt: a failed write can occur
after execution started. Use file tools to inspect and export needed content;
do not require starting a new shell just to recover files. Propose selected
disposable files for cleanup. Preserve uncommitted changes, unpushed commits,
active tasks and worktrees. Never remove a repository still used by linked
worktrees, reset user work, or delete broad directories merely to free space.
After cleanup, inspect storage and test a small write before resuming.
Deleting a file does not guarantee reclamation of the SDK's retained data.
If a small write still fails, preserve/export needed files and report that
provider storage recovery is required. Do not repeatedly delete user work.
