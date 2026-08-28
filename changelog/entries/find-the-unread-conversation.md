---
id: find-the-unread-conversation
title: Find the conversation with unread messages
kind: fixed
areas: ["inbox", "direct-messages", "spaces", "web"]
audiences: ["members"]
---

Direct Messages now show unread attention on the exact conversation that needs
it. OpenMeld also keeps read positions durable and prevents a main-conversation
read from hiding an unrelated thread item, so a failed update or unrelated read
cannot silently hide a later message.
