---
id: live-agent-permission-updates
publishedAt: 2026-10-07
release: v0.3.247
evidence: ["pr:1564", "pr:1568", "workflow:37607115073"]
title: Change supported agent permissions during a task
kind: fixed
areas: ["agents", "spaces"]
audiences: ["members"]
---

Codex can switch between Ask for approval and Approve for me during a running
task on supported versions. Claude Code can accept an owner-selected permission
change without starting another task.

Codex settings now offer Ask for approval, Approve for me, and Full access.
Existing custom settings remain in effect until you choose another mode.
Approval cards can save a mode before continuing the approved action, with
explicit confirmation for Full access. Full access changes Codex's sandbox on
the next task; the interface explains when a change can take effect.
