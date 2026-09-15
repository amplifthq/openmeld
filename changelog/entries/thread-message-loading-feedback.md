---
id: thread-message-loading-feedback
title: Easier, faster access to Thread replies
kind: improved
areas: ["spaces"]
audiences: ["users"]
publishedAt: 2026-09-15
evidence: ["pr:1070", "commit:c1c13deed77ad26b20c86fa2978de14b05b919d6", "workflow:34938662680"]
---

Thread previews open across the whole reply row and show the latest replies,
authors, and times. New Threads appear when their first reply arrives. Message
loading has a visible indicator, and previews and restored panels warm their
messages before opening.

Links from Agent conversations locate the message shown in the preview. Explicit
Thread links begin loading their messages alongside the Space, and show the
Thread loading panel while access and conversation data are being checked.

Messages in Spaces, Threads, and direct messages become read after their
beginning stays visible briefly. Long replies no longer require scrolling to the
end, and unseen messages and closed Threads keep their unread indicators.

Agent progress follows the selected reply destination. Completed replies in a
Thread also clear stale progress in the main conversation.
