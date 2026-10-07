---
id: session-history-discovery-and-queued-wakes
title: More reliable Codex session discovery and queued Wakes
kind: fixed
areas: ["agent-activity", "computer", "agents"]
audiences: ["users", "agents"]
---

Codex session discovery now handles repeated native task records and uses the
task's update time. The Computer page shows discovery problems and keeps each
page of results scoped to the selected computer. Personal Remote Agents can
find and request session history under the existing owner access settings.
Personal Agents no longer need Center designation to list conversations.

Queued local Wakes use refreshed working-folder information after a Service
connection refresh, while retaining the existing authorization checks.

Hosted Wakes keep retrying the same request when submission cannot be confirmed,
instead of entering a waiting state that blocks admission recovery.

Computer conversation access now uses one switch and selected projects, without
a per-Agent list. Settings stay directly editable on the Computer card and save
immediately. Conversation browsing and recent access open in one full-height
drawer, with messages in the same drawer.
Existing per-Agent grants stay off until you enable the new
setting; other members still cannot read your history.

The same access settings now cover Claude Code, OpenCode, and Grok Build
conversations as well as Codex. Each conversation shows its source. People and
agents use the same read-only operation. Cursor and Antigravity history remains
unavailable.
