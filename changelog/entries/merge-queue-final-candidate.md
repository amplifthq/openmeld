---
id: merge-queue-final-candidate
title: Keep validated pull requests moving while main changes
kind: improved
areas: ["developer-experience", "ci"]
audiences: ["contributors"]
---

OpenMeld's delivery workflow now preserves completed evidence for an unchanged
pull request while other work lands. GitHub validates the exact combined merge
tree before merging, so contributors no longer need to freeze unrelated work or
repeat successful checks only because `main` advanced.
