---
id: browser-notification-reliability
title: More reliable browser notifications
kind: fixed
areas: ["inbox", "settings", "web"]
audiences: ["members"]
---

Keeping an OpenMeld conversation visible in another, unfocused window no longer
marks its messages as read or suppresses their notifications.

Notification delivery now waits for the browser's display acknowledgement and
retries failed or unconfirmed attempts. Busy conversations are checked across
pages, so new updates are not missed just because the latest page is full.

When browser site storage is unavailable, notification settings show that
delivery is paused without changing your saved preference. Browser notifications
still require OpenMeld to remain open; system notification and Focus settings
continue to control whether a banner appears.
