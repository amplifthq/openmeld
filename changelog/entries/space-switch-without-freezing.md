---
id: space-switch-without-freezing
title: Switching Spaces no longer freezes the window
kind: improved
areas: ["spaces", "web", "desktop"]
audiences: ["members"]
---

Switching Spaces on the web and in the desktop app no longer freezes the
window. The address and the selected Space in the sidebar update right away,
and the conversation appears shortly after. Long conversations show the newest
messages first and load earlier ones as you scroll up. Messages you have
already seen render faster when you return to a Space.

Opening a Space waits on fewer server round trips, and a database query that
slowed many requests now uses its index. When live updates are unavailable,
the app checks for new Inbox items less often instead of every second.

In long conversations, the browser's find command only searches the messages
that are currently shown. Scroll up to load earlier messages before you search
them.
