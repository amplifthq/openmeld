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

Other connected harnesses keep their existing serial execution in discussion
threads. Explicit task branching and parallel execution require a supported
harness.

Codex also supports independent project worktrees with separate files and Git
metadata. Each starts from the connected repository's committed state and keeps
its changes when the task continues. Unsaved changes and local configuration are
not copied. Project boundaries are verified before execution; system temporary
directories keep the native runtime's access rules. Work that shares writable
files waits for the conflicting task.
Claude Code supports independent Space-context tasks. Unsupported connections
show a failure or update requirement instead of silently sharing another task's
native conversation.
