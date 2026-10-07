# Work on the cloud Computer

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

Keep the primary checkout on its actual default branch when practical. Give
each modifying task its own branch/worktree, based on an explicit commit.
Do not pull, reset or switch a checkout while another task uses it. Read-only
work can reuse a stable checkout; use a detached worktree when a fixed snapshot
is necessary. Separate clones remain valid for isolation or one-time work.
Worktrees share Git objects, but working files, dependencies and builds can still
consume space. Do not share mutable dependency directories across tasks blindly.

Use the selected Plugin account for fresh Git access; see `plugins.md`.
Cached files do not grant new permissions to fetch, publish or disclose code.
Pass an explicit `cwd` in the Computer command. Task logs and temporary outputs
can remain under `/computer/tasks/<task-id>`.

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
