---
id: conversation-queue-recovery
title: Continue paused work from the conversation
kind: improved
areas: ["agents", "spaces", "web"]
audiences: ["users"]
---

Continue an occupied conversation on a new branch or skip paused work from the
existing message queue. Requesters can manage their own paused work when the
operation does not affect other people's work or require shared write access.
Sorting, Send now, editing, and deletion keep
their familiar controls. Untouched queued messages follow a new branch without
resending messages whose delivery is uncertain.
Send errors appear beside the send button, with room to wrap on small screens.

Codex work can continue automatically after an occupied-conversation wait when
OpenMeld confirms that no turn started and the task cannot modify shared files.
Tasks that need an owner's decision keep the existing recovery choices.

Shared Spaces keep each person's follow-ups attached to their own response.
One person's pending messages no longer hold up another independent task.
Send now is available only while that response is running. Waiting for another
app is shown separately from waiting for earlier tasks.

Center Agent chats use the same Queue. Follow-ups can enter it while the first
request starts, without appearing as a second running task.
