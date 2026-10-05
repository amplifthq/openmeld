---
id: faster-inbox-and-team-loading
title: Faster Inbox and Team loading
kind: improved
areas: ["inbox", "team", "spaces"]
audiences: ["users"]
publishedAt: 2026-10-06
evidence: ["pr:1524", "commit:20425528edfe6aec5b11700e52cef34735e284aa", "workflow:37365763256"]
---

Inbox starts loading earlier. Inbox, Team, and conversation lists retain loaded
content through an overnight pause in the same browser tab, then refresh when
you return.
Background refresh keeps visible items in place and finishes before loading
older items. Inbox and Team also make fewer sequential database requests.

Space lists use live updates with less frequent background recovery checks,
reducing unnecessary requests while the app is idle.
