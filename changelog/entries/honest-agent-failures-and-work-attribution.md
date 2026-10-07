---
id: honest-agent-failures-and-work-attribution
title: Clearer Agent failures and work attribution
kind: fixed
areas: ["agents", "center-agent", "spaces"]
audiences: ["members"]
---

OpenMeld now reports confirmed provider limits and other specific Center Agent
failures in plain language, keeps an unpublished Space reply out of the
successful-outcome path, and helps Center Agent trace member-attributed App work
back to its source Space when it came from an OpenMeld Space. Slack and other
external conversation IDs stay in their own conversation records and are never
treated as OpenMeld Space IDs.

Routine failures retain known context, identity, and execution-limit reasons
even when the task's outcome is unconfirmed. They distinguish the stop reason
from whether earlier actions took effect, without exposing private error details.

An unconfirmed App or GitHub write retains its original operation reference.
When the original deduplication window is verified, the Agent can retry that
exact request once, then use a read tool to check the target. If the result is
still uncertain, its final reply identifies the affected action and target.
Expired or unverified windows skip the write retry. These receipts do not
automatically confirm an uncertain write, and reads retain normal retry behavior.

When automatic continuation startup retries stop, Space and Inbox explain the
uncertain outcome and recommend summarizing existing results rather than
resending the original request. These notices and Routine execution failures
use the Organization's language preference when the task's reply language is
unavailable, with English as the final fallback.

A continuation whose startup reply was lost can recover its original execution
reference from a confirmed receipt, then check that execution without another
startup request. An unfinished or missing receipt is still treated as uncertain.

The original requester can ask Center Agent to continue summarizing verified
delegated Space results after the earlier summary has confirmed failure or
cancellation. This creates one new summary attempt, checks current access and
preserves the earlier history. It does not repeat child tasks or restart work
whose execution is still uncertain.

When Routine startup recovery expires without a confirmed receipt, its notice
explains that earlier actions may have happened instead of claiming the Routine
never ran. Known provider and permission causes remain visible in English and
Chinese without suggesting an unchecked repeat of the work.
The same uncertainty is preserved when a delayed notification no longer has
the admission record; it still identifies the original Run and is published
once.

Message Channel startup timeouts now give the same cautious guidance as Spaces:
check the request's status before starting more work, rather than treating a
missing acknowledgement as proof that the request never ran.

Isolated local Git tasks keep configuration and its routing pointers read-only
while allowing normal worktree, index, object, ref, and log writes.

Stopping a parent task also stops continuation startup retries. A temporary
connection problem while forwarding Stop is retried without starting the work
again, including after the Agent's startup acknowledgement arrives. Confirmed
stopped continuations show one stopped notice, including when
their startup acknowledgement never arrived, rather than a failure alert.
