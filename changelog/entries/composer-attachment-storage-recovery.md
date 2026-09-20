---
id: composer-attachment-storage-recovery
title: Recover attachment drafts after local storage interruptions
kind: fixed
areas: ["web", "desktop"]
audiences: ["users"]
---

If local attachment storage closes while you are preparing a message, OpenMeld
now reconnects and lets you retry the same attachment without losing its draft
identity or staging an unnecessary second upload. Space, Thread, Center Agent,
and inline-edit composers keep failed attachments and cleanup visible until the
specific operation succeeds or you remove it. Messages are never sent
automatically during recovery.
