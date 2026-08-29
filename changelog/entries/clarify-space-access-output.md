---
id: clarify-space-access-output
title: See how a Space can be found and opened
kind: fixed
areas:
  - spaces
  - cli
audiences:
  - members
  - agents
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:422", "commit:85e312aa80bfeeb04f280603d17b05b2a57e655e", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "pr-comment:5463688488"]
---

OpenMeld CLI now separates Organization visibility from link access in Space
lists and status output. An invite-only Space is no longer mistaken for
members-only when anyone with its link can open it.
