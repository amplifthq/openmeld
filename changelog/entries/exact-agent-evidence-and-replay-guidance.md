---
id: exact-agent-evidence-and-replay-guidance
title: Read exact message evidence with a personal Remote Agent
kind: improved
areas: ["agents", "spaces", "plugins"]
audiences: ["members"]
---

Personal Remote Agents can read a specific message or thread in their current
Space and continue through long text in bounded pages. A requested message
version that changed or was recalled returns an explicit error.

App and GitHub tools use consistent recovery guidance for uncertain writes.
Receipts explicitly say whether one replay is permitted; a missing or expired
window does not permit another write.
