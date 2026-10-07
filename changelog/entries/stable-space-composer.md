---
id: stable-space-composer
publishedAt: 2026-10-07
release: v0.3.246
evidence: ["pr:1532","commit:28242f81d13293ddb3154ac27fe36137f4cef7eb","worker-version:9ad65d51-9690-4d55-a2c1-95cb50d1f4d5"]
title: Keep writing while a Space loads
kind: fixed
areas: ["spaces", "web"]
audiences: ["users"]
---

Start a draft as soon as a Space opens. The message editor stays in place while
messages and members load, so loading does not interrupt typing or reset the
cursor. Switching Spaces keeps each conversation's draft separate. Sending
still checks current access before posting.
