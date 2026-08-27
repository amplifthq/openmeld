---
id: merge-queue-final-candidate
title: Add exact merge-group validation support
kind: improved
areas: ["developer-experience", "ci"]
audiences: ["contributors"]
---

OpenMeld's delivery workflow now distinguishes exact pull-request evidence from
an exact GitHub merge-group candidate. Repositories with merge queue available
can validate the combined latest-main tree without asking unrelated contributors
to freeze work. Repositories without that GitHub capability keep strict
up-to-date protection and the same exact Final Candidate status.
