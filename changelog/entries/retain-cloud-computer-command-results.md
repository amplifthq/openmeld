---
id: retain-cloud-computer-command-results
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
