---
id: conversation-sidebar-performance
title: Less background work in the conversation sidebar
kind: improved
areas: ["web", "desktop", "spaces"]
audiences: ["users"]
---

The conversation sidebar avoids unnecessary updates when its contents have not
changed. Hovering conversations with profile or session links now preloads the
correct destination without sending malformed Space requests. The sidebar's
appearance and interactions stay the same in Web and Desktop.
