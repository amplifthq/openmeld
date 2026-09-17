---
id: agent-results-reconnect-replay
title: Deliver saved Agent results promptly after reconnecting
kind: fixed
areas: ["computer", "cli"]
audiences: ["users"]
publishedAt: 2026-09-13
release: v0.3.200
evidence: ["pr:974", "pr:975", "commit:de0140fd0892ffb13fd6a670a30a5c96074b6c39", "workflow:34731853294", "smoke:dispatch:f810516d-a222-4669-a884-225f612e5f0a"]
---

When your computer reconnects, OpenMeld immediately retries saved Agent results
that have not been confirmed, so waiting work can continue without an extra
delay from the previous connection. Confirmed results stay settled.
