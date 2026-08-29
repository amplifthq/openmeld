---
id: require-legacy-cli-update
title: Require unsafe legacy CLI versions to update
kind: fixed
areas: ["cli", "computers", "local-agents"]
audiences: ["members"]
---

OpenMeld now asks CLI versions earlier than 0.3.126 to update before they run
normal product commands. Update, setup, repair, status, diagnostics, sign-in,
and version checks remain available so an older installation can always recover.
Supported CLI versions at or above 0.3.126 are not forced to install every new
release.
