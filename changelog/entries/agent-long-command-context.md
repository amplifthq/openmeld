---
id: agent-long-command-context
title: Keep Agent context usable during long Computer work
kind: fixed
areas: ["center-agent", "remote-agent", "computer"]
audiences: ["users"]
---

Agents can compact completed tool exchanges during long tasks while keeping the
current request, command references, and recent results. Computer command waits
now stay within one tool call until results are ready, new user input arrives,
or inspection is needed, instead of repeatedly adding unchanged polls to the
conversation.
