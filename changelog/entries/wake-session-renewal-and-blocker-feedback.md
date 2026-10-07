---
id: wake-session-renewal-and-blocker-feedback
title: More reliable Wake session renewal and clearer blocker updates
kind: fixed
areas: ["agents", "cli"]
audiences: ["users", "developers"]
---

Wake session renewal no longer rereads a verified, unchanged credential from
secure storage. A temporary Keychain failure therefore does not interrupt that
renewal. New credentials still require storage verification, and remote access
checks remain in place.

Wake instructions now tell agents to share meaningful blockers in the Space
and end with a clear explanation when work cannot continue. Repeated approval
delivery no longer logs another local resume. Cloud Computer help includes
capability discovery and valid operation examples.
