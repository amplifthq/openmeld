---
id: github-computer-continuity
title: Continue GitHub work without losing Computer results
kind: fixed
areas: ["center-agent", "computer", "plugins"]
audiences: ["users"]
---

GitHub actions can complete their confirmation step without repeatedly asking
for the same confirmation. Computer Git checkouts retain a stable repository
address and use temporary access only for the current command. When a command
status check times out, the Agent keeps its saved results and original command
reference, explains what remains unknown, and can check that command again
without starting it twice.
