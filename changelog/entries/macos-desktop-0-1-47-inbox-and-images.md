---
id: macos-desktop-0-1-47-inbox-and-images
title: Refresh expired Inbox views and load Space images on macOS
kind: fixed
areas: ["desktop", "inbox", "spaces"]
audiences: ["users"]
publishedAt: 2026-11-03
evidence: ["pr:369", "commit:fe736d9a32c421e0e60f267d0338d0be1addff0a", "https://openmeld.ai/desktop?candidate=ebe64bbcd6b0f9b46fffb7095b4e34e1adb96e530aabae1191834e51cb70dd39"]
---

OpenMeld Desktop 0.1.47 for Apple silicon includes the Inbox refresh and
Space image fixes. An expired Inbox view offers a single refresh action, and
Space images keep their static placeholder when the browser engine cannot
start the loading animation.
