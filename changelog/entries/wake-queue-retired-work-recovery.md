---
id: wake-queue-retired-work-recovery
title: Recover an Agent whose Wake queue stopped moving
kind: fixed
areas: ["wake", "agent-profiles"]
audiences: ["users"]
---

An Agent Profile could keep a work slot reserved for a Wake that had already
ended, so new Wakes reported a growing queue position and never started.
Sending a Wake to that Agent now clears the finished work, starts the Wake that
was waiting at the front of the queue, and reports the real position for
everything still waiting.
