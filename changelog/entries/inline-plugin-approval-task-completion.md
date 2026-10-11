---
id: inline-plugin-approval-task-completion
title: Review Plugin actions where the work started
kind: fixed
areas: ["spaces", "tasks", "plugins"]
audiences: ["members"]
---

Plugin action requests now appear on their original Space or Thread message,
and in the expandable pending-action tray above the composer, alongside Local
Agent requests. Pending actions remain available when the message scrolls out
of view. Approving a supported
message request automatically asks the Agent to continue with the approved
account and action. Inbox shows the same decision.
Approval continues with the original requester profile, even when a different
profile is selected in Inbox. Pending recovery no longer skips newer approvals
behind long-running requests. Guest Spaces remain usable without Organization
approval access.

GitHub issues closed as completed now finish linked Tasks, or submit their
result for the assigned reviewer. Issues closed as not planned or duplicates
cancel the Task. An unknown closure reason does not guess a Task outcome.
Results and Activity recorded by GitHub identify GitHub as their source instead
of attributing the change to the Task creator.
If a GitHub write succeeds before Task synchronization finishes, retrying the
same operation completes the synchronization without repeating the write.
