---
id: quieter-composer-wake-checks
title: Keep writing while Agent availability updates
kind: improved
areas: ["spaces", "agents"]
audiences: ["users"]
---

Existing Wake drafts can start sending while OpenMeld checks the Agent's latest
availability. Short checks stay quiet; longer checks show a small indicator beside
Wake. Recovery appears as one muted action instead of a red warning beside a
second button. Failed connection checks no longer claim the computer disconnected.

OpenMeld still checks current access and availability before publishing. A failed
check preserves unsent content, and waiting for an offline computer remains explicit.
Connection checks also time out cleanly instead of leaving a message waiting
indefinitely when the browser is offline or a response stalls.

Offline Wakes remain selectable when waiting is supported. Send and wait uses
the main send button, with a compact offline explanation beside it. Reference
mentions are now labeled Mention only, with a short explanation that they won’t
wake the Agent. They never silently start a task.

Drafts with mentions show a quiet loading hint while members load and offer Retry
if loading fails. Feedback stays inside the Composer without a separate warning
box. Availability updates no longer let older responses replace newer state or
repeat the same refresh from multiple page listeners.

Recently viewed conversations with unread messages can load new messages before
you open them. Returning to a conversation also prepares new messages on hover,
while keeping your reading position and unread status intact.
