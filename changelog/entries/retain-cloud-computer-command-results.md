---
id: retain-cloud-computer-command-results
publishedAt: 2026-10-07
release: v0.3.247
evidence: ["pr:1557", "pr:1568", "worker-version:3c584f02-1241-45b1-84b7-b27eed8666b4"]
title: Keep cloud command results available during longer tasks
kind: fixed
areas: ["center-agent", "computer"]
audiences: ["users"]
---

Cloud Computers collect and save command results while an agent works on other
steps. A completed result remains available after the runtime removes its
temporary command log. File synchronization must be confirmed before a command
reports completion.

An agent can recover from a reported command loss without the same error
discarding its final response. Interruption notices use simpler instructions and
no longer direct you to an unspecified Diagnostics screen.
