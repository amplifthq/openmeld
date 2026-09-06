---
id: existing-spaces-message-preview-upgrade
title: Keep existing chats writable after the preview upgrade
kind: fixed
areas: ["spaces"]
audiences: ["members"]
---

Existing chats now create the message preview counter during their database
upgrade. Sending a message no longer fails because the chat already completed
an earlier database version. Existing messages and preview ordering are preserved.
