---
id: recover-stalled-desktop-downloads
title: Cancel and retry Desktop update downloads
kind: fixed
areas: ["desktop"]
audiences: ["users"]
publishedAt: 2026-10-08
release: v0.3.248
evidence: ["pr:1581", "commit:22245aa4a774ad28e0ade8ec8d313b98caa1f069", "workflow:37672648199", "workflow:37668077567"]
---

You can cancel an update download and try again. Downloads that stop making
progress show a retry option instead of remaining stuck at the same percentage.
Desktop installers and updates use a cached download service that supports
partial file requests. Installing an update still requires your restart action.
