---
id: find-the-unread-conversation
title: Find the conversation with unread messages
kind: fixed
areas: ["inbox", "direct-messages", "spaces", "web"]
audiences: ["members"]
publishedAt: 2026-08-30
release: v0.3.132
evidence: ["pr:434", "commit:f030ca6e5c446fc109b2c199ef5d7e5dc6074107", "commit:cc1aacf11c2f3abf8bbd3cfc148269a30d818e3e", "tag:v0.3.132", "worker-version:acb7e69e-ffed-4ef2-96e7-c734a2598961", "worker-version:c3c4d138-2fd2-4df6-9ef2-d49fb24cf085"]
---

Direct Messages now show unread attention on the exact conversation that needs
it. OpenMeld also keeps read positions durable and prevents a main-conversation
read from hiding an unrelated thread item, so a failed update or unrelated read
cannot silently hide a later message.
