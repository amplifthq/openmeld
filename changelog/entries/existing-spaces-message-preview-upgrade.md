---
id: existing-spaces-message-preview-upgrade
title: Keep existing chats writable after the preview upgrade
kind: fixed
areas: ["spaces"]
audiences: ["members"]
publishedAt: 2026-09-07
release: v0.3.164
evidence: ["pr:697", "workflow:34048141546", "signal:2ee4894f-6463-4bdc-9abf-4acd6bf76384"]
---

Existing chats now create the message preview counter during their database
upgrade. Sending a message no longer fails because the chat already completed
an earlier database version. Existing messages and preview ordering are preserved.
