---
id: center-agent-failure-diagnostics
title: Keep Center Agent decisions independent of wording
kind: fixed
areas: ["center-agent", "diagnostics", "channels"]
audiences: ["members", "admins"]
---

Center Agent no longer decides whether work succeeded, a Profile Report found
useful evidence, a connected App action is destructive, or reply publication
failed by searching ordinary prose, action names, or diagnostic wording. It now
uses structured results, declared effects, and lifecycle events; actions that
do not declare an effect remain safely constrained.
