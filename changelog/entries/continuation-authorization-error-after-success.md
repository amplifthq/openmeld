---
id: continuation-authorization-error-after-success
title: Stop reporting an error after a continuation is accepted
kind: fixed
areas: ["agent-profiles", "wake"]
audiences: ["users"]
---

Choosing to continue interrupted Agent work on a new branch reported a failure
even though OpenMeld had already accepted the choice, so the action looked
broken until the page was reloaded. The confirmation now matches what the
server recorded.
