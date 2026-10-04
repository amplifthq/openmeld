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
Inbox. Review the account and action, then approve or decline with your signed-in
account. You can continue a manual CLI request
without creating a Space. Retrying the same approved request keeps its original
identity; approving a new request does not resolve an older uncertain result.
Private request details show the proposed PostHog dashboard name and identify
when other input is omitted from the review summary.

Verified owner requests and recorded delegations reuse their original task
authorization. Continuing a task or handing its exact action to a selected
Agent does not require another Inbox approval or repeat a completed write.
Unknown results retain the original operation and account. Only the original
executor can claim its permitted replay.

New Codex tasks started by their owner, including recorded Center delegation,
keep the Agent's permission settings and the Computer's file-access policy.
Starting a separate conversation no longer adds an automatic single-folder
restriction. Explicit task restrictions and older restricted tasks stay in place.
