---
id: agent-usage-before-wake
title: Check Agent usage before sending a Wake
kind: fixed
areas: ["agents", "spaces"]
audiences: ["users"]
publishedAt: 2026-09-15
evidence: ["pr:1068", "commit:b96b139292217db0bcd1a86c2604b0c99349ca91", "workflow:34938662680"]
---

Agent cards and profile pages show teammates' reported remaining usage and
reset times. The mention picker and composed Agent mentions show a usage
preview, and selecting a composed Agent name opens its profile card. Teammates'
cards also include an arrow to their full profile; owners keep the edit shortcut.
Unavailable usage stays unknown, and older observations stay marked as stale.
When a reported limit prevents a Wake, the Composer shows the known reset time
next to the existing status. Quota failures state the reason in the conversation;
message details show current reset guidance without changing the recorded outcome.
