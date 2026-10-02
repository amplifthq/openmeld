---
id: inbox-action-source-reliability
title: More reliable Inbox actions and failure reminders
kind: fixed
areas: ["inbox", "agents"]
audiences: ["users"]
---

Old automatic-continuation failures are repaired when Inbox refreshes, removing
incorrect requests for action and opening the failure in its original conversation.
Read and removed states are preserved.

Agent permissions, questions, and plan reviews retain a response receipt after
delivery. Retrying the same answer is safe; a conflicting answer is rejected,
and a handled request cannot reappear as a new approval.
