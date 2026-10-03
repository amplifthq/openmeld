---
id: inbox-action-source-reliability
title: More reliable Inbox actions and failure reminders
kind: fixed
areas: ["inbox", "agents"]
audiences: ["users"]
publishedAt: 2026-10-03
release: v0.3.237
evidence: ["pr:1456", "commit:a34b1544f955570b2b320fa79801e96ffa3e9443", "workflow:37044018284", "commit:60509153ca78fd785360206369f803b6f5b58f7d"]
---

Old automatic-continuation failures are repaired when Inbox refreshes, removing
incorrect requests for action and opening the failure in its original conversation.
Read and removed states are preserved.

Agent permissions, questions, and plan reviews retain a response receipt after
delivery. Retrying the same answer is safe; a conflicting answer is rejected,
and a handled request cannot reappear as a new approval.
