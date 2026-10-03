---
id: exact-agent-evidence-and-replay-guidance
title: Hand off exact evidence with scoped Plugin access
kind: improved
areas: ["agents", "spaces", "plugins"]
audiences: ["members"]
---

Wake requests can include exact message, thread, and file revision references.
Center Agents can pin message and thread versions before handing them off.
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
Replay admission also refuses older records without a verified original account
version. Duplicate claims preserve known completion or failure, the original
operation, and account attribution without inventing missing result data.

Local Plugin writes that need fresh authorization appear privately in your
Inbox. Review the account and action, then use the code sent to your verified
email to approve or decline the request. You can continue a manual CLI request
without creating a Space. Retrying the same approved request keeps its original
identity; approving a new request does not resolve an older uncertain result.
