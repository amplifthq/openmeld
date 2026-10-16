---
id: computer-observation-preserves-work
title: Keep Computer work running through status delays
kind: fixed
areas: ["computer", "center-agent"]
audiences: ["users", "operators"]
---

A slow or interrupted status check no longer stops a Computer command while it
prepares or saves results. The Center Agent waits for the original command's
results and keeps explicit Stop available. Normal reply completion also checks
results without cancelling work whose status is unknown.
