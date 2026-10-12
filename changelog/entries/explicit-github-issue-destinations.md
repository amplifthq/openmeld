---
id: explicit-github-issue-destinations
title: Create requested GitHub issues without a Project link
kind: fixed
areas: ["center-agent", "plugins", "projects"]
audiences: ["members"]
---

When you explicitly ask the Center Agent or a Remote Agent to create GitHub
issues in an exact repository, it can use your authorized GitHub connection
without requiring a linked OpenMeld Project or a separate destination approval.
The Agent's Binding must remain active, and Space requests still require
current membership when the request is admitted.

Unclear destinations still use the existing approval in the conversation or
Inbox. Existing approval decisions, connection permissions, and operation retry
protections remain in effect.
