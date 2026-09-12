---
id: reliable-computer-setup-recovery
title: More reliable Computer setup and recovery
kind: fixed
areas: ["computer", "cli"]
audiences: ["users"]
---

Computer setup requests a macOS background Service start without restarting an
already running Service. Startup failures retain diagnostic details, and CLI
update and diagnostic commands remain available when an earlier connection
cannot recover.

Setup also migrates original local agent settings without requiring a reset.
An older npm installation that cannot update no longer blocks setup through
the new managed OpenMeld binary.

Web onboarding keeps an active Terminal connection flow in place while computer
status refreshes, so a successful connection can finish in the same flow.
