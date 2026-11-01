---
id: center-agent-task-outcome-evidence
title: Keep Task outcomes tied to the requested work
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
publishedAt: 2026-10-29
evidence:
  - "pr:335"
  - "pr:336"
  - "commit:118d473bf33805b0fc4541d2780d2392f3d116b4"
  - "commit:381632813aabf4f0f558f7c4a51a395de989912c"
  - "workflow:40879073266"
  - "workflow:40886168710"
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
