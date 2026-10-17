---
id: space-live-updates-survive-database-hiccups
title: Keep Space live updates connected through brief database delays
kind: fixed
areas: ["spaces", "web"]
audiences: ["members"]
---

A brief delay while OpenMeld checks someone's access no longer disconnects
everyone in a Space or drops live updates such as Wake progress and approval
requests. Only the affected connection pauses and reconnects, then catches up
on what it missed. People who lose access to a Space are still disconnected
right away.
