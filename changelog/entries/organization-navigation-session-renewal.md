---
id: organization-navigation-session-renewal
title: Keep organization navigation available during session renewal
kind: fixed
areas: ["web", "authentication"]
audiences: ["users", "operators"]
---

Selecting the current navigation destination no longer reloads the organization
page. Organization entry checks run independently of background session renewal,
while continuing to verify current access. Error details include a request ID
that connects browser failures with Web and Auth diagnostic stages.
