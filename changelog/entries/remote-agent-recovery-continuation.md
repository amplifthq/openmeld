---
id: remote-agent-recovery-continuation
title: Resume an interrupted Remote Agent release recovery
kind: fixed
areas: ["releases", "remote-agent"]
audiences: ["operators", "contributors"]
---

Release operators can manually continue a failed Remote Agent recovery when
the recorded Worker and Container state still matches production. The guarded
command preserves the original release attempt and source. It checks the full
recovery evidence chain before deployment and does not replay user commands.
