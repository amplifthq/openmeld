---
id: stop-keeps-a-started-local-turn
title: Stopping a resumed local request keeps what already ran
kind: fixed
areas: ["local-agents", "wake"]
audiences: ["users"]
---

When a local Codex conversation was busy in another app, OpenMeld waited for it
and retried. Stopping the request during that retry reported it as stopped
before anything started, even when the retry had already begun a turn, so its
reply or failure was discarded.

Stopping now reports what the retry actually did: a turn that already started
keeps its result, and only a request stopped before its turn began is reported
as never started.
