---
id: verified-slack-thread-publication
title: Publish only to verified Slack threads
kind: security
areas: ["slack", "center-agent"]
audiences: ["members"]
publishedAt: 2026-08-19
release: v0.3.76
evidence: ["pr:143", "commit:b192a404a2a3fd7c3e33838d3db9d5d47ead4a6b", "workflow:32255551305", "workflow:32257426899"]
---

Center Agent thread replies now require an exact Slack message link from the
request or the Slack evidence it just read. OpenMeld verifies that link against
the connected workspace before publishing, so an invented channel or timestamp
cannot redirect the reply.
