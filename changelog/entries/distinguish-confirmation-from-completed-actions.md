---
id: distinguish-confirmation-from-completed-actions
publishedAt: 2026-09-06
evidence: ["pr:689", "pr:693", "commit:5bffe90ba001eec03f043797a61940fc922d9e06"]
title: Distinguish confirmation requests from completed actions
kind: fixed
areas: ["center-agent", "plugins"]
audiences: ["users"]
---

Center Agent work summaries identify actions that are waiting for confirmation
instead of describing them as already executed. Confirmation requests remain
separate from completed actions when similar steps are grouped together.
