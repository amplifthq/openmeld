---
id: conversation-queue-recovery
title: Continue paused work from the conversation
kind: improved
areas: ["agents", "spaces", "web"]
audiences: ["users"]
---

Owners can continue an occupied conversation on a new branch or skip paused work
from the existing message queue. Sorting, Send now, editing, and deletion keep
their familiar controls. Untouched queued messages follow a new branch without
resending messages whose delivery is uncertain.

Codex work can continue automatically after an occupied-conversation wait when
OpenMeld confirms that no turn started and the task cannot modify shared files.
Tasks that need an owner's decision keep the existing recovery choices.
