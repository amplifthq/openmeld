---
id: verified-slack-thread-publication
title: Publish only to verified Slack threads
kind: security
areas: ["slack", "center-agent"]
audiences: ["members"]
---

Center Agent thread replies now require an exact Slack message link from the
request or the Slack evidence it just read. OpenMeld verifies that link against
the connected workspace before publishing, so an invented channel or timestamp
cannot redirect the reply.
