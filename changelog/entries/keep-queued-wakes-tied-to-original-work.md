---
id: keep-queued-wakes-tied-to-original-work
title: Keep queued Wakes tied to their original request
kind: fixed
areas: ["spaces", "wake", "agent-profiles", "openmeld-service"]
audiences: ["members"]
---

Queued workstation Wakes now keep the prompt, attachments, reply location,
agent configuration, and computer identity they had when OpenMeld accepted
them. Promotion or reconnect can no longer run an older Wake with a later
message or Agent Profile setup.
