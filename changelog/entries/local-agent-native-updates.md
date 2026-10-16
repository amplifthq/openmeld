---
id: local-agent-native-updates
title: Update native Claude Code from Computer details
kind: new
areas: ["agents", "web", "desktop", "cli"]
audiences: ["users"]
publishedAt: 2026-10-14
release: v0.3.261
evidence: ["pr:1728", "workflow:38595947657", "workflow:38590148705", "commit:4a84cdbcdfeddeaf2a12b8f6bd5dc990afb78b9d", "commit:57246148ea8b2e1fd0b92f2df66f20c52e231c78", "commit:b461313d90eca6d6283b28e784ecb61625692886"]
---

Computer details in Web and Desktop can update the selected native Claude Code
installation on macOS and Linux. Updates use Claude Code's configured release
channel. You can start an update when Claude Code has no OpenMeld work in progress.

You can close the details window and return to check the result. OpenMeld verifies
the installed version and does not automatically repeat an unconfirmed update.
Other installation methods keep their existing manual update instructions.
