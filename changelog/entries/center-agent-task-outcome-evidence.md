---
id: center-agent-task-outcome-evidence
title: Keep Task outcomes tied to the requested work
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
---

Closing a linked GitHub issue updates its observed status without marking the
Space Task complete or canceled. Task results and reviews remain tied to the
requested completion conditions, including when an issue is closed after work
moves elsewhere. Tasks created by the Center Agent stay unassigned until an
executor is explicitly selected.

The Center Agent can create a new Task and queue its initial delegation in one
operation. Its brief, executor, review decision, and handoff are saved together,
so an interruption cannot leave a newly created Task waiting for a missing Wake.

The Center Agent also receives its exact Agent Profile identity and the source
message's shared Wake participants, so it can distinguish an already activated
teammate from a name or a context-only reference.
