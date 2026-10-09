---
id: agent-setup-recovery
title: Recover incomplete Agent setup
kind: fixed
areas: ["agents", "center-agent", "computer"]
audiences: ["members"]
---

Invalid model selections are rejected before an Agent is created. If setup
fails later, you can review the model and retry the same Agent without losing
its original Project or overwriting settings you changed afterward.

Custom and OpenMeld-managed folder changes correctly clear Default Project.
If the folder is saved but Default Project cannot be updated, Working folder
shows the partial result and keeps your choice for retry.
Center Agent setup results keep local folder paths private and show which
steps still need attention.
Creation failures also protect local diagnostics while keeping the error reason
and recovery step, including when older saved diagnostics are read again.
During an update, incompatible Center Agent folder changes stop before any
settings are saved.

Codex Agents can start work when their included usage is exhausted but account
credits still permit it. Usage percentages remain visible, and account changes
do not carry usage evidence between workspaces. Center Agents can read public
OpenMeld failure messages when they check a delegated task's outcome.

Missing or unavailable working folders now lead to the affected Agent’s folder
settings. Center Agent can check a Project’s connection on that Agent’s Computer
without receiving local paths.

Stop remains available after the same local OpenMeld Service reconnects and
confirms that it still owns the running task.
Thread replies also recover after reconnecting or returning to the page,
without closing and reopening the thread.

Cloud commands return their exact receipt reference and execution phase. Owner
inspection can query the original Remote command, and a missing receipt reports
an unknown acceptance state instead of an unreachable service.
If the native execution result is unavailable, the saved receipt remains
available for inspection. This failure is distinct from an unreachable service
and does not restart the command.

Linux commands see new file changes after synchronization, including renames,
deletions, size changes and same-size replacements. Sync retries preserve files
recreated or modified afterward on the receiving Computer.
Applying this native update preserves workspace files and saved command
references. A process interrupted by a container replacement is reported as
unavailable and is not restarted automatically.
