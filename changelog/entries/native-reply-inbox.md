---
id: native-reply-inbox
title: Keep remote Agent replies visible in Inbox
kind: fixed
areas: ["inbox", "agents"]
audiences: ["users"]
publishedAt: 2026-10-04
release: v0.3.241
evidence: ["pr:1502", "pr:1506", "commit:585184c808cf88810acd332eef7b366883d08cfa", "commit:1f311a527f036ee3fcc9493a9702abd23f8b986d"]
---

Replies and failure notices from remote Agents now reach the member who started the request in a Space. Other members do not receive an update unless they are addressed or participate in the relevant thread.
