---
id: desktop-protected-service-controls
title: Start and stop an existing Service in the Desktop pilot
kind: new
areas: ["desktop", "service"]
audiences: ["contributors"]
---

The local macOS Desktop pilot can start and stop an existing Service when its
installed CLI and Service support account-checked control. Actions retain the
displayed account, and Stop waits for current work to finish.

Unsupported pairs keep controls disabled. Other Computer changes open in Web;
the Desktop pilot also refuses direct requests for those changes. Public Desktop
distribution remains outside this pilot.
