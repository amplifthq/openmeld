---
id: steady-agent-status-and-faster-agents-page
title: Keep Agent status steady while it refreshes
kind: fixed
areas: ["agents", "web"]
audiences: ["members"]
---

Agent cards keep their last known status while OpenMeld refreshes it, instead
of briefly switching back to Checking when a status check can't finish.
Checking now appears only before any status has been read. The Agents page and
sidebar also load your chats with every Agent in one request, so members with
many Agents see the page settle sooner.
