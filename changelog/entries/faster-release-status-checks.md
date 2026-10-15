---
id: faster-release-status-checks
title: Faster release checks with visible stage timings
kind: improved
areas: ["releases"]
audiences: ["operators", "contributors"]
publishedAt: 2026-10-15
release: v0.3.262
evidence: ["pr:188", "pr:190", "pr:193", "workflow:38676811108", "workflow:38677222696"]
---

Release checks avoid downloading unchanged deployment receipts and read
independent workflow histories concurrently. Automatic continuation reports
time spent checking status and running each component, so operators can locate
delays without repeating a deployment. Fresh evidence and release checks remain
required.

CLI publication now requires the exact Windows helper used to prepare the
release manifest. Automatic continuation reports a missing helper pin before
deploying another selected component, instead of rebuilding different native
bytes during publication.
