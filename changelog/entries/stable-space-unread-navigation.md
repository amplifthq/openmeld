---
id: stable-space-unread-navigation
title: Keep Space unread navigation stable
kind: fixed
areas: ["spaces", "inbox", "web"]
audiences: ["members"]
---

Space unread counts no longer change just because messages move into or out of
the viewport. The blue **New messages** divider stays where the visit began,
and unread Thread shortcuts open the exact reply.

The existing latest-message button can now catch up the main conversation even
when it is short or opened in historical messages. Messages that arrive after
the click and unread Thread replies remain unread. If saving the read position
fails, OpenMeld keeps the same boundary and offers a clear retry.
