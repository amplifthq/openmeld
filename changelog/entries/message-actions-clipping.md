---
id: message-actions-clipping
title: Keep message actions fully visible
kind: fixed
areas: ["spaces", "web", "desktop"]
audiences: ["members"]
publishedAt: 2026-10-04
evidence: ["pr:1503", "pr:1507", "commit:88b0a3114b9894af5b748da492c62759bd4a2a81", "commit:a956440cb31b9388c9f6469d5b6b7162eb9bf458", "desktop-candidate:5b005262390436c05458e67a87b2051d99835eae687f3412d2fe78b6c2c20eab"]
---

Message actions remain fully visible above wide message bubbles, including
consecutive messages with an error. The error details and other actions are
no longer cut off at the top of the message.
