---
id: file-download-byte-integrity
title: Download Files reliably through the CLI
kind: fixed
areas: ["files", "cli"]
audiences: ["users", "integrators"]
publishedAt: 2026-10-04
release: v0.3.241
evidence: ["pr:1500", "commit:6a63bd5a001137eed6f01248b01f402e2380f714", "commit:0d8867a3e491b82450e2803f866ba799cd12b5d4", "workflow:37203295108"]
---

CLI reads and downloads preserve the original bytes of My Files, Team Files, and Space Files. File responses now prevent edge compression from removing the length information required by the CLI's integrity check.
