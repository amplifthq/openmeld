---
id: codex-reusable-command-approvals
title: Find automatic review and keep Codex command-prefix approvals
kind: fixed
areas: ["agents", "spaces"]
audiences: ["users"]
---

Permission requests expose supported automatic-review modes before an approval
choice is selected. Current permissions remain selected until the owner
explicitly chooses a change and approves the request.

When Codex supplies a proposed reusable command-prefix rule without an explicit
decision list, OpenMeld now offers that rule and returns the owner's exact
choice to Codex for native persistence. The request explains which prefix is
covered. An explicit restricted decision list remains authoritative; one-time
approvals never become remembered rules. Reusable choices are offered only when
their complete command-prefix rules can be shown before approval.
