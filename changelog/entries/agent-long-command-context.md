---
id: agent-long-command-context
title: Keep Agent context usable during long Computer work
kind: fixed
areas: ["center-agent", "remote-agent", "computer"]
audiences: ["users"]
publishedAt: 2026-10-14
evidence: ["pr:1711", "commit:f1de97e2a4bc43b2ace742e3fa950b60c26abe40"]
---

Agents can compact completed tool exchanges during long tasks while keeping the
current request, command references, and recent results. Computer command waits
now stay within one tool call until results are ready, new user input arrives,
or inspection is needed, instead of repeatedly adding unchanged polls to the
conversation.
