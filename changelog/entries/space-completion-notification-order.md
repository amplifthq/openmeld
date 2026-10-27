---
id: space-completion-notification-order
title: Keep completion notifications behind Space updates
kind: fixed
areas: ["spaces", "inbox"]
audiences: ["members"]
---

Fixed a race that let an Agent's completion notification get ahead of its final
reply in an open Space. Space updates now finish their server-side delivery
checks before the corresponding Inbox notification is produced, including
background recovery and Inbox refreshes.
