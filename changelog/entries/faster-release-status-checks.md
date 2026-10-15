---
id: faster-release-status-checks
title: Faster release checks with visible stage timings
kind: improved
areas: ["releases"]
audiences: ["operators", "contributors"]
---

Release checks avoid downloading unchanged deployment receipts and read
independent workflow histories concurrently. Automatic continuation reports
time spent checking status and running each component, so operators can locate
delays without repeating a deployment. Fresh evidence and release checks remain
required.
