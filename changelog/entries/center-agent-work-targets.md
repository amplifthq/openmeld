---
id: center-agent-work-targets
title: Keep the Center Agent's goal and repository attached to the request
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["members"]
---

The Center Agent keeps a request's goal, code repositories, and issue destination
through context compaction and runtime rollover. A correction such as switching
from one repository to another stays attached to that request, while independent
Tasks retain their own targets.

Repository operations check the selected target before execution. Code work and
issue creation can use different destinations without changing each other's scope.
