---
id: task-continuation-work-loop-stop
title: Keep continued summaries working and stoppable
kind: fixed
areas: ["wake", "center-agent"]
audiences: ["users"]
---

Delegated summaries that continue into another execution round keep their
connection to the original task. OpenMeld can check their progress and forward
Stop without incorrectly rejecting the new round as an identity mismatch.
