---
id: resume-computer-release-verification
title: Complete Computer release verification without deploying again
kind: fixed
areas: ["computer", "developer-workflow"]
audiences: ["operators"]
---

If a Computer update finishes but its verification record cannot be saved,
operators can resume verification of that same update. The guarded release
checks the deployed Worker and Container before saving the original release
record. It does not repeat the deployment or user commands.
