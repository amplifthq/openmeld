---
id: cli-replies-within-threads
title: Reply to any message in a thread from the CLI
kind: fixed
areas: ["cli", "spaces"]
audiences: ["users", "integrators"]
---

`space send --reply-to` keeps replies in the message's existing thread, including
when the target is another reply. Messages outside a thread still start one.
