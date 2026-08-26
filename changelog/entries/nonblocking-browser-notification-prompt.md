---
id: nonblocking-browser-notification-prompt
title: Keep browser notification setup out of the way
kind: fixed
areas: ["inbox", "notifications", "web"]
audiences: ["members"]
publishedAt: 2026-08-26
evidence: ["pr:301", "pr:298", "commit:c7edbf065f3405a12cf1801322761fc72bd20314", "commit:c2bd412b72928fe97dad262e280044d2c3f915fb"]
---

Browser notification setup now disappears completely after permission is
granted, “Not now” is selected, or the new close button is used, so members can
immediately continue setup or use the page underneath it.
