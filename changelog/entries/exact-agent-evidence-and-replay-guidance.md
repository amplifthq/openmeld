---
id: exact-agent-evidence-and-replay-guidance
title: Hand off exact evidence with scoped Plugin access
kind: improved
areas: ["agents", "spaces", "plugins"]
audiences: ["members"]
---

Wake requests can include exact message, thread, and file revision references.
Local and personal Remote Agents can read the referenced evidence in bounded
pages, with access checked again on each page. Unavailable versions return an
explicit error. Recorded one-hop delegation can grant an ordinary Plugin read
or write for an exact input and account, subject to current access settings.

Members can use `files copy-excerpt` to share selected text from their own
message with an explicitly named Space audience. The resulting file contains
only that selection and has its own access and lifecycle.

App and GitHub tools use consistent recovery guidance for uncertain writes.
Receipts explicitly say whether one replay is permitted; a missing or expired
window does not permit another write.
