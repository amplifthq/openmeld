---
id: faster-inbox-and-team-loading
title: Faster Inbox and Team loading
kind: improved
areas: ["inbox", "team", "spaces"]
audiences: ["users"]
---

Inbox starts loading earlier and retains recent views when you switch pages.
Background refresh keeps visible items in place and finishes before loading
older items. Inbox and Team also make fewer sequential database requests.

Space lists use live updates with less frequent background recovery checks,
reducing unnecessary requests while the app is idle.
