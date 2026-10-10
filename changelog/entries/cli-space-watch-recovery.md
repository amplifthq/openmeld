---
id: cli-space-watch-recovery
title: Recover Space watches after a connection drops
kind: fixed
areas: ["cli", "spaces"]
audiences: ["users", "agents"]
---

Space watches reconnect after a temporary connection failure and load missed
messages without displaying duplicates. The existing view stays open during
recovery. Recovery never resends a message or starts another Agent task.

A watch reports failure when recovery cannot finish, so scripts can detect an
interrupted stream. Leaving the watch yourself remains a normal exit.
