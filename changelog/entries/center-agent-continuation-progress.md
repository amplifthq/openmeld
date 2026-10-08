---
id: center-agent-continuation-progress
title: Clearer progress while agents keep working
kind: fixed
areas: ["center-agent", "spaces"]
audiences: ["users"]
publishedAt: 2026-10-03
release: v0.3.237
evidence: ["pr:1451", "commit:a34b1544f955570b2b320fa79801e96ffa3e9443", "workflow:37044018284", "commit:804c71e113016556a8d1bfbb95e3d2faa2f2eb89", "commit:60509153ca78fd785360206369f803b6f5b58f7d"]
---

Center Agent tasks that continue after delegated work now show tool progress
and reply text in Spaces and direct messages. Active requests no longer switch
to "Still waiting for the final status" just because no visible update arrived
for 45 seconds. Progress follows the actual task state, with Stop and message
details still available.
