---
id: github-computer-continuity
title: Continue GitHub work without losing Computer results
kind: fixed
areas: ["center-agent", "computer", "plugins"]
audiences: ["users"]
---

GitHub actions can complete their confirmation step without repeatedly asking
for the same confirmation. Computer Git checkouts retain a stable repository
address and use temporary authorization for Git transfers. When a command
status check times out, the Agent keeps its saved results and original command
reference, explains what remains unknown, and can check that command again
without starting it twice.

If a final Computer check cannot confirm completion, the saved Agent response
remains available with a clear warning about unverified results instead of
being replaced by a generic failure message.
