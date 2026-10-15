---
id: remote-agent-recovery-continuation
title: Resume an interrupted Remote Agent release recovery
kind: fixed
areas: ["releases", "remote-agent"]
audiences: ["operators", "contributors"]
publishedAt: 2026-10-14
evidence: ["pr:1731", "commit:a7eed0324b807e918f50e2b2d3c00d080dfa512c", "commit:876764f6184c5b73eb84f0aa34b83cf81115d363"]
---

Release operators can manually continue a failed Remote Agent recovery when
the recorded Worker and Container state still matches production. The guarded
command preserves the original release attempt and source. It checks the full
recovery evidence chain before deployment and does not replay user commands.
