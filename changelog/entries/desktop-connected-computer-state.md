---
id: desktop-connected-computer-state
title: Desktop recognizes an already connected computer
kind: fixed
areas: ["desktop", "computers"]
audiences: ["members"]
publishedAt: 2026-10-03
release: v0.3.240
evidence: ["pr:1483", "commit:15549cc047d90f90edfbe2a1209919681a1e7e24", "workflow:37138467122", "https://openmeld.ai/desktop?candidate=d26801c5b9439dfe0f47eea747d50c22157b2ff729c31fd4b0b864d40faa3d69"]
---

Desktop’s Computer entry checks this Mac’s existing connection before offering
setup. Connected computers show their connection status, and a completed
reconnection returns to connection management instead of offering Connect again.
After disconnecting, Desktop no longer describes the signed-out computer as
connected to another account.
