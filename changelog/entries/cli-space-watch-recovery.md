---
id: cli-space-watch-recovery
title: Recover Space watches after a connection drops
kind: fixed
areas: ["cli", "spaces"]
audiences: ["users", "agents"]
publishedAt: 2026-10-10
release: v0.3.251
evidence: ["commit:d06e01c8cfca75152777a6e653b298f24a742d5c", "commit:03668cdc6506ea4ed93f4166387533e5bd30bd84", "pr:1638", "workflow:38078641800", "workflow:38077171997"]
---

Space watches reconnect after a temporary connection failure and load missed
messages without displaying duplicates. The existing view stays open during
recovery. Recovery never resends a message or starts another Agent task.

A watch reports failure when recovery cannot finish, so scripts can detect an
interrupted stream. Leaving the watch yourself remains a normal exit.
