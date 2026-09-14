---
id: independent-agent-tasks
title: Run independent tasks with one Agent
kind: new
areas: ["agents", "spaces", "cli"]
audiences: ["users", "integrators"]
---

An updated local Agent can run up to three independent tasks at once. Start a
new task, fork completed history, or work in different discussion threads.
Follow-ups in the same task wait their turn, and each reply stays with its
original message.
Space-only tasks can read their authorized Space history even when Computer
file access is limited to selected project folders. Forks retain the final
revised answer when a task reconsiders newer information before replying.

Owners can switch independent-task admission between parallel and serial mode.
Running work keeps its place, and waiting tasks retain their history and reply
destination.

Other connected harnesses keep their existing serial execution in discussion
threads. Explicit task branching and parallel execution require a supported
harness.

Space Action tool receipts report local proposal storage, an explicit local
rejection, or an uncertain local result. They do not confirm that Core accepted
the proposal or that a reply was published.

Codex also supports independent project worktrees with separate files and Git
metadata. Each starts from the connected repository's committed state and keeps
its changes when the task continues. Unsaved changes and local configuration are
not copied. Project boundaries are verified before execution; system temporary
directories keep the native runtime's access rules. Work that shares writable
files waits for the conflicting task.
Unchanged generated project copies can be reclaimed after verified execution
shutdown and restored at the same commit when needed. Task changes and uncertain
workspaces are retained.
Claude Code supports independent Space-context tasks. Unsupported connections
show a failure or update requirement instead of silently sharing another task's
native conversation.
