---
id: reliable-space-messaging-and-computer-settings
title: More reliable Space messaging and Computer settings
kind: fixed
areas: ["spaces", "computers"]
audiences: ["users"]
---

Fixed an intermittent stall when sending a Space message while other Space
requests were loading. Membership checks remain current and continue to deny
access when verification fails.

Computer power settings pause automatic checks while the selected Computer is
disconnected and resume when it reconnects, keeping offline errors visible
without repeating failed requests every five seconds.
