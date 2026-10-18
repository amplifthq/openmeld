---
id: desktop-service-update-wait
title: Clearer waiting during computer updates
kind: fixed
areas: ["desktop", "cli", "service"]
audiences: ["users"]
---

Computer setup explains when an update is waiting for current tasks and continues
automatically when they finish. Desktop observes the background update without
holding the setup lock or requesting connection credentials. Observation ends
after 30 minutes with a check-and-retry message; tasks and the update continue.
Setup itself releases its lock at its fixed 15-minute limit.

Running tasks keep their Stop control when the Agent's startup readiness report
expires or becomes unavailable. OpenMeld still waits for the Agent to confirm
that the task stopped.

Tasks already queued on the computer survive a temporary connection loss.
They keep their execution identity and must pass admission checks again before
the Agent starts.
