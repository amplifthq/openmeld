---
id: core-secret-addition-reconciliation
title: Resume releases after adding a Core secret
kind: fixed
areas: ["releases"]
audiences: ["operators", "contributors"]
---

Release operators can reconcile an authorized Core secret addition without
redeploying unchanged code or discarding the previous release record. Recovery
requires proof that the active successor preserves program content and other
configuration, then resumes the normal guarded release.
