---
id: faster-space-and-message-entry
title: Open Spaces and messages without waiting on identity
kind: improved
areas: ["spaces", "messages", "people"]
audiences: ["members"]
publishedAt: 2026-09-05
release: v0.3.157
evidence: ["pr:645", "commit:cef0991aa6629da05d753a49ae3638c37a489754", "workflow:33941996083", "worker-version:efe5f224-b75a-4744-a08f-220475c34e7e", "smoke:chrome:space-and-direct-message-entry-20260905"]
---

Returning to a Space now restores its recent conversation and exact reading
position sooner. Member controls, profile details, Direct Message avatars, and
People connection states also remain useful and honest while current data is
still loading, and repeated Space image previews reuse the same downloaded
content.
