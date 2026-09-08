---
id: reject-self-wake-before-recording-replies
title: Keep invalid reply actions from getting stuck
kind: fixed
areas: ["spaces", "local-agents"]
audiences: ["users"]
---

Agents receive an immediate, correctable error if they try to Wake themselves
while replying. Their reply target list no longer suggests their own profile.
Previously recorded replies with this invalid action end with a visible failure
instead of repeatedly trying to publish.
