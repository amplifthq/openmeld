---
id: space-task-blocked-handoff
title: Show blocked Task handoffs instead of silent success
kind: fixed
areas: ["spaces"]
audiences: ["members"]
publishedAt: 2026-10-29
evidence:
  - "pr:336"
  - "pr:337"
  - "commit:381632813aabf4f0f558f7c4a51a395de989912c"
  - "commit:c90a68fefcf7ba77e5093337d07a0ec65ae595d8"
  - "workflow:40886168710"
  - "workflow:40893009950"
---

A Task handoff now prepares a real Wake dispatch before publishing an activated
message. If the selected target is blocked, including when an Agent tries to
Wake itself, Task details retain the specific delivery failure and the Task
stays in its current phase. A published-looking message no longer hides work
that never started.

The Center Agent can also reread one Task's current result, review, and delivery
status, so it can report the recorded blocker instead of guessing from an earlier
creation or assignment confirmation.

After work resumes, Task details stop showing superseded handoff failures as
current actions. The original failure record remains available for diagnostics.
